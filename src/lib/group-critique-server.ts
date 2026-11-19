import "server-only";

import type { UserRole } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { memberCoachIntakeFailure } from "@/lib/member-intake-server";
import {
  groupCritiqueConsentInputSchema,
  groupCritiqueGenerationInputSchema,
  groupCritiqueJoinCredentialSchema,
  groupCritiqueMembershipStateSchema,
  groupCritiqueMuteInputSchema,
  groupCritiqueOfferInputSchema,
  groupCritiqueRoomStateSchema,
  groupCritiqueSessionInputSchema,
  groupCritiqueSnapshotSchema,
  type GroupCritiqueError,
  type GroupCritiqueJoinResult,
  type GroupCritiqueSnapshot,
  type GroupCritiqueSnapshotResult,
} from "@/lib/group-critique";
import {
  createRealtimeKitApi,
  readRealtimeKitConfiguration,
  type RealtimeKitConfiguration,
} from "@/lib/realtimekit-server";

type UserClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

export type GroupCritiqueActor = { id: string; role: UserRole };

type Result<T extends object = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: GroupCritiqueError };

type Runtime = {
  admin: AdminClient;
  config: RealtimeKitConfiguration;
  api: ReturnType<typeof createRealtimeKitApi>;
};

const CLEANUP_BATCH_SIZE = 20;
const CLEANUP_CONCURRENCY = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail<T extends object = Record<never, never>>(
  error: GroupCritiqueError,
): Result<T> {
  return { ok: false, error };
}

function safeRpcError(error: unknown): GroupCritiqueError {
  if (!isRecord(error) || typeof error.code !== "string")
    return "temporarily_unavailable";
  if (error.code === "42501") return "not_allowed";
  if (error.code === "P0002") return "not_found";
  if (error.code === "22023") return "invalid_request";
  if (error.code === "P0001") return "not_ready";
  return "temporarily_unavailable";
}

function isMissingDatabaseFunction(error: unknown) {
  return isRecord(error) &&
    (error.code === "PGRST202" || error.code === "42883");
}

function roleCanUseGroupCritique(role: UserRole): role is "coach" | "member" {
  return role === "coach" || role === "member";
}

async function authorizedForSession(
  user: UserClient,
  admin: AdminClient,
  actor: GroupCritiqueActor,
  sessionId: string,
) {
  const { data: session, error } = await admin
    .from("calendar_sessions")
    .select("id,coach_id,live_mode")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) return { ok: false as const, error: "temporarily_unavailable" as const };
  if (!session) return { ok: false as const, error: "not_found" as const };
  if (actor.role === "coach") {
    return session.coach_id === actor.id
      ? { ok: true as const, session }
      : { ok: false as const, error: "not_allowed" as const };
  }
  if (actor.role !== "member")
    return { ok: false as const, error: "not_allowed" as const };
  const { data: invite, error: inviteError } = await admin
    .from("session_invites")
    .select("member_id")
    .eq("session_id", sessionId)
    .eq("member_id", actor.id)
    .maybeSingle();
  if (inviteError)
    return { ok: false as const, error: "temporarily_unavailable" as const };
  if (!invite)
    return { ok: false as const, error: "not_allowed" as const };
  return { ok: true as const, session };
}

async function providerRuntime(): Promise<Runtime | null> {
  const config = readRealtimeKitConfiguration();
  if (!config) return null;
  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }
  try {
    const { data: bound, error: bindError } = await admin.rpc(
      "bind_group_critique_provider",
      { p_account_id: config.accountId, p_app_id: config.appId },
    );
    if (bindError || bound !== true) return null;
    return { admin, config, api: createRealtimeKitApi(config) };
  } catch {
    return null;
  }
}

async function runtimeReady(runtime: Runtime) {
  try {
    const { data, error } = await runtime.admin.rpc("group_critique_provider_ready");
    return !error && data === true;
  } catch {
    return false;
  }
}

async function providerReadyForMedia(runtime: Runtime) {
  if (!(await runtimeReady(runtime))) return false;
  try {
    return await runtime.api.verifyPresetDefinitions();
  } catch {
    return false;
  }
}

function parseOneRow(data: unknown) {
  return Array.isArray(data) && data.length === 1 && isRecord(data[0])
    ? data[0]
    : null;
}

function parseDate(value: unknown) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function expectedParticipantId(idempotencyKey: string, epoch: number) {
  return `${idempotencyKey}:${epoch}`;
}

function presetName(runtime: Runtime, preset: string) {
  if (preset === "host") return runtime.config.hostPreset;
  if (preset === "not_allowed") return runtime.config.observerPreset;
  if (preset === "can_request") return runtime.config.consentedPreset;
  return null;
}

