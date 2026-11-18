import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAccount,
  mockGetT,
  mockGetLocale,
  mockSyncProgress,
  mockLoadCoachData,
  mockLoadMemberData,
  mockCreateClient,
  mockRedirect,
} = vi.hoisted(() => ({
  mockRequireAccount: vi.fn(),
  mockGetT: vi.fn(),
  mockGetLocale: vi.fn(),
  mockSyncProgress: vi.fn(),
  mockLoadCoachData: vi.fn(),
  mockLoadMemberData: vi.fn(),
  mockCreateClient: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/i18n/server", () => ({ getT: mockGetT, getLocale: mockGetLocale }));
vi.mock("@/lib/auth", () => ({ requireAccount: mockRequireAccount }));
vi.mock("@/lib/achievements-data", () => ({ syncProgress: mockSyncProgress }));
vi.mock("@/lib/coach-dashboard-data", () => ({ loadCoachDashboardData: mockLoadCoachData }));
vi.mock("@/lib/member-dashboard-data", () => ({ loadMemberDashboardData: mockLoadMemberData }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/reminders", () => ({ todayKey: () => "2026-11-17" }));
vi.mock("@/components/coach-dashboard", () => ({
  CoachDashboard: () => createElement("div", { "data-testid": "coach-dashboard" }),
}));
vi.mock("@/components/member-dashboard", () => ({
  MemberDashboard: () => createElement("div", { "data-testid": "member-dashboard" }),
}));

import { en } from "@/i18n/en";
import DashboardPage from "./page";

function profile(role: "member" | "coach" | "moderator" | "admin") {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    role,
    display_name: "Taylor",
    onboarded_at: "2026-11-01T00:00:00.000Z",
    coach_requested: false,
  };
}

async function renderPage(role: "member" | "coach" | "moderator" | "admin") {
  mockRequireAccount.mockResolvedValue({ profile: profile(role) });
  return renderToStaticMarkup(await DashboardPage());
}

describe("dashboard role routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetT.mockResolvedValue(en);
    mockGetLocale.mockResolvedValue("en");
    mockSyncProgress.mockResolvedValue(null);
    mockLoadCoachData.mockResolvedValue({
      photoUrl: null,
      sessions: { items: [], error: false },
      activity: { items: [], error: false },
    });
    mockLoadMemberData.mockResolvedValue({
      photoUrl: null,
      coachSelection: "missing",
      armoryPurchase: "missing",
      sessions: { items: [], error: false },
      tasks: { items: [], error: false },
    });
  });

  it("routes coaches to the existing coach dashboard only", async () => {
    const html = await renderPage("coach");

    expect(html).toContain('data-testid="coach-dashboard"');
    expect(mockLoadCoachData).toHaveBeenCalledOnce();
    expect(mockLoadMemberData).not.toHaveBeenCalled();
  });

  it("routes members to the member dashboard only", async () => {
    const html = await renderPage("member");

    expect(html).toContain('data-testid="member-dashboard"');
    expect(mockLoadMemberData).toHaveBeenCalledOnce();
    expect(mockLoadCoachData).not.toHaveBeenCalled();
  });

  it.each(["moderator", "admin"] as const)(
    "keeps the existing generic dashboard path for %s",
    async (role) => {
      const html = await renderPage(role);

      expect(html).toContain('href="/profile"');
      expect(mockLoadMemberData).not.toHaveBeenCalled();
      expect(mockLoadCoachData).not.toHaveBeenCalled();
      if (role === "admin") expect(html).toContain('href="/admin"');
    },
  );
});
