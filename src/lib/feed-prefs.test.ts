import { describe, expect, it } from "vitest";
import {
  compactWeights,
  preferencesSchema,
  readPreferences,
  STANDARD_PREFERENCES,
} from "./feed-prefs";

const coach = "6b1f3c1e-2a4b-4c5d-8e9f-0a1b2c3d4e5f";

describe("feed preferences", () => {
  it("falls back to the standard feed when nothing is saved", () => {
    expect(readPreferences(null)).toEqual(STANDARD_PREFERENCES);
  });

  it("reads a saved row and drops anything unexpected", () => {
    expect(
      readPreferences({
        mode: "personalized",
        sort: "personalized",
        topic_weights: { workout: 3, nutrition: 0, bogus: 2, motivation: 9 },
        preferred_coaches: [coach, 42],
      }),
    ).toEqual({
      mode: "personalized",
      sort: "personalized",
      weights: { workout: 3, nutrition: 0 },
      preferredCoaches: [coach],
    });
    expect(readPreferences({ mode: "admin", sort: "random" }).mode).toBe(
      "standard",
    );
  });

  it("stores only weights that differ from Normal", () => {
    expect(compactWeights({ workout: 1, nutrition: 2, progress: 0 })).toEqual({
      nutrition: 2,
      progress: 0,
    });
  });

  it("rejects out-of-range weights, unknown kinds and bad coach ids", () => {
    const base = { mode: "personalized", sort: "newest", preferredCoaches: [] };
    expect(
      preferencesSchema.safeParse({ ...base, weights: { workout: 4 } }).success,
    ).toBe(false);
    expect(
      preferencesSchema.safeParse({ ...base, weights: { secret: 1 } }).success,
    ).toBe(false);
    expect(
      preferencesSchema.safeParse({
        ...base,
        weights: {},
        preferredCoaches: ["not-an-id"],
      }).success,
    ).toBe(false);
    expect(
      preferencesSchema.safeParse({
        ...base,
        weights: { workout: 3 },
        preferredCoaches: [coach],
      }).success,
    ).toBe(true);
  });
});