function publicPreset(preset: string) {
  if (preset === "host") return "host" as const;
  if (preset === "not_allowed") return "observer" as const;
  if (preset === "can_request") return "consented" as const;
  return null;
}

async function provisionMeeting(
  runtime: Runtime,
  sessionId: string,
  generation: number,
) {
  const { data, error } = await runtime.admin.rpc("claim_group_critique_meeting", {
    p_session_id: sessionId,
    p_generation: generation,
  });
  if (error) return null;
  const claim = parseOneRow(data);
  if (!claim) return null;
  const lease = zUuid(claim.lease_token);
  const providerTag = typeof claim.provider_meeting_tag === "string"
    ? claim.provider_meeting_tag
    : "";
  if (!/^gymx2-group:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerTag))
    return null;
  if (claim.create_required === true && !lease) return null;

  let meetingId = typeof claim.provider_meeting_id === "string" && UUID.test(claim.provider_meeting_id)
    ? claim.provider_meeting_id.toLowerCase()
    : null;
  if (claim.create_required === true) {
    const matches = await runtime.api.listMeetingsByTitle(providerTag);
    if (matches.length > 1) return null;
    if (matches.length === 1) {
      meetingId = matches[0].id;
      if (matches[0].status !== "ACTIVE") return null;
    } else {
      const created = await runtime.api.createMeeting(providerTag);
      meetingId = created.id;
    }
    const { data: completed, error: completeError } = await runtime.admin.rpc(
      "complete_group_critique_meeting",
      {
        p_session_id: sessionId,
        p_generation: generation,
        p_lease_token: lease,
        p_provider_meeting_id: meetingId,
      },
    );
    if (completeError || completed !== true) return null;
  }
  if (!meetingId) return null;
  const providerMeeting = await runtime.api.getMeeting(meetingId);
  if (providerMeeting.id !== meetingId || providerMeeting.title !== providerTag ||
      providerMeeting.status !== "ACTIVE") return null;
  return { id: meetingId, tag: providerTag };
}

