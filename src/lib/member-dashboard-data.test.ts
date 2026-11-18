import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));

import { loadMemberDashboardData } from "./member-dashboard-data";

const memberId = "11111111-1111-4111-8111-111111111111";
const foreignId = "22222222-2222-4222-8222-222222222222";
const uploadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Result = { data: unknown; error?: unknown };
type Operation = [string, ...unknown[]];

function createDatabase(results: Record<string, Result>) {
  const builders: Record<string, { operations: Operation[] }> = {};
  const db = {
    from(table: string) {
      const record = (builders[table] ??= { operations: [] });
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "gt", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          record.operations.push([method, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = () => Promise.resolve(results[table] ?? { data: null });
      builder.then = (
        resolve: (value: Result) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        const result = results[table] ?? { data: [] };
        if (table !== "purchases" || !Array.isArray(result.data))
          return Promise.resolve(result).then(resolve, reject);

        const kindFilter = record.operations.find(
          ([method, column]) => method === "eq" && column === "kind",
        )?.[2];
        const data = result.data.filter(
          (row) =>
            typeof row === "object" &&
            row !== null &&
            (row as { kind?: unknown }).kind === kindFilter,
        );
        return Promise.resolve({ ...result, data }).then(resolve, reject);
      };
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

describe("loadMemberDashboardData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads only the member’s upcoming sessions, open Tasks, coach state, purchases and own portrait", async () => {
    const signCalls: Operation[] = [];
    const { db, builders } = createDatabase({
      coach_members: { data: [{ coach_id: foreignId }] },
      purchases: { data: [] },
      calendar_sessions: {
        data: [
          {
            id: "session-1",
            title: "Strength session",
            starts_at: "2026-11-20T18:00:00Z",
            ends_at: "2026-11-20T19:00:00Z",
            location: "Studio A",
            coach: { display_name: "Coach Sage" },
          },
        ],
      },
      task_assignments: {
        data: [
          {
            id: "assignment-1",
            due_on: "2026-11-21",
            task: { title: "Mobility work" },
          },
        ],
      },
      profile_photos: { data: { photo_path: `${memberId}/${uploadId}.webp` } },
    });
    mockCreateClient.mockResolvedValue(db);
    mockCreateAdminClient.mockReturnValue(signedPhotoClient(signCalls));

    const data = await loadMemberDashboardData(memberId, "2026-11-17T18:00:00Z");

    expect(data.photoUrl).toBe(`signed:profile-photos:${memberId}/${uploadId}.webp`);
    expect(signCalls).toEqual([
      ["sign", "profile-photos", `${memberId}/${uploadId}.webp`, 3600],
    ]);
    expect(data.coachSelection).toBe("selected");
    expect(data.armoryPurchase).toBe("missing");
    expect(data.sessions.items[0]?.coach?.display_name).toBe("Coach Sage");
    expect(data.tasks.items).toEqual([
      { id: "assignment-1", due_on: "2026-11-21", title: "Mobility work" },
    ]);

    expect(builders.coach_members.operations).toContainEqual(["eq", "member_id", memberId]);
    expect(builders.purchases.operations).toContainEqual(["eq", "member_id", memberId]);
    expect(builders.purchases.operations).toContainEqual(["eq", "kind", "item"]);
    expect(builders.calendar_sessions.operations).toContainEqual(["gt", "ends_at", "2026-11-17T18:00:00Z"]);
    expect(builders.calendar_sessions.operations).toContainEqual(["limit", 3]);
    expect(builders.task_assignments.operations).toContainEqual(["eq", "member_id", memberId]);
    expect(builders.task_assignments.operations).toContainEqual(["is", "completed_at", null]);
    expect(builders.task_assignments.operations).toContainEqual(["limit", 3]);
  });

  it("keeps lookup failures explicit so the dashboard does not infer an unselected coach or first purchase", async () => {
    const { db } = createDatabase({
      coach_members: { data: null, error: new Error("connections unavailable") },
      purchases: { data: null, error: new Error("purchases unavailable") },
      calendar_sessions: { data: null, error: new Error("calendar unavailable") },
      task_assignments: { data: null, error: new Error("tasks unavailable") },
      profile_photos: { data: null },
    });
    mockCreateClient.mockResolvedValue(db);

    const data = await loadMemberDashboardData(memberId);

    expect(data.coachSelection).toBe("error");
    expect(data.armoryPurchase).toBe("error");
    expect(data.sessions).toEqual({ items: [], error: true });
    expect(data.tasks).toEqual({ items: [], error: true });
  });

  it("does not count a coach membership invoice as an Armory item purchase", async () => {
    const { db, builders } = createDatabase({
      coach_members: { data: [] },
      purchases: {
        data: [{ id: "membership-invoice", kind: "membership", item_id: null }],
      },
      calendar_sessions: { data: [] },
      task_assignments: { data: [] },
      profile_photos: { data: null },
    });
    mockCreateClient.mockResolvedValue(db);

    const data = await loadMemberDashboardData(memberId);

    expect(data.armoryPurchase).toBe("missing");
    expect(builders.purchases.operations).toContainEqual(["eq", "kind", "item"]);
  });

  it("counts completed Armory item history even when its inventory reference is gone", async () => {
    const { db } = createDatabase({
      coach_members: { data: [] },
      purchases: {
        data: [{ id: "deleted-item-purchase", kind: "item", item_id: null }],
      },
      calendar_sessions: { data: [] },
      task_assignments: { data: [] },
      profile_photos: { data: null },
    });
    mockCreateClient.mockResolvedValue(db);

    const data = await loadMemberDashboardData(memberId);

    expect(data.armoryPurchase).toBe("purchased");
  });

  it("never signs a photo path owned by someone else", async () => {
    const signCalls: Operation[] = [];
    const { db } = createDatabase({
      coach_members: { data: [] },
      purchases: { data: [] },
      calendar_sessions: { data: [] },
      task_assignments: { data: [] },
      profile_photos: { data: { photo_path: `${foreignId}/${uploadId}.jpg` } },
    });
    mockCreateClient.mockResolvedValue(db);
    mockCreateAdminClient.mockReturnValue(signedPhotoClient(signCalls));

    const data = await loadMemberDashboardData(memberId);

    expect(data.photoUrl).toBeNull();
    expect(signCalls).toEqual([]);
  });
});
