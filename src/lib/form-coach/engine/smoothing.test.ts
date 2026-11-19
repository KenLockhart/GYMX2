import { describe, expect, it } from "vitest";
import { LandmarkEmaSmoother, smoothLandmarks } from "./smoothing";

describe("landmark EMA smoothing", () => {
  it("uses alpha 0.4 for visible coordinates and preserves confidence", () => {
    const smoother = new LandmarkEmaSmoother(0.4);
    expect(smoother.smooth([{ x: 0, y: 0, visibility: 0.9 }])[0]).toEqual({ x: 0, y: 0, visibility: 0.9 });
    expect(smoother.smooth([{ x: 1, y: 0.5, visibility: 0.8 }])[0]).toEqual({
      x: 0.4,
      y: 0.2,
      visibility: 0.8,
    });
  });

  it("does not carry old coordinates through an occlusion", () => {
    const smoother = new LandmarkEmaSmoother(0.4);
    smoother.smooth([{ x: 0.1, y: 0.2, visibility: 0.9 }]);
    expect(smoother.smooth([{ x: 0.9, y: 0.8, visibility: 0.49 }])[0]).toEqual({
      x: 0.9,
      y: 0.8,
      visibility: 0.49,
    });
    expect(smoother.smooth([{ x: 0.7, y: 0.6, visibility: 0.9 }])[0]).toEqual({
      x: 0.7,
      y: 0.6,
      visibility: 0.9,
    });
  });

  it("clears EMA state on null, invalid, and truncated landmark input", () => {
    const smoother = new LandmarkEmaSmoother(0.4);
    smoother.smooth([{ x: 0.1, y: 0.2, visibility: 0.9 }, { x: 0.2, y: 0.3, visibility: 0.9 }]);
    expect(smoother.smooth([null, { x: Number.NaN, y: 0.4, visibility: 0.9 }])).toEqual([null, null]);
    expect(smoother.smooth([{ x: 0.9, y: 0.8, visibility: 0.9 }])[0]).toEqual({
      x: 0.9,
      y: 0.8,
      visibility: 0.9,
    });
    smoother.smooth([{ x: 0.2, y: 0.2, visibility: 0.9 }, { x: 0.3, y: 0.3, visibility: 0.9 }]);
    smoother.smooth([{ x: 0.4, y: 0.4, visibility: 0.9 }]);
    expect(smoother.smooth([{ x: 0.8, y: 0.8, visibility: 0.9 }, { x: 0.9, y: 0.9, visibility: 0.9 }])[1]).toEqual({
      x: 0.9,
      y: 0.9,
      visibility: 0.9,
    });
  });

  it("supports stateless EMA and validates alpha", () => {
    expect(
      smoothLandmarks([{ x: 0.5, y: 0.5, visibility: 0.9 }], [{ x: 0.1, y: 0.1, visibility: 0.9 }])[0],
    ).toEqual({ x: 0.26, y: 0.26, visibility: 0.9 });
    expect(smoothLandmarks([{ x: 0.5, y: 0.5 }], [{ x: 0.1, y: 0.1 }])[0]).toEqual({ x: 0.5, y: 0.5 });
    expect(() => new LandmarkEmaSmoother(0)).toThrow(RangeError);
    expect(() => smoothLandmarks([], null, 1.2)).toThrow(RangeError);
  });
});
