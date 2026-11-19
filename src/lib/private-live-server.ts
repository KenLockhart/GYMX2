import "server-only";

import {
  createHmac,
  createPrivateKey,
  sign as signBytes,
  timingSafeEqual,
  type JsonWebKey as NodeJsonWebKey,
} from "node:crypto";
import type { UserRole } from "@/lib/types";
import {
  createLiveInput,
  deleteLiveInput,
  findLiveInputsByMetaName,
  getLiveIngestUrl,
  getLiveInputMetaName,
  getLiveStreamAccountId,
  getLiveStreamCustomerCode,
  hasDedicatedLiveStreamConfig,
  isLiveStreamConfigured,
} from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { memberCoachIntakeFailure } from "@/lib/member-intake-server";
import {
  privateLiveAcceptInputSchema,
  privateLiveCleanupLeaseSchema,
  privateLiveGrantInputSchema,
  privateLiveGrantRowSchema,
  isPrivateLiveWindowOpen,
  privateLiveWindowClosesAt,
  privateLiveModeSchema,
  privateLiveOfferInputSchema,
  privateLivePlaybackInputSchema,
  privateLiveProviderStateRowSchema,
  privateLiveProviderTag,
  privateLiveProviderUidSchema,
  privateLiveProvisionInputSchema,
  privateLiveProvisionLeaseSchema,
  privateLiveSessionInputSchema,
  privateLiveStartedInputSchema,
  toPrivateLiveGrantSnapshot,
  type PrivateActionResult,
  type PrivateBroadcastPreparationResult,
  type PrivateLiveDirection,
  type PrivateLiveErrorCode,
  type PrivateLiveSessionResult,
  type PrivatePlaybackResult,
  type PrivateRevokeResult,
  type PrivateSessionOfferResult,
} from "@/lib/private-live";

const PLAYBACK_TOKEN_MAX_MS = 2 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 20;
const CLEANUP_HMAC_PATH = "/api/cron/live-cleanup";
const PRIVATE_PROVIDER_UIDS = privateLiveProviderUidSchema;

type UserClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

export type PrivateLiveActor = {
  id: string;
  role: UserRole;
};

type Session = {
  id: string;
  coachId: string;
  startsAt: string;
  endsAt: string;
  mode: "broadcast" | "one_on_one";
};

type SigningConfiguration = {
  keyId: string;
  jwkValue: string;
};

type PrivateConfiguration = {
  accountId: string;
  customerCode: string;
  signingKey: SigningConfiguration;
};

type LiveProviderConfiguration = {
  accountId: string;
  customerCode: string;
};

type AccountBindingStatus = "matched" | "mismatch" | "unavailable";

type CleanupBatchResult = {
  ok: boolean;
  claimed: number;
  completed: number;
};

function failure<T extends object = object>(
  error: PrivateLiveErrorCode,
): PrivateActionResult<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roleDirection(role: UserRole): PrivateLiveDirection | null {
  if (role === "coach") return "coach";
  if (role === "member") return "member";
  return null;
}

function oppositeDirection(direction: PrivateLiveDirection): PrivateLiveDirection {
  return direction === "coach" ? "member" : "coach";
}

function safeRpcErrorCode(error: unknown): PrivateLiveErrorCode {
  if (!isRecord(error) || typeof error.code !== "string")
    return "temporarily_unavailable";
  if (error.code === "42501") return "not_allowed";
  if (error.code === "P0002") return "not_found";
  if (error.code === "P0001") return "not_ready";
  if (error.code === "22023") return "invalid_request";
  return "temporarily_unavailable";
}

function sessionWindowOpen(session: Session, nowMs = Date.now()) {
  return isPrivateLiveWindowOpen(
    session.startsAt,
    session.endsAt,
    new Date(nowMs),
  );
}

async function memberIntakeAccessError(
  user: UserClient,
  actor: PrivateLiveActor,
  coachId: string,
): Promise<PrivateLiveErrorCode | null> {
  if (actor.role !== "member") return null;
  return memberCoachIntakeFailure(user, coachId);
}

async function readSession(
  user: UserClient,
  sessionId: string,
): Promise<{ session: Session | null; error: PrivateLiveErrorCode | null }> {
  const { data, error } = await user
    .from("calendar_sessions")
    .select("id, coach_id, starts_at, ends_at, live_mode")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) return { session: null, error: "temporarily_unavailable" };
  if (!data) return { session: null, error: "not_found" };
  const mode = privateLiveModeSchema.safeParse(data.live_mode);
  if (!mode.success) return { session: null, error: "temporarily_unavailable" };
  return {
    session: {
      id: data.id as string,
      coachId: data.coach_id as string,
      startsAt: data.starts_at as string,
      endsAt: data.ends_at as string,
      mode: mode.data,
    },
    error: null,
  };
}