function zUuid(value: unknown) {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

export async function readGroupCritiqueSnapshot(
  user: UserClient,
  actor: GroupCritiqueActor,
  sessionId: string,
): Promise<GroupCritiqueSnapshotResult> {
  const parsed = groupCritiqueSessionInputSchema.safeParse({ sessionId });
  if (!parsed.success) return fail("invalid_request");
  if (!roleCanUseGroupCritique(actor.role)) return fail("not_allowed");
  if (!readRealtimeKitConfiguration())
    return { ok: true, featureEnabled: false, snapshot: null };
  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    return fail("temporarily_unavailable");
  }
  const access = await authorizedForSession(user, admin, actor, parsed.data.sessionId);
  if (!access.ok) return fail(access.error);
  if (actor.role === "member") {
    const intakeFailure = await memberCoachIntakeFailure(user, access.session.coach_id);
    if (intakeFailure) return fail(intakeFailure);
  }
  const coachId = zUuid(access.session.coach_id);
  if (!coachId) return fail("temporarily_unavailable");
  const runtime = await providerRuntime();
  const { data, error } = await user.rpc("read_group_critique_room", {
    p_session_id: parsed.data.sessionId,
    p_generation: null,
  });
  if (error || !Array.isArray(data)) return fail("temporarily_unavailable");
  const featureEnabled = Boolean(runtime && await runtimeReady(runtime));
  if (data.length === 0) return { ok: true, featureEnabled, snapshot: null };

  const rows = data.filter(isRecord);
  // A coach can see at most 25 members plus the single empty-roster sentinel row.
  if (rows.length !== data.length || rows.length > 26) return fail("temporarily_unavailable");
  const parsedRows = rows.map((row) => ({
    generation: Number(row.generation),
    roomState: row.room_state,
    joinExpiresAt: parseDate(row.join_expires_at),
    allMembersMuted: row.all_members_muted,
    memberId: zUuid(row.member_id),
    membershipState: row.membership_state,
    offeredAt: row.offered_at === null ? null : parseDate(row.offered_at),
    cameraAllowed: row.camera_allowed === true,
    microphoneAllowed: row.microphone_allowed === true,
    coachMuted: row.coach_muted === true,
    participantEpoch: Number(row.participant_epoch),
  }));
  const generation = parsedRows[0]?.generation;
  if (!generation || parsedRows.some((row) => row.generation !== generation ||
      row.roomState !== parsedRows[0].roomState || row.joinExpiresAt !== parsedRows[0].joinExpiresAt ||
      row.allMembersMuted !== parsedRows[0].allMembersMuted) ||
      !groupCritiqueRoomStateSchema.safeParse(parsedRows[0].roomState).success ||
      !parsedRows[0].joinExpiresAt) return fail("temporarily_unavailable");
  if (actor.role === "member" && (parsedRows.length !== 1 || parsedRows[0].memberId !== actor.id))
    return fail("temporarily_unavailable");
  if (parsedRows.some((row) => row.memberId !== null &&
      (!groupCritiqueMembershipStateSchema.safeParse(row.membershipState).success ||
       !Number.isSafeInteger(row.participantEpoch) || row.participantEpoch < 0 ||
       (row.offeredAt === null && rows.find((candidate) => zUuid(candidate.member_id) === row.memberId)?.offered_at !== null))))
    return fail("temporarily_unavailable");
  if (actor.role === "coach" && parsedRows.filter((row) => row.memberId === null).length > 1)
    return fail("temporarily_unavailable");

  const currentRows = actor.role === "coach"
    ? parsedRows.filter((row) => row.memberId !== null && row.membershipState === "eligible")
    : parsedRows;
  const memberIds = currentRows.map((row) => row.memberId as string);
  const { data: profiles, error: profileError } = memberIds.length
    ? await admin.from("profiles").select("id,display_name,role").in("id", memberIds)
    : { data: [], error: null };
  if (profileError || !Array.isArray(profiles)) return fail("temporarily_unavailable");
  const profileMap = new Map<string, string>();
  for (const profile of profiles) {
    if (!isRecord(profile) || typeof profile.id !== "string" ||
        typeof profile.display_name !== "string" || profile.role !== "member")
      return fail("temporarily_unavailable");
    profileMap.set(profile.id.toLowerCase(), profile.display_name.trim().slice(0, 120) || "Member");
  }
  if (memberIds.some((memberId) => !profileMap.has(memberId)))
    return fail("temporarily_unavailable");

  const participantTags = new Map<string, string>();
  if (runtime) {
    let providerQuery = runtime.admin
      .from("group_critique_provider_participants")
      .select("actor_id,idempotency_key,participant_epoch,state")
      .eq("session_id", parsed.data.sessionId)
      .eq("generation", generation);
    if (actor.role === "member")
      providerQuery = providerQuery.in("actor_id", [actor.id, coachId]);
    const { data: providerRows, error: providerError } = await providerQuery;
    if (providerError || !Array.isArray(providerRows)) return fail("temporarily_unavailable");
    const allowedActorIds = actor.role === "member" ? new Set([actor.id, coachId]) : null;
    for (const providerRow of providerRows) {
      if (!isRecord(providerRow)) return fail("temporarily_unavailable");
      const actorId = zUuid(providerRow.actor_id);
      if (!actorId || (allowedActorIds && !allowedActorIds.has(actorId))) continue;
      if (providerRow.state !== "ready") continue;
      const idempotency = zUuid(providerRow.idempotency_key);
      const epoch = Number(providerRow.participant_epoch);
      if (!idempotency || !Number.isSafeInteger(epoch) || epoch < 0 || participantTags.has(actorId))
        return fail("temporarily_unavailable");
      participantTags.set(actorId, expectedParticipantId(idempotency, epoch));
    }
  }
  const snapshotInput: GroupCritiqueSnapshot = {
    sessionId: parsed.data.sessionId,
    generation,
    state: parsedRows[0].roomState as GroupCritiqueSnapshot["state"],
    joinExpiresAt: parsedRows[0].joinExpiresAt,
    role: actor.role,
    coachCustomParticipantId: participantTags.get(coachId) ?? null,
    allMembersMuted: parsedRows[0].allMembersMuted as boolean,
    members: currentRows.map((row) => ({
      memberId: row.memberId as string,
      displayName: profileMap.get(row.memberId as string) as string,
      membershipState: row.membershipState as GroupCritiqueSnapshot["members"][number]["membershipState"],
      offeredAt: row.offeredAt,
      cameraAllowed: row.cameraAllowed as boolean,
      microphoneAllowed: row.microphoneAllowed as boolean,
      coachMuted: row.coachMuted as boolean,
      participantEpoch: row.participantEpoch,
      customParticipantId: row.cameraAllowed && row.microphoneAllowed
        ? participantTags.get(row.memberId as string) ?? null
        : null,
    })),
  };
  const parsedSnapshot = groupCritiqueSnapshotSchema.safeParse(snapshotInput);
  return parsedSnapshot.success
    ? { ok: true, featureEnabled, snapshot: parsedSnapshot.data }
    : fail("temporarily_unavailable");
}

