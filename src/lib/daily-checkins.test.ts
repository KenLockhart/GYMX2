import { describe, expect, it } from "vitest";
import {
  dailyCheckinExpectedDaySchema,
  dailyCheckinSchema,
} from "./daily-checkins";

describe("daily check-in answers", () => {
  it("accepts each of the four wellbeing scores from one through five", () => {
    expect(
      dailyCheckinSchema.parse({
        energy: "4",
        sleep: "3",
        stress: "2",
        motivation: "5",
      }),
    ).toEqual({ energy: 4, sleep: 3, stress: 2, motivation: 5 });
  });

  it.each([0, 6, 2.5, "", "not-a-score"])(
    "rejects an invalid score %s",
    (value) => {
      expect(
        dailyCheckinSchema.safeParse({
          energy: value,
          sleep: 3,
          stress: 2,
          motivation: 4,
        }).success,
      ).toBe(false);
    },
  );

  it("requires all four answers", () => {
    expect(
      dailyCheckinSchema.safeParse({ energy: 4, sleep: 3, stress: 2 })
        .success,
    ).toBe(false);
  });

  it("accepts only an ISO day for the stale-page guard", () => {
    expect(dailyCheckinExpectedDaySchema.safeParse("2026-11-17").success).toBe(true);
    expect(dailyCheckinExpectedDaySchema.safeParse("November 17").success).toBe(false);
  });
});
