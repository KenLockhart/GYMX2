import { describe, expect, it } from "vitest";
import { nextDay, progressPercent, unlockedThrough, weeksLabel } from "./programs";

describe("unlockedThrough", () => {
  it("opens day 1 on the start day and one more each day", () => {
    expect(unlockedThrough("2026-11-08", "2026-11-08")).toBe(1);
    expect(unlockedThrough("2026-11-08", "2026-11-14")).toBe(7);
  });

  it("opens nothing before the start", () => {
    expect(unlockedThrough("2026-11-10", "2026-11-08")).toBe(0);
  });
});

describe("labels", () => {
  it.each([
    [0, "No days yet"],
    [1, "1 day"],
    [5, "5 days"],
    [7, "1 week · 7 days"],
    [42, "6 weeks · 42 days"],
  ])("%i days", (count, label) => {
    expect(weeksLabel(count)).toBe(label);
  });

  it("works out progress", () => {
    expect(progressPercent(3, 42)).toBe(7);
    expect(progressPercent(0, 0)).toBe(0);
  });
});

describe("nextDay", () => {
  const days = [
    { id: "a", day_number: 1 },
    { id: "b", day_number: 2 },
    { id: "c", day_number: 3 },
  ];

  it("finds the first unlocked day not yet done", () => {
    expect(nextDay(days, new Set(["a"]), 3)?.id).toBe("b");
  });

  it("is null when caught up", () => {
    expect(nextDay(days, new Set(["a", "b"]), 2)).toBeNull();
  });
});
