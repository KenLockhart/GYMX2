import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAccount,
  mockGetT,
  mockGetLocale,
  mockSyncProgress,
  mockLoadCoachData,
  mockLoadMemberData,
  mockLoadDailyFuel,
  mockLoadMemberIntakeBanner,
  mockCreateClient,
  mockRedirect,
} = vi.hoisted(() => ({
  mockRequireAccount: vi.fn(),
  mockGetT: vi.fn(),
  mockGetLocale: vi.fn(),
  mockSyncProgress: vi.fn(),
  mockLoadCoachData: vi.fn(),
  mockLoadMemberData: vi.fn(),
  mockLoadDailyFuel: vi.fn(),
  mockLoadMemberIntakeBanner: vi.fn(),
  mockCreateClient: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/i18n/server", () => ({ getT: mockGetT, getLocale: mockGetLocale }));
vi.mock("@/lib/auth", () => ({ requireAccount: mockRequireAccount }));
vi.mock("@/lib/achievements-data", () => ({ syncProgress: mockSyncProgress }));
vi.mock("@/lib/coach-dashboard-data", () => ({ loadCoachDashboardData: mockLoadCoachData }));
vi.mock("@/lib/member-dashboard-data", () => ({ loadMemberDashboardData: mockLoadMemberData }));
vi.mock("@/lib/member-daily-fuel-data", () => ({ loadMemberDailyFuel: mockLoadDailyFuel }));
vi.mock("@/lib/member-intake-server", () => ({ loadMemberIntakeBanner: mockLoadMemberIntakeBanner }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/reminders", () => ({ todayKey: () => "2026-11-17" }));
vi.mock("@/components/coach-dashboard", () => ({
  CoachDashboard: () => createElement("div", { "data-testid": "coach-dashboard" }),
}));
vi.mock("@/components/member-dashboard", () => ({
  MemberDashboard: ({ intakeBanner }: { intakeBanner?: ReactNode }) =>
    createElement("div", { "data-testid": "member-dashboard" }, intakeBanner),
}));
vi.mock("@/components/pending-member-intake-banner", () => ({
  PendingMemberIntakeBanner: ({ coaches }: { coaches: { coachName: string; startsAt: string }[] }) =>
    createElement("aside", { "data-testid": "pending-intake-banner" }, coaches[0]?.coachName ?? "no coaches"),
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
    mockLoadDailyFuel.mockResolvedValue({
      day: "2026-11-17",
      video: null,
      videoError: false,
      bookmarkError: false,
      affirmed: false,
      affirmationError: false,
    });
    mockLoadMemberIntakeBanner.mockResolvedValue({ coaches: [], error: false });
  });

  it("routes coaches to the existing coach dashboard only", async () => {
    const html = await renderPage("coach");

    expect(html).toContain('data-testid="coach-dashboard"');
    expect(mockLoadCoachData).toHaveBeenCalledOnce();
    expect(mockLoadMemberData).not.toHaveBeenCalled();
    expect(mockLoadMemberIntakeBanner).not.toHaveBeenCalled();
  });

  it("routes members to the member dashboard only", async () => {
    const html = await renderPage("member");

    expect(html).toContain('data-testid="member-dashboard"');
    expect(mockLoadMemberData).toHaveBeenCalledOnce();
    expect(mockLoadDailyFuel).toHaveBeenCalledWith(
      profile("member").id,
      "2026-11-17",
      expect.any(Date),
    );
    expect(mockLoadMemberIntakeBanner).toHaveBeenCalledOnce();
    expect(mockLoadCoachData).not.toHaveBeenCalled();
  });

  it("shows the pending intake banner with sanitized coach data for members", async () => {
    mockLoadMemberIntakeBanner.mockResolvedValue({
      coaches: [{ coachName: "Coach Lee", startsAt: "2026-11-20T14:00:00.000Z" }],
      error: false,
    });

    const html = await renderPage("member");

    expect(html).toContain('data-testid="pending-intake-banner"');
    expect(html).toContain("Coach Lee");
    expect(html).not.toContain("answers");
  });

  it("shows a localized retry alert when the intake lookup fails", async () => {
    mockLoadMemberIntakeBanner.mockResolvedValue({ coaches: [], error: true });

    const html = await renderPage("member");

    expect(html).toContain('role="alert"');
    expect(html).toContain(en.dashboard.dashboardLoadError);
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain('data-testid="pending-intake-banner"');
  });

  it("also shows the retry alert if the intake loader throws", async () => {
    mockLoadMemberIntakeBanner.mockRejectedValue(new Error("lookup failed"));

    const html = await renderPage("member");

    expect(html).toContain('role="alert"');
    expect(html).toContain(en.dashboard.dashboardLoadError);
    expect(html).toContain('href="/dashboard"');
  });

  it.each(["moderator", "admin"] as const)(
    "keeps the existing generic dashboard path for %s",
    async (role) => {
      const html = await renderPage(role);

      expect(html).toContain('href="/profile"');
      expect(mockLoadMemberData).not.toHaveBeenCalled();
      expect(mockLoadDailyFuel).not.toHaveBeenCalled();
      expect(mockLoadMemberIntakeBanner).not.toHaveBeenCalled();
      expect(mockLoadCoachData).not.toHaveBeenCalled();
      if (role === "admin") expect(html).toContain('href="/admin"');
    },
  );
});
