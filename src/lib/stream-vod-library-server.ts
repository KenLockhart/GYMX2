import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  STREAM_VOD_LIBRARY_MAX_DURATION_SECONDS,
  STREAM_VOD_LIBRARY_SLOT,
  STREAM_VOD_LIBRARY_UPLOAD_WINDOW_MS,
  encodeStreamVodLibraryTusMetadata,
  isAllowedStreamTusLocation,
  isCloudflareAccountId,
  isPostgresUuid,
  isProviderUid,
  isStreamVodLibraryInput,
  isValidStreamVodLibraryUploadLength,
  parseStreamVodLibraryCapability,
  parseStreamVodLibraryRegistryProjection,
  parseStreamVodLibraryStatus,
  parseStreamVodLibraryWorkProjection,
  type StreamVodLibraryErrorCode,
  type StreamVodLibraryRegistryProjection,
  type StreamVodLibraryRole,
  type StreamVodLibraryWork,
} from "./stream-vod-library-contracts";

const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com/client/v4";
const PROVIDER_TIMEOUT_MS = 8_000;
const MAX_PROVIDER_JSON_BYTES = 64 * 1024;
const MAX_READBACK_ATTEMPTS = 3;
const READBACK_RETRY_DELAY_MS = [150, 350] as const;

type RpcArguments = Record<string, unknown>;
type RpcFunction = (name: string, args: RpcArguments) => Promise<unknown>;

export type StreamVodLibraryActor = { id: string; role: string };

export type StreamVodLibraryRequestContext = {
  actor: StreamVodLibraryActor;
  userRpc: RpcFunction;
  serviceRpc: RpcFunction;
};

type ProviderCredentials = { accountId: string; token: string };

export type StreamVodLibraryAdapterDependencies = {
  enabled: () => boolean;
  credentials: () => ProviderCredentials | null;
  openContext: () => Promise<StreamVodLibraryRequestContext | null>;
  fetch: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  providerTimeoutMs: number;
};

type ReadbackFlags = {
  signedUrls: boolean | null;
  creatorMatch: boolean | null;
  metadataMatch: boolean | null;
  ready: boolean | null;
};

type ProviderReadback = {
  status: number;
  flags: ReadbackFlags;
  evidenceDigest: string;
  requestId: string;
};

type LoadWorkResult =
  | { ok: true; work: StreamVodLibraryWork; outcome: "work_available" | "recovery_required" | "completed" }
  | { ok: false; error: StreamVodLibraryErrorCode; blockedOutcome?: string };

function defaultCredentials(): ProviderCredentials | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_STREAM_TOKEN?.trim();
  if (!isCloudflareAccountId(accountId) || !token) return null;
  return { accountId, token };
}

async function rpcData(
  call: (name: string, args: RpcArguments) => Promise<unknown>,
  name: string,
  args: RpcArguments,
): Promise<unknown> {
  const value = await call(name, args);
  if (value && typeof value === "object" && "error" in value && "data" in value) {
    const response = value as { data: unknown; error: unknown };
    if (response.error) throw new Error("rpc_unavailable");
    return response.data;
  }
  return value;
}

async function defaultOpenContext(): Promise<StreamVodLibraryRequestContext | null> {
  const userClient = await createClient();
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user || !isPostgresUuid(data.user.id)) return null;

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError || !profile || typeof profile.role !== "string") {
    return { actor: { id: data.user.id, role: "unknown" }, userRpc: async () => null, serviceRpc: async () => null };
  }

  return {
    actor: { id: data.user.id.toLowerCase(), role: profile.role },
    userRpc: async (name, args) => {
      const response = await userClient.rpc(name, args);
      if (response.error) throw new Error("rpc_unavailable");
      return response.data;
    },
    serviceRpc: async (name, args) => {
      const response = await createAdminClient().rpc(name, args);
      if (response.error) throw new Error("rpc_unavailable");
      return response.data;
    },
  };
}

const defaultDependencies: StreamVodLibraryAdapterDependencies = {
  enabled: () => process.env.STREAM_VOD_LIBRARY_UPLOAD_ENABLED === "true",
  credentials: defaultCredentials,
  openContext: defaultOpenContext,
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  providerTimeoutMs: PROVIDER_TIMEOUT_MS,
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function digestFacts(value: unknown): string {
  return sha256(JSON.stringify(stableValue(value)));
}

// UUIDv8 is a deterministic, canonical PostgreSQL UUID. SQL 315 can produce non-RFC version
// and variant bits, so response validation accepts the general 8-4-4-4-12 PostgreSQL form.
function stableUuid(namespace: string): string {
  const bytes = createHash("sha256").update(namespace, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isEligibleRole(role: string): role is StreamVodLibraryRole {
  return role === "coach" || role === "admin";
}

function failure(error: StreamVodLibraryErrorCode) {
  return { ok: false as const, error };
}

function action<T extends Record<string, unknown> = Record<string, never>>(
  outcome: string,
  data?: T,
): { ok: true; outcome: string } & T {
  return { ok: true, outcome, ...(data ?? {} as T) } as { ok: true; outcome: string } & T;
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error("provider_timeout"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("provider_timeout")), { once: true });
  });
}

