import { describe, expect, it } from "vitest";
import { STANDING_DUMBBELL_CURL } from "./engine/registry";
import type { CurlScoringTemplate, PoseLandmark, SegmentedCurlRep } from "./engine/types";
import { buildMedianReference, createPoseSessionAdapter, isCleanReferenceRep } from "./pose-session-adapter";

interface LandmarkOptions {
  readonly torsoBottom?: number;
  readonly frontView?: boolean;
  readonly rightWristVisibility?: number;
  readonly leftWristVisibility?: number;
  readonly bothArms?: boolean;
  readonly leftArmOffset?: number;
  readonly exerciseAngleDeg?: number;
  readonly leftExerciseAngleDeg?: number;
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
  const showLeft = options.bothArms === true;
  const leftElbowX = leftShoulderX + (options.leftArmOffset ?? 0);
  set(13, showLeft ? leftElbowX : leftShoulderX + 0.01, 0.48, showLeft ? 0.95 : 0.15);
  const rightElbowX = options.exerciseAngleDeg === undefined ? rightShoulderX + 0.01 : rightShoulderX;
  set(14, rightElbowX, 0.48, 0.95);
  const leftExerciseAngleDeg = options.leftExerciseAngleDeg ?? options.exerciseAngleDeg;
  set(15, leftShoulderX + 0.01, 0.63, showLeft ? options.leftWristVisibility ?? 0.95 : 0.15);
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
    if (showLeft && leftExerciseAngleDeg !== undefined) {
      const shoulderDxPx = (leftShoulderX - leftElbowX) * 640;
      const shoulderDyPx = (0.33 - 0.48) * 480;
      const shoulderDirection = Math.atan2(shoulderDyPx, shoulderDxPx);
      const leftRadians = (leftExerciseAngleDeg * Math.PI) / 180;
      const wristDirection = shoulderDirection + leftRadians;
      set(
        15,
        leftElbowX + (Math.cos(wristDirection) * wristLengthPx) / 640,
        0.48 + (Math.sin(wristDirection) * wristLengthPx) / 480,
        options.leftWristVisibility ?? 0.95,
      );
    }
  }
  if (showLeft && leftExerciseAngleDeg === undefined) {
    set(15, leftElbowX, 0.63, options.leftWristVisibility ?? 0.95);
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

  it("does not baseline or score side-view poses when the configured view is front", () => {
    const adapter = createPoseSessionAdapter({ mode: "live", arm: "right", cameraView: "front", template: LIVE_TEMPLATE });
    const outputs: ReturnType<typeof frame>[] = [];
    let timestampMs = 0;
    const send = (angleDeg: number) => {
      const output = frame(adapter, timestampMs, { exerciseAngleDeg: angleDeg });
      timestampMs += 100;
      outputs.push(output);
      return output;
    };

    for (let index = 0; index <= 20; index += 1) send(170);
    for (let cycle = 0; cycle < 2; cycle += 1) {
      for (const angle of [170, 170, 130, 100, 70, 50, 50, 50, 50, 50, 50, 70, 90, 120, 150, 170, 170, 170]) {
        send(angle);
      }
    }

    expect(outputs.every((output) => output.setupStep === "show-required-view")).toBe(true);
    expect(outputs.some((output) => output.setupStep === "ready")).toBe(false);
    expect(outputs.some((output) => output.rep || output.reference)).toBe(false);
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
    expect(() => createPoseSessionAdapter({ mode: "reference", arm: "both" })).not.toThrow();
  });

  it("requires both visible arms and the configured camera view", () => {
    const both = createPoseSessionAdapter({ mode: "reference", arm: "both", cameraView: "side" });
    expect(frame(both, 0).setupStep).toBe("show-both-arms");
    const front = createPoseSessionAdapter({ mode: "reference", arm: "both", cameraView: "front" });
    expect(front.process({ landmarks: landmarks({ frontView: true, bothArms: true, exerciseAngleDeg: 170 }), timestampMs: 0, width: 640, height: 480 }).setupStep).toBe("extend-arm-hold");
    const wrongView = createPoseSessionAdapter({ mode: "reference", arm: "both", cameraView: "front" });
    expect(frame(wrongView, 0, { bothArms: true, exerciseAngleDeg: 170 }).setupStep).toBe("show-required-view");
    const left = createPoseSessionAdapter({ mode: "reference", arm: "left" });
    let output;
    for (let timestampMs = 0; timestampMs <= 2_000; timestampMs += 100) {
      output = frame(left, timestampMs, { bothArms: true, exerciseAngleDeg: 170 });
    }
    expect(output?.setupStep).toBe("ready");
  });

  it("counts a synchronized bilateral rep once and preserves a fault from either arm", () => {
    const adapter = createPoseSessionAdapter({ mode: "live", arm: "both", template: LIVE_TEMPLATE });
    let timestampMs = 0;
    for (; timestampMs <= 2_000; timestampMs += 100) {
      frame(adapter, timestampMs, { bothArms: true, exerciseAngleDeg: 170 });
    }
    const outputs: ReturnType<typeof frame>[] = [];
    const angles = [170, 170, 130, 100, 70, 50, 50, 50, 50, 50, 50, 70, 90, 120, 150, 170, 170, 170];
    for (const angle of angles) {
      outputs.push(frame(adapter, timestampMs, { bothArms: true, exerciseAngleDeg: angle, leftArmOffset: 0.12 }));
      timestampMs += 100;
    }
    const completed = outputs.filter((output) => output.rep);
    expect(completed).toHaveLength(1);
    expect(completed[0]?.rep?.repNumber).toBe(1);
    expect(completed[0]?.rep?.faults).toContain("elbow_drift");
    expect(completed[0]?.rep?.score).toBeLessThan(100);
  });

  it("uses only complete bilateral clean cycles in a three-to-five-rep reference", () => {
    const adapter = createPoseSessionAdapter({ mode: "reference", arm: "both", referenceRepTarget: 3 });
    let timestampMs = 0;
    for (; timestampMs <= 2_000; timestampMs += 100) frame(adapter, timestampMs, { bothArms: true, exerciseAngleDeg: 170 });
    const angles = [170, 170, 130, 100, 70, 50, 50, 50, 50, 50, 50, 70, 90, 120, 150, 170, 170, 170];
    const outputs: ReturnType<typeof frame>[] = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (const angle of angles) {
        outputs.push(frame(adapter, timestampMs, { bothArms: true, exerciseAngleDeg: angle }));
        timestampMs += 100;
      }
    }
    expect(adapter.getCleanReferenceCount()).toBe(3);
    expect(outputs.filter((output) => output.reference)).toHaveLength(1);
  });

  it("emits selection candidates only for completed singles or an accepted bilateral merge", () => {
    const singleCandidates: Array<{ pairing: string; arm: string | null; startMs: number }> = [];
    const single = createPoseSessionAdapter({
      mode: "reference",
      arm: "right",
      onReferenceCandidate: (candidate) => singleCandidates.push({ pairing: candidate.pairing, arm: candidate.arm, startMs: candidate.rep.startMs }),
    });
    let timestampMs = warmBaseline(single);
    const cycle = [170, 170, 130, 100, 70, 50, 50, 50, 50, 50, 50, 70, 90, 120, 150, 170, 170, 170];
    for (const angle of cycle) {
      frame(single, timestampMs, { exerciseAngleDeg: angle });
      timestampMs += 100;
    }
    expect(singleCandidates).toHaveLength(1);
    expect(singleCandidates[0]).toMatchObject({ pairing: "single_arm", arm: "right" });
    expect(single.getCleanReferenceCount()).toBe(0);

    const bilateralCandidates: Array<{ pairing: string; arm: string | null; rep: SegmentedCurlRep }> = [];
    const bilateral = createPoseSessionAdapter({
      mode: "reference",
      arm: "both",
      onReferenceCandidate: (candidate) => bilateralCandidates.push(candidate),
    });
    timestampMs = 0;
    for (; timestampMs <= 2_000; timestampMs += 100) frame(bilateral, timestampMs, { bothArms: true, exerciseAngleDeg: 170 });
    for (const angle of cycle) {
      frame(bilateral, timestampMs, { bothArms: true, exerciseAngleDeg: angle, leftExerciseAngleDeg: angle });
      timestampMs += 100;
    }
    expect(bilateralCandidates).toHaveLength(1);
    expect(bilateralCandidates[0]).toMatchObject({ pairing: "matched_bilateral", arm: null });

    const unmatchedCandidates: SegmentedCurlRep[] = [];
    const unmatched = createPoseSessionAdapter({ mode: "reference", arm: "both", onReferenceCandidate: ({ rep }) => unmatchedCandidates.push(rep) });
    timestampMs = 0;
    for (; timestampMs <= 2_000; timestampMs += 100) frame(unmatched, timestampMs, { bothArms: true, exerciseAngleDeg: 170 });
    for (const angle of cycle) {
      frame(unmatched, timestampMs, { bothArms: true, exerciseAngleDeg: angle, leftExerciseAngleDeg: 170 });
      timestampMs += 100;
    }
    for (const angle of cycle) {
      frame(unmatched, timestampMs, { bothArms: true, exerciseAngleDeg: 170, leftExerciseAngleDeg: angle });
      timestampMs += 100;
    }
    expect(unmatchedCandidates).toHaveLength(0);
  });

  it("drops a bilateral partial cycle on mid-rep occlusion and counts only the next complete pair", () => {
    const adapter = createPoseSessionAdapter({ mode: "live", arm: "both", template: LIVE_TEMPLATE });
    let timestampMs = 0;
    for (; timestampMs <= 2_000; timestampMs += 100) frame(adapter, timestampMs, { bothArms: true, exerciseAngleDeg: 170 });
    const interrupted = [170, 170, 130, 100, 70, 50];
    for (const angle of interrupted) {
      frame(adapter, timestampMs, { bothArms: true, exerciseAngleDeg: angle });
      timestampMs += 100;
    }
    expect(frame(adapter, timestampMs, { bothArms: true, exerciseAngleDeg: 50, leftWristVisibility: 0.49 }).setupStep).toBe("show-both-arms");
    timestampMs += 100;
    const resumed = [100, 140, 170, 170, 170];
    const afterInterruption = resumed.map((angle) => {
      const output = frame(adapter, timestampMs, { bothArms: true, exerciseAngleDeg: angle });
      timestampMs += 100;
      return output;
    });
    expect(afterInterruption.some((output) => output.rep)).toBe(false);

    const complete = [170, 170, 130, 100, 70, 50, 50, 50, 50, 50, 50, 70, 90, 120, 150, 170, 170, 170];
    const outputs = complete.map((angle) => {
      const output = frame(adapter, timestampMs, { bothArms: true, exerciseAngleDeg: angle });
      timestampMs += 100;
      return output;
    });
    expect(outputs.filter((output) => output.rep)).toHaveLength(1);
  });

  it("drops both bilateral partial candidates after early one-wrist occlusion", () => {
    const adapter = createPoseSessionAdapter({ mode: "live", arm: "both", template: LIVE_TEMPLATE });
    let timestampMs = 0;
    for (; timestampMs <= 2_000; timestampMs += 100) {
      frame(adapter, timestampMs, { bothArms: true, exerciseAngleDeg: 170, leftExerciseAngleDeg: 170 });
    }

    const interrupted: Array<{ left: number; right: number; leftVisibility?: number }> = [
      { left: 170, right: 170 },
      { left: 170, right: 170 },
      { left: 130, right: 130 },
      { left: 100, right: 100, leftVisibility: 0.49 },
      { left: 170, right: 70 },
      { left: 130, right: 50 },
      { left: 100, right: 50 },
      { left: 70, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 50, right: 50 },
      { left: 70, right: 50 },
      { left: 90, right: 50 },
      { left: 120, right: 70 },
      { left: 150, right: 90 },
      { left: 170, right: 120 },
      { left: 170, right: 150 },
      { left: 170, right: 170 },
    ];
    const interruptedOutputs = interrupted.map(({ left, right, leftVisibility }) => {
      const output = frame(adapter, timestampMs, {
        bothArms: true,
        leftExerciseAngleDeg: left,
        exerciseAngleDeg: right,
        ...(leftVisibility === undefined ? {} : { leftWristVisibility: leftVisibility }),
      });
      timestampMs += 100;
      return output;
    });
    expect(interruptedOutputs[3]?.setupStep).toBe("show-both-arms");
    expect(interruptedOutputs.some((output) => output.rep)).toBe(false);

    const completeCycle = [170, 170, 130, 100, 70, 50, 50, 50, 50, 50, 50, 70, 90, 120, 150, 170, 170, 170];
    const leftOnlyCycle = completeCycle.map((angle) => {
      const output = frame(adapter, timestampMs, {
        bothArms: true,
        exerciseAngleDeg: 170,
        leftExerciseAngleDeg: angle,
      });
      timestampMs += 100;
      return output;
    });
    expect(leftOnlyCycle.some((output) => output.rep)).toBe(false);

    const completedOutputs = completeCycle.map((angle) => {
      const output = frame(adapter, timestampMs, {
        bothArms: true,
        exerciseAngleDeg: angle,
        leftExerciseAngleDeg: angle,
      });
      timestampMs += 100;
      return output;
    });
    expect(completedOutputs.filter((output) => output.rep)).toHaveLength(1);
  });
});
