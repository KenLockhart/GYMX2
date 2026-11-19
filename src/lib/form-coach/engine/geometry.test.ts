import { describe, expect, it } from "vitest";
import { angleAtJoint, getVisibleLandmark, toPixelPoint } from "./geometry";

describe("pose geometry", () => {
  it("computes the joint angle from pixel-space vectors", () => {
    expect(angleAtJoint({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })).toBeCloseTo(180);
    expect(angleAtJoint({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(90);
    expect(angleAtJoint({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });

  it("corrects normalized coordinates for the video aspect ratio before measuring angles", () => {
    const width = 1600;
    const height = 900;
    const normalized = (x: number, y: number) => ({ x: x / width, y: y / height, visibility: 0.9 });
    const shoulder = toPixelPoint(normalized(500, 200), width, height);
    const elbow = toPixelPoint(normalized(500, 500), width, height);
    const wrist = toPixelPoint(normalized(800, 500), width, height);
    expect(shoulder).not.toBeNull();
    expect(elbow).not.toBeNull();
    expect(wrist).not.toBeNull();
    expect(angleAtJoint(shoulder!, elbow!, wrist!)).toBeCloseTo(90);
  });

  it("ignores landmarks below the 0.5 visibility cutoff", () => {
    expect(getVisibleLandmark([{ x: 0.2, y: 0.3, visibility: 0.49 }], 0)).toBeNull();
    expect(getVisibleLandmark([{ x: 0.2, y: 0.3, visibility: 0.5 }], 0)).toEqual({
      x: 0.2,
      y: 0.3,
      visibility: 0.5,
    });
    expect(toPixelPoint({ x: 0.5, y: 0.5, visibility: 0.2 }, 640, 480)).toBeNull();
    expect(getVisibleLandmark([{ x: 0.2, y: 0.3 }], 0)).toBeNull();
    expect(toPixelPoint({ x: 0.5, y: 0.5 }, 640, 480)).toBeNull();
  });
});
