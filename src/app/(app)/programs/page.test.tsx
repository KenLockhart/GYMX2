import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  requireAccount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAccount: mocks.requireAccount }));
vi.mock("@/i18n/server", async () => {
  const { programs } = await import("@/i18n/en/programs");
  return { getT: async () => ({ programs }) };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/components/form-parts", () => ({
  ActionForm: ({ children }: { children: ReactNode }) =>
    createElement("form", null, children),
  Field: () => null,
  FormStatus: () => null,
  SubmitButton: ({ children }: { children: ReactNode }) =>
    createElement("button", null, children),
}));
vi.mock("./actions", () => ({ createProgram: vi.fn(), startProgram: vi.fn() }));

import ProgramsPage from "./page";

function queryResult(data: unknown): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "in"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = (
    resolve: (value: { data: unknown; error: null }) => unknown,
  ) => Promise.resolve(resolve({ data, error: null }));
  return query;
}

describe("member Programs listing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows retained detached history and version-scoped progress without enrollment joins", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        rows: [
          {
            program_id: "deleted-program",
            program_title: "Archived coach program",
            program_exists: false,
            member_id: "member-1",
            enrollment_id: null,
            mode: "history_only",
            content_version_id: null,
            started_on: "2026-10-01",
            required_count: 0,
            current_completed_count: 0,
            completed_once_count: 2,
          },
          {
            program_id: "started-program",
            program_title: "Snapshot program",
            program_exists: true,
            member_id: "member-1",
            enrollment_id: "enrollment-1",
            mode: "free_snapshot",
            content_version_id: "version-1",
            started_on: "2026-11-01",
            required_count: 12,
            current_completed_count: 7,
            completed_once_count: 7,
          },
          {
            program_id: "unlinked-existing-program",
            program_title: "Retained but unavailable program",
            program_exists: true,
            member_id: "member-1",
            enrollment_id: null,
            mode: "history_only",
            content_version_id: null,
            started_on: "2026-09-01",
            required_count: 0,
            current_completed_count: 0,
            completed_once_count: 1,
          },
          {
            program_id: "left-free-program",
            program_title: "Rejoinable free program",
            program_exists: true,
            member_id: "member-1",
            enrollment_id: null,
            mode: "legacy_free",
            content_version_id: "legacy-version",
            started_on: "2026-08-01",
            required_count: 0,
            current_completed_count: 0,
            completed_once_count: 4,
          },
        ],
        has_more: false,
        page: 1,
        page_size: 50,
      },
      error: null,
    });
    const userClient = {
      rpc,
      from: vi.fn((table: string) =>
        queryResult(
          table === "programs"
            ? [
                {
                  id: "started-program",
                  coach_id: "coach-1",
                  title: "Snapshot program",
                  description: "Already started",
                  published: true,
                  platform_owned: false,
                  coach: { display_name: "Coach" },
                  program_days: [{ count: 10 }],
                },
                {
                  id: "open-program",
                  coach_id: "coach-2",
                  title: "Open snapshot",
                  description: "Available",
                  published: true,
                  platform_owned: true,
                  coach: null,
                  program_days: [{ count: 10 }],
                },
                {
                  id: "left-free-program",
                  coach_id: "coach-3",
                  title: "Rejoinable free program",
                  description: "Start again",
                  published: true,
                  platform_owned: false,
                  coach: { display_name: "Coach Three" },
                  program_days: [{ count: 5 }],
                },
              ]
            : [],
        ),
      ),
    };
    const adminClient = {
      from: vi.fn((table: string) =>
        queryResult(
          table === "programs"
            ? [
                {
                  id: "left-free-program",
                  program_days: [{ count: 5 }],
                },
              ]
            : table === "program_commerce_state"
            ? [
                {
                  program_id: "started-program",
                  current_content_version_id: "version-1",
                },
                {
                  program_id: "open-program",
                  current_content_version_id: "version-open",
                },
                {
                  program_id: "left-free-program",
                  current_content_version_id: "legacy-version",
                },
              ]
            : table === "program_content_versions"
              ? [
                  {
                    id: "version-1",
                    program_id: "started-program",
                    revision_kind: "free_snapshot",
                    lesson_count: 12,
                  },
                  {
                    id: "version-open",
                    program_id: "open-program",
                    revision_kind: "free_snapshot",
                    lesson_count: 6,
                  },
                  {
                    id: "legacy-version",
                    program_id: "left-free-program",
                    revision_kind: "current",
                    lesson_count: 5,
                  },
                ]
              : [],
        ),
      ),
    };
    mocks.createClient.mockResolvedValue(userClient);
    mocks.createAdminClient.mockReturnValue(adminClient);
    mocks.requireAccount.mockResolvedValue({
      profile: { id: "member-1", role: "member" },
    });

    const markup = renderToStaticMarkup(await ProgramsPage());

    expect(markup).toContain("Archived coach program");
    expect(markup).toContain("2 lessons completed in saved history");
    expect(markup).toContain("Current version · 7 of 12 lessons done");
    expect(markup).toContain("Open snapshot");
    expect(markup).toContain("6 days");
    expect(markup).toContain("Retained but unavailable program");
    expect(markup).not.toContain('href="/programs/unlinked-existing-program"');
    expect(markup).toContain("Rejoinable free program");
    expect(markup).toContain("4 lessons completed in saved history");
    expect(markup.match(/Start today/g)).toHaveLength(2);
    expect(markup).not.toContain("Already started");
    expect(userClient.from).not.toHaveBeenCalledWith("program_enrollments");
    expect(userClient.from).not.toHaveBeenCalledWith("program_day_completions");
    expect(rpc).toHaveBeenCalledWith(
      "list_program_progress_summaries",
      expect.objectContaining({ target_member_id: null }),
    );
  });
});