async function readGrant(
  user: UserClient,
  sessionId: string,
  grantId?: string,
) {
  let query = user
    .from("private_session_grants")
    .select(
      "grant_id, session_id, generation, state, expires_at, member_camera_allowed, coach_live_at, member_live_at",
    )
    .eq("session_id", sessionId);
  if (grantId) query = query.eq("grant_id", grantId);
  else query = query.order("generation", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) return { grant: null, error: "temporarily_unavailable" as const };
  if (!data) return { grant: null, error: null };
  const parsed = privateLiveGrantRowSchema.safeParse(data);
  return parsed.success
    ? { grant: parsed.data, error: null }
    : { grant: null, error: "temporarily_unavailable" as const };
}

function loadSigningConfiguration(): SigningConfiguration {
  const keyId = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID?.trim();
  const jwkValue = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK?.trim();
  if (!keyId || !jwkValue) throw new Error("Private video isn't configured.");
  return { keyId, jwkValue };
}

function decodeJwk(value: string): NodeJsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
} {
  let candidate = value.trim();
  if (!candidate.startsWith("{")) {
    try {
      candidate = Buffer.from(candidate, "base64").toString("utf8").trim();
    } catch {
      throw new Error("Private playback signing key is invalid.");
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error("Private playback signing key is invalid.");
  }
  if (
    !isRecord(parsed) ||
    parsed.kty !== "RSA" ||
    typeof parsed.n !== "string" ||
    typeof parsed.e !== "string" ||
    typeof parsed.d !== "string" ||
    typeof parsed.p !== "string" ||
    typeof parsed.q !== "string" ||
    typeof parsed.dp !== "string" ||
    typeof parsed.dq !== "string" ||
    typeof parsed.qi !== "string" ||
    (parsed.kid !== undefined && typeof parsed.kid !== "string") ||
    (parsed.alg !== undefined && parsed.alg !== "RS256") ||
    (parsed.use !== undefined && parsed.use !== "sig")
  ) {
    throw new Error("Private playback signing key is invalid.");
  }
  return parsed as NodeJsonWebKey & { kid?: string; alg?: string; use?: string };
}

function privateKeyFromConfiguration(configuration: SigningConfiguration) {
  const jwk = decodeJwk(configuration.jwkValue);
  if (jwk.kid && jwk.kid !== configuration.keyId)
    throw new Error("Private playback signing key is invalid.");
  try {
    return createPrivateKey({ key: jwk, format: "jwk" });
  } catch {
    throw new Error("Private playback signing key is invalid.");
  }
}

function requireDedicatedLiveStreamConfiguration(): LiveProviderConfiguration {
  if (!hasDedicatedLiveStreamConfig() || !isLiveStreamConfigured())
    throw new Error("Private live video isn't configured.");
  const accountId = getLiveStreamAccountId().trim().toLowerCase();
  const customerCode = getLiveStreamCustomerCode();
  if (
    !/^[0-9a-f]{32}$/.test(accountId) ||
    !customerCode ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(customerCode)
  )
    throw new Error("Private live video isn't configured.");
  return { accountId, customerCode };
}

function requirePrivateConfiguration(): PrivateConfiguration {
  const stream = requireDedicatedLiveStreamConfiguration();
  if (!process.env.LIVE_CLEANUP_SECRET?.trim())
    throw new Error("Private live cleanup isn't configured.");
  const signingKey = loadSigningConfiguration();
  privateKeyFromConfiguration(signingKey);
  return { ...stream, signingKey };
}

async function bindPrivateLiveAccount(
  admin: AdminClient,
  accountId: string,
): Promise<AccountBindingStatus> {
  const { data: bound, error: bindError } = await admin.rpc(
    "bind_private_live_account",
    { target_account_id: accountId },
  );
  if (bindError) return "unavailable";
  if (bound !== true) return "mismatch";
  const { data: matches, error: matchError } = await admin.rpc(
    "private_live_account_matches",
    { target_account_id: accountId },
  );
  if (matchError) return "unavailable";
  return matches === true ? "matched" : "mismatch";
}

function accountBindingFailure(status: AccountBindingStatus) {
  return status === "unavailable" ? "temporarily_unavailable" : "not_ready";
}

function base64UrlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function mintPrivateStreamJwt(input: {
  playbackId: string;
  expiresAtSeconds: number;
  nowSeconds?: number;
  signing?: SigningConfiguration;
}) {
  if (!PRIVATE_PROVIDER_UIDS.safeParse(input.playbackId).success)
    throw new Error("Private playback isn't available.");
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(input.expiresAtSeconds) ||
    input.expiresAtSeconds <= nowSeconds + 1 ||
    input.expiresAtSeconds > nowSeconds + Math.ceil(PLAYBACK_TOKEN_MAX_MS / 1000)
  ) {
    throw new Error("Private playback isn't available.");
  }

  const signing = input.signing ?? loadSigningConfiguration();
  const header = { alg: "RS256", kid: signing.keyId };
  const payload = {
    sub: input.playbackId,
    kid: signing.keyId,
    nbf: Math.max(0, nowSeconds - 5),
    exp: input.expiresAtSeconds,
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  let signature: Buffer;
  try {
    signature = signBytes(
      "RSA-SHA256",
      Buffer.from(unsigned),
      privateKeyFromConfiguration(signing),
    );
  } catch {
    throw new Error("Private playback signing failed.");
  }
  return `${unsigned}.${signature.toString("base64url")}`;
}

function privatePlaybackExpiry(
  grantExpiresAt: string,
  sessionEndsAt: string,
  nowMs: number,
) {
  const grantExpiry = Date.parse(grantExpiresAt);
  const sessionClose = privateLiveWindowClosesAt(sessionEndsAt);
  if (
    sessionClose === null ||
    !Number.isFinite(grantExpiry) ||
    !Number.isFinite(sessionClose)
  )
    throw new Error("Private playback isn't available.");
  const expiresAtMs = Math.min(
    nowMs + PLAYBACK_TOKEN_MAX_MS,
    grantExpiry,
    sessionClose,
  );
  if (expiresAtMs <= nowMs + 1000)
    throw new Error("Private playback isn't available.");
  return expiresAtMs;
}

function isValidWhepEndpoint(
  playbackUrl: string,
  uid: string,
  customerCode: string,
) {
  try {
    const url = new URL(playbackUrl);
    const expectedHost = `customer-${customerCode}.cloudflarestream.com`;
    const parts = url.pathname.split("/").filter(Boolean);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === expectedHost.toLowerCase() &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      parts.length === 3 &&
      parts[0] === uid &&
      parts[1] === "webRTC" &&
      parts[2] === "play"
    );
  } catch {
    return false;
  }
}

