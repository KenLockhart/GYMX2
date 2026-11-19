import cleanCurl from "../fixtures/clean-curl.json";
import fastEccentricCurl from "../fixtures/fast-eccentric-curl.json";
import partialCurl from "../fixtures/partial-curl.json";
import swingingCurl from "../fixtures/swinging-curl.json";
import { describe, expect, it } from "vitest";
import { computeFrameMetrics, createPostureBaseline } from "./metrics";
import { CurlRepSegmenter, segmentCurlSequence } from "./rep-segmentation";
import { scoreCurlRep } from "./scoring";
import { resampleTimedCurve } from "./dtw";
import type { CurlFrameSample, CurlScoringTemplate, LandmarkSet, PoseLandmark } from "./types";

type FixtureFrame = { timestampMs: number; landmarks: Record<string, [number, number, number]> };
type FixtureSequence = { videoWidth: number; videoHeight: number; frames: FixtureFrame[] };

function angleSample(timestampMs: number, elbowAngleDeg: number | null, overrides: Partial<CurlFrameSample> = {}): CurlFrameSample {
  return {
    timestampMs,
    elbowAngleDeg,
    upperArmDriftDeg: 0,
    torsoSwingDeg: 0,
    shoulderShrugRatio: 0,
    confidence: 1,
    ...overrides,
  };
}

function toLandmarks(frame: FixtureFrame): LandmarkSet {
  const result: Array<PoseLandmark | null> = Array.from({ length: 25 }, () => null);
  for (const [index, [x, y, visibility]] of Object.entries(frame.landmarks)) result[Number(index)] = { x, y, visibility };
  return result;
}

function asSamples(fixtureValue: unknown): CurlFrameSample[] {
  const fixture = fixtureValue as FixtureSequence;
  const first = fixture.frames[0];
  const firstMetrics = computeFrameMetrics({
    landmarks: toLandmarks(first),
    videoWidth: fixture.videoWidth,
    videoHeight: fixture.videoHeight,
    timestampMs: first.timestampMs,
    arm: "right",
  });
  if (!firstMetrics) throw new Error("Synthetic fixture baseline is invalid.");
  const baseline = createPostureBaseline(firstMetrics);
  return fixture.frames.map((frame) => {
    const metrics = computeFrameMetrics({
      landmarks: toLandmarks(frame),
      videoWidth: fixture.videoWidth,
      videoHeight: fixture.videoHeight,
      timestampMs: frame.timestampMs,
      arm: "right",
      baseline,
    });
    return metrics
      ? {
          timestampMs: metrics.timestampMs,
          elbowAngleDeg: metrics.elbowAngleDeg,
          upperArmDriftDeg: metrics.upperArmDriftDeg,
          torsoSwingDeg: metrics.torsoSwingDeg,
          shoulderShrugRatio: metrics.shoulderShrugRatio,
          confidence: metrics.confidence,
        }
      : angleSample(frame.timestampMs, null, { confidence: 0 });
  });
}

function scoringTemplate(rep: ReturnType<typeof segmentCurlSequence>["reps"][number]): CurlScoringTemplate {
  return {
    reference: {
      romMinAngle: rep.romMinAngle,
      romMaxAngle: rep.romMaxAngle,
      concentricMs: rep.concentricMs,
      topPauseMs: rep.topPauseMs,
      eccentricMs: rep.eccentricMs,
      elbowCurve: resampleTimedCurve(rep.elbowCurve, 50),
    },
    tolerances: { romTopDeg: 15, romBottomDeg: 15, upperArmDriftDeg: 15, torsoSwingDeg: 10, shrugRatio: 0.08, tempoPct: 35 },
    scoringWeights: { rom: 30, elbow: 25, torso: 20, tempo: 15, shoulders: 10 },
    strictness: "standard",
  };
}

