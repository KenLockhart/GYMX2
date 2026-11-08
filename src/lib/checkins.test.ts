import { describe, expect, it } from "vitest";
import {
  needsAttention,
  previousWeeks,
  weekStart,
  weekSummary,
  type Checkin,
} from "./checkins";

const checkin = (over: Partial<Checkin>): Checkin => ({
  id: "c",
  member_id: "a",
  week_start: "2026-11-02",
  energy: 4,
  sleep: 4,
  stress: 2,
  motivation: 4,
  wins: "",
  struggles: "",
  question: "",
  created_at: "2026-11-05T12:00:00Z",
  ...over,
});

describe("check-ins", () => {
  it("weeks start on Monday", () => {
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2026-11-14")).toBe("2026-11-09");
    expect(previousWeeks("2026-11-09", 3)).toEqual([
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
    ]);
  });

  it("flags low scores and high stress", () => {
    expect(needsAttention(checkin({}))).toEqual([]);
    expect(needsAttention(checkin({ sleep: 2, stress: 5 }))).toEqual([
      "Sleep",
      "Stress",
    ]);
  });

  it("summarizes the week for a coach", () => {
    const summary = weekSummary(
      ["a", "b", "c"],
      [
        checkin({ member_id: "a", energy: 5 }),
        checkin({ member_id: "b", energy: 2 }),
        checkin({ member_id: "c", week_start: "2026-10-26" }),
      ],
      "2026-11-02",
    );
    expect(summary.checkedIn).toBe(2);
    expect(summary.missing).toEqual(["c"]);
    expect(summary.averages.energy).toBe(3.5);
    expect(summary.flagged).toBe(1);
  });
});