function isValidWhipEndpoint(
  ingestUrl: string,
  customerCode: string,
) {
  try {
    const url = new URL(ingestUrl);
    const expectedHost = `customer-${customerCode}.cloudflarestream.com`;
    const parts = url.pathname.split("/").filter(Boolean);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === expectedHost.toLowerCase() &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      parts.length === 3 &&
      parts[0] !== "" &&
      parts[0].length <= 256 &&
      /^[a-zA-Z0-9_-]{16,256}$/.test(parts[0]) &&
      parts[1] === "webRTC" &&
      parts[2] === "publish"
    );
  } catch {
    return false;
  }
}

function makePrivateWhepUrl(
  token: string,
  customerCode: string,
) {
  return `https://customer-${customerCode}.cloudflarestream.com/${token}/webRTC/play`;
}

async function readPrivateProviderState(
  admin: AdminClient,
  sessionId: string,
  grantId: string,
  generation: number,
  direction: PrivateLiveDirection,
) {
  const { data, error } = await admin
    .from("private_live_provider_state")
    .select(
      "session_id, grant_id, generation, direction, provider_tag, state, input_uid, playback_id, provision_actor_id, provision_lease_token",
    )
    .eq("session_id", sessionId)
    .eq("grant_id", grantId)
    .eq("generation", generation)
    .eq("direction", direction)
    .maybeSingle();
  if (error) return { row: null, error: "temporarily_unavailable" as const };
  if (!data) return { row: null, error: null };
  const parsed = privateLiveProviderStateRowSchema.safeParse(data);
  return parsed.success
    ? { row: parsed.data, error: null }
    : { row: null, error: "temporarily_unavailable" as const };
}

async function completeProvision(
  admin: AdminClient,
  input: {
    sessionId: string;
    grantId: string;
    direction: PrivateLiveDirection;
    generation: number;
    leaseToken: string;
    uid: string;
  },
) {
  const { data, error } = await admin.rpc("complete_private_live_provision", {
    target_session_id: input.sessionId,
    target_grant_id: input.grantId,
    target_direction: input.direction,
    target_generation: input.generation,
    target_lease_token: input.leaseToken,
    target_input_uid: input.uid,
    target_playback_id: input.uid,
  });
  return !error && data === true;
}

async function bestEffortDelete(uid: string) {
  try {
    await deleteLiveInput(uid);
  } catch {
    // The SQL cleanup queue remains authoritative if this immediate orphan cleanup fails.
  }
}