export async function openGroupCritique(
  user: UserClient,
  actor: GroupCritiqueActor,
  sessionId: string,
): Promise<Result<{ generation: number; state: "open"; joinExpiresAt: string }>> {
  const parsed = groupCritiqueSessionInputSchema.safeParse({ sessionId });
  if (!parsed.success) return fail("invalid_request");
  if (actor.role !== "coach") return fail("not_allowed");
  let accessAdmin: AdminClient;
  try { accessAdmin = createAdminClient(); } catch { return fail("temporarily_unavailable"); }
  const access = await authorizedForSession(user, accessAdmin, actor, parsed.data.sessionId);
  if (!access.ok) return fail(access.error);
  if (access.session.live_mode !== "broadcast") return fail("not_ready");
  const runtime = await providerRuntime();
  if (!runtime) return fail("not_ready");
  if (!(await providerReadyForMedia(runtime))) return fail("not_ready");
  const { data, error } = await user.rpc("open_group_critique_room", {
    p_session_id: parsed.data.sessionId,
  });
  if (error) return fail(safeRpcError(error));
  const row = parseOneRow(data);
  const generation = row ? Number(row.generation) : NaN;
  const joinExpiresAt = parseDate(row?.join_expires_at);
  if (!row || !Number.isSafeInteger(generation) || generation < 1 ||
      !joinExpiresAt || !groupCritiqueRoomStateSchema.safeParse(row.state).success)
    return fail("temporarily_unavailable");
  let meeting: Awaited<ReturnType<typeof provisionMeeting>>;
  try {
    meeting = await provisionMeeting(runtime, parsed.data.sessionId, generation);
  } catch {
    return fail("temporarily_unavailable");
  }
  if (!meeting) return fail("temporarily_unavailable");
  return { ok: true, generation, state: "open", joinExpiresAt };
}

export async function offerGroupCritiqueCameras(
  user: UserClient,
  actor: GroupCritiqueActor,
  sessionId: string,
  generation: number,
  memberId?: string | null,
): Promise<Result<{ offeredCount: number; memberId: string | null }>> {
  const parsed = groupCritiqueOfferInputSchema.safeParse({ sessionId, generation, memberId: memberId ?? null });
  if (!parsed.success) return fail("invalid_request");
  if (actor.role !== "coach") return fail("not_allowed");
  let accessAdmin: AdminClient;
  try { accessAdmin = createAdminClient(); } catch { return fail("temporarily_unavailable"); }
  const access = await authorizedForSession(user, accessAdmin, actor, parsed.data.sessionId);
  if (!access.ok) return fail(access.error);
  const runtime = await providerRuntime();
  if (!runtime || !(await providerReadyForMedia(runtime))) return fail("not_ready");
  const { data, error } = await user.rpc("offer_group_critique_cameras", {
    p_session_id: parsed.data.sessionId,
    p_generation: parsed.data.generation,
    p_member_id: parsed.data.memberId ?? null,
  });
  if (error) return fail(safeRpcError(error));
  if (!Number.isSafeInteger(data) || Number(data) < 1) return fail("not_ready");
  return { ok: true, offeredCount: Number(data), memberId: parsed.data.memberId ?? null };
}

export async function acceptGroupCritiqueOffer(
  user: UserClient,
  actor: GroupCritiqueActor,
  sessionId: string,
  generation: number,
): Promise<Result<{ cameraAllowed: true; microphoneAllowed: true; participantEpoch: number; cleanupPending: boolean }>> {
  const parsed = groupCritiqueConsentInputSchema.safeParse({ sessionId, generation, allowCamera: true, allowMicrophone: true });
  if (!parsed.success) return fail("invalid_request");
  if (actor.role !== "member") return fail("not_allowed");
  let accessAdmin: AdminClient;
  try { accessAdmin = createAdminClient(); } catch { return fail("temporarily_unavailable"); }
  const access = await authorizedForSession(user, accessAdmin, actor, parsed.data.sessionId);
  if (!access.ok) return fail(access.error);
  const intakeFailure = await memberCoachIntakeFailure(user, access.session.coach_id);
  if (intakeFailure) return fail(intakeFailure);
  const runtime = await providerRuntime();
  if (!runtime || !(await providerReadyForMedia(runtime))) return fail("not_ready");
  const { data, error } = await user.rpc("accept_group_critique_offer", {
    p_session_id: parsed.data.sessionId,
    p_generation: parsed.data.generation,
    p_allow_camera: true,
    p_allow_microphone: true,
  });
  if (error) return fail(safeRpcError(error));
  const row = parseOneRow(data);
  const participantEpoch = row ? Number(row.participant_epoch) : NaN;
  if (!row || row.camera_allowed !== true || row.microphone_allowed !== true ||
      !Number.isSafeInteger(participantEpoch) || participantEpoch < 0)
    return fail("temporarily_unavailable");
  await attemptScopedGroupCleanup(runtime, parsed.data.sessionId, actor.id);
  const cleanupPending = await actorCleanupPending(
    runtime.admin,
    parsed.data.sessionId,
    parsed.data.generation,
    actor.id,
    "can_request",
    participantEpoch,
  );
  return { ok: true, cameraAllowed: true, microphoneAllowed: true, participantEpoch, cleanupPending };
}

