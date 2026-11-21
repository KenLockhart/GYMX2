import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  admin: { rpc: vi.fn() },
  user: { rpc: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mocks.admin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mocks.user,
}));

import {
  loadOwnProgramProgressSummaries,
  loadProgramCompletedOnceActivity,
  loadProgramProgressHistoryForMember,
  loadProgramProgressSummariesForMember,
  loadProgramReminderCandidates,
  loadProgramCatalogLessonCounts,
  resolveProgramCatalogLessonCounts,
} from "./program-progress-data";

const summary = (overrides: Record<string, unknown> = {}) => ({
  program_id: "program-1",
  program_title: "Retained program title",
  program_exists: false,
  member_id: "member-1",
  enrollment_id: null,
  mode: "history_only",
  content_version_id: null,
  started_on: "2026-10-01",
  required_count: 0,
  current_completed_count: 0,
  completed_once_count: 2,
  ...overrides,
});

const activity = (overrides: Record<string, unknown> = {}) => ({
  member_id: "member-1",
  program_id: "program-1",
  lesson_identity_id: "identity-1",
  first_completed_at: "2026-10-02T12:00:00Z",
  pillar: "body",
  ...overrides,
});

const reminder = (overrides: Record<string, unknown> = {}) => ({
  member_id: "member-1",
  program_id: "program-1",
  program_title: "Program",
  enrollment_id: "enrollment-1",
  content_version_id: "version-1",
  lesson_id: "lesson-2",
  lesson_title: "Next lesson",
  lesson_ordinal: 2,
  timeline_day_number: 2,
  reminder_key: "identity-2",
  ...overrides,
});

function page(rows: unknown[], current: number, hasMore: boolean) {
  return { rows, has_more: hasMore, page: current, page_size: 50 };
}

function offsetPage(rows: unknown[], nextOffset: number, hasMore: boolean) {
  return { rows, has_more: hasMore, next_offset: nextOffset };
}