export async function readPrivateLiveSession(
  user: UserClient,
  actor: PrivateLiveActor,
  sessionId: string,
): Promise<PrivateLiveSessionResult> {
  const parsed = privateLiveSessionInputSchema.safeParse({ sessionId });
  if (!parsed.success) return failure("invalid_request");
  sessionId = parsed.data.sessionId;
  if (!roleDirection(actor.role)) return failure("not_allowed");
  const { session, error: sessionError } = await readSession(user, sessionId);
  if (sessionError || !session) return failure(sessionError ?? "not_found");
  if (session.mode === "broadcast")
    return { ok: true, mode: "broadcast", grant: null };

  const { grant, error: grantError } = await readGrant(user, sessionId);
  if (grantError) return failure(grantError);
  if (actor.role === "coach" && session.coachId !== actor.id.toLowerCase()) {
    return failure("not_allowed");
  }
  if (!grant) {
    if (actor.role === "coach" && session.coachId === actor.id.toLowerCase()) {
      return { ok: true, mode: session.mode, grant: null };
    }
    return failure("not_allowed");
  }
  return {
    ok: true,
    mode: session.mode,
    grant: toPrivateLiveGrantSnapshot(grant),
  };
}

export async function offerPrivateSession(
  user: UserClient,
  actor: PrivateLiveActor,
  sessionId: string,
  memberId: string,
): Promise<PrivateSessionOfferResult> {
  const parsed = privateLiveOfferInputSchema.safeParse({ sessionId, memberId });
  if (!parsed.success) return failure("invalid_request");
  sessionId = parsed.data.sessionId;
  memberId = parsed.data.memberId;
  if (actor.role !== "coach" || actor.id.toLowerCase() === memberId)
    return failure("not_allowed");
  let config: PrivateConfiguration;
  try {
    config = requirePrivateConfiguration();
  } catch {
    return failure("temporarily_unavailable");
  }

  const { session, error: sessionError } = await readSession(user, sessionId);
  if (sessionError || !session) return failure(sessionError ?? "not_found");
  if (session.coachId !== actor.id.toLowerCase()) return failure("not_allowed");
  if ((privateLiveWindowClosesAt(session.endsAt) ?? 0) <= Date.now())
    return failure("outside_window");

  const { data: room, error: roomError } = await user
    .from("session_live")
    .select("session_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (roomError) return failure("temporarily_unavailable");
  if (room) return failure("cleanup_pending");

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    return failure("temporarily_unavailable");
  }
  const accountStatus = await bindPrivateLiveAccount(admin, config.accountId);
  if (accountStatus !== "matched")
    return failure(accountBindingFailure(accountStatus));

  const { data, error } = await user.rpc("set_session_live_mode", {
    target_session_id: sessionId,
    target_mode: "one_on_one",
    target_member_id: memberId,
  });
  if (error) return failure(safeRpcErrorCode(error));
  const grantId = privateLiveGrantInputSchema.shape.grantId.safeParse(data);
  if (!grantId.success) return failure("temporarily_unavailable");
  return { ok: true, grantId: grantId.data };
}

export async function resetSessionToBroadcast(
  user: UserClient,
  actor: PrivateLiveActor,
  sessionId: string,
): Promise<PrivateActionResult<{ mode: "broadcast" }>> {
  const parsed = privateLiveSessionInputSchema.safeParse({ sessionId });
  if (!parsed.success) return failure("invalid_request");
  sessionId = parsed.data.sessionId;
  if (actor.role !== "coach") return failure("not_allowed");

  const { session, error: sessionError } = await readSession(user, sessionId);
  if (sessionError || !session) return failure(sessionError ?? "not_found");
  if (session.coachId !== actor.id.toLowerCase()) return failure("not_allowed");

  const { data, error } = await user.rpc("set_session_live_mode", {
    target_session_id: sessionId,
    target_mode: "broadcast",
    target_member_id: null,
  });
  if (error) {
    if (isRecord(error) && error.code === "P0001")
      return failure("cleanup_pending");
    return failure(safeRpcErrorCode(error));
  }
  if (data !== null) return failure("temporarily_unavailable");
  return { ok: true, mode: "broadcast" };
}

