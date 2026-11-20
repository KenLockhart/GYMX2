import { describe, expect, it } from "vitest";
import { STANDING_DUMBBELL_CURL } from "./engine/registry";
import type { CurlScoringTemplate, PoseLandmark, SegmentedCurlRep } from "./engine/types";
import { buildMedianReference, createPoseSessionAdapter, isCleanReferenceRep } from "./pose-session-adapter";

interface LandmarkOptions {
  readonly torsoBottom?: number;
  readonly frontView?: boolean;
  readonly rightWristVisibility?: number;
  readonly exerciseAngleDeg?: number;
}

function landmarks(options: LandmarkOptions = {}): PoseLandmark[] {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const leftShoulderX = options.frontView ? 0.35 : 0.535;
  const rightShoulderX = options.frontView ? 0.65 : 0.52;
  const leftHipX = options.frontView ? 0.36 : 0.535;
  const rightHipX = options.frontView ? 0.64 : 0.52;
  const set = (index: number, x: number, y: number, visibility = 0.9) => {
    points[index] = { x, y, visibility };
  };
  set(7, leftShoulderX, 0.2, 0.8);
  set(8, rightShoulderX, 0.2, 0.9);
  set(11, leftShoulderX, 0.33, 0.6);
  set(12, rightShoulderX, 0.33, 0.95);
  set(13, leftShoulderX + 0.01, 0.48, 0.15);
  const rightElbowX = options.exerciseAngleDeg === undefined ? rightShoulderX + 0.01 : rightShoulderX;
  set(14, rightElbowX, 0.48, 0.95);
  set(15, leftShoulderX + 0.01, 0.63, 0.15);
  if (options.exerciseAngleDeg === undefined) {
    set(16, rightShoulderX + 0.01, 0.63, options.rightWristVisibility ?? 0.95);
  } else {
    const radians = (options.exerciseAngleDeg * Math.PI) / 180;
    const wristLengthPx = 72;
    set(
      16,
      rightElbowX + (Math.sin(radians) * wristLengthPx) / 640,
      0.48 - (Math.cos(radians) * wristLengthPx) / 480,
      options.rightWristVisibility ?? 0.95,
    );
  }
  set(23, leftHipX, options.torsoBottom ?? 0.65, 0.9);
  set(24, rightHipX, options.torsoBottom ?? 0.65, 0.95);
  return points;
}

const LIVE_TEMPLATE: CurlScoringTemplate = {
  reference: {
    romMinAngle: 50,
    romMaxAngle: 170,
    concentricMs: 800,
    topPauseMs: 300,
    eccentricMs: 900,
    elbowCurve: Array.from({ length: 50 }, (_, index) => 170 - 120 * Math.sin((Math.PI * index) / 49)),
  },
  tolerances: STANDING_DUMBBELL_CURL.defaultTolerances,
  scoringWeights: STANDING_DUMBBELL_CURL.defaultScoringWeights,
  strictness: "standard",
};

function frame(adapter: ReturnType<typeof createPoseSessionAdapter>, timestampMs: number, options: LandmarkOptions = {}) {
  return adapter.process({ landmarks: landmarks(options), timestampMs, width: 640, height: 480 });
}

function warmBaseline(adapter: ReturnType<typeof createPoseSessionAdapter>): number {
  let output = frame(adapter, 0, { exerciseAngleDeg: 170 });
  for (let timestampMs = 100; timestampMs <= 2_000; timestampMs += 100) {
    output = frame(adapter, timestampMs, { exerciseAngleDeg: 170 });
  }
  expect(output.setupStep).toBe("ready");
  return 2_100;
}

function makeRep(offset: number): SegmentedCurlRep {
  return {
    startMs: 0,
    endMs: 2_000,
    concentricMs: 700 + offset,
    topPauseMs: 200 + offset,
    eccentricMs: 1_100 + offset,
    romMinAngle: 50 + offset,
    romMaxAngle: 170 - offset,
    maxUpperArmDrift: 5,
    maxTorsoSwing: 2,
    maxShrug: 0.02,
    elbowCurve: [
      { timestampMs: 0, angleDeg: 170 - offset },
      { timestampMs: 1_000, angleDeg: 50 + offset },
      { timestampMs: 2_000, angleDeg: 170 - offset },
    ],
  };
}