export async function declineGroupCritiqueOffer(
  user: UserClient,
  actor: GroupCritiqueActor,
  sessionId: string,
  generation: number,
): Promise<Result<{ state: "declined"; cleanupPending: boolean }>> {
  const parsed = groupCritiqueGenerationInputSchema.safeParse({ sessionId, generation });
  if (!parsed.success) return fail("invalid_request");
  if (actor.role !== "member") return fail("not_allowed");
  const { data, error } = await user.rpc("decline_group_critique_offer", {
    p_session_id: parsed.data.sessionId,
    p_generation: parsed.data.generation,
  });
  if (error) return fail(safeRpcError(error));
  if (data !== true) return fail("not_ready");
  const runtime = await providerRuntime();
  if (runtime) await attemptScopedGroupCleanup(runtime, parsed.data.sessionId, actor.id);
  const cleanupPending = runtime
    ? await actorCleanupPending(runtime.admin, parsed.data.sessionId, parsed.data.generation, actor.id, "not_allowed")
    : true;
  return { ok: true, state: "declined", cleanupPending };
}

export async function setGroupCritiqueMute(
  user: UserClient,
  actor: GroupCritiqueActor,
  sessionId: string,
  generation: number,
  memberId: string | null,
  muted: boolean,
): Promise<Result<{ muted: boolean; memberId: string | null }>> {
  const parsed = groupCritiqueMuteInputSchema.safeParse({ sessionId, generation, memberId, muted });
  if (!parsed.success) return fail("invalid_request");
  if (actor.role !== "coach") return fail("not_allowed");
  const { data, error } = await user.rpc("set_group_critique_mute", {
    p_session_id: parsed.data.sessionId,
    p_generation: parsed.data.generation,
    p_member_id: parsed.data.memberId,
    p_muted: parsed.data.muted,
  });
  if (error) return fail(safeRpcError(error));
  return data === true
    ? { ok: true, muted: parsed.data.muted, memberId: parsed.data.memberId }
    : fail("not_ready");
}

export async function endGroupCritiqueRoom(
  user: UserClient,
  actor: GroupCritiqueActor,
  sessionId: string,
  generation: number,
): Promise<Result<{ state: "ending" | "ended"; cleanupPending: boolean }>> {
  const parsed = groupCritiqueGenerationInputSchema.safeParse({ sessionId, generation });
  if (!parsed.success) return fail("invalid_request");
  if (actor.role !== "coach") return fail("not_allowed");
  const { data, error } = await user.rpc("end_group_critique_room", {
    p_session_id: parsed.data.sessionId,
    p_generation: parsed.data.generation,
  });
  if (error) return fail(safeRpcError(error));
  if (data !== true) return fail("not_ready");
  const runtime = await providerRuntime();
  if (runtime) await attemptScopedGroupCleanup(runtime, parsed.data.sessionId, null);
  const { data: roomRows, error: readError } = await user.rpc("read_group_critique_room", {
    p_session_id: parsed.data.sessionId,
    p_generation: parsed.data.generation,
  });
  const roomList = Array.isArray(roomRows) ? roomRows.filter(isRecord) : [];
  const ended = !readError && roomList.length > 0 &&
    roomList.length === (Array.isArray(roomRows) ? roomRows.length : -1) &&
    roomList.every((room) => room.room_state === "ended");
  return { ok: true, state: ended ? "ended" : "ending", cleanupPending: !ended };
}

