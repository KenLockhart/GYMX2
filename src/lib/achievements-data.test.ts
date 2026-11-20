import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { loadMemberActivity } from "./achievements-data";

function queryResult(
  data: unknown,
  count: number | null = null,
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "is", "limit"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = (resolve: (value: { data: unknown; error: null; count: number | null }) => unknown) =>
    Promise.resolve(resolve({ data, error: null, count }));
  return query;
}

describe("loadMemberActivity Program projection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses lifetime first-completion facts and their frozen pillars", async () => {
    const tables = new Map<string, { data: unknown; count?: number | null }>([
      ["task_assignments", { data: [{ completed_at: "2026-11-01T12:00:00Z", task: { pillar: "mind" } }] }],
      ["memos", { data: [{ memo_date: "2026-11-01" }] }],
      ["session_invites", { data: [{ responded_at: "2026-11-02T12:00:00Z" }] }],
      ["messages", { data: [{ created_at: "2026-11-03T12:00:00Z" }] }],
      ["purchases", { data: [], count: 1 }],
      ["coach_members", { data: [], count: 2 }],
      ["habit_logs", { data: [{ day: "2026-11-04", habit: { pillar: "body" } }] }],
      ["session_attendance", { data: [{ joined_at: "2026-11-05T12:00:00Z" }] }],
    ]);
    const db = {
      from: vi.fn((table: string) => {
        const result = tables.get(table);
        return queryResult(result?.data ?? [], result?.count ?? null);
      }),
      rpc: vi.fn().mockResolvedValue({
        data: {
          rows: [
            {
              member_id: "member-1",
              program_id: "deleted-program-id",
              lesson_identity_id: "stable-lesson-identity",
              first_completed_at: "2026-11-06T12:00:00Z",
              pillar: "spirit",
            },
          ],
          has_more: false,
          next_offset: 1,
        },
        error: null,
      }),
    };
    mocks.createAdminClient.mockReturnValue(db);

    const activity = await loadMemberActivity("member-1");

    expect(activity.completions).toEqual([
      { at: "2026-11-01T12:00:00Z", pillar: "mind" },
      { at: "2026-11-06T12:00:00Z", pillar: "spirit" },
    ]);
    expect(db.rpc).toHaveBeenCalledWith(
      "list_program_completed_once_activity",
      expect.objectContaining({
        target_member_ids: ["member-1"],
        target_from: null,
      }),
    );
    expect(db.from).not.toHaveBeenCalledWith("program_day_completions");
  });
});
