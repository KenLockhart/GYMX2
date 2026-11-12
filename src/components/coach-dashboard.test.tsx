import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import type { Profile } from "@/lib/types";
import { CoachDashboard } from "./coach-dashboard";

vi.mock("@/components/calendar-parts", () => ({
  SessionTime: ({ startsAt }: { startsAt: string }) =>
    createElement("time", { dateTime: startsAt }, "Thu, 11:00 AM"),
}));

vi.mock("@/components/coach-profile/profile-client", () => ({
  LocalDateTime: ({ iso }: { iso: string }) =>
    createElement("time", { dateTime: iso }, "Nov 11, 8:00 PM"),
}));

const profile = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "coach",
  display_name: "Jasmine AI Coach",
  specialties: ["build_muscle"],
} as Profile;

function renderDashboard(photoUrl: string | null) {
  return renderToStaticMarkup(
    createElement(CoachDashboard, {
      profile,
      photoUrl,
      sessions: [],
      sessionsError: false,
      activity: [],
      activityError: false,
      goals: en.options.goals,
      copy: en.dashboard,
      roleLabel: "Coach",
    }),
  );
}

describe("coach dashboard rendering", () => {
  it("renders the signed portrait, full name, specialty and all real action routes", () => {
    const html = renderDashboard("https://photos.example/signed.webp");

    expect(html).toContain('src="https://photos.example/signed.webp"');
    expect(html).toContain('alt="Jasmine AI Coach&#x27;s portrait"');
    expect(html).toContain("Welcome back, Jasmine AI Coach.");
    expect(html).toContain("Build muscle and strength");
    expect(html).toContain('href="/profile"');
    for (const path of [
      "/tasks/new",
      "/library/upload",
      "/calendar/new",
      "/armory/new",
    ])
      expect(html).toContain(`href="${path}"`);
    expect(html).toContain("Upcoming sessions");
    expect(html).toContain("Member activity");
    expect(html).not.toMatch(/\b(Level|Streak|Challenges)\b/);
  });

  it("shows the add-photo fallback when no signed photo is available", () => {
    const html = renderDashboard(null);

    expect(html).toContain("Add a portrait to your profile");
    expect(html).toContain("Add or update photo");
    expect(html).toContain('href="/profile"');
    expect(html).not.toContain("<img");
  });
});