export async function joinGroupCritique(
  user: UserClient,
  actor: GroupCritiqueActor,
  sessionId: string,
  generation: number,
): Promise<GroupCritiqueJoinResult> {
  const parsed = groupCritiqueGenerationInputSchema.safeParse({ sessionId, generation });
  if (!parsed.success || !roleCanUseGroupCritique(actor.role)) return fail("invalid_request");
  let accessAdmin: AdminClient;
  try { accessAdmin = createAdminClient(); } catch { return fail("temporarily_unavailable"); }
  const access = await authorizedForSession(user, accessAdmin, actor, parsed.data.sessionId);
  if (!access.ok) return fail(access.error);
  if (access.session.live_mode !== "broadcast") return fail("not_ready");
  if (actor.role === "member") {
    const intakeFailure = await memberCoachIntakeFailure(user, access.session.coach_id);
    if (intakeFailure) return fail(intakeFailure);
  }
  const runtime = await providerRuntime();
  if (!runtime || !(await providerReadyForMedia(runtime))) return fail("not_ready");

  let meeting: Awaited<ReturnType<typeof provisionMeeting>>;
  try {
    meeting = await provisionMeeting(runtime, parsed.data.sessionId, parsed.data.generation);
  } catch {
    return fail("temporarily_unavailable");
  }
  if (!meeting) return fail("not_ready");
  const { data: claimData, error: claimError } = await runtime.admin.rpc(
    "claim_group_critique_participant",
    {
      p_session_id: parsed.data.sessionId,
      p_generation: parsed.data.generation,
      p_actor_id: actor.id,
    },
  );
  if (claimError) return fail(safeRpcError(claimError));
  const claim = parseOneRow(claimData);
  if (!claim) return fail("not_ready");
  const epoch = Number(claim.participant_epoch);
  const expectedMeetingId = zUuid(claim.provider_meeting_id);
  const expectedParticipantId = zUuid(claim.provider_participant_id);
  const expiresAt = parseDate(claim.token_expires_at);
  const participantTag = typeof claim.provider_participant_tag === "string"
    ? claim.provider_participant_tag
    : "";
  const idempotencyKey = zUuid(claim.idempotency_key);
  const providerPreset = typeof claim.preset === "string" ? presetName(runtime, claim.preset) : null;
  const safePreset = typeof claim.preset === "string" ? publicPreset(claim.preset) : null;
  if (!Number.isSafeInteger(epoch) || epoch < 0 || expectedMeetingId !== meeting.id ||
      !expiresAt || Date.parse(expiresAt) <= Date.now() || !idempotencyKey || !providerPreset || !safePreset ||
      participantTag !== expectedParticipantIdFor(epoch, idempotencyKey) ||
      typeof claim.can_publish_audio !== "boolean" || typeof claim.can_publish_video !== "boolean" ||
      typeof claim.muted !== "boolean" || typeof claim.provision_required !== "boolean")
    return fail("not_ready");

  let providerParticipantId = expectedParticipantId;
  let authToken: string | null = null;
  if (claim.provision_required) {
    if (!zUuid(claim.lease_token)) return fail("not_ready");
    let matches;
    try {
      matches = await runtime.api.listParticipantsByCustomId(meeting.id, participantTag);
    } catch {
      return fail("temporarily_unavailable");
    }
    if (matches.length > 1) return fail("temporarily_unavailable");
    if (matches.length === 1) {
      if (matches[0].presetName !== providerPreset) return fail("temporarily_unavailable");
      providerParticipantId = matches[0].id;
    } else {
      let profileName = "Member";
      const { data: profile, error: profileError } = await runtime.admin
        .from("profiles").select("display_name").eq("id", actor.id).maybeSingle();
      if (profileError || !isRecord(profile) || typeof profile.display_name !== "string")
        return fail("temporarily_unavailable");
      profileName = profile.display_name.trim().slice(0, 120) || "Member";
      try {
        const created = await runtime.api.addParticipant({
          meetingId: meeting.id,
          customParticipantId: participantTag,
          presetName: providerPreset,
          name: profileName,
          expiresOn: expiresAt,
        });
        providerParticipantId = created.participant.id;
        authToken = created.token;
      } catch {
        // A network timeout may hide a successful creation. Reconcile only after a complete list.
        try {
          const recovered = await runtime.api.listParticipantsByCustomId(meeting.id, participantTag);
          if (recovered.length !== 1 || recovered[0].presetName !== providerPreset)
            return fail("temporarily_unavailable");
          providerParticipantId = recovered[0].id;
        } catch {
          return fail("temporarily_unavailable");
        }
      }
    }
    const { data: completed, error: completeError } = await runtime.admin.rpc(
      "complete_group_critique_participant",
      {
        p_session_id: parsed.data.sessionId,
        p_generation: parsed.data.generation,
        p_actor_id: actor.id,
        p_lease_token: claim.lease_token,
        p_provider_participant_id: providerParticipantId,
        p_provider_participant_tag: participantTag,
      },
    );
    if (completeError || completed !== true) return fail("not_ready");
  } else {
    if (!providerParticipantId) return fail("not_ready");
    let providerParticipant;
    try {
      providerParticipant = await runtime.api.getParticipant(meeting.id, providerParticipantId);
    } catch {
      return fail("temporarily_unavailable");
    }
    if (!providerParticipant || providerParticipant.customParticipantId !== participantTag ||
        providerParticipant.presetName !== providerPreset)
      return fail("not_ready");
  }

  if (!providerParticipantId) return fail("not_ready");
  if (!authToken) {
    try {
      authToken = await runtime.api.refreshParticipantToken({
        meetingId: meeting.id,
        participantId: providerParticipantId,
        expiresOn: expiresAt,
      });
    } catch {
      return fail("temporarily_unavailable");
    }
  }

  // Recheck actor, consent epoch, exact provider identity and meeting state after all provider I/O.
  const { data: finalData, error: finalError } = await runtime.admin.rpc(
    "authorize_group_critique_join",
    {
      p_session_id: parsed.data.sessionId,
      p_generation: parsed.data.generation,
      p_actor_id: actor.id,
      p_expected_epoch: epoch,
    },
  );
  const final = parseOneRow(finalData);
  const finalExpiresAt = parseDate(final?.token_expires_at);
  if (finalError || !final || zUuid(final.provider_meeting_id) !== meeting.id ||
      zUuid(final.provider_participant_id) !== providerParticipantId ||
      final.participant_epoch !== epoch || final.preset !== claim.preset ||
      final.can_publish_audio !== claim.can_publish_audio ||
      final.can_publish_video !== claim.can_publish_video || final.muted !== claim.muted ||
      finalExpiresAt !== expiresAt || !await runtimeReady(runtime))
    return fail("not_ready");

  const credential = groupCritiqueJoinCredentialSchema.safeParse({
    meetingId: meeting.id,
    participantId: providerParticipantId,
    customParticipantId: participantTag,
    authToken,
    preset: safePreset,
    canPublishAudio: claim.can_publish_audio,
    canPublishVideo: claim.can_publish_video,
    muted: claim.muted,
    expiresAt,
  });
  return credential.success
    ? { ok: true, credentials: credential.data }
    : fail("temporarily_unavailable");
}