export async function acceptPrivateSession(
  user: UserClient,
  actor: PrivateLiveActor,
  sessionId: string,
  grantId: string,
  allowMemberCamera: boolean,
): Promise<PrivateActionResult> {
  const parsed = privateLiveAcceptInputSchema.safeParse({
    sessionId,
    grantId,
    allowMemberCamera,
  });
  if (!parsed.success) return failure("invalid_request");
  sessionId = parsed.data.sessionId;
  grantId = parsed.data.grantId;
  if (actor.role !== "member") return failure("not_allowed");
  const { session, error: sessionError } = await readSession(user, sessionId);
  if (sessionError || !session) return failure(sessionError ?? "not_found");
  if (session.mode !== "one_on_one") return failure("wrong_mode");
  const intakeError = await memberIntakeAccessError(user, actor, session.coachId);
  if (intakeError) return failure(intakeError);
  const { grant, error: grantError } = await readGrant(user, sessionId, grantId);
  if (grantError) return failure(grantError);
  if (!grant) return failure("not_allowed");
  let config: PrivateConfiguration;
  try {
    config = requirePrivateConfiguration();
  } catch {
    return failure("temporarily_unavailable");
  }

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    return failure("temporarily_unavailable");
  }
  const accountStatus = await bindPrivateLiveAccount(admin, config.accountId);
  if (accountStatus !== "matched")
    return failure(accountBindingFailure(accountStatus));

  const { data, error } = await user.rpc("accept_private_session_grant", {
    target_session_id: sessionId,
    target_grant_id: grantId,
    allow_member_camera: allowMemberCamera,
  });
  if (error) return failure(safeRpcErrorCode(error));
  return data === true ? { ok: true } : failure("not_ready");
}

export async function preparePrivateBroadcast(
  user: UserClient,
  actor: PrivateLiveActor,
  sessionId: string,
  grantId: string,
): Promise<PrivateBroadcastPreparationResult> {
  const parsed = privateLiveProvisionInputSchema.safeParse({ sessionId, grantId });
  if (!parsed.success) return failure("invalid_request");
  sessionId = parsed.data.sessionId;
  grantId = parsed.data.grantId;
  const direction = roleDirection(actor.role);
  if (!direction) return failure("not_allowed");
  let config: PrivateConfiguration;
  try {
    config = requirePrivateConfiguration();
  } catch {
    return failure("temporarily_unavailable");
  }

  const { session, error: sessionError } = await readSession(user, sessionId);
  if (sessionError || !session) return failure(sessionError ?? "not_found");
  if (session.mode !== "one_on_one") return failure("wrong_mode");
  if (direction === "coach" && session.coachId !== actor.id.toLowerCase())
    return failure("not_allowed");
  const intakeError = await memberIntakeAccessError(user, actor, session.coachId);
  if (intakeError) return failure(intakeError);
  const { grant, error: grantError } = await readGrant(user, sessionId, grantId);
  if (grantError) return failure(grantError);
  if (!grant) return failure("not_allowed");
  if (Date.parse(grant.expires_at) <= Date.now() || !sessionWindowOpen(session))
    return failure("outside_window");
  if (direction === "member") {
    if (!grant.member_camera_allowed)
      return failure("camera_consent_required");
    if (grant.state !== "live") return failure("not_ready");
  } else if (grant.state !== "accepted" && grant.state !== "live") {
    return failure("not_ready");
  }

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    return failure("temporarily_unavailable");
  }
  const accountStatus = await bindPrivateLiveAccount(admin, config.accountId);
  if (accountStatus !== "matched")
    return failure(accountBindingFailure(accountStatus));

  const directionState = await readPrivateProviderState(
    admin,
    sessionId,
    grantId,
    grant.generation,
    direction,
  );
  if (directionState.error) return failure(directionState.error);

  let uid: string;
  let leaseToken: string;
  if (directionState.row) {
    const current = directionState.row;
    if (
      current.provider_tag !==
      privateLiveProviderTag(sessionId, grant.generation, direction)
    ) {
      return failure("temporarily_unavailable");
    }
    if (current.state === "cleanup_pending" || current.state === "revoked")
      return failure("cleanup_pending");
    if (current.state === "provisioning") return failure("not_ready");
    if (
      (current.state !== "ready" && current.state !== "live") ||
      !current.input_uid ||
      current.playback_id !== current.input_uid ||
      current.provision_actor_id !== actor.id ||
      !current.provision_lease_token
    ) {
      return failure("not_allowed");
    }
    uid = current.input_uid;
    leaseToken = current.provision_lease_token;
  } else {
    const { data, error } = await admin.rpc("claim_private_live_provision", {
      target_session_id: sessionId,
      target_grant_id: grantId,
      actor_id: actor.id,
    });
    if (error) return failure(safeRpcErrorCode(error));
    const rows = Array.isArray(data) ? data : [];
    if (rows.length !== 1) return failure("not_ready");
    const claim = privateLiveProvisionLeaseSchema.safeParse(rows[0]);
    if (
      !claim.success ||
      claim.data.session_id !== sessionId ||
      claim.data.grant_id !== grantId ||
      claim.data.direction !== direction ||
      claim.data.generation !== grant.generation ||
      claim.data.provider_tag !==
        privateLiveProviderTag(sessionId, grant.generation, direction)
    ) {
      return failure("not_allowed");
    }
    leaseToken = claim.data.lease_token;

    let input: { uid: string; playbackUrl: string };
    try {
      input = await createLiveInput(claim.data.provider_tag, {
        privatePlayback: true,
      });
    } catch {
      // If creation succeeded remotely but the response was lost, the SQL lease expires and
      // cleanup reconciles exact provider metadata using this deterministic tag.
      return failure("temporarily_unavailable");
    }
    if (!PRIVATE_PROVIDER_UIDS.safeParse(input.uid).success) {
      // The SQL lease will expire and the cleanup worker will locate the newly created input by
      // its exact metadata tag. Never send an unvalidated identifier to the delete endpoint.
      return failure("temporarily_unavailable");
    }
    if (!isValidWhepEndpoint(input.playbackUrl, input.uid, config.customerCode)) {
      await bestEffortDelete(input.uid);
      return failure("temporarily_unavailable");
    }
    uid = input.uid;
  }

  // This service-only RPC rechecks the authenticated actor, generation, lease, current invite,
  // time window, consent, and cleanup heartbeat before the Stream ingest address is fetched.
  if (
    !(await completeProvision(admin, {
      sessionId,
      grantId,
      direction,
      generation: grant.generation,
      leaseToken,
      uid,
    }))
  ) {
    await bestEffortDelete(uid);
    return failure("not_ready");
  }

  let ingestUrl: string;
  try {
    ingestUrl = await getLiveIngestUrl(uid);
  } catch {
    return failure("temporarily_unavailable");
  }
  if (!isValidWhipEndpoint(ingestUrl, config.customerCode))
    return failure("temporarily_unavailable");
  // A provision response can race a role, invite, mode, consent, or time-window change.
  // Revalidate the lease and current participant before any publisher credential is returned.
  if (
    !(await completeProvision(admin, {
      sessionId,
      grantId,
      direction,
      generation: grant.generation,
      leaseToken,
      uid,
    }))
  ) {
    await bestEffortDelete(uid);
    return failure("not_ready");
  }
  const finalIntakeError = await memberIntakeAccessError(user, actor, session.coachId);
  if (finalIntakeError) return failure(finalIntakeError);
  return {
    ok: true,
    direction,
    generation: grant.generation,
    leaseToken,
    ingestUrl,
  };
}

