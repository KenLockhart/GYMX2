import { describe, expect, it } from "vitest";
import {
  formatPrice,
  MATCH_CATEGORIES,
  type MatchCategory,
  startingMonthlyPrice,
  weightedTotal,
} from "./coach-profile";
import { SAMPLE_COACH } from "./coach-sample";

describe("coach profile helpers", () => {
  it("weights add up to 100", () => {
    expect(MATCH_CATEGORIES.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
  });

  it("starts pricing at the cheapest monthly plan, never an intro call or single session", () => {
    expect(startingMonthlyPrice(SAMPLE_COACH.packages)).toBe(14900);
    expect(
      startingMonthlyPrice([
        {
          name: "Intro",
          kind: "intro",
          priceCents: 0,
          billing: "",
          sessions: "",
          duration: "",
          includes: [],
        },
      ]),
    ).toBeNull();
  });

  it("formats prices", () => {
    expect(formatPrice(0)).toBe("Free");
    expect(formatPrice(14900)).toBe("$149");
    expect(formatPrice(7550)).toBe("$75.50");
  });
});

describe("Coach Jasmine sample", () => {
  it("is marked as sample data", () => {
    expect(SAMPLE_COACH.sample).toBe(true);
  });

  it("has a match total that agrees with its category scores", () => {
    expect(
      weightedTotal(
        SAMPLE_COACH.match!.categories as Record<MatchCategory, number>,
      ),
    ).toBe(SAMPLE_COACH.match!.total);
  });

  it("covers the profile reference values", () => {
    expect(SAMPLE_COACH.specialties).toEqual([
      "Strength",
      "Weight Loss",
      "Beginners",
    ]);
    expect(SAMPLE_COACH.rating).toEqual({ average: 4.9, count: 86 });
    expect(SAMPLE_COACH.experienceYears).toBe(8);
    expect(SAMPLE_COACH.loveLanguages).toEqual({
      primary: "encouragement",
      secondary: "milestones",
    });
  });

  it("never names a real reviewer", () => {
    for (const review of SAMPLE_COACH.reviews.items)
      expect(review.author).toMatch(/^Sample member/);
  });
});