function expectedParticipantIdFor(epoch: number, idempotencyKey: string) {
  return `${idempotencyKey}:${epoch}`;
}

type CleanupJob = {
  jobId: string;
  sessionId: string;
  generation: number;
  meetingId: string | null;
  participantId: string | null;
  meetingTag: string;
  participantTag: string | null;
  action: "delete_participant" | "end_meeting" | "reconcile_meeting" | "reconcile_participant";
  leaseToken: string;
};

function parseCleanupJob(value: unknown): CleanupJob | null {
  if (!isRecord(value)) return null;
  const jobId = zUuid(value.job_id);
  const sessionId = zUuid(value.session_id);
  const generation = Number(value.generation);
  const meetingId = value.provider_meeting_id === null ? null : zUuid(value.provider_meeting_id);
  const participantId = value.provider_participant_id === null ? null : zUuid(value.provider_participant_id);
  const meetingTag = typeof value.provider_meeting_tag === "string" ? value.provider_meeting_tag : "";
  const participantTag = value.provider_participant_tag === null
    ? null
    : typeof value.provider_participant_tag === "string" && value.provider_participant_tag.length <= 160
      ? value.provider_participant_tag
      : "";
  const leaseToken = zUuid(value.lease_token);
  const action = value.action;
  if (!jobId || !sessionId || !Number.isSafeInteger(generation) || generation < 1 ||
      !/^gymx2-group:[0-9a-f-]{36}$/i.test(meetingTag) || !leaseToken ||
      !["delete_participant", "end_meeting", "reconcile_meeting", "reconcile_participant"].includes(String(action)) ||
      (value.provider_meeting_id !== null && !meetingId) ||
      (value.provider_participant_id !== null && !participantId) ||
      participantTag === "") return null;
  return {
    jobId,
    sessionId,
    generation,
    meetingId,
    participantId,
    meetingTag,
    participantTag,
    action: action as CleanupJob["action"],
    leaseToken,
  };
}

async function verifyTaggedMeeting(runtime: Runtime, meetingId: string, meetingTag: string) {
  const meeting = await runtime.api.getMeeting(meetingId);
  return meeting.id === meetingId && meeting.title === meetingTag ? meeting : null;
}

async function removeExactParticipant(
  runtime: Runtime,
  meetingId: string,
  participantId: string,
  participantTag: string,
) {
  const participant = await runtime.api.getParticipant(meetingId, participantId);
  if (!participant) return true;
  if (participant.id !== participantId || participant.customParticipantId !== participantTag)
    return false;
  const deleted = await runtime.api.deleteParticipant(meetingId, participantId);
  if (deleted) return (await runtime.api.getParticipant(meetingId, participantId)) === null;
  return (await runtime.api.getParticipant(meetingId, participantId)) === null;
}

async function runCleanupJob(runtime: Runtime, job: CleanupJob) {
  try {
    if (job.action === "reconcile_meeting") {
      const meetings = await runtime.api.listMeetingsByTitle(job.meetingTag);
      for (const listed of meetings) {
        const verified = await verifyTaggedMeeting(runtime, listed.id, job.meetingTag);
        if (!verified || !(await runtime.api.setMeetingInactive(verified.id))) return false;
      }
      return true;
    }
    if (!job.meetingId || !(await verifyTaggedMeeting(runtime, job.meetingId, job.meetingTag)))
      return false;
    if (job.action === "end_meeting")
      return runtime.api.setMeetingInactive(job.meetingId);
    if (job.action === "reconcile_participant") {
      if (!job.participantTag) return false;
      const matches = await runtime.api.listParticipantsByCustomId(job.meetingId, job.participantTag);
      for (const participant of matches) {
        if (!(await removeExactParticipant(runtime, job.meetingId, participant.id, job.participantTag)))
          return false;
      }
      return (await runtime.api.listParticipantsByCustomId(job.meetingId, job.participantTag)).length === 0;
    }
    if (!job.participantId || !job.participantTag) return false;
    return removeExactParticipant(runtime, job.meetingId, job.participantId, job.participantTag);
  } catch {
    return false;
  }
}

