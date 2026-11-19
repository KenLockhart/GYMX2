import { describe, expect, it } from "vitest";
import { ActiveArmSelector, selectArmByVisibility } from "./side-selection";
import type { ArmSelectionSample, LandmarkSet } from "./types";

function sample(timestampMs: number, leftVisibility: number, rightVisibility: number): ArmSelectionSample {
  const landmarks: Array<{ x: number; y: number; visibility: number } | null> = Array.from({ length: 25 }, () => null);
  for (const index of [11, 13, 15]) landmarks[index] = { x: 0.3, y: 0.4, visibility: leftVisibility };
  for (const index of [12, 14, 16]) landmarks[index] = { x: 0.7, y: 0.4, visibility: rightVisibility };
  return { timestampMs, landmarks: landmarks as LandmarkSet };
}

describe("stable active-arm selection", () => {
  it("chooses the arm with higher average visibility over the first second and then locks it", () => {
    const selector = new ActiveArmSelector("auto");
    expect(selector.observe(sample(0, 0.55, 0.95)).ready).toBe(false);
    expect(selector.observe(sample(500, 0.6, 0.9)).ready).toBe(false);
    const selected = selector.observe(sample(1000, 0.65, 0.85));
    expect(selected).toMatchObject({ arm: "right", ready: true });
    expect(selector.observe(sample(1200, 1, 0.2)).arm).toBe("right");
  });

  it("does not select from an all-low-confidence or tied first-second window", () => {
    expect(selectArmByVisibility([sample(0, 0.2, 0.2), sample(500, 0.4, 0.4)])).toBeNull();
    expect(selectArmByVisibility([sample(0, 0.8, 0.8)])).toBeNull();
    const selector = new ActiveArmSelector("auto");
    selector.observe(sample(0, 0.2, 0.2));
    const closed = selector.observe(sample(1100, 0.9, 0.1));
    expect(closed).toMatchObject({ arm: null, ready: false });
    expect(selector.observe(sample(1500, 0.1, 1)).arm).toBeNull();
  });

  it("can explicitly retry after a low-confidence setup window while keeping resolved choices locked", () => {
    const selector = new ActiveArmSelector("auto");
    selector.observe(sample(0, 0.2, 0.2));
    expect(selector.observe(sample(1000, 0.3, 0.2)).ready).toBe(false);
    selector.reset();
    selector.observe(sample(2000, 0.4, 0.9));
    expect(selector.observe(sample(3000, 0.5, 0.9))).toMatchObject({ arm: "right", ready: true });
    selector.observe(sample(3200, 1, 0.1));
    expect(selector.getSelection().arm).toBe("right");
  });

  it("returns fixed template arms without waiting for visibility sampling", () => {
    expect(new ActiveArmSelector("left").getSelection()).toMatchObject({ arm: "left", ready: true });
    expect(new ActiveArmSelector("both").getSelection()).toMatchObject({ arm: "both", ready: true });
  });
});
