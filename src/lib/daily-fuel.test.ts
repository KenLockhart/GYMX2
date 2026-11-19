import { describe, expect, it } from "vitest";
import {
  dailyFuelStateKey,
  formatMediaTime,
  mediaProgress,
  quoteIndexForDay,
} from "./daily-fuel";

describe("Daily Fuel presentation helpers", () => {
  it("keys state by Eastern day and assigned clip, while keeping same-clip same-day actions stable", () => {
    const today = dailyFuelStateKey("2026-11-18", "video-a");
    expect(dailyFuelStateKey("2026-11-18", "video-a")).toBe(today);
    expect(dailyFuelStateKey("2026-11-18", "video-b")).not.toBe(today);
    expect(dailyFuelStateKey("2026-11-19", "video-a")).not.toBe(today);
    expect(dailyFuelStateKey("2026-11-18", null)).not.toBe(today);
  });

  it("selects the same quote for an Eastern day and changes selection on other dates", () => {
    const first = quoteIndexForDay("2026-11-18", 3);
    expect(quoteIndexForDay("2026-11-18", 3)).toBe(first);
    expect(quoteIndexForDay("2026-11-19", 3)).not.toBe(first);
    expect(quoteIndexForDay("2026-11-18", 0)).toBe(0);
  });

  it("formats player time and clamps progress to the real media duration", () => {
    expect(formatMediaTime(0)).toBe("0:00");
    expect(formatMediaTime(72.9)).toBe("1:12");
    expect(formatMediaTime(Number.NaN)).toBe("0:00");
    expect(mediaProgress(15, 60)).toBe(25);
    expect(mediaProgress(90, 60)).toBe(100);
    expect(mediaProgress(4, 0)).toBe(0);
  });
});
