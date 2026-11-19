import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { es } from "@/i18n/es";
import type { MemberDailyFuelData } from "@/lib/member-daily-fuel-data";
import { MemberDailyFuel } from "./member-daily-fuel";

vi.mock("@/app/(app)/dashboard/fuel-actions", () => ({
  setMemberDailyAffirmation: vi.fn(),
  setMemberDailyFuelBookmark: vi.fn(),
}));
vi.mock("./member-daily-fuel-player", () => ({
  MemberDailyFuelPlayer: () => null,
}));

const baseData: MemberDailyFuelData = {
  day: "2026-11-19",
  video: null,
  videoError: false,
  bookmarkError: false,
  quote: null,
  quoteError: false,
  affirmation: null,
  affirmed: false,
  affirmationError: false,
};

function render(data: MemberDailyFuelData, locale: "en" | "es" = "en") {
  const messages = locale === "en" ? en : es;
  return renderToStaticMarkup(
    createElement(MemberDailyFuel, {
      data,
      copy: messages.dashboard.dailyFuel,
      categories: {},
      libraryHref: "/library",
    }),
  );
}

describe("member authored Daily Fuel content", () => {
  it("renders the resolved quote and affirmation instead of sample copy", () => {
    const html = render({
      ...baseData,
      quote: {
        text: "Take the next useful step.",
        attribution: "Coach Sage",
        revisionId: "quote-revision-1",
      },
      affirmation: {
        text: "I can build consistency one choice at a time.",
        revisionId: "affirmation-revision-1",
      },
    });

    expect(html).toContain("Take the next useful step.");
    expect(html).toContain("Coach Sage");
    expect(html).toContain("I can build consistency one choice at a time.");
    expect(html).not.toContain("Will Durant");
    expect(html).not.toContain("Show another quote");
    expect(html).toMatch(/<button[^>]*aria-pressed="false"/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-pressed="false"/);
  });

  it("shows empty states and disables acknowledgement without authored content", () => {
    const html = render(baseData);

    expect(html).toContain("No quote has been selected for today yet.");
    expect(html).toContain("No affirmation has been selected for today yet.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-pressed="false"/);
  });

  it("fails closed on resolver errors and reports them in the selected locale", () => {
    const data: MemberDailyFuelData = {
      ...baseData,
      quote: { text: "Must stay hidden", attribution: null, revisionId: "q-1" },
      quoteError: true,
      affirmation: { text: "Must stay hidden too", revisionId: "a-1" },
      affirmationError: true,
      affirmed: true,
    };
    const html = render(data, "es");

    expect(html).toContain(es.dashboard.dailyFuel.quoteLoadError);
    expect(html).toContain(es.dashboard.dailyFuel.affirmationLoadError);
    expect(html).not.toContain("Must stay hidden");
    expect(html).not.toContain("Must stay hidden too");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-pressed="false"/);
  });
});
