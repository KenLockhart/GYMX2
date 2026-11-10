import { describe, expect, it } from "vitest";
import {
  averageRating,
  growth,
  mergeActivity,
  readRange,
  sparklinePoints,
  timeAgo,
} from "./admin-console";

const now = new Date("2026-11-10T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 86400000).toISOString();

describe("growth", () => {
  it("counts the total, what was added in the range and the change", () => {
    const g = growth(
      [daysAgo(100), daysAgo(50), daysAgo(20), daysAgo(5)],
      30,
      now,
    );
    expect(g.total).toBe(4);
    expect(g.added).toBe(2);
    expect(g.changePct).toBe(100);
    expect(g.series).toHaveLength(31);
    expect(g.series[0]).toBe(2);
    expect(g.series[30]).toBe(4);
  });
  it("has no change percentage when the range started at zero", () => {
    expect(growth([daysAgo(1)], 7, now).changePct).toBeNull();
    expect(growth([], 7, now)).toMatchObject({
      total: 0,
      added: 0,
      changePct: null,
    });
  });
});

describe("readRange", () => {
  it("accepts 7, 30 or 90 and defaults to 30", () => {
    expect(readRange("7")).toBe(7);
    expect(readRange("90")).toBe(90);
    expect(readRange("365")).toBe(30);
    expect(readRange(undefined)).toBe(30);
  });
});

describe("averageRating", () => {
  it("averages valid ratings to one decimal", () => {
    expect(averageRating([5, 4, 5])).toBe(4.7);
    expect(averageRating([])).toBeNull();
    expect(averageRating([0, 9])).toBeNull();
  });
});

describe("mergeActivity", () => {
  it("keeps the newest events across sources", () => {
    const a = (at: string, title: string) => ({
      kind: "sale" as const,
      title,
      detail: "",
      at,
      href: "/",
    });
    const merged = mergeActivity(
      [[a(daysAgo(3), "old")], [a(daysAgo(1), "new"), a(daysAgo(2), "mid")]],
      2,
    );
    expect(merged.map((m) => m.title)).toEqual(["new", "mid"]);
  });
});

describe("timeAgo", () => {
  it("reads naturally", () => {
    expect(
      timeAgo(new Date(now.getTime() - 12 * 60000).toISOString(), now),
    ).toBe("12 minutes ago");
    expect(
      timeAgo(new Date(now.getTime() - 60 * 60000).toISOString(), now),
    ).toBe("1 hour ago");
    expect(timeAgo(daysAgo(3), now)).toBe("3 days ago");
  });
});

describe("sparklinePoints", () => {
  it("draws a flat line in the middle and scales a rising one", () => {
    expect(sparklinePoints([2, 2], 100, 30, 0)).toBe("0.0,15.0 100.0,15.0");
    expect(sparklinePoints([0, 10], 100, 30, 0)).toBe("0.0,30.0 100.0,0.0");
    expect(sparklinePoints([1])).toBe("");
  });
});
