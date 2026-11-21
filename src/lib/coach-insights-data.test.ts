import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  userRpc: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { loadCoachInsights } from "./coach-insights-data";

const PROGRAM_IDS = ["current-coach-program-a", "current-coach-program-b"];
const OTHER_COACH_PROGRAM_ID = "other-coach-program";
const DELETED_PROGRAM_ID = "deleted-former-coach-program";
const MEMBER_ID = "member-linked-to-coach";

function queryResult(table: string): Record<string, unknown> {
  const rows: Record<string, unknown[]> = {
    purchases: [],
    subscriptions: [],
    coach_members: [
      { member_id: MEMBER_ID, created_at: "2026-01-01T12:00:00Z", member: { display_name: "Member" } },
    ],
    task_assignments: [],
    messages: [],
    group_messages: [],
    calendar_sessions: [],
    programs: PROGRAM_IDS.map((id, index) => ({
      id,
      title: `Current coach program ${index + 1}`,
    })),
    checkins: [],
  };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "neq", "limit", "in", "order"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = (
    resolve: (value: {
      data: unknown[];
      error: null;
      count: number | null;
    }) => unknown,
  ) =>
    Promise.resolve(
      resolve({
        data: rows[table] ?? [],
        error: null,
        count: table === "programs" ? PROGRAM_IDS.length : null,
      }),
    );
  return query;
}

describe("coach Insights Program scoping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes a linked member's activity and current progress to each currently owned program", async () => {
    const admin = {
      from: vi.fn((table: string) => queryResult(table)),
      rpc: mocks.adminRpc.mockImplementation(
        async (_name: string, args: Record<string, unknown>) => {
          const programId = args.target_program_id;
          const activityByProgram: Record<string, string> = {
            [PROGRAM_IDS[0]]: "2026-11-10T12:00:00Z",
            [PROGRAM_IDS[1]]: "2026-11-11T12:00:00Z",
            [OTHER_COACH_PROGRAM_ID]: "2026-11-12T12:00:00Z",
            [DELETED_PROGRAM_ID]: "2026-11-13T12:00:00Z",
          };
          const rows =
            typeof programId === "string" && activityByProgram[programId]
              ? [
                  {
                    member_id: MEMBER_ID,
                    program_id: programId,
                    lesson_identity_id: `identity-${programId}`,
                    first_completed_at: activityByProgram[programId],
                    pillar: "mind",
                  },
                ]
              : [];
          return {
            data: { rows, has_more: false, next_offset: rows.length },
            error: null,
          };
        },
      ),
    };
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.createClient.mockResolvedValue({ rpc: mocks.userRpc });
    mocks.userRpc.mockResolvedValue({
      data: {
        rows: [],
        has_more: false,
        page: 1,
        page_size: 50,
      },
      error: null,
    });
    mocks.userRpc.mockImplementation(
      async (_name: string, args: Record<string, unknown>) => ({
        data: {
          rows: [
            {
              program_id: args.target_program_id,
              program_title: "Current coach program",
              program_exists: true,
              member_id: MEMBER_ID,
              enrollment_id: `enrollment-${args.target_program_id}`,
              mode: "free_snapshot",
              content_version_id: `version-${args.target_program_id}`,
              started_on: "2026-11-01",
              required_count: 8,
              current_completed_count: 3,
              completed_once_count: 3,
            },
          ],
          has_more: false,
          page: 1,
          page_size: 50,
        },
        error: null,
      }),
    );

    const result = await loadCoachInsights("coach-1");

    expect(result.programs).toEqual(
      PROGRAM_IDS.map((id, index) => ({
        id,
        title: `Current coach program ${index + 1}`,
        enrollments: [{ done: 3, required: 8 }],
      })),
    );
    expect(result.activity).toEqual([
      { member_id: MEMBER_ID, at: "2026-11-10T12:00:00Z" },
      { member_id: MEMBER_ID, at: "2026-11-11T12:00:00Z" },
    ]);
    expect(result.activity).not.toContainEqual(
      expect.objectContaining({ at: "2026-11-12T12:00:00Z" }),
    );
    expect(result.activity).not.toContainEqual(
      expect.objectContaining({ at: "2026-11-13T12:00:00Z" }),
    );
    const activityCalls = mocks.adminRpc.mock.calls.filter(
      ([name]) => name === "list_program_completed_once_activity",
    );
    expect(activityCalls.map(([, args]) => args.target_program_id).sort()).toEqual(
      [...PROGRAM_IDS].sort(),
    );
    expect(activityCalls.every(([, args]) =>
      (args.target_member_ids as string[]).includes(MEMBER_ID),
    )).toBe(true);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "list_program_completed_once_activity",
      expect.objectContaining({ target_program_id: PROGRAM_IDS[0] }),
    );
    expect(mocks.adminRpc).not.toHaveBeenCalledWith(
      "list_program_completed_once_activity",
      expect.objectContaining({ target_program_id: null }),
    );
    expect(mocks.userRpc).toHaveBeenCalledWith(
      "list_program_progress_summaries",
      expect.objectContaining({ target_program_id: PROGRAM_IDS[0] }),
    );
  });
});
