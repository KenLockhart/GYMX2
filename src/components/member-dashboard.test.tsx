import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import type { MemberDashboardData } from "@/lib/member-dashboard-data";
import type { Profile } from "@/lib/types";
import { MemberDashboard } from "./member-dashboard";

vi.mock("@/components/calendar-parts", () => ({
  SessionTime: ({ startsAt }: { startsAt: string }) =>
    createElement("time", { dateTime: startsAt }, "Fri, 1:00 PM"),
}));

const profile = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "member",
  display_name: "Taylor Member",
  coach_requested: false,
} as Profile;

function data(
  overrides: Partial<MemberDashboardData> = {},
): MemberDashboardData {
  return {
    photoUrl: null,
    coachSelection: "missing",
    armoryPurchase: "missing",
    sessions: { items: [], error: false },
    tasks: { items: [], error: false },
    ...overrides,
  };
}

function renderDashboard(dashboardData: MemberDashboardData) {
  return renderToStaticMarkup(
    createElement(MemberDashboard, {
      profile,
      data: dashboardData,
      progress: null,
      tasksCopy: en.tasks,
      locale: "en",
      copy: en.dashboard,
      roleLabel: "Member",
      levels: en.options.levels,
      weeklyCheckinDue: false,
    }),
  );
}

describe("member dashboard rendering", () => {
  it("shows daily check-in, session request, nutrition, conditional first-use CTAs and the two work panels", () => {
    const html = renderDashboard(data());

    for (const [href, label] of [
      ["/checkin/daily", "Daily check-in"],
      ["/calendar/request", "Schedule a session"],
      ["/track#nutrition", "Log nutrition / meals"],
      ["/coaches", "Find a coach"],
      ["/armory", "Visit the Armory"],
    ]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(label);
    }
    expect(html).toContain("Upcoming sessions");
    expect(html).toContain("Tasks");
    expect(html).not.toContain("Member activity");
    expect(html).not.toContain("Edit your profile");
  });

  it("hides discovery CTAs after a coach is selected and any purchase is recorded", () => {
    const html = renderDashboard(
      data({ coachSelection: "selected", armoryPurchase: "purchased" }),
    );

    expect(html).not.toContain('href="/coaches"');
    expect(html).not.toContain('href="/armory"');
    expect(html).toContain('href="/calendar/request"');
  });

  it("shows errors and refresh links without treating failed lookups as first-use state", () => {
    const html = renderDashboard(
      data({ coachSelection: "error", armoryPurchase: "error" }),
    );

    expect(html).toContain("We couldn’t check whether you’ve selected a coach.");
    expect(html).toContain("We couldn’t check your purchase history.");
    expect(html).toContain("Refresh dashboard");
    expect(html).not.toContain('href="/coaches"');
    expect(html).not.toContain('href="/armory"');
  });

  it("shows panel errors instead of empty states when sessions or Tasks fail to load", () => {
    const html = renderDashboard(
      data({
        sessions: { items: [], error: true },
        tasks: { items: [], error: true },
      }),
    );

    expect(html).toContain("We couldn’t load your upcoming sessions.");
    expect(html).toContain("We couldn’t load your Tasks.");
    expect(html).not.toContain("Upcoming sessions with your coach will show up here.");
    expect(html).not.toContain("No open Tasks right now.");
  });

  it("renders assigned open Tasks and upcoming sessions, with a photo fallback that has no profile link", () => {
    const html = renderDashboard(
      data({
        photoUrl: "https://photos.example/member.webp",
        sessions: {
          items: [
            {
              id: "session-1",
              title: "Strength session",
              starts_at: "2026-11-20T18:00:00Z",
              ends_at: "2026-11-20T19:00:00Z",
              location: "Studio A",
              coach: { display_name: "Coach Sage" },
            },
          ],
          error: false,
        },
        tasks: {
          items: [{ id: "assignment-1", due_on: "2026-11-21", title: "Mobility work" }],
          error: false,
        },
      }),
    );

    expect(html).toContain('src="https://photos.example/member.webp"');
    expect(html).toContain("Taylor Member&#x27;s portrait");
    expect(html).toContain("Strength session");
    expect(html).toContain("Coach Sage");
    expect(html).toContain("Mobility work");
    expect(html).not.toContain('href="/profile"');
  });
});