async function processCleanupJobs(runtime: Runtime, jobs: unknown[]) {
  const parsedJobs = jobs.map(parseCleanupJob);
  let completed = 0;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(CLEANUP_CONCURRENCY, parsedJobs.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= parsedJobs.length) return;
        const job = parsedJobs[index];
        if (!job) continue;
        const success = await runCleanupJob(runtime, job);
        try {
          const { data, error } = await runtime.admin.rpc("complete_group_critique_cleanup", {
            p_account_id: runtime.config.accountId,
            p_app_id: runtime.config.appId,
            p_job_id: job.jobId,
            p_lease_token: job.leaseToken,
            p_success: success,
          });
          if (!error && data === true && success) completed += 1;
        } catch {
          // Let other independent leases finish; this job will be reclaimed after its lease expires.
        }
      }
    },
  );
  await Promise.all(workers);
  return { claimed: jobs.length, completed };
}

async function attemptScopedGroupCleanup(
  runtime: Runtime,
  sessionId: string,
  actorId: string | null,
) {
  try {
    const { data, error } = await runtime.admin.rpc("claim_group_critique_cleanup", {
      p_account_id: runtime.config.accountId,
      p_app_id: runtime.config.appId,
      p_limit: 3,
      p_session_id: sessionId,
      p_actor_id: actorId,
    });
    if (error || !Array.isArray(data)) return false;
    const result = await processCleanupJobs(runtime, data);
    return result.claimed === result.completed;
  } catch {
    return false;
  }
}

async function actorCleanupPending(
  admin: AdminClient,
  sessionId: string,
  generation: number,
  actorId: string,
  desiredPreset: "can_request" | "not_allowed",
  desiredEpoch?: number,
) {
  try {
    const { data, error } = await admin
      .from("group_critique_provider_participants")
      .select("state,preset,participant_epoch")
      .eq("session_id", sessionId)
      .eq("generation", generation)
      .eq("actor_id", actorId)
      .maybeSingle();
    if (error) return true;
    if (!data) return false;
    if (!isRecord(data) || typeof data.state !== "string") return true;
    if (data.state === "removed") return false;
    const epochMatches = desiredEpoch === undefined || Number(data.participant_epoch) === desiredEpoch;
    return !(data.state === "ready" && data.preset === desiredPreset && epochMatches);
  } catch {
    return true;
  }
}

export async function cleanupGroupCritiqueAndRecordHeartbeat() {
  const config = readRealtimeKitConfiguration();
  if (!config) {
    try {
      const admin = createAdminClient();
      const { data: bound, error } = await admin.rpc("group_critique_provider_bound");
      if (error && isMissingDatabaseFunction(error))
        return { ok: true, enabled: false, claimed: 0, completed: 0, heartbeatRecorded: false };
      if (error || bound !== false)
        return { ok: false, enabled: true, claimed: 0, completed: 0, heartbeatRecorded: false };
      return { ok: true, enabled: false, claimed: 0, completed: 0, heartbeatRecorded: false };
    } catch {
      return { ok: false, enabled: true, claimed: 0, completed: 0, heartbeatRecorded: false };
    }
  }
  const runtime = await providerRuntime();
  if (!runtime)
    return { ok: false, enabled: true, claimed: 0, completed: 0, heartbeatRecorded: false };
  try {
    const { data, error } = await runtime.admin.rpc("claim_group_critique_cleanup", {
      p_account_id: runtime.config.accountId,
      p_app_id: runtime.config.appId,
      p_limit: CLEANUP_BATCH_SIZE,
    });
    if (error || !Array.isArray(data))
      return { ok: false, enabled: true, claimed: 0, completed: 0, heartbeatRecorded: false };
    const batch = await processCleanupJobs(runtime, data);
    if (batch.completed !== batch.claimed)
      return { ok: false, enabled: true, ...batch, heartbeatRecorded: false };
    const { error: heartbeatError } = await runtime.admin.rpc("record_group_critique_cleanup_heartbeat");
    return {
      ok: !heartbeatError,
      enabled: true,
      ...batch,
      heartbeatRecorded: !heartbeatError,
    };
  } catch {
    return { ok: false, enabled: true, claimed: 0, completed: 0, heartbeatRecorded: false };
  }
}