describe("pose session adapter", () => {
  it("requires a visible side view and a torso occupying at least one quarter of the frame", () => {
    const front = createPoseSessionAdapter({ mode: "reference" });
    expect(front.process({ landmarks: landmarks({ frontView: true }), timestampMs: 1_000, width: 640, height: 480 }).setupStep).toBe("show-side-view");

    const tooFar = createPoseSessionAdapter({ mode: "reference" });
    for (let timestampMs = 0; timestampMs <= 1_000; timestampMs += 100) {
      const result = tooFar.process({ landmarks: landmarks({ torsoBottom: 0.5 }), timestampMs, width: 640, height: 480 });
      if (timestampMs === 1_000) expect(result.setupStep).toBe("move-back");
    }
  });

  it("holds a stable extended-arm baseline for two seconds after arm selection", () => {
    const adapter = createPoseSessionAdapter({ mode: "reference" });
    let output;
    for (let timestampMs = 0; timestampMs <= 3_000; timestampMs += 100) {
      output = adapter.process({ landmarks: landmarks(), timestampMs, width: 640, height: 480 });
    }
    expect(output?.setupStep).toBe("ready");
  });

  it.each([
    { label: "low wrist confidence", options: { rightWristVisibility: 0.49 }, step: "low-confidence" },
    { label: "front view", options: { frontView: true }, step: "show-side-view" },
    { label: "torso below the size minimum", options: { torsoBottom: 0.5 }, step: "move-back" },
  ] as const)("restarts the full setup hold after $label", ({ options, step }) => {
    const adapter = createPoseSessionAdapter({ mode: "reference", arm: "right" });
    expect(frame(adapter, 0, { exerciseAngleDeg: 170 }).setupStep).toBe("extend-arm-hold");
    let finalFailureStep = "";
    for (let timestampMs = 100; timestampMs <= 1_900; timestampMs += 100) {
      finalFailureStep = frame(adapter, timestampMs, { exerciseAngleDeg: 170, ...options }).setupStep;
    }
    expect(finalFailureStep).toBe(step);

    let continuousHoldStartedAt: number | null = null;
    for (let timestampMs = 2_000; timestampMs <= 8_000; timestampMs += 100) {
      const setupStep = frame(adapter, timestampMs, { exerciseAngleDeg: 170 }).setupStep;
      if (setupStep === "ready") {
        expect(continuousHoldStartedAt).not.toBeNull();
        expect(timestampMs - (continuousHoldStartedAt as number)).toBeGreaterThanOrEqual(2_000);
        return;
      }
      if (setupStep === "extend-arm-hold") continuousHoldStartedAt ??= timestampMs;
      else continuousHoldStartedAt = null;
    }
    throw new Error("A continuous two-second setup hold did not become ready.");
  });

  it("restarts the setup hold after an unacceptable timestamp gap", () => {
    const adapter = createPoseSessionAdapter({ mode: "reference", arm: "right" });
    expect(frame(adapter, 0, { exerciseAngleDeg: 170 }).setupStep).toBe("extend-arm-hold");
    expect(frame(adapter, 600, { exerciseAngleDeg: 170 }).setupStep).toBe("extend-arm-hold");
    for (let timestampMs = 700; timestampMs <= 2_600; timestampMs += 100) {
      const result = frame(adapter, timestampMs, { exerciseAngleDeg: 170 });
      if (timestampMs < 2_600) expect(result.setupStep).toBe("extend-arm-hold");
      else expect(result.setupStep).toBe("ready");
    }
  });

  it.each(["reference", "live"] as const)("does not bridge one observed low-confidence wrist frame in %s mode", (mode) => {
    const adapter = createPoseSessionAdapter({
      mode,
      arm: "right",
      ...(mode === "live" ? { template: LIVE_TEMPLATE } : {}),
    });
    let timestampMs = warmBaseline(adapter);
    const outputs: ReturnType<typeof frame>[] = [];
    const push = (angleDeg: number, rightWristVisibility = 0.95) => {
      const result = frame(adapter, timestampMs, { exerciseAngleDeg: angleDeg, rightWristVisibility });
      timestampMs += 100;
      outputs.push(result);
      return result;
    };

    push(170);
    push(170);
    for (const angleDeg of [130, 100, 70, 50, 50, 50, 50, 50, 50]) push(angleDeg);
    expect(push(50, 0.49).setupStep).toBe("low-confidence");

    for (const angleDeg of [100, 140, 170, 170, 170, 170]) push(angleDeg);
    expect(outputs.some((output) => output.rep !== undefined)).toBe(false);
    expect(adapter.getCleanReferenceCount()).toBe(0);

    for (const angleDeg of [130, 100, 70, 50, 50, 50, 50, 50, 50, 70, 90, 120, 150, 170, 170, 170]) push(angleDeg);
    expect(outputs.some((output) => output.rep !== undefined)).toBe(mode === "live");
    expect(adapter.getCleanReferenceCount()).toBe(mode === "reference" ? 1 : 0);
  });

  it("builds a bounded median reference from three to five clean reps", () => {
    const reps = [makeRep(0), makeRep(2), makeRep(4)];
    expect(reps.every(isCleanReferenceRep)).toBe(true);
    const reference = buildMedianReference(reps);
    expect(reference.reference.concentricMs).toBe(702);
    expect(reference.reference.topPauseMs).toBe(202);
    expect(reference.reference.eccentricMs).toBe(1_102);
    expect(reference.reference.romMinAngle).toBe(52);
    expect(reference.reference.elbowCurve).toHaveLength(50);
    expect(reference.reference.elbowCurve.every((angle) => angle >= 0 && angle <= 180)).toBe(true);
  });

  it("rejects reference targets outside the supported clean-rep range and live sessions without a template", () => {
    expect(() => createPoseSessionAdapter({ mode: "reference", referenceRepTarget: 2 })).toThrow(RangeError);
    expect(() => createPoseSessionAdapter({ mode: "live" })).toThrow(RangeError);
    expect(() => createPoseSessionAdapter({ mode: "reference", arm: "both" })).toThrow("Both-arm scoring is not supported");
  });
});