describe("program progress data adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("paginates self summaries and preserves detached-history facts", async () => {
    mocks.user.rpc
      .mockResolvedValueOnce({
        data: page([summary()], 1, true),
        error: null,
      })
      .mockResolvedValueOnce({
        data: page(
          [summary({
            program_id: "program-2",
            program_exists: true,
            mode: "free_snapshot",
            required_count: 12,
            current_completed_count: 7,
          })],
          2,
          false,
        ),
        error: null,
      });

    const rows = await loadOwnProgramProgressSummaries();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      program_title: "Retained program title",
      program_exists: false,
      mode: "history_only",
      completed_once_count: 2,
    });
    expect(mocks.user.rpc).toHaveBeenNthCalledWith(
      1,
      "list_program_progress_summaries",
      {
        target_page: 1,
        target_page_size: 50,
        target_program_id: null,
        target_member_id: null,
      },
    );
    expect(mocks.user.rpc).toHaveBeenNthCalledWith(
      2,
      "list_program_progress_summaries",
      expect.objectContaining({ target_page: 2 }),
    );
  });

  it("uses an explicit member ID for service export summaries", async () => {
    mocks.admin.rpc.mockResolvedValue({
      data: page([summary()], 1, false),
      error: null,
    });

    await loadProgramProgressSummariesForMember("member-1");

    expect(mocks.admin.rpc).toHaveBeenCalledWith(
      "list_program_progress_summaries",
      expect.objectContaining({ target_member_id: "member-1" }),
    );
  });

  it("exports only the member's own sanitized version history facts", async () => {
    mocks.admin.rpc.mockResolvedValue({
      data: {
        history: [
          {
            lesson_ordinal: 3,
            timeline_day_number: 4,
            title: "Strength basics",
            pillar: "body",
            state: "completed",
            occurred_at: "2026-10-03T16:00:00Z",
            instructions: "private lesson instructions",
            cloudflare_uid: "provider-secret",
          },
        ],
      },
      error: null,
    });

    const facts = await loadProgramProgressHistoryForMember(
      "program-1",
      "member-1",
    );

    expect(mocks.admin.rpc).toHaveBeenCalledWith(
      "get_program_versioned_progress",
      { target_program_id: "program-1", target_member_id: "member-1" },
    );
    expect(facts).toEqual([
      {
        lessonOrdinal: 3,
        timelineDayNumber: 4,
        title: "Strength basics",
        pillar: "body",
        state: "completed",
        occurredAt: "2026-10-03T16:00:00Z",
      },
    ]);
    expect(JSON.stringify(facts)).not.toContain("instructions");
    expect(JSON.stringify(facts)).not.toContain("cloudflare");
  });

  it("batches lifetime activity IDs, follows offsets, and deduplicates stable identities", async () => {
    const members = Array.from({ length: 201 }, (_, index) => `member-${index}`);
    const firstBatch = members.slice(0, 200);
    const lastMember = members[200];
    mocks.admin.rpc
      .mockResolvedValueOnce({
        data: offsetPage([activity()], 1, true),
        error: null,
      })
      .mockResolvedValueOnce({
        data: offsetPage([activity(), activity({ lesson_identity_id: "identity-2" })], 2, false),
        error: null,
      })
      .mockResolvedValueOnce({
        data: offsetPage([activity({ member_id: lastMember })], 1, false),
        error: null,
      });

    const rows = await loadProgramCompletedOnceActivity({
      from: null,
      to: "2026-11-19T18:00:00Z",
      memberIds: members,
    });

    expect(rows).toHaveLength(3);
    expect(mocks.admin.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.admin.rpc).toHaveBeenNthCalledWith(
      1,
      "list_program_completed_once_activity",
      expect.objectContaining({
        target_member_ids: firstBatch,
        target_from: null,
        target_to: "2026-11-19T18:00:00Z",
        target_offset: 0,
        target_limit: 200,
      }),
    );
    expect(mocks.admin.rpc).toHaveBeenNthCalledWith(
      2,
      "list_program_completed_once_activity",
      expect.objectContaining({ target_offset: 1 }),
    );
  });

  it("reads reminder candidates from the canonical service projection without rebuilding eligibility", async () => {
    mocks.admin.rpc
      .mockResolvedValueOnce({
        data: offsetPage([reminder()], 1, true),
        error: null,
      })
      .mockResolvedValueOnce({
        data: offsetPage([], 1, false),
        error: null,
      });

    const rows = await loadProgramReminderCandidates({
      memberIds: ["member-1"],
      easternToday: "2026-11-19",
    });

    expect(rows).toEqual([reminder()]);
    expect(mocks.admin.rpc).toHaveBeenCalledWith(
      "get_program_reminder_candidates",
      expect.objectContaining({
        target_member_ids: ["member-1"],
        target_eastern_today: "2026-11-19",
        target_offset: 0,
        target_limit: 200,
      }),
    );
  });

  it("fails closed on a truncated or malformed page instead of silently dropping subjects", async () => {
    mocks.user.rpc.mockResolvedValue({
      data: { rows: [summary()], has_more: true, page: 1, page_size: 50 },
      error: null,
    });
    await expect(loadOwnProgramProgressSummaries()).rejects.toThrow(
      "Program progress returned an invalid response.",
    );

    mocks.user.rpc.mockResolvedValue({
      data: page([summary({ completed_once_count: -1 })], 1, false),
      error: null,
    });
    await expect(loadOwnProgramProgressSummaries()).rejects.toThrow(
      "Program progress returned an invalid response.",
    );
  });

  it("uses immutable version lesson counts and current mutable day counts", () => {
    const counts = resolveProgramCatalogLessonCounts(
      [
        { id: "legacy", dayCount: 9 },
        { id: "free", dayCount: 9 },
        { id: "paid", dayCount: 9 },
      ],
      [
        {
          program_id: "legacy",
          current_content_version_id: "legacy-v",
          revision_kind: "current",
          lesson_count: 4,
        },
        {
          program_id: "free",
          current_content_version_id: "free-v",
          revision_kind: "free_snapshot",
          lesson_count: 6,
        },
        {
          program_id: "paid",
          current_content_version_id: "paid-v",
          revision_kind: "paid",
          lesson_count: 8,
        },
      ],
    );
    expect([...counts]).toEqual([
      ["legacy", 9],
      ["free", 6],
      ["paid", 8],
    ]);
  });

  it("does not fall back to mutable days when an immutable version is missing", () => {
    expect(() =>
      resolveProgramCatalogLessonCounts(
        [{ id: "paid", dayCount: 9 }],
        [
          {
            program_id: "paid",
            current_content_version_id: "missing-version",
            revision_kind: null,
            lesson_count: null,
          },
        ],
      ),
    ).toThrow("Program catalog version metadata is unavailable.");
  });

  it("uses service-read dynamic days when catalog RLS hides current versioned days", async () => {
    const rowsByTable: Record<string, unknown[]> = {
      program_commerce_state: [
        {
          program_id: "current-free",
          current_content_version_id: "current-version",
        },
        {
          program_id: "snapshot-free",
          current_content_version_id: "snapshot-version",
        },
      ],
      program_content_versions: [
        {
          id: "current-version",
          program_id: "current-free",
          revision_kind: "current",
          lesson_count: 1,
        },
        {
          id: "snapshot-version",
          program_id: "snapshot-free",
          revision_kind: "free_snapshot",
          lesson_count: 12,
        },
      ],
      // The service query is limited to current revision IDs already supplied by the
      // caller's RLS-filtered catalog. A member-facing count can be zero under versioned RLS.
      programs: [
        { id: "current-free", program_days: [{ count: 2 }] },
      ],
    };
    const selects: { table: string; columns: string }[] = [];
    let currentProgramQuery: Record<string, unknown> | undefined;
    const admin = Object.assign(mocks.admin, {
      from: vi.fn((table: string) => {
        const query: Record<string, unknown> = {};
        query.select = vi.fn((columns: string) => {
          selects.push({ table, columns });
          return query;
        });
        query.in = vi.fn(() => query);
        query.then = (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
        ) => Promise.resolve(resolve({ data: rowsByTable[table] ?? [], error: null }));
        if (table === "programs") currentProgramQuery = query;
        return query;
      }),
    });

    const counts = await loadProgramCatalogLessonCounts([
      { id: "current-free", dayCount: 0 },
      { id: "snapshot-free", dayCount: 0 },
    ]);

    expect([...counts]).toEqual([
      ["current-free", 2],
      ["snapshot-free", 12],
    ]);
    expect(admin.from).toHaveBeenCalledWith("programs");
    expect(selects).toContainEqual({
      table: "programs",
      columns: "id, program_days(count)",
    });
    expect(currentProgramQuery?.in).toHaveBeenCalledWith("id", ["current-free"]);
    expect(admin.from).not.toHaveBeenCalledWith("videos");
  });
});
