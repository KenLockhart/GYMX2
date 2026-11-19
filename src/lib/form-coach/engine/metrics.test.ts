import cleanCurl from "../fixtures/clean-curl.json";
import swingingCurl from "../fixtures/swinging-curl.json";
import { describe, expect, it } from "vitest";
import { computeFrameMetrics, createPostureBaseline } from "./metrics";
import type { LandmarkSet, PoseLandmark } from "./types";

type FixtureFrame = { timestampMs: number; landmarks: Record<string, [number, number, number]> };
type FixtureSequence = { videoWidth: number; videoHeight: number; frames: FixtureFrame[] };

function landmarksFromFixture(frame: FixtureFrame): LandmarkSet {
  const landmarks: Array<PoseLandmark | null> = Array.from({ length: 25 }, () => null);
  for (const [index, [x, y, visibility]] of Object.entries(frame.landmarks)) {
    landmarks[Number(index)] = { x, y, visibility };
  }
  return landmarks;
}

describe("per-frame curl metrics", () => {
  it("computes elbow angle and stable baseline-relative values from normalized landmarks", () => {
    const fixture = cleanCurl as unknown as FixtureSequence;
    const first = fixture.frames[0];
    const baselineFrame = computeFrameMetrics({
      landmarks: landmarksFromFixture(first),
      videoWidth: fixture.videoWidth,
      videoHeight: fixture.videoHeight,
      timestampMs: first.timestampMs,
      arm: "right",
    });
    expect(baselineFrame).not.toBeNull();
    expect(baselineFrame!.elbowAngleDeg).toBeCloseTo(165, 0);
    expect(baselineFrame!.upperArmDriftDeg).toBeCloseTo(0, 0);
    const baseline = createPostureBaseline(baselineFrame!);
    const samePosture = computeFrameMetrics({
      landmarks: landmarksFromFixture(fixture.frames[1]),
      videoWidth: fixture.videoWidth,
      videoHeight: fixture.videoHeight,
      timestampMs: fixture.frames[1].timestampMs,
      arm: "right",
      baseline,
    });
    expect(samePosture?.torsoSwingDeg).toBeCloseTo(0);
    expect(samePosture?.shoulderShrugRatio).toBeCloseTo(0);
  });

  it("measures torso swing and shoulder rise relative to the setup baseline", () => {
    const fixture = swingingCurl as unknown as FixtureSequence;
    const baseFrame = fixture.frames[0];
    const base = computeFrameMetrics({
      landmarks: landmarksFromFixture(baseFrame),
      videoWidth: fixture.videoWidth,
      videoHeight: fixture.videoHeight,
      timestampMs: baseFrame.timestampMs,
      arm: "right",
    });
    const movedFrame = fixture.frames[4];
    const moved = computeFrameMetrics({
      landmarks: landmarksFromFixture(movedFrame),
      videoWidth: fixture.videoWidth,
      videoHeight: fixture.videoHeight,
      timestampMs: movedFrame.timestampMs,
      arm: "right",
      baseline: createPostureBaseline(base!),
    });
    expect(moved?.torsoSwingDeg).toBeGreaterThan(10);
    expect(moved?.upperArmDriftDeg).toBeGreaterThan(15);
    expect(moved?.shoulderShrugRatio).toBeGreaterThan(0.08);
    expect(moved?.shoulderShrugRatio).toBeCloseTo(
      (base!.earShoulderVerticalPx - moved!.earShoulderVerticalPx) / moved!.torsoLengthPx,
    );
    expect(moved?.shoulderShrugRatio).not.toBeCloseTo(
      (base!.earShoulderVerticalPx - moved!.earShoulderVerticalPx) / base!.torsoLengthPx,
    );
  });

  it("rejects a frame if any required landmark visibility is below 0.5", () => {
    const fixture = cleanCurl as unknown as FixtureSequence;
    const frame = fixture.frames[0];
    const landmarks = landmarksFromFixture(frame) as Array<PoseLandmark | null>;
    landmarks[14] = { ...landmarks[14]!, visibility: 0.49 };
    expect(
      computeFrameMetrics({
        landmarks,
        videoWidth: fixture.videoWidth,
        videoHeight: fixture.videoHeight,
        timestampMs: frame.timestampMs,
        arm: "right",
      }),
    ).toBeNull();
  });

  it("rejects required landmarks with missing or non-finite visibility", () => {
    const fixture = cleanCurl as unknown as FixtureSequence;
    const frame = fixture.frames[0];
    const missing = landmarksFromFixture(frame) as Array<PoseLandmark | null>;
    missing[14] = { x: missing[14]!.x, y: missing[14]!.y };
    const nonFinite = landmarksFromFixture(frame) as Array<PoseLandmark | null>;
    nonFinite[14] = { ...nonFinite[14]!, visibility: Number.NaN };
    for (const landmarks of [missing, nonFinite]) {
      expect(computeFrameMetrics({
        landmarks,
        videoWidth: fixture.videoWidth,
        videoHeight: fixture.videoHeight,
        timestampMs: frame.timestampMs,
        arm: "right",
      })).toBeNull();
    }
  });
});
