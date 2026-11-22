import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { buildDataExport } from "./data-export";

function queryResult(data: unknown, table?: string, selectCalls?: string[]) {
  const query: Record<string, unknown> = {};
  let selectedColumns = "";
  for (const method of ["select", "eq", "order", "limit"]) {
    query[method] = vi.fn(() => query);
  }
  query.select = vi.fn((columns: string) => {
    selectedColumns = columns;
    selectCalls?.push(columns);
    return query;
  });
  query.maybeSingle = vi.fn(async () => ({ data, error: null }));
  query.then = (
    resolve: (value: { data: unknown; error: { message: string } | null }) => unknown,
  ) => {
    const invalidProgramInstructions =
      table === "programs" &&
      (/(?:^|,)\s*instructions\s*(?:,|$)/.test(selectedColumns) ||
        !selectedColumns.includes(
          "program_days(day_number, title, pillar, instructions)",
        ));
    return Promise.resolve(
      resolve(
        invalidProgramInstructions
          ? {
              data: null,
              error: { message: "column programs.instructions does not exist" },
            }
          : { data, error: null },
      ),
    );
  };
  return query;
}

describe("buildDataExport Program history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports only the signed-in member's retained progress facts, never content or provider IDs", async () => {
    const userClient = {
      from: vi.fn((table: string) =>
        queryResult(
          table === "profiles"
            ? { display_name: "Member", role: "member" }
            : [],
        ),
      ),
    };
    mocks.createClient.mockResolvedValue(userClient);
    const adminClient = {
      rpc: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            rows: [
              {
                program_id: "program-1",
                program_title: "Saved program title",
                program_exists: false,
                member_id: "member-1",
                enrollment_id: null,
                mode: "history_only",
                content_version_id: null,
                started_on: "2026-09-01",
                required_count: 0,
                current_completed_count: 0,
                completed_once_count: 1,
              },
            ],
            has_more: false,
            page: 1,
            page_size: 50,
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            history: [
              {
                lesson_ordinal: 2,
                timeline_day_number: 3,
                title: "Foundation",
                pillar: "mind",
                state: "completed",
                occurred_at: "2026-09-03T16:00:00Z",
                instructions: "Should not be exported",
                video_id: "private-video-id",
                cloudflare_uid: "provider-uid",
              },
            ],
          },
          error: null,
        }),
    };
    mocks.createAdminClient.mockReturnValue(adminClient);

    const data = await buildDataExport({ id: "member-1", email: "member@example.test" });
    const programs = (data as Record<string, unknown>).programs_started as {
      program_title: string;
      mode: string;
      history: { title: string; state: string }[];
    }[];

    expect(programs).toEqual([
      expect.objectContaining({
        program_title: "Saved program title",
        mode: "history_only",
        history: [
          expect.objectContaining({ title: "Foundation", state: "completed" }),
        ],
      }),
    ]);
    expect(JSON.stringify(data)).not.toContain("Should not be exported");
    expect(JSON.stringify(data)).not.toContain("private-video-id");
    expect(JSON.stringify(data)).not.toContain("provider-uid");
    expect(userClient.from).not.toHaveBeenCalledWith("program_enrollments");
    expect(adminClient.rpc).toHaveBeenNthCalledWith(
      1,
      "list_program_progress_summaries",
      expect.objectContaining({ target_member_id: "member-1" }),
    );
    expect(adminClient.rpc).toHaveBeenNthCalledWith(
      2,
      "get_program_versioned_progress",
      { target_program_id: "program-1", target_member_id: "member-1" },
    );
  });

  it("keeps a creator's own program instructions and exports retained history after a role change", async () => {
    const creatorInstructions = "The creator's authored program instructions.";
    const programSelects: string[] = [];
    const userClient = {
      from: vi.fn((table: string) =>
        queryResult(
          table === "profiles"
            ? { display_name: "Former member", role: "coach" }
            : table === "programs"
              ? [
                  {
                    title: "My authored program",
                    description: "Created by this coach",
                    published: true,
                    created_at: "2026-01-01T12:00:00Z",
                    program_days: [
                      {
                        day_number: 1,
                        title: "Start",
                        pillar: "mind",
                        instructions: creatorInstructions,
                      },
                    ],
                  },
                ]
              : [],
          table,
          programSelects,
        ),
      ),
    };
    mocks.createClient.mockResolvedValue(userClient);
    const adminClient = {
      rpc: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            rows: [
              {
                program_id: "deleted-former-member-program",
                program_title: "My former program",
                program_exists: false,
                member_id: "former-member-now-coach",
                enrollment_id: null,
                mode: "history_only",
                content_version_id: null,
                started_on: "2026-02-01",
                required_count: 0,
                current_completed_count: 0,
                completed_once_count: 1,
              },
            ],
            has_more: false,
            page: 1,
            page_size: 50,
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            history: [
              {
                lesson_ordinal: 1,
                timeline_day_number: 1,
                title: "Completed before promotion",
                pillar: "mind",
                state: "completed",
                occurred_at: "2026-02-02T12:00:00Z",
                instructions: "Buyer-only lesson instructions",
                video_id: "buyer-video-id",
              },
            ],
          },
          error: null,
        }),
    };
    mocks.createAdminClient.mockReturnValue(adminClient);

    const data = (await buildDataExport({
      id: "former-member-now-coach",
      email: "coach@example.test",
    })) as Record<string, unknown>;
    const created = data.programs_created as {
      title: string;
      program_days: { instructions: string }[];
    }[];
    const started = data.programs_started as {
      program_title: string;
      history: { title: string; state: string }[];
    }[];

    expect(created).toEqual([
      expect.objectContaining({
        title: "My authored program",
        program_days: [expect.objectContaining({ instructions: creatorInstructions })],
      }),
    ]);
    expect(programSelects).toContain(
      "title, description, published, created_at, program_days(day_number, title, pillar, instructions)",
    );
    expect(started).toEqual([
      expect.objectContaining({
        program_title: "My former program",
        history: [
          expect.objectContaining({
            title: "Completed before promotion",
            state: "completed",
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(data)).not.toContain("Buyer-only lesson instructions");
    expect(JSON.stringify(data)).not.toContain("buyer-video-id");
    expect(adminClient.rpc).toHaveBeenNthCalledWith(
      1,
      "list_program_progress_summaries",
      expect.objectContaining({
        target_member_id: "former-member-now-coach",
      }),
    );
  });
});