export async function markPrivateBroadcastLive(
  user: UserClient,
  actor: PrivateLiveActor,
  sessionId: string,
  grantId: string,
  generation: number,
  leaseToken: string,
): Promise<PrivateActionResult> {
  const parsed = privateLiveStartedInputSchema.safeParse({
    sessionId,
    grantId,
    generation,
    leaseToken,
  });
  if (!parsed.success) return failure("invalid_request");
  sessionId = parsed.data.sessionId;
  grantId = parsed.data.grantId;
  leaseToken = parsed.data.leaseToken;
  const direction = roleDirection(actor.role);
  if (!direction) return failure("not_allowed");
  const { session, error: sessionError } = await readSession(user, sessionId);
  if (sessionError || !session) return failure(sessionError ?? "not_found");
  if (session.mode !== "one_on_one") return failure("wrong_mode");
  if (direction === "coach" && session.coachId !== actor.id.toLowerCase())
    return failure("not_allowed");
  const intakeError = await memberIntakeAccessError(user, actor, session.coachId);
  if (intakeError) return failure(intakeError);
  const { grant, error: grantError } = await readGrant(user, sessionId, grantId);
  if (grantError) return failure(grantError);
  if (!grant) return failure("not_allowed");
  if (grant.generation !== generation || !sessionWindowOpen(session))
    return failure("not_ready");
  if (direction === "member" && !grant.member_camera_allowed)
    return failure("camera_consent_required");

  let config: PrivateConfiguration;
  try {
    config = requirePrivateConfiguration();
  } catch {
    return failure("temporarily_unavailable");
  }

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    return failure("temporarily_unavailable");
  }
  const accountStatus = await bindPrivateLiveAccount(admin, config.accountId);
  if (accountStatus !== "matched")
    return failure(accountBindingFailure(accountStatus));
  const { data, error } = await admin.rpc("mark_private_live_started", {
    target_session_id: sessionId,
    target_grant_id: grantId,
    target_direction: direction,
    target_generation: generation,
    target_lease_token: leaseToken,
    actor_id: actor.id,
  });
  if (error) return failure(safeRpcErrorCode(error));
  return data === true ? { ok: true } : failure("not_ready");
}

