import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));

import { loadCoachDashboardData } from "./coach-dashboard-data";

const coachId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const otherMemberId = "33333333-3333-4333-8333-333333333333";
const uploadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Result = { data: unknown; error?: unknown };
type Operation = [string, ...unknown[]];

function createDatabase(results: Record<string, Result>) {
  const builders: Record<string, { operations: Operation[] }> = {};
  const db = {
    from(table: string) {
      const record = (builders[table] ??= { operations: [] });
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "in", "gt", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          record.operations.push([method, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = () => Promise.resolve(results[table] ?? { data: null });
      builder.then = (
        resolve: (value: Result) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(results[table] ?? { data: [] }).then(resolve, reject);
      return builder;
    },
  };
  return { db, builders };
}

function signedPhotoClient(signCalls: Operation[]) {
  return {
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(path: string, ttl: number) {
            signCalls.push(["sign", bucket, path, ttl]);
            return { data: { signedUrl: `signed:${bucket}:${path}` }, error: null };
          },
        };
      },
    },
  };
}

describe("loadCoachDashboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes upcoming sessions and member activity, merges recent events, and signs own photo first", async () => {
    const signCalls: Operation[] = [];
    const session = {
      id: "session-1",
      title: "Strength check-in",
      starts_at: "2026-11-12T15:00:00Z",
      ends_at: "2026-11-12T16:00:00Z",
      location: "Studio A",
    };
    const { db, builders } = createDatabase({
      calendar_sessions: { data: [session] },
      coach_members: {
        data: [
          { member_id: memberId, member: [{ id: memberId, display_name: "Sam" }] },
          { member_id: otherMemberId, member: null },
        ],
      },
      profile_photos: { data: { photo_path: `${coachId}/${uploadId}.webp` } },
      coach_profile_drafts: {
        data: { photo_path: `${otherMemberId}/${uploadId}.jpg` },
      },
      coach_profiles_public: { data: { photo_path: null } },
      checkins: {
        data: [
          { id: "checkin-1", member_id: memberId, created_at: "2026-11-11T18:00:00Z" },
          { id: "foreign-checkin", member_id: otherMemberId, created_at: "2026-11-11T22:00:00Z" },
        ],
      },
      messages: {
        data: [
          { id: "message-1", member_id: memberId, sender_id: memberId, created_at: "2026-11-11T19:00:00Z" },
          { id: "coach-message", member_id: memberId, sender_id: coachId, created_at: "2026-11-11T20:00:00Z" },
        ],
      },
    });
    mockCreateClient.mockResolvedValue(db);
    mockCreateAdminClient.mockReturnValue(signedPhotoClient(signCalls));

    const data = await loadCoachDashboardData(coachId, "2026-11-11T12:00:00Z");

    expect(data.photoUrl).toBe(`signed:profile-photos:${coachId}/${uploadId}.webp`);
    expect(signCalls).toEqual([
      ["sign", "profile-photos", `${coachId}/${uploadId}.webp`, 3600],
    ]);
    expect(data.sessions.items).toEqual([session]);
    expect(data.activity.items.map((item) => item.kind)).toEqual(["message", "checkin"]);
    expect(data.activity.items.map((item) => item.memberId)).toEqual([memberId, memberId]);

    expect(builders.calendar_sessions.operations).toContainEqual(["eq", "coach_id", coachId]);
    expect(builders.calendar_sessions.operations).toContainEqual(["gt", "ends_at", "2026-11-11T12:00:00Z"]);
    expect(builders.calendar_sessions.operations).toContainEqual(["limit", 3]);
    expect(builders.coach_members.operations).toContainEqual(["eq", "coach_id", coachId]);
    expect(builders.checkins.operations).toContainEqual(["in", "member_id", [memberId]]);
    expect(builders.messages.operations).toContainEqual(["eq", "coach_id", coachId]);
    expect(builders.messages.operations).toContainEqual(["neq", "sender_id", coachId]);
    expect(builders.messages.operations).toContainEqual(["in", "member_id", [memberId]]);
  });

  it("skips dependent reads when there are no connected members", async () => {
    const { db, builders } = createDatabase({
      calendar_sessions: { data: [] },
      coach_members: { data: [] },
      profile_photos: { data: null },
      coach_profile_drafts: { data: null },
      coach_profiles_public: { data: null },
    });
    mockCreateClient.mockResolvedValue(db);

    const data = await loadCoachDashboardData(coachId);

    expect(data.activity).toEqual({ items: [], error: false });
    expect(builders).not.toHaveProperty("checkins");
    expect(builders).not.toHaveProperty("messages");
  });

  it("keeps a session error separate and reports membership failures without broad activity reads", async () => {
    const { db, builders } = createDatabase({
      calendar_sessions: { data: null, error: new Error("calendar unavailable") },
      coach_members: { data: null, error: new Error("membership unavailable") },
      profile_photos: { data: null },
      coach_profile_drafts: { data: null },
      coach_profiles_public: { data: null },
    });
    mockCreateClient.mockResolvedValue(db);

    const data = await loadCoachDashboardData(coachId);

    expect(data.sessions).toEqual({ items: [], error: true });
    expect(data.activity).toEqual({ items: [], error: true });
    expect(builders).not.toHaveProperty("checkins");
    expect(builders).not.toHaveProperty("messages");
  });

  it("does not sign foreign-owner coach portrait paths", async () => {
    const signCalls: Operation[] = [];
    const { db } = createDatabase({
      calendar_sessions: { data: [] },
      coach_members: { data: [] },
      profile_photos: { data: { photo_path: `${otherMemberId}/${uploadId}.jpg` } },
      coach_profile_drafts: { data: { photo_path: `${otherMemberId}/${uploadId}.webp` } },
      coach_profiles_public: { data: { photo_path: `${otherMemberId}/${uploadId}.png` } },
    });
    mockCreateClient.mockResolvedValue(db);
    mockCreateAdminClient.mockReturnValue(signedPhotoClient(signCalls));

    const data = await loadCoachDashboardData(coachId);

    expect(data.photoUrl).toBeNull();
    expect(signCalls).toEqual([]);
  });
});