function cancelResponseBody(response: Response): void {
  try {
    if (response.body && !response.bodyUsed) void response.body.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best effort; no upload capability depends on draining provider bodies.
  }
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let finished = false;
  const consume = async (): Promise<unknown | null> => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          break;
        }
        byteLength += value.byteLength;
        if (byteLength > MAX_PROVIDER_JSON_BYTES) return null;
        chunks.push(value);
      }
    } catch {
      return null;
    }
    try {
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      return null;
    }
  };
  try {
    return await Promise.race([consume(), abortPromise(signal)]);
  } catch {
    return null;
  } finally {
    if (!finished) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        // A timed-out reader can still be locked by its pending read; leave cancellation best effort.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // A pending timed-out read may retain the lock until the stream settles.
    }
  }
}

async function fetchWithTimeout<T>(
  deps: StreamVodLibraryAdapterDependencies,
  input: string,
  init: RequestInit,
  consume: (response: Response, signal: AbortSignal) => Promise<T | null> | T | null,
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.providerTimeoutMs);
  let response: Response | null = null;
  try {
    response = await Promise.race([
      deps.fetch(input, { ...init, signal: controller.signal }),
      abortPromise(controller.signal),
    ]);
    return await Promise.race([
      Promise.resolve(consume(response, controller.signal)),
      abortPromise(controller.signal),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    if (response) cancelResponseBody(response);
  }
}

function validApiEnvelope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  return envelope.success === true && Array.isArray(envelope.errors) && envelope.errors.length === 0;
}

function validateContext(context: StreamVodLibraryRequestContext | null):
  | { ok: true; context: StreamVodLibraryRequestContext }
  | { ok: false; error: "unauthenticated" | "forbidden" } {
  if (!context || !isPostgresUuid(context.actor.id)) return { ok: false, error: "unauthenticated" };
  if (!isEligibleRole(context.actor.role)) return { ok: false, error: "forbidden" };
  return { ok: true, context };
}

function mapBlockedOutcome(outcome: string): StreamVodLibraryErrorCode {
  if (outcome === "account_unverified") return "account_unverified";
  if (["observation_conflict", "identity_mismatch", "identity_inconsistent", "account_binding_mismatch",
    "operation_inconsistent", "source_changed"].includes(outcome)) return "identity_conflict";
  if (outcome === "not_eligible") return "forbidden";
  if (outcome === "unavailable" || outcome === "account_deleting" || outcome === "canceled_or_cleanup_held" ||
    outcome === "source_fence_changed") return "recovery_required";
  return "temporarily_unavailable";
}

