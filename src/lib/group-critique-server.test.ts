import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createRealtimeKitApi: vi.fn(),
  readRealtimeKitConfiguration: vi.fn(),
  api: {
    verifyPresetDefinitions: vi.fn(),
    listMeetingsByTitle: vi.fn(),
    createMeeting: vi.fn(),
    getMeeting: vi.fn(),
    listParticipantsByCustomId: vi.fn(),
    addParticipant: vi.fn(),
    getParticipant: vi.fn(),
    refreshParticipantToken: vi.fn(),
    deleteParticipant: vi.fn(),
    setMeetingInactive: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/realtimekit-server", () => ({
  createRealtimeKitApi: mocks.createRealtimeKitApi,
  readRealtimeKitConfiguration: mocks.readRealtimeKitConfiguration,
}));

import {
  acceptGroupCritiqueOffer,
  joinGroupCritique,
  readGroupCritiqueSnapshot,
} from "./group-critique-server";

const sessionId = "d38fce57-073a-4d5a-9cad-73e4d75f28a1";
const coachId = "31dc4305-d759-45a9-9df7-5a91bd681a34";
const memberId = "40708d19-e673-40be-a7e2-7a6078df02a3";
const meetingId = "7a86f017-8ad2-47a2-84c5-863fc9ba5cab";
const participantId = "a1b2c3d4-e5f6-4789-8a9b-0c1d2e3f4a5b";
const idempotencyKey = "12345678-1234-4234-8234-123456789abc";
const participantTag = `${idempotencyKey}:4`;
const providerConfig = {
  accountId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  appId: "d38fce57-073a-4d5a-9cad-73e4d75f28a1",
  apiToken: "synthetic-token",
  hostPreset: "host",
  observerPreset: "observer",
  consentedPreset: "consented",
};
const joinExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();

function makeAdmin(options: {
  invited?: boolean;
  sessionCoachId?: string;
  providerState?: unknown;
  rpcHandlers?: Record<string, unknown | (() => unknown)>;
} = {}) {
  const handlers = options.rpcHandlers ?? {};
  const rpcCalls: { name: string; args?: Record<string, unknown> }[] = [];
  const queries: { table: string; method: string; args: unknown[] }[] = [];
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const configured = handlers[name];
    if (typeof configured === "function") return configured();
    if (configured !== undefined) return configured;
    if (name === "bind_group_critique_provider") return { data: true, error: null };
    if (name === "group_critique_provider_ready") return { data: true, error: null };
    return { data: null, error: null };
  });
  const from = vi.fn((table: string) => {
    let result: unknown = null;
    if (table === "calendar_sessions") {
      result = { id: sessionId, coach_id: options.sessionCoachId ?? coachId, live_mode: "broadcast" };
    } else if (table === "session_invites" && options.invited !== false) {
      result = { member_id: memberId };
    } else if (table === "profiles") {
      result = { id: memberId, role: "member", display_name: "Test Member" };
    } else if (table === "group_critique_provider_participants") {
      result = options.providerState ?? null;
    }
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "limit"]) {
      query[method] = vi.fn((...args: unknown[]) => {
        queries.push({ table, method, args });
        return query;
      });
    }
    query.maybeSingle = vi.fn(async () => ({ data: result, error: null }));
    query.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: Array.isArray(result) ? result : result ? [result] : [], error: null }).then(resolve);
    return query;
  });
  return { rpc, from, rpcCalls, queries };
}

function makeUser(rpcResult: unknown = { data: null, error: null }) {
  return { rpc: vi.fn(async () => rpcResult) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readRealtimeKitConfiguration.mockReturnValue(providerConfig);
  mocks.createRealtimeKitApi.mockReturnValue(mocks.api);
  Object.values(mocks.api).forEach((method) => method.mockReset());
  mocks.api.verifyPresetDefinitions.mockResolvedValue(true);
  mocks.api.getMeeting.mockResolvedValue({ id: meetingId, title: "gymx2-group:12345678-1234-4234-8234-123456789abc", status: "ACTIVE" });
  mocks.api.listParticipantsByCustomId.mockResolvedValue([]);
  mocks.api.addParticipant.mockResolvedValue({
    participant: { id: participantId, customParticipantId: participantTag, presetName: "consented" },
    token: "synthetic-scoped-token",
  });
});

