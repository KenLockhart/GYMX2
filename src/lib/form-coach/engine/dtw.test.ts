import { describe, expect, it } from "vitest";
import { dtwSimilarity, dynamicTimeWarpingDistance, resampleTimedCurve } from "./dtw";

describe("curve resampling and DTW", () => {
  it("resamples a timed curve to exactly fifty evenly spaced points", () => {
    const samples = resampleTimedCurve([
      { timestampMs: 0, angleDeg: 180 },
      { timestampMs: 500, angleDeg: 90 },
      { timestampMs: 1000, angleDeg: 0 },
    ]);
    expect(samples).toHaveLength(50);
    expect(samples[0]).toBe(180);
    expect((samples[24] + samples[25]) / 2).toBeCloseTo(90);
    expect(samples[49]).toBe(0);
  });

  it("returns perfect similarity for identical curves and degrades monotonically with error", () => {
    const target = [180, 150, 100, 60, 40, 80, 120, 180];
    expect(dtwSimilarity(target, target)).toBe(100);
    const mild = dtwSimilarity(target, target.map((value) => value - 10));
    const larger = dtwSimilarity(target, target.map((value) => value - 30));
    expect(mild).toBeGreaterThan(larger!);
    expect(dynamicTimeWarpingDistance(target, target.map((value) => value - 20))).toBeGreaterThan(0);
  });

  it("handles timing stretch and rejects empty, non-finite, or unordered input", () => {
    expect(dtwSimilarity([0, 40, 100, 160], [0, 20, 40, 100, 130, 160])).toBeGreaterThan(85);
    expect(dtwSimilarity([], [1])).toBeNull();
    expect(() => resampleTimedCurve([{ timestampMs: 2, angleDeg: 20 }, { timestampMs: 1, angleDeg: 30 }])).toThrow(RangeError);
    expect(() => resampleTimedCurve([{ timestampMs: 0, angleDeg: Number.NaN }])).toThrow(RangeError);
  });
});
