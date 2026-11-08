import { describe, expect, it } from "vitest";
import {
  balancedDays,
  isEditableDay,
  lastDays,
  nutritionAverages,
  parseMeasure,
  pillarSummary,
  weightChange,
} from "./tracking";

const now = new Date("2026-11-11T20:00:00Z"); // Wed 3 PM Eastern

describe("days", () => {
  it("lists the last days, oldest first", () => {
    expect(lastDays(3, now)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
  });

  it("allows editing the last week only", () => {
    expect(isEditableDay("2026-11-05", now)).toBe(true);
    expect(isEditableDay("2026-11-04", now)).toBe(false);
    expect(isEditableDay("2026-11-12", now)).toBe(false);
  });
});

const habits = [
  { id: "m", pillar: "mind" as const },
  { id: "b", pillar: "body" as const },
  { id: "s", pillar: "spirit" as const },
];

describe("pillarSummary", () => {
  it("counts check-ins per pillar out of what was possible", () => {
    const days = ["2026-11-10", "2026-11-11"];
    expect(
      pillarSummary(
        habits,
        [
          { habit_id: "m", day: "2026-11-10" },
          { habit_id: "m", day: "2026-11-11" },
          { habit_id: "b", day: "2026-11-11" },
          { habit_id: "b", day: "2026-11-01" },
        ],
        days,
      ),
    ).toEqual({ mind: { done: 2, possible: 2 }, body: { done: 1, possible: 2 }, spirit: { done: 0, possible: 2 } });
  });
});

describe("balancedDays", () => {
  it("finds days with all three pillars", () => {
    expect(
      balancedDays(habits, [
        { habit_id: "m", day: "2026-11-10" },
        { habit_id: "b", day: "2026-11-10" },
        { habit_id: "s", day: "2026-11-10" },
        { habit_id: "m", day: "2026-11-11" },
      ]),
    ).toEqual(["2026-11-10"]);
  });
});

describe("nutritionAverages", () => {
  it("averages the days that have a value", () => {
    expect(
      nutritionAverages(
        [
          { day: "2026-11-10", protein_g: 150, calories: null, water_glasses: 8 },
          { day: "2026-11-11", protein_g: 171, calories: 2200, water_glasses: null },
          { day: "2026-10-01", protein_g: 10, calories: 10, water_glasses: 1 },
        ],
        ["2026-11-10", "2026-11-11"],
      ),
    ).toEqual({ protein: 161, calories: 2200, water: 8, logged: 2 });
  });
});

describe("weightChange", () => {
  it("compares the first and last weigh-ins since a day", () => {
    expect(
      weightChange(
        [
          { day: "2026-11-11", weight_lb: "178.2" },
          { day: "2026-10-20", weight_lb: 181 },
          { day: "2026-09-01", weight_lb: 190 },
        ],
        "2026-10-12",
      ),
    ).toBe(-2.8);
  });

  it("needs two weigh-ins", () => {
    expect(weightChange([{ day: "2026-11-11", weight_lb: 178 }], "2026-10-12")).toBeNull();
  });
});

describe("parseMeasure", () => {
  it.each([
    ["180", 180],
    ["180.5", 180.5],
    ["1,180", 1180],
    ["", null],
  ])("reads %s", (input, value) => {
    expect(parseMeasure(input)).toBe(value);
  });

  it("rejects text", () => {
    expect(parseMeasure("heavy")).toBeNaN();
  });
});
