import { createElement } from "react";
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
  const { en } = await import("@/i18n/en");
  return { getT: async () => en };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/components/game-parts", () => ({
  PillarTag: ({ pillar }: { pillar: string }) =>
    createElement("span", null, pillar),
}));

function queryResult(data: unknown): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "order", "in"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = (
    resolve: (value: { data: unknown; error: null }) => unknown,
  ) => Promise.resolve(resolve({ data, error: null }));
  return query;
}

describe("Welcome matches catalog counts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses current published version counts from the member-visible catalog only", async () => {
    const userClient = {
      from: vi.fn((table: string) =>
        queryResult(
          table === "profiles"
            ? [
                {
                  id: "coach-1",
                  display_name: "Coach One",
                  bio: "",
                  specialties: ["build_muscle"],
                  join_mode: "free",
                },
              ]
            : table === "programs"
              ? [
                  {
                    id: "visible-program",
                    coach_id: "coach-1",
                    title: "Visible program",
                    program_days: [{ count: 6 }],
                  },
                ]
              : [],
        ),
      ),
    };
    const adminClient = {
      from: vi.fn((table: string) =>
        queryResult(
          table === "program_commerce_state"
            ? [
                {
                  program_id: "visible-program",
                  current_content_version_id: "published-version",
                },
              ]
            : table === "program_content_versions"
              ? [
                  {
                    id: "published-version",
                    program_id: "visible-program",
                    revision_kind: "free_snapshot",
                    lesson_count: 12,
                  },
                ]
              : [],
        ),
      ),
    };
    mocks.createClient.mockResolvedValue(userClient);
    mocks.createAdminClient.mockReturnValue(adminClient);
    mocks.requireAccount.mockResolvedValue({
      profile: {
        id: "member-1",
        role: "member",
        goals: ["build_muscle"],
        focus: null,
      },
    });

    const { default: MatchesPage } = await import("./page");
    const markup = renderToStaticMarkup(await MatchesPage());

    expect(markup).toContain("Visible program (2 weeks · 12 days)");
    expect(userClient.from).toHaveBeenCalledWith("programs");
    expect(adminClient.from).not.toHaveBeenCalledWith("programs");
    expect(adminClient.from).toHaveBeenCalledWith("program_commerce_state");
    expect(adminClient.from).toHaveBeenCalledWith("program_content_versions");
  });
});