describe("group critique server authorization and races", () => {
  it("keeps the feature off without RealtimeKit config and avoids new group RPCs", async () => {
    mocks.readRealtimeKitConfiguration.mockReturnValue(null);
    const result = await readGroupCritiqueSnapshot(
      makeUser() as never,
      { id: memberId, role: "member" },
      sessionId,
    );
    expect(result).toEqual({ ok: true, featureEnabled: false, snapshot: null });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns an accepted member's own opaque participant tag without other members' tags", async () => {
    const coachIdempotencyKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const providerState = [
      { actor_id: memberId, idempotency_key: idempotencyKey, participant_epoch: 4, state: "ready" },
      { actor_id: coachId, idempotency_key: coachIdempotencyKey, participant_epoch: 0, state: "ready" },
      { actor_id: "5d3501bb-1970-46cd-b064-250858c1b6ee", idempotency_key: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", participant_epoch: 1, state: "ready" },
    ];
    const admin = makeAdmin({
      providerState,
    });
    mocks.createAdminClient.mockReturnValue(admin);
    const user = makeUser({
      data: [{
        generation: 4,
        room_state: "open",
        join_expires_at: joinExpiry,
        all_members_muted: false,
        member_id: memberId,
        membership_state: "eligible",
        offered_at: new Date().toISOString(),
        camera_allowed: true,
        microphone_allowed: true,
        coach_muted: false,
        participant_epoch: 4,
      }],
      error: null,
    });
    const result = await readGroupCritiqueSnapshot(
      user as never,
      { id: memberId, role: "member" },
      sessionId,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot?.members).toHaveLength(1);
    expect(result.snapshot?.members[0].customParticipantId).toBe(participantTag);
    expect(result.snapshot?.members[0].memberId).toBe(memberId);
    expect(result.snapshot?.coachCustomParticipantId).toBe(`${coachIdempotencyKey}:0`);
    expect(admin.queries).toContainEqual({
      table: "group_critique_provider_participants",
      method: "in",
      args: ["actor_id", [memberId, coachId]],
    });

    (providerState[1] as { state: string }).state = "removed";
    const removedCoach = await readGroupCritiqueSnapshot(
      user as never,
      { id: memberId, role: "member" },
      sessionId,
    );
    expect(removedCoach.ok).toBe(true);
    if (removedCoach.ok) expect(removedCoach.snapshot?.coachCustomParticipantId).toBeNull();
  });

  it("queries the coach identity for an empty coach roster and ignores unrelated provider rows", async () => {
    const coachIdempotencyKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const admin = makeAdmin({
      providerState: [
        { actor_id: coachId, idempotency_key: coachIdempotencyKey, participant_epoch: 0, state: "ready" },
        { actor_id: memberId, idempotency_key: idempotencyKey, participant_epoch: 4, state: "ready" },
      ],
    });
    mocks.createAdminClient.mockReturnValue(admin);
    const user = makeUser({
      data: [{
        generation: 4,
        room_state: "open",
        join_expires_at: joinExpiry,
        all_members_muted: false,
        member_id: null,
        membership_state: null,
        offered_at: null,
        camera_allowed: false,
        microphone_allowed: false,
        coach_muted: false,
        participant_epoch: 0,
      }],
      error: null,
    });

    const result = await readGroupCritiqueSnapshot(
      user as never,
      { id: coachId, role: "coach" },
      sessionId,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot?.members).toEqual([]);
    expect(result.snapshot?.coachCustomParticipantId).toBe(`${coachIdempotencyKey}:0`);
    expect(admin.queries).toContainEqual({
      table: "group_critique_provider_participants",
      method: "eq",
      args: ["generation", 4],
    });
    expect(admin.queries).not.toContainEqual(expect.objectContaining({
      table: "group_critique_provider_participants",
      method: "in",
      args: expect.arrayContaining(["actor_id"]),
    }));
  });

  it("fails closed when the authorized session has no valid coach UUID", async () => {
    const admin = makeAdmin({ sessionCoachId: "not-a-uuid" });
    mocks.createAdminClient.mockReturnValue(admin);
    const result = await readGroupCritiqueSnapshot(
      makeUser({
        data: [{
          generation: 4,
          room_state: "open",
          join_expires_at: joinExpiry,
          all_members_muted: false,
          member_id: memberId,
          membership_state: "eligible",
          offered_at: null,
          camera_allowed: false,
          microphone_allowed: false,
          coach_muted: false,
          participant_epoch: 4,
        }],
        error: null,
      }) as never,
      { id: memberId, role: "member" },
      sessionId,
    );

    expect(result).toEqual({ ok: false, error: "temporarily_unavailable" });
    expect(admin.queries).not.toContainEqual(expect.objectContaining({
      table: "group_critique_provider_participants",
    }));
  });

  it("does not call provider readiness or issue credentials for a non-invited member", async () => {
    const admin = makeAdmin({ invited: false });
    mocks.createAdminClient.mockReturnValue(admin);
    const result = await joinGroupCritique(
      makeUser() as never,
      { id: memberId, role: "member" },
      sessionId,
      2,
    );

    expect(result).toEqual({ ok: false, error: "not_allowed" });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(mocks.api.addParticipant).not.toHaveBeenCalled();
  });

  it("withholds a newly minted token if final authorization sees a consent-epoch race", async () => {
    const admin = makeAdmin({
      rpcHandlers: {
        claim_group_critique_meeting: {
          data: [{
            lease_token: null,
            provider_meeting_id: meetingId,
            create_required: false,
            provider_meeting_tag: "gymx2-group:12345678-1234-4234-8234-123456789abc",
          }],
          error: null,
        },
        claim_group_critique_participant: {
          data: [{
            lease_token: "12345678-1234-4234-8234-123456789abc",
            provider_meeting_id: meetingId,
            provider_participant_id: null,
            provider_participant_tag: participantTag,
            idempotency_key: idempotencyKey,
            preset: "can_request",
            can_publish_audio: true,
            can_publish_video: true,
            muted: false,
            token_expires_at: joinExpiry,
            participant_epoch: 4,
            provision_required: true,
          }],
          error: null,
        },
        complete_group_critique_participant: { data: true, error: null },
        authorize_group_critique_join: { data: [], error: null },
      },
    });
    mocks.createAdminClient.mockReturnValue(admin);
    const result = await joinGroupCritique(
      makeUser() as never,
      { id: memberId, role: "member" },
      sessionId,
      4,
    );

    expect(result).toEqual({ ok: false, error: "not_ready" });
    expect(mocks.api.addParticipant).toHaveBeenCalledOnce();
    expect(admin.rpcCalls.map(({ name }) => name)).toContain("authorize_group_critique_join");
    expect(admin.rpcCalls.find(({ name }) => name === "complete_group_critique_participant")?.args)
      .toMatchObject({ p_provider_participant_tag: participantTag });
  });

  it("records the atomic camera-and-microphone consent and immediately claims only that member's revocation", async () => {
    const admin = makeAdmin({
      providerState: { state: "removed", preset: "not_allowed", participant_epoch: 4 },
      rpcHandlers: {
        accept_group_critique_offer: {
          data: [{ camera_allowed: true, microphone_allowed: true, participant_epoch: 4 }],
          error: null,
        },
        claim_group_critique_cleanup: { data: [], error: null },
      },
    });
    mocks.createAdminClient.mockReturnValue(admin);
    const userClient = makeUser({
      data: [{ camera_allowed: true, microphone_allowed: true, participant_epoch: 4 }],
      error: null,
    });
    const result = await acceptGroupCritiqueOffer(userClient as never, { id: memberId, role: "member" }, sessionId, 4);

    expect(result).toEqual({
      ok: true,
      cameraAllowed: true,
      microphoneAllowed: true,
      participantEpoch: 4,
      cleanupPending: false,
    });
    expect(userClient.rpc).toHaveBeenCalledWith("accept_group_critique_offer", {
      p_session_id: sessionId,
      p_generation: 4,
      p_allow_camera: true,
      p_allow_microphone: true,
    });
    expect(admin.rpc).toHaveBeenCalledWith("claim_group_critique_cleanup", expect.objectContaining({
      p_session_id: sessionId,
      p_actor_id: memberId,
      p_limit: 3,
    }));
  });
});