export async function privatePlayback(
  user: UserClient,
  actor: PrivateLiveActor,
  sessionId: string,
  grantId: string,
  generation: number,
): Promise<PrivatePlaybackResult> {
  const parsed = privateLivePlaybackInputSchema.safeParse({
    sessionId,
    grantId,
    generation,
  });
  if (!parsed.success) return failure("invalid_request");
  sessionId = parsed.data.sessionId;
  grantId = parsed.data.grantId;
  const viewerDirection = roleDirection(actor.role);
  if (!viewerDirection) return failure("not_allowed");
  let config: PrivateConfiguration;
  try {
    config = requirePrivateConfiguration();
  } catch {
    return failure("temporarily_unavailable");
  }
  const { session, error: sessionError } = await readSession(user, sessionId);
  if (sessionError || !session) return failure(sessionError ?? "not_found");
  if (session.mode !== "one_on_one") return failure("wrong_mode");
  if (viewerDirection === "coach" && session.coachId !== actor.id.toLowerCase())
    return failure("not_allowed");
  const intakeError = await memberIntakeAccessError(user, actor, session.coachId);
  if (intakeError) return failure(intakeError);
  const { grant, error: grantError } = await readGrant(user, sessionId, grantId);
  if (grantError) return failure(grantError);
  if (!grant) return failure("not_allowed");
  if (
    grant.generation !== generation ||
    grant.state !== "live" ||
    Date.parse(grant.expires_at) <= Date.now() ||
    !sessionWindowOpen(session)
  ) {
    return failure("not_ready");
  }

  const sourceDirection = oppositeDirection(viewerDirection);
  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    return failure("temporarily_unavailable");
  }
  const accountStatus = await bindPrivateLiveAccount(admin, config.accountId);
  if (accountStatus !== "matched")
    return failure(accountBindingFailure(accountStatus));

  const { data, error } = await admin.rpc("authorize_private_live_playback", {
    target_session_id: sessionId,
    target_grant_id: grantId,
    target_generation: generation,
    viewer_id: actor.id,
    target_source_direction: sourceDirection,
  });
  if (error) return failure(safeRpcErrorCode(error));
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1 || !isRecord(rows[0])) return failure("not_ready");
  const playbackId = PRIVATE_PROVIDER_UIDS.safeParse(rows[0].playback_id);
  if (!playbackId.success) return failure("not_ready");

  const nowMs = Date.now();
  let expiresAtMs: number;
  let token: string;
  try {
    expiresAtMs = privatePlaybackExpiry(grant.expires_at, session.endsAt, nowMs);
    token = mintPrivateStreamJwt({
      playbackId: playbackId.data,
      expiresAtSeconds: Math.floor(expiresAtMs / 1000),
      nowSeconds: Math.floor(nowMs / 1000),
      signing: config.signingKey,
    });
  } catch {
    return failure("temporarily_unavailable");
  }

  // The authorization RPC rechecks role, grant, window, and heartbeat after minting so a newly
  // revoked or stale pair receives no playback URL.
  const finalAccountStatus = await bindPrivateLiveAccount(admin, config.accountId);
  if (finalAccountStatus !== "matched")
    return failure(accountBindingFailure(finalAccountStatus));
  const { data: finalAuthorization, error: finalError } = await admin.rpc(
    "authorize_private_live_playback",
    {
      target_session_id: sessionId,
      target_grant_id: grantId,
      target_generation: generation,
      viewer_id: actor.id,
      target_source_direction: sourceDirection,
    },
  );
  const finalRows = Array.isArray(finalAuthorization)
    ? finalAuthorization
    : [];
  if (
    finalError ||
    finalRows.length !== 1 ||
    !isRecord(finalRows[0]) ||
    finalRows[0].playback_id !== playbackId.data
  ) {
    return failure("not_ready");
  }

  const finalIntakeError = await memberIntakeAccessError(user, actor, session.coachId);
  if (finalIntakeError) return failure(finalIntakeError);

  return {
    ok: true,
    playbackUrl: makePrivateWhepUrl(
      token,
      config.customerCode,
    ),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export async function revokePrivateSession(
  user: UserClient,
  actor: PrivateLiveActor,
  sessionId: string,
  grantId: string,
): Promise<PrivateRevokeResult> {
  const parsed = privateLiveGrantInputSchema.safeParse({ sessionId, grantId });
  if (!parsed.success) return failure("invalid_request");
  sessionId = parsed.data.sessionId;
  grantId = parsed.data.grantId;
  if (!roleDirection(actor.role)) return failure("not_allowed");
  const { data, error } = await user.rpc("revoke_private_live_access", {
    target_session_id: sessionId,
    target_grant_id: grantId,
  });
  if (error) return failure(safeRpcErrorCode(error));
  if (data !== true && data !== false) return failure("temporarily_unavailable");

  const { grant, error: grantError } = await readGrant(user, sessionId, grantId);
  if (grantError) {
    // SQL accepted the revoke request. Report its durable queued state without claiming teardown.
    return data ? { ok: true, state: "revoking" } : failure("not_ready");
  }
  if (!grant) return data ? { ok: true, state: "revoking" } : failure("not_found");
  return {
    ok: true,
    state: grant.state === "revoked" ? "revoked" : "revoking",
  };
}

async function cleanupOneJob(
  admin: AdminClient,
  rawJob: unknown,
  accountId: string,
): Promise<boolean> {
  const parsed = privateLiveCleanupLeaseSchema.safeParse(rawJob);
  if (!parsed.success) return false;
  const job = parsed.data;
  if (
    job.provider_tag !==
    privateLiveProviderTag(job.session_id, job.generation, job.direction)
  ) {
    return false;
  }

  let providerUids: string[];
  if (job.input_uid) {
    let actualTag: string | null;
    try {
      actualTag = await getLiveInputMetaName(job.input_uid);
    } catch {
      return false;
    }
    if (actualTag !== null && actualTag !== job.provider_tag) {
      // Never delete a UID that now belongs to another provider input.
      return false;
    }
    // An exact 404 confirms a previous delete; a matching tag authorizes this one UID only.
    providerUids = actualTag === null ? [] : [job.input_uid];
  } else {
    try {
      const taggedUids = await findLiveInputsByMetaName(job.provider_tag);
      if (!Array.isArray(taggedUids)) return false;
      providerUids = [...new Set(taggedUids)];
    } catch {
      return false;
    }
  }
  if (!providerUids.every((uid) => PRIVATE_PROVIDER_UIDS.safeParse(uid).success))
    return false;

  for (const uid of providerUids) {
    try {
      await deleteLiveInput(uid);
    } catch {
      return false;
    }
  }

  const { data, error } = await admin.rpc("complete_private_live_cleanup", {
    target_cleanup_id: job.cleanup_id,
    target_session_id: job.session_id,
    target_generation: job.generation,
    target_direction: job.direction,
    target_lease_token: job.lease_token,
    provider_delete_confirmed: true,
    target_account_id: accountId,
  });
  return !error && data === true;
}

export async function cleanupPrivateLiveInputs(
  limit = CLEANUP_BATCH_SIZE,
): Promise<CleanupBatchResult> {
  const requestedLimit = Math.max(1, Math.min(CLEANUP_BATCH_SIZE, Math.trunc(limit)));
  try {
    const config = requireDedicatedLiveStreamConfiguration();
    const admin = createAdminClient();
    const accountStatus = await bindPrivateLiveAccount(admin, config.accountId);
    if (accountStatus !== "matched")
      return { ok: false, claimed: 0, completed: 0 };
    const { data, error } = await admin.rpc(
      "claim_private_live_cleanup_batch",
      { target_account_id: config.accountId, target_limit: requestedLimit },
    );
    if (error || !Array.isArray(data))
      return { ok: false, claimed: 0, completed: 0 };
    let completed = 0;
    for (const job of data) {
      if (await cleanupOneJob(admin, job, config.accountId)) completed += 1;
    }
    return {
      ok: completed === data.length,
      claimed: data.length,
      completed,
    };
  } catch {
    return { ok: false, claimed: 0, completed: 0 };
  }
}

export async function cleanupPrivateLiveInputsAndRecordHeartbeat() {
  const cleanup = await cleanupPrivateLiveInputs();
  if (!cleanup.ok)
    return { ...cleanup, heartbeatRecorded: false as const };
  try {
    const config = requireDedicatedLiveStreamConfiguration();
    const admin = createAdminClient();
    const accountStatus = await bindPrivateLiveAccount(admin, config.accountId);
    if (accountStatus !== "matched")
      return { ...cleanup, ok: false, heartbeatRecorded: false as const };
    const { error } = await admin.rpc("record_private_live_cleanup_heartbeat");
    if (error) return { ...cleanup, ok: false, heartbeatRecorded: false as const };
    return { ...cleanup, heartbeatRecorded: true as const };
  } catch {
    return { ...cleanup, ok: false, heartbeatRecorded: false as const };
  }
}

export function verifyLiveCleanupHmac(input: {
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowMs?: number;
}) {
  const { timestamp, signature, secret } = input;
  if (
    !timestamp ||
    !/^[1-9]\d{9}$/.test(timestamp) ||
    !signature ||
    !/^[0-9a-f]{64}$/.test(signature) ||
    !secret
  ) {
    return false;
  }
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(timestampSeconds - nowSeconds) > 5 * 60
  ) {
    return false;
  }
  const message = `${timestamp}.GET.${CLEANUP_HMAC_PATH}`;
  const expected = createHmac("sha256", secret).update(message).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(expected, received);
}