describe("standing curl state-machine segmentation", () => {
  it("counts one complete clean synthetic curl and records phase transition times", () => {
    const result = segmentCurlSequence(asSamples(cleanCurl));
    expect(result.reps).toHaveLength(1);
    expect(result.rejected).toEqual([]);
    expect(result.reps[0]).toMatchObject({ startMs: 1000, endMs: 5600, concentricMs: 1500, topPauseMs: 500, eccentricMs: 2600 });
    expect(result.transitions.map(({ phase }) => phase)).toEqual(["bottom", "concentric", "top", "eccentric", "bottom", "seeking_bottom"]);
    expect(result.reps[0].elbowCurve.length).toBeGreaterThan(5);
  });

  it("rejects a partial curl that returns down without reaching the flexion threshold", () => {
    const result = segmentCurlSequence(asSamples(partialCurl));
    expect(result.reps).toHaveLength(0);
    expect(result.rejected.map(({ reason }) => reason)).toContain("short_rom_top");
  });

  it("rejects a rep that reaches the top but does not return to extension", () => {
    const result = segmentCurlSequence([
      angleSample(0, 160),
      angleSample(100, 140),
      angleSample(300, 80),
      angleSample(500, 59),
      angleSample(900, 80),
    ]);
    expect(result.reps).toHaveLength(0);
    expect(result.rejected.map(({ reason }) => reason)).toContain("short_rom_bottom");
  });

  it("requires a hysteretic rising pair to leave the top and records the first confirmed eccentric time", () => {
    const result = segmentCurlSequence([
      angleSample(0, 160),
      angleSample(200, 140),
      angleSample(400, 100),
      angleSample(600, 55),
      angleSample(800, 61),
      angleSample(1000, 45),
      angleSample(1200, 45),
      angleSample(1400, 70),
      angleSample(1600, 80),
      angleSample(1800, 120),
      angleSample(2000, 160),
    ]);
    expect(result.reps).toHaveLength(1);
    expect(result.reps[0]).toMatchObject({ startMs: 200, topPauseMs: 800, eccentricMs: 600 });
    expect(result.transitions.find(({ phase }) => phase === "eccentric")?.atMs).toBe(1400);
  });

  it("completes when the confirming eccentric sample is already at the bottom", () => {
    const result = segmentCurlSequence([
      angleSample(0, 160),
      angleSample(100, 140),
      angleSample(300, 50),
      angleSample(500, 90),
      angleSample(800, 160),
    ]);
    expect(result.reps).toHaveLength(1);
    expect(result.reps[0]).toMatchObject({ startMs: 100, eccentricMs: 300, endMs: 800 });
    expect(result.rejected).toEqual([]);
  });

  it("does not bridge a finished set's stale bottom pose into a phantom rep", () => {
    const segmenter = new CurlRepSegmenter();
    segmenter.push(angleSample(0, 160));
    segmenter.finish(100);
    for (const sample of [
      angleSample(200, 140),
      angleSample(300, 50),
      angleSample(400, 70),
    ]) segmenter.push(sample);
    expect(segmenter.result().reps).toHaveLength(0);

    segmenter.push(angleSample(500, 160));
    for (const sample of [
      angleSample(600, 140),
      angleSample(800, 100),
      angleSample(1000, 55),
      angleSample(1200, 70),
      angleSample(1400, 80),
      angleSample(1600, 120),
      angleSample(1800, 160),
    ]) segmenter.push(sample);
    expect(segmenter.result().reps).toHaveLength(1);
  });

  it("returns a typed stop instead of retaining unbounded per-set history", () => {
    const segmenter = new CurlRepSegmenter({ maxSessionSamples: 3 });
    segmenter.push(angleSample(0, 160));
    segmenter.push(angleSample(100, 140));
    segmenter.push(angleSample(200, 120));
    const stopped = segmenter.push(angleSample(300, 100));
    expect(stopped.stopReason).toBe("session_sample_limit");
    expect(stopped.rejected.map(({ reason }) => reason)).toContain("session_sample_limit");
    expect(segmenter.push(angleSample(400, 55)).stopReason).toBe("session_sample_limit");
    expect(segmenter.result().stopReason).toBe("session_sample_limit");
    segmenter.reset();
    expect(segmenter.push(angleSample(500, 160)).stopReason).toBeNull();
    expect(segmenter.result().stopReason).toBeNull();
  });

  it("keeps a full-range swinging rep countable but reports its measured faults", () => {
    const result = segmentCurlSequence(asSamples(swingingCurl));
    expect(result.reps).toHaveLength(1);
    expect(result.reps[0].maxTorsoSwing).toBeGreaterThan(10);
    expect(result.reps[0].maxUpperArmDrift).toBeGreaterThan(15);
    expect(result.reps[0].maxShrug).toBeGreaterThan(0.08);
    const scored = scoreCurlRep(result.reps[0], scoringTemplate(segmentCurlSequence(asSamples(cleanCurl)).reps[0]));
    expect(scored.faults).toEqual(expect.arrayContaining(["torso_swing", "elbow_drift", "shoulder_shrug"]));
  });

  it("retains a completed fast-eccentric rep and labels the tempo fault", () => {
    const result = segmentCurlSequence(asSamples(fastEccentricCurl));
    expect(result.reps).toHaveLength(1);
    expect(result.reps[0].eccentricMs).toBe(250);
    const scored = scoreCurlRep(result.reps[0], scoringTemplate(segmentCurlSequence(asSamples(cleanCurl)).reps[0]));
    expect(scored.faults).toContain("eccentric_too_fast");
  });

  it("does not turn low-confidence frames into a rep", () => {
    const samples = asSamples(cleanCurl).map((sample, index) => (index === 5 ? { ...sample, confidence: 0.49 } : sample));
    const result = segmentCurlSequence(samples);
    expect(result.reps).toHaveLength(0);
    expect(result.rejected.map(({ reason }) => reason)).toContain("low_confidence");
  });

  it("rejects incomplete numeric metrics instead of treating missing measurements as zero", () => {
    const incomplete = {
      ...angleSample(600, 120),
      torsoSwingDeg: undefined,
    } as unknown as CurlFrameSample;
    const result = segmentCurlSequence([
      angleSample(0, 160),
      angleSample(100, 140),
      angleSample(300, 120),
      incomplete,
      angleSample(800, 55),
      angleSample(1000, 80),
      angleSample(1300, 160),
    ]);
    expect(result.reps).toHaveLength(0);
    expect(result.rejected.map(({ reason }) => reason)).toContain("invalid_metrics");
  });

  it("rejects a multi-second sample dropout and cannot bridge it into a rep", () => {
    const result = segmentCurlSequence([
      angleSample(0, 160),
      angleSample(200, 140),
      angleSample(400, 120),
      angleSample(1000, 90),
      angleSample(1200, 55),
      angleSample(1400, 80),
      angleSample(1600, 160),
    ]);
    expect(result.reps).toHaveLength(0);
    expect(result.rejected.map(({ reason }) => reason)).toContain("sample_gap");
  });

  it("requires strictly more than 150 degrees at bottom and strictly less than 60 at top", () => {
    const result = segmentCurlSequence([
      angleSample(0, 150),
      angleSample(100, 151),
      angleSample(200, 150),
      angleSample(300, 60),
      angleSample(400, 151),
    ]);
    expect(result.reps).toHaveLength(0);
    expect(result.rejected.map(({ reason }) => reason)).toContain("short_rom_top");
  });

  it("discards candidates below 0.6 seconds and above 15 seconds", () => {
    const tooShort = segmentCurlSequence([
      angleSample(0, 160),
      angleSample(100, 160),
      angleSample(150, 140),
      angleSample(200, 50),
      angleSample(220, 70),
      angleSample(230, 80),
      angleSample(300, 160),
    ]);
    expect(tooShort.reps).toHaveLength(0);
    expect(tooShort.rejected.map(({ reason }) => reason)).toContain("too_short");

    const tooLong = segmentCurlSequence([
      angleSample(0, 160),
      angleSample(500, 160),
      angleSample(600, 140),
      angleSample(700, 50),
      angleSample(800, 70),
      angleSample(5800, 120),
      angleSample(10800, 120),
      angleSample(15601, 120),
    ], { maxGapMs: 5000 });
    expect(tooLong.reps).toHaveLength(0);
    expect(tooLong.rejected.map(({ reason }) => reason)).toContain("too_long");
  });

  it("rejects an unreachable 180 degree extension threshold and completes at the reachable 179 boundary", () => {
    expect(() => new CurlRepSegmenter({ extendedThreshold: 180 })).toThrow(RangeError);
    const result = segmentCurlSequence([
      angleSample(0, 180),
      angleSample(100, 170),
      angleSample(300, 120),
      angleSample(500, 60),
      angleSample(600, 55),
      angleSample(800, 70),
      angleSample(1000, 80),
      angleSample(1300, 120),
      angleSample(1500, 180),
    ], { extendedThreshold: 179.999 });
    expect(result.reps).toHaveLength(1);
  });
});