export function createStreamVodLibraryAdapter(
  overrides: Partial<StreamVodLibraryAdapterDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };

  async function openEligibleContext(): Promise<
    | { ok: true; context: StreamVodLibraryRequestContext }
    | { ok: false; error: StreamVodLibraryErrorCode }
  > {
    try {
      const result = validateContext(await deps.openContext());
      return result.ok ? result : failure(result.error);
    } catch {
      return failure("temporarily_unavailable");
    }
  }

  function providerCredentials(): ProviderCredentials | null {
    try {
      const credentials = deps.credentials();
      if (!credentials || !isCloudflareAccountId(credentials.accountId) || !credentials.token.trim()) return null;
      return { accountId: credentials.accountId, token: credentials.token };
    } catch {
      return null;
    }
  }

  async function serviceCall(
    context: StreamVodLibraryRequestContext,
    name: string,
    args: RpcArguments,
  ): Promise<{ ok: true; data: unknown } | { ok: false }> {
    try {
      return { ok: true, data: await rpcData(context.serviceRpc, name, args) };
    } catch {
      return { ok: false };
    }
  }

  async function userCall(
    context: StreamVodLibraryRequestContext,
    name: string,
    args: RpcArguments,
  ): Promise<{ ok: true; data: unknown } | { ok: false }> {
    try {
      return { ok: true, data: await rpcData(context.userRpc, name, args) };
    } catch {
      return { ok: false };
    }
  }

  async function getRegistry(
    context: StreamVodLibraryRequestContext,
    credentials: ProviderCredentials,
  ): Promise<{ ok: true; registry: StreamVodLibraryRegistryProjection } | { ok: false; error: StreamVodLibraryErrorCode }> {
    const response = await serviceCall(context, "get_stream_provider_account_projection", {
      target_credential_slot: STREAM_VOD_LIBRARY_SLOT,
      target_expected_provider_account_id: credentials.accountId,
    });
    if (!response.ok) return { ok: false, error: "temporarily_unavailable" };
    const registry = parseStreamVodLibraryRegistryProjection(response.data, credentials.accountId);
    if (!registry) {
      if (response.data && typeof response.data === "object") {
        const outcome = (response.data as Record<string, unknown>).outcome;
        return { ok: false, error: mapBlockedOutcome(String(outcome ?? "")) };
      }
      return { ok: false, error: "account_unavailable" };
    }
    return { ok: true, registry };
  }

  async function verifyConfiguredAccount(
    context: StreamVodLibraryRequestContext,
    credentials: ProviderCredentials,
    registry: StreamVodLibraryRegistryProjection,
  ): Promise<boolean> {
    if (registry.verificationValid) return true;
    const url = `${CLOUDFLARE_API_ORIGIN}/accounts/${credentials.accountId}/stream?limit=1`;
    const verification = await fetchWithTimeout(deps, url, {
      method: "GET",
      headers: { Authorization: `Bearer ${credentials.token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
    }, async (response, signal) => {
      if (response.status !== 200 || response.redirected) return null;
      const body = await readBoundedJson(response, signal);
      if (!validApiEnvelope(body) || !Array.isArray(body.result)) return null;
      return { status: response.status, resultCount: body.result.length };
    });
    if (!verification) return false;

    const requestId = randomUUID();
    const evidenceDigest = digestFacts({
      kind: "stream_account_path_access_v1",
      requestId,
      provider: "cloudflare_stream",
      credentialSlot: STREAM_VOD_LIBRARY_SLOT,
      accountId: credentials.accountId,
      status: verification.status,
      success: true,
      resultCount: verification.resultCount,
    });
    const recorded = await serviceCall(context, "record_stream_account_path_verification", {
      target_request_id: requestId,
      target_registry_id: registry.registryId,
      target_credential_slot: STREAM_VOD_LIBRARY_SLOT,
      target_provider_account_id: credentials.accountId,
      target_http_status: verification.status,
      target_evidence_digest: evidenceDigest,
    });
    if (!recorded.ok || !recorded.data || typeof recorded.data !== "object") return false;
    const outcome = (recorded.data as Record<string, unknown>).outcome;
    if (outcome !== "verified" && outcome !== "already_recorded") return false;
    const refreshed = await getRegistry(context, credentials);
    return refreshed.ok && refreshed.registry.registryId === registry.registryId && refreshed.registry.verificationValid;
  }

  async function ensureCurrentRegistry(
    context: StreamVodLibraryRequestContext,
    credentials: ProviderCredentials,
  ): Promise<{ ok: true; registry: StreamVodLibraryRegistryProjection } | { ok: false; error: StreamVodLibraryErrorCode }> {
    const result = await getRegistry(context, credentials);
    if (!result.ok) return result;
    if (result.registry.verificationValid) return result;
    if (!(await verifyConfiguredAccount(context, credentials, result.registry))) {
      return { ok: false, error: "account_unverified" };
    }
    const current = await getRegistry(context, credentials);
    return current.ok && current.registry.verificationValid
      ? current
      : { ok: false, error: "account_unverified" };
  }

  async function readWork(
    context: StreamVodLibraryRequestContext,
    operationId: string,
  ): Promise<LoadWorkResult> {
    const response = await serviceCall(context, "get_stream_library_upload_work", {
      target_operation_id: operationId,
      target_expected_actor_id: context.actor.id,
    });
    if (!response.ok) return { ok: false, error: "temporarily_unavailable" };
    let projection;
    try {
      projection = parseStreamVodLibraryWorkProjection(response.data, context.actor.id);
    } catch {
      return { ok: false, error: "identity_conflict" };
    }
    if (!projection) return { ok: false, error: "temporarily_unavailable" };
    if (projection.kind === "blocked") {
      return {
        ok: false,
        error: mapBlockedOutcome(projection.outcome),
        blockedOutcome: projection.outcome,
      };
    }
    if (projection.work.actorRole !== context.actor.role || !projection.work.actorRoleEligible) {
      return { ok: false, error: "forbidden" };
    }
    return { ok: true, work: projection.work, outcome: projection.outcome };
  }

  async function ensureWork(
    context: StreamVodLibraryRequestContext,
    credentials: ProviderCredentials,
    operationId: string,
  ): Promise<LoadWorkResult> {
    let loaded = await readWork(context, operationId);
    if (loaded.ok && loaded.work.operationState === "completed") return loaded;
    if (!loaded.ok && loaded.blockedOutcome === "account_unverified") {
      const registry = await ensureCurrentRegistry(context, credentials);
      if (!registry.ok) return { ok: false, error: registry.error };
      loaded = await readWork(context, operationId);
    }
    if (!loaded.ok) return loaded;
    if (loaded.work.registry.providerAccountId !== credentials.accountId ||
      loaded.work.registry.credentialSlot !== STREAM_VOD_LIBRARY_SLOT) {
      return { ok: false, error: "identity_conflict" };
    }
    if (loaded.work.operationState !== "completed" && !loaded.work.accountVerifiedCurrent) {
      const registry = await ensureCurrentRegistry(context, credentials);
      if (!registry.ok) return { ok: false, error: registry.error };
      loaded = await readWork(context, operationId);
      if (!loaded.ok) return loaded;
      if (!loaded.work.accountVerifiedCurrent && loaded.work.operationState !== "completed") {
        return { ok: false, error: "account_unverified" };
      }
    }
    return loaded;
  }

  async function recordCreateReply(
    context: StreamVodLibraryRequestContext,
    work: StreamVodLibraryWork,
    httpStatus: number,
    providerUid: string | null,
    evidenceDigest: string,
  ): Promise<boolean> {
    const requestId = stableUuid(`stream-vod-library:create-reply:${work.operationId}:${evidenceDigest}`);
    const result = await serviceCall(context, "record_stream_media_upload_observation", {
      target_operation_id: work.operationId,
      target_registry_id: work.registry.registryId,
      target_kind: "create_reply",
      target_uid: providerUid,
      target_http_status: httpStatus,
      target_signed_urls: null,
      target_creator_match: null,
      target_marker_match: null,
      target_ready: null,
      target_request_id: requestId,
      target_evidence_digest: evidenceDigest,
    });
    if (!result.ok || !result.data || typeof result.data !== "object") return false;
    const outcome = (result.data as Record<string, unknown>).outcome;
    return outcome === "recorded" || outcome === "already_recorded";
  }

  async function advanceUnknown(
    context: StreamVodLibraryRequestContext,
    operationId: string,
    evidenceDigest: string,
  ): Promise<void> {
    await serviceCall(context, "advance_stream_media_upload", {
      target_operation_id: operationId,
      target_request_id: stableUuid(`stream-vod-library:advance-create-unknown:${operationId}`),
      target_next_state: "create_unknown",
      target_evidence_digest: evidenceDigest,
    });
  }

  async function issueCapability(
    context: StreamVodLibraryRequestContext,
    credentials: ProviderCredentials,
    work: StreamVodLibraryWork,
  ) {
    if (!deps.enabled()) return failure("disabled");
    if (!work.transport.tusLocationPresent || !work.transport.providerUid ||
      !work.accountVerifiedCurrent || work.operationState === "completed") {
      return failure("capability_unavailable");
    }
    const result = await userCall(context, "get_stream_media_upload_tus_location", {
      target_operation_id: work.operationId,
    });
    if (!result.ok) return failure("capability_unavailable");
    const parsed = parseStreamVodLibraryCapability(result.data, work);
    if (!parsed || Date.parse(parsed.expiresAt) <= deps.now() ||
      !isAllowedStreamTusLocation(parsed.location, credentials.accountId)) {
      return failure("capability_unavailable");
    }
    return action("upload_capability", {
      operationId: work.operationId,
      videoId: work.sourceId,
      tusUrl: parsed.location,
      expiresAt: parsed.expiresAt,
      maxDurationSeconds: STREAM_VOD_LIBRARY_MAX_DURATION_SECONDS,
      requireSignedUrls: true,
    });
  }

  async function loadAndMaybeIssueCapability(
    context: StreamVodLibraryRequestContext,
    credentials: ProviderCredentials,
    operationId: string,
  ) {
    const loaded = await ensureWork(context, credentials, operationId);
    if (!loaded.ok) return failure(loaded.error);
    if (loaded.work.operationState === "completed") {
      return action("completed", { operationId, videoId: loaded.work.sourceId });
    }
    const cap = await issueCapability(context, credentials, loaded.work);
    if (cap.ok) return cap;
    return action("recovery_required", {
      operationId,
      videoId: loaded.work.sourceId,
      state: loaded.work.operationState,
    });
  }

  async function prepare(input: unknown) {
    if (!deps.enabled()) return failure("disabled");
    if (!isStreamVodLibraryInput(input)) return failure("invalid_request");
    const opened = await openEligibleContext();
    if (!opened.ok) return failure(opened.error);
    const context = opened.context;
    const credentials = providerCredentials();
    if (!credentials) return failure("account_unavailable");
    const registry = await ensureCurrentRegistry(context, credentials);
    if (!registry.ok) return failure(registry.error);

    const videoId = stableUuid(`stream-vod-library:prospective-video:${input.requestId.toLowerCase()}`);
    const args = {
      target_request_id: input.requestId.toLowerCase(),
      target_video_id: videoId,
      target_title: input.title,
      target_description: input.description,
      target_file_digest: input.fileDigest,
    };
    let response = await userCall(context, "prepare_stream_library_video_upload", args);
    if (!response.ok || !response.data || typeof response.data !== "object") {
      return failure("temporarily_unavailable");
    }
    let value = response.data as Record<string, unknown>;
    if (value.outcome === "account_unverified") {
      const refreshed = await ensureCurrentRegistry(context, credentials);
      if (!refreshed.ok) return failure(refreshed.error);
      response = await userCall(context, "prepare_stream_library_video_upload", args);
      if (!response.ok || !response.data || typeof response.data !== "object") {
        return failure("temporarily_unavailable");
      }
      value = response.data as Record<string, unknown>;
    }
    if (!["reserved", "same_operation"].includes(String(value.outcome)) ||
      !isPostgresUuid(value.operation_id) || value.source_id !== videoId) {
      return failure(mapBlockedOutcome(String(value.outcome ?? "")));
    }
    if (typeof value.operation_state !== "string") return failure("temporarily_unavailable");
    return action("prepared", {
      operationId: value.operation_id.toLowerCase(),
      videoId,
      state: value.operation_state,
    });
  }

  async function start(input: unknown) {
    if (!deps.enabled()) return failure("disabled");
    if (!input || typeof input !== "object" || Array.isArray(input)) return failure("invalid_request");
    const value = input as Record<string, unknown>;
    if (!isPostgresUuid(value.operationId) || !isValidStreamVodLibraryUploadLength(value.uploadLengthBytes)) {
      return failure("invalid_request");
    }
    const operationId = value.operationId.toLowerCase();
    const opened = await openEligibleContext();
    if (!opened.ok) return failure(opened.error);
    const context = opened.context;
    const initial = await readWork(context, operationId);
    if (initial.ok && initial.work.operationState === "completed") {
      return action("completed", { operationId, videoId: initial.work.sourceId });
    }
    if (!initial.ok && initial.blockedOutcome && initial.blockedOutcome !== "account_unverified") {
      return failure(initial.error);
    }
    const credentials = providerCredentials();
    if (!credentials) return failure("account_unavailable");
    // Re-read the durable work through the fixed credential-slot check even when
    // the first projection says its account proof is current. This prevents a
    // current proof for account A from authorizing work under configured account B.
    let loaded = await ensureWork(context, credentials, operationId);
    if (!loaded.ok) return failure(loaded.error);
    let work = loaded.work;
    if (work.operationState !== "reserved" || work.createClaim || work.transport.providerUid || work.latestObservation) {
      return loadAndMaybeIssueCapability(context, credentials, operationId);
    }

    const claimRequestId = stableUuid(`stream-vod-library:create-claim:${operationId}`);
    const claim = await serviceCall(context, "claim_stream_media_create", {
      target_operation_id: operationId,
      target_request_id: claimRequestId,
      target_request_digest: work.operationDigest,
    });
    if (!claim.ok || !claim.data || typeof claim.data !== "object") {
      return action("recovery_required", { operationId, videoId: work.sourceId, state: "create_started" });
    }
    const claimData = claim.data as Record<string, unknown>;
    if (claimData.outcome !== "create_authorized" || claimData.create_authorized !== true ||
      claimData.operation_id !== operationId || !Number.isSafeInteger(claimData.operation_revision)) {
      loaded = await ensureWork(context, credentials, operationId);
      if (!loaded.ok) return action("recovery_required", { operationId, videoId: work.sourceId, state: "create_started" });
      return loadAndMaybeIssueCapability(context, credentials, operationId);
    }

    const expiresAt = new Date(deps.now() + STREAM_VOD_LIBRARY_UPLOAD_WINDOW_MS).toISOString();
    const tusMetadata = encodeStreamVodLibraryTusMetadata(work, expiresAt);
    const postEvidenceBase = {
      protocol: "tus-1.0.0",
      operationId,
      requestDigest: work.operationDigest,
      uploadLengthBytes: value.uploadLengthBytes,
      maxDurationSeconds: STREAM_VOD_LIBRARY_MAX_DURATION_SECONDS,
      expiresAt,
      metadataDigest: sha256(tusMetadata),
      credentialSlot: STREAM_VOD_LIBRARY_SLOT,
    };
    const providerReply = await fetchWithTimeout(deps,
      `${CLOUDFLARE_API_ORIGIN}/accounts/${credentials.accountId}/stream?direct_user=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          Accept: "application/json",
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(value.uploadLengthBytes),
          "Upload-Creator": context.actor.id,
          "Upload-Metadata": tusMetadata,
        },
        cache: "no-store",
        redirect: "error",
      },
      (response) => {
        const rawUid = response.headers.get("stream-media-id");
        const location = response.status === 201 ? response.headers.get("Location") : null;
        return {
          status: response.status,
          redirected: response.redirected,
          rawUid,
          location,
        };
      },
    );
    if (!providerReply || providerReply.redirected) {
      const digest = digestFacts({ ...postEvidenceBase, result: "unknown_transport_outcome" });
      await advanceUnknown(context, operationId, digest);
      return action("recovery_required", { operationId, videoId: work.sourceId, state: "create_unknown" });
    }

    const providerUid = providerReply.status === 201 && isProviderUid(providerReply.rawUid?.trim())
      ? providerReply.rawUid.trim()
      : null;
    const location = providerReply.location;
    const locationValid = providerUid !== null && isAllowedStreamTusLocation(location, credentials.accountId);
    const createReplyDigest = digestFacts({
      ...postEvidenceBase,
      kind: "create_reply",
      status: providerReply.status,
      uid: providerUid,
      locationDigest: location ? sha256(location) : null,
      locationValid,
    });
    await recordCreateReply(context, work, providerReply.status, providerUid, createReplyDigest);

    if (!providerUid) {
      await advanceUnknown(context, operationId, createReplyDigest);
      return action("recovery_required", { operationId, videoId: work.sourceId, state: "create_unknown" });
    }

    const transport = await serviceCall(context, "record_stream_media_upload_transport", {
      target_operation_id: operationId,
      target_request_id: work.transport.requestId,
      target_request_digest: work.operationDigest,
      target_provider_uid: providerUid,
      target_tus_location: locationValid ? location : null,
      target_expires_at: locationValid ? expiresAt : null,
      target_max_duration_seconds: STREAM_VOD_LIBRARY_MAX_DURATION_SECONDS,
      target_require_signed_urls: true,
      target_metadata: work.transport.originalMetadata,
      target_evidence_digest: createReplyDigest,
    });
    if (!transport.ok || !transport.data || typeof transport.data !== "object") {
      return action("recovery_required", { operationId, videoId: work.sourceId, state: "create_started" });
    }
    const transportOutcome = (transport.data as Record<string, unknown>).outcome;
    if (!["recorded", "location_recovered", "already_recorded", "known_uid_location_missing"].includes(String(transportOutcome))) {
      return failure(transportOutcome === "identity_mismatch" ? "identity_conflict" : "recovery_required");
    }

    const advanced = await serviceCall(context, "advance_stream_media_upload", {
      target_operation_id: operationId,
      target_request_id: stableUuid(`stream-vod-library:advance-created:${operationId}:${createReplyDigest}`),
      target_next_state: "created_unverified",
      target_evidence_digest: createReplyDigest,
    });
    if (!advanced.ok || !advanced.data || typeof advanced.data !== "object" ||
      !["advanced", "already_recorded"].includes(String((advanced.data as Record<string, unknown>).outcome))) {
      loaded = await ensureWork(context, credentials, operationId);
      if (!loaded.ok || loaded.work.operationState !== "created_unverified") {
        return action("recovery_required", { operationId, videoId: work.sourceId, state: loaded.ok ? loaded.work.operationState : "created_unverified" });
      }
      work = loaded.work;
    } else {
      loaded = await ensureWork(context, credentials, operationId);
      if (!loaded.ok) return action("recovery_required", { operationId, videoId: work.sourceId, state: "created_unverified" });
      work = loaded.work;
    }
    if (!locationValid) {
      return action("recovery_required", { operationId, videoId: work.sourceId, state: work.operationState });
    }
    return issueCapability(context, credentials, work);
  }

  async function status(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      !isPostgresUuid((input as Record<string, unknown>).operationId)) return failure("invalid_request");
    const opened = await openEligibleContext();
    if (!opened.ok) return failure(opened.error);
    const operationId = String((input as Record<string, unknown>).operationId).toLowerCase();
    const result = await userCall(opened.context, "get_stream_media_upload_status", {
      target_operation_id: operationId,
    });
    if (!result.ok) return failure("temporarily_unavailable");
    const parsed = parseStreamVodLibraryStatus(result.data);
    if (!parsed) return failure("recovery_required");
    return action("status", { operationId, state: parsed.state, revision: parsed.revision });
  }

  async function getUploadCapability(input: unknown) {
    if (!deps.enabled()) return failure("disabled");
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      !isPostgresUuid((input as Record<string, unknown>).operationId)) return failure("invalid_request");
    const opened = await openEligibleContext();
    if (!opened.ok) return failure(opened.error);
    const credentials = providerCredentials();
    if (!credentials) return failure("account_unavailable");
    const operationId = String((input as Record<string, unknown>).operationId).toLowerCase();
    const loaded = await ensureWork(opened.context, credentials, operationId);
    if (!loaded.ok) return failure(loaded.error);
    return issueCapability(opened.context, credentials, loaded.work);
  }

  async function fetchExactUid(
    credentials: ProviderCredentials,
    work: StreamVodLibraryWork,
    requestId: string,
  ): Promise<ProviderReadback | null> {
    const uid = work.transport.providerUid;
    if (!uid || !isProviderUid(uid)) return null;
    return fetchWithTimeout(deps,
      `${CLOUDFLARE_API_ORIGIN}/accounts/${credentials.accountId}/stream/${encodeURIComponent(uid)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${credentials.token}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
      },
      async (response, signal) => {
        if (response.redirected) return null;
        if (response.status !== 200) {
          const evidenceDigest = digestFacts({
            kind: "exact_uid_get_v1",
            requestId,
            operationId: work.operationId,
            expectedUid: uid,
            status: response.status,
            flags: null,
          });
          return {
            status: response.status,
            flags: { signedUrls: null, creatorMatch: null, metadataMatch: null, ready: null },
            evidenceDigest,
            requestId,
          };
        }

        const body = await readBoundedJson(response, signal);
        if (!validApiEnvelope(body) || !body.result || typeof body.result !== "object" || Array.isArray(body.result)) {
          // An unusable 200 is not evidence of absence or identity mismatch.
          // Leave the observation ledger untouched and retry only the exact GET.
          return null;
        }
        const result = body.result as Record<string, unknown>;
        const meta = result.meta && typeof result.meta === "object" && !Array.isArray(result.meta)
          ? result.meta as Record<string, unknown>
          : null;
        const returnedUid = typeof result.uid === "string" ? result.uid : null;
        const creatorReported = typeof result.creator === "string" ? result.creator : null;
        const creatorMatch = returnedUid !== null && returnedUid !== uid ||
          creatorReported !== null && creatorReported !== work.actorId
          ? false
          : returnedUid === uid && creatorReported === work.actorId ? true : null;
        const signedUrls = typeof result.requireSignedURLs === "boolean" ? result.requireSignedURLs : null;
        const ready = typeof result.readyToStream === "boolean" ? result.readyToStream : null;

        const canonicalFields: ReadonlyArray<readonly [string, string]> = [
          ["request_marker", work.transport.requestMarker],
          ["source_kind", "video"],
          ["source_id", work.sourceId],
          ["actor_id", work.actorId],
        ];
        let canonicalFieldsComplete = meta !== null;
        let explicitCanonicalMismatch = false;
        if (meta) {
          for (const [field, expected] of canonicalFields) {
            if (!Object.prototype.hasOwnProperty.call(meta, field)) {
              canonicalFieldsComplete = false;
            } else if (meta[field] !== expected) {
              explicitCanonicalMismatch = true;
            }
          }
        }

        // These API fields are optional. Treat an unknown sentinel or an absent
        // local expiry as unknown; only a comparable, explicit disagreement is a hold.
        const reportedMaxDuration = result.maxDurationSeconds;
        const durationConflict = typeof reportedMaxDuration === "number" &&
          reportedMaxDuration !== -1 &&
          reportedMaxDuration !== STREAM_VOD_LIBRARY_MAX_DURATION_SECONDS;
        const expectedExpiry = work.transport.transportExpiresAt
          ? Date.parse(work.transport.transportExpiresAt)
          : Number.NaN;
        const reportedExpiry = typeof result.uploadExpiry === "string"
          ? Date.parse(result.uploadExpiry)
          : Number.NaN;
        const expiryConflict = Number.isFinite(expectedExpiry) && Number.isFinite(reportedExpiry) &&
          expectedExpiry !== reportedExpiry;
        const metadataMatch = explicitCanonicalMismatch || durationConflict || expiryConflict
          ? false
          : canonicalFieldsComplete ? true : null;

        const identityIncomplete = signedUrls === null || creatorMatch === null || metadataMatch === null;
        const explicitIdentityContradiction = signedUrls === false || creatorMatch === false || metadataMatch === false;
        if (identityIncomplete && !explicitIdentityContradiction) {
          // 615 treats a recorded HTTP 200 with nullable identity flags as a
          // permanent observation conflict. Do not write an equivocal 200;
          // leave the ledger unchanged so the next bounded exact GET can prove it.
          return null;
        }

        const flags: ReadbackFlags = {
          signedUrls,
          creatorMatch,
          metadataMatch,
          ready,
        };
        const evidenceDigest = digestFacts({
          kind: "exact_uid_get_v1",
          requestId,
          operationId: work.operationId,
          expectedUid: uid,
          returnedUid,
          status: response.status,
          creator: result.creator ?? null,
          signedUrls: result.requireSignedURLs ?? null,
          marker: meta?.request_marker ?? null,
          sourceKind: meta?.source_kind ?? null,
          sourceId: meta?.source_id ?? null,
          actorId: meta?.actor_id ?? null,
          maxDurationSeconds: result.maxDurationSeconds ?? null,
          uploadExpiry: result.uploadExpiry ?? null,
          ready: result.readyToStream ?? null,
        });
        return { status: response.status, flags, evidenceDigest, requestId };
      },
    );
  }

  async function recordReadback(
    context: StreamVodLibraryRequestContext,
    work: StreamVodLibraryWork,
    readback: ProviderReadback,
  ): Promise<boolean> {
    const result = await serviceCall(context, "record_stream_media_upload_observation", {
      target_operation_id: work.operationId,
      target_registry_id: work.registry.registryId,
      target_kind: "exact_uid_get",
      target_uid: work.transport.providerUid,
      target_http_status: readback.status,
      target_signed_urls: readback.flags.signedUrls,
      target_creator_match: readback.flags.creatorMatch,
      target_marker_match: readback.flags.metadataMatch,
      target_ready: readback.flags.ready,
      target_request_id: readback.requestId,
      target_evidence_digest: readback.evidenceDigest,
    });
    if (!result.ok || !result.data || typeof result.data !== "object") return false;
    const outcome = (result.data as Record<string, unknown>).outcome;
    return outcome === "recorded" || outcome === "already_recorded";
  }

  async function verifyAndCommit(input: unknown) {
    if (!deps.enabled()) return failure("disabled");
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      !isPostgresUuid((input as Record<string, unknown>).operationId)) return failure("invalid_request");
    const opened = await openEligibleContext();
    if (!opened.ok) return failure(opened.error);
    const context = opened.context;
    const operationId = String((input as Record<string, unknown>).operationId).toLowerCase();
    const initial = await readWork(context, operationId);
    if (initial.ok && initial.work.operationState === "completed") {
      return action("completed", { operationId, videoId: initial.work.sourceId });
    }
    if (!initial.ok && initial.blockedOutcome && initial.blockedOutcome !== "account_unverified") {
      return failure(initial.error);
    }
    const credentials = providerCredentials();
    if (!credentials) return failure("account_unavailable");
    // Always revalidate the active projection against the configured slot/account.
    // A current proof for another configured account must never authorize a GET or commit.
    let loaded = await ensureWork(context, credentials, operationId);
    if (!loaded.ok) return failure(loaded.error);
    if (loaded.work.operationState === "completed") {
      return action("completed", { operationId, videoId: loaded.work.sourceId });
    }
    if (!loaded.work.transport.providerUid ||
      !["create_unknown", "created_unverified", "provisional_bound"].includes(loaded.work.operationState)) {
      return failure("upload_not_ready");
    }

    let lastWork = loaded.work;
    for (let attempt = 0; attempt < MAX_READBACK_ATTEMPTS; attempt += 1) {
      const requestId = randomUUID();
      const readback = await fetchExactUid(credentials, lastWork, requestId);
      if (!readback) {
        if (attempt + 1 < MAX_READBACK_ATTEMPTS) {
          await deps.sleep(READBACK_RETRY_DELAY_MS[Math.min(attempt, READBACK_RETRY_DELAY_MS.length - 1)]);
          continue;
        }
        return action("recovery_required", { operationId, videoId: lastWork.sourceId, state: lastWork.operationState });
      }
      if (!(await recordReadback(context, lastWork, readback))) {
        return action("recovery_required", { operationId, videoId: lastWork.sourceId, state: lastWork.operationState });
      }
      loaded = await ensureWork(context, credentials, operationId);
      if (!loaded.ok) return failure(loaded.error);
      lastWork = loaded.work;
      if (lastWork.operationState === "completed") {
        return action("completed", { operationId, videoId: lastWork.sourceId });
      }
      if (lastWork.latestExactUidGet?.requestId !== readback.requestId &&
        !lastWork.latestReadbackValid && !lastWork.latestReadbackRetryable) {
        return failure("identity_conflict");
      }
      if (lastWork.latestReadbackRetryable || !lastWork.latestReadbackValid) {
        if (attempt + 1 < MAX_READBACK_ATTEMPTS) {
          await deps.sleep(READBACK_RETRY_DELAY_MS[Math.min(attempt, READBACK_RETRY_DELAY_MS.length - 1)]);
          continue;
        }
        return action("upload_not_ready", { operationId, videoId: lastWork.sourceId, state: lastWork.operationState });
      }
      if (readback.flags.creatorMatch !== true || readback.flags.metadataMatch !== true ||
        readback.flags.signedUrls !== true) return failure("identity_conflict");

      if (lastWork.operationState === "create_unknown" || lastWork.operationState === "created_unverified") {
        const latestExact = lastWork.latestExactUidGet;
        const observationRequestId = latestExact?.requestId;
        if (!observationRequestId || latestExact.kind !== "exact_uid_get") {
          return failure("recovery_required");
        }
        const bindRequestId = stableUuid(`stream-vod-library:bind:${operationId}:${observationRequestId}`);
        const bound = await serviceCall(context, "bind_stream_media_upload_readback", {
          target_operation_id: operationId,
          target_observation_request_id: observationRequestId,
          target_request_id: bindRequestId,
        });
        if (!bound.ok || !bound.data || typeof bound.data !== "object") {
          const afterUnknownBind = await ensureWork(context, credentials, operationId);
          if (!afterUnknownBind.ok || afterUnknownBind.work.operationState !== "provisional_bound") {
            return action("recovery_required", { operationId, videoId: lastWork.sourceId, state: "created_unverified" });
          }
          lastWork = afterUnknownBind.work;
        } else {
          const bindOutcome = (bound.data as Record<string, unknown>).outcome;
          if (bindOutcome !== "provisional_bound" && bindOutcome !== "already_bound") {
            return bindOutcome === "identity_mismatch" ? failure("identity_conflict") : failure("recovery_required");
          }
          loaded = await ensureWork(context, credentials, operationId);
          if (!loaded.ok) return failure(loaded.error);
          lastWork = loaded.work;
          if (lastWork.operationState !== "provisional_bound") return failure("recovery_required");
        }
      }

      if (lastWork.operationState !== "provisional_bound" || !lastWork.latestReadbackValid) {
        return failure("recovery_required");
      }
      const commitRequestId = stableUuid(`stream-vod-library:commit:${operationId}`);
      const committed = await userCall(context, "commit_stream_library_video_upload", {
        target_operation_id: operationId,
        target_request_id: commitRequestId,
      });
      if (committed.ok && committed.data && typeof committed.data === "object") {
        const result = committed.data as Record<string, unknown>;
        if (result.outcome === "ready_for_publication" && result.video_id === lastWork.sourceId) {
          return action("ready_for_publication", {
            operationId,
            videoId: lastWork.sourceId,
            sourceRevision: Number.isSafeInteger(result.source_revision) ? result.source_revision : null,
          });
        }
      }
      const afterCommit = await ensureWork(context, credentials, operationId);
      if (afterCommit.ok && afterCommit.work.operationState === "completed") {
        return action("completed", { operationId, videoId: afterCommit.work.sourceId });
      }
      return action("recovery_required", { operationId, videoId: lastWork.sourceId, state: "provisional_bound" });
    }
    return action("upload_not_ready", { operationId, videoId: lastWork.sourceId, state: lastWork.operationState });
  }

  return { prepare, start, status, getUploadCapability, verifyAndCommit };
}

const defaultAdapter = createStreamVodLibraryAdapter();

export const prepareStreamVodLibraryUpload = (input: unknown) => defaultAdapter.prepare(input);
export const startStreamVodLibraryUpload = (input: unknown) => defaultAdapter.start(input);
export const getStreamVodLibraryUploadStatus = (input: unknown) => defaultAdapter.status(input);
export const getStreamVodLibraryUploadCapability = (input: unknown) => defaultAdapter.getUploadCapability(input);
export const verifyAndCommitStreamVodLibraryUpload = (input: unknown) => defaultAdapter.verifyAndCommit(input);
