import { DEFAULT_CURL_CUES, CurlCueScheduler } from "./engine/cues";
import { resampleTimedCurve } from "./engine/dtw";
import { distance, getVisibleLandmark, LANDMARK_INDEX, toPixelPoint } from "./engine/geometry";
import { createPostureBaseline, computeFrameMetrics } from "./engine/metrics";
import { ActiveArmSelector, armVisibilityIsUsable } from "./engine/side-selection";
import { LandmarkEmaSmoother } from "./engine/smoothing";
import { CurlRepSegmenter } from "./engine/rep-segmentation";
import { scoreCurlRep } from "./engine/scoring";
import { BilateralRepPairer, type PairRejectionReason } from "./engine/bilateral-pairing";
import { STANDING_DUMBBELL_CURL } from "./engine/registry";
import type {
  ArmSelectionSample,
  ArmSide,
  CameraView,
  CurlScoringTemplate,
  FrameMetrics,
  LandmarkSet,
  PoseLandmark,
  ScoredCurlRep,
  SegmentedCurlRep,
  TrackedArm,
} from "./engine/types";
import type { CueCode, RepFaultCode } from "./worker-controller";
import type { FormCoachRepSummary, FormCoachRunMode, SetupStep } from "./worker-protocol";

const MIN_SETUP_VISIBILITY = 0.5;
const MIN_TORSO_HEIGHT_RATIO = 0.25;
const MAX_FRAME_GAP_MS = 500;
const BASELINE_HOLD_MS = 2_000;
const BASELINE_MAX_LEAN_DRIFT_DEG = 2.5;
const BASELINE_MAX_TORSO_RATIO_DRIFT = 0.035;
const MAX_SET_SAMPLES = 30_000;
const REFERENCE_CURVE_SAMPLES = 50;

export interface PoseFrameInput {
  readonly landmarks: LandmarkSet;
  readonly timestampMs: number;
  readonly width: number;
  readonly height: number;
}

export interface PoseFrameOutput {
  readonly overlay: readonly (PoseLandmark | null)[];
  readonly setupStep: SetupStep;
  readonly rep?: FormCoachRepSummary;
  readonly reference?: CurlScoringTemplate;
  readonly cues: readonly CueCode[];
  readonly setBoundary: boolean;
  readonly pairRejected?: PairRejectionReason;
}

export interface PoseSessionAdapterOptions {
  readonly mode: FormCoachRunMode;
  readonly arm?: TrackedArm;
  readonly cameraView?: CameraView;
  readonly referenceRepTarget?: number;
  readonly template?: CurlScoringTemplate;
  /** Worker-local capture hook. The segment is never added to a public frame/result DTO. */
  readonly onReferenceCandidate?: (candidate: Readonly<{
    rep: SegmentedCurlRep;
    pairing: "single_arm" | "matched_bilateral";
    arm: ArmSide | null;
  }>) => void;
}

interface PoseFrameDetails {
  readonly segment: SegmentedCurlRep;
  readonly scored?: ScoredCurlRep;
}

interface InternalPoseFrameOutput extends PoseFrameOutput {
  readonly details?: PoseFrameDetails;
}

interface InternalPoseSessionAdapterOptions extends PoseSessionAdapterOptions {
  readonly deferReferenceAggregation?: boolean;
  readonly suppressCues?: boolean;
}

interface BaselineCandidate {
  readonly startedAtMs: number;
  readonly reference: FrameMetrics;
  readonly sum: {
    signedTorsoLeanDeg: number;
    earShoulderVerticalPx: number;
    torsoLengthPx: number;
  };
  count: number;
}

function finiteLandmark(landmark: PoseLandmark | null | undefined): PoseLandmark | null {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
  if (landmark.x < -0.25 || landmark.x > 1.25 || landmark.y < -0.25 || landmark.y > 1.25) return null;
  const visibility = Number.isFinite(landmark.visibility) ? Math.max(0, Math.min(1, landmark.visibility as number)) : undefined;
  const z = Number.isFinite(landmark.z) && Math.abs(landmark.z as number) <= 5 ? landmark.z : undefined;
  return {
    x: landmark.x,
    y: landmark.y,
    ...(z === undefined ? {} : { z }),
    ...(visibility === undefined ? {} : { visibility }),
  };
}

function normalizedOverlay(landmarks: LandmarkSet): Array<PoseLandmark | null> {
  return Array.from({ length: Math.min(33, landmarks.length) }, (_, index) => finiteLandmark(landmarks[index]));
}

function sideViewRatio(landmarks: LandmarkSet, width: number, height: number): number | null {
  const leftShoulder = toPixelPoint(getVisibleLandmark(landmarks, LANDMARK_INDEX.leftShoulder), width, height);
  const rightShoulder = toPixelPoint(getVisibleLandmark(landmarks, LANDMARK_INDEX.rightShoulder), width, height);
  const leftHip = toPixelPoint(getVisibleLandmark(landmarks, LANDMARK_INDEX.leftHip), width, height);
  const rightHip = toPixelPoint(getVisibleLandmark(landmarks, LANDMARK_INDEX.rightHip), width, height);
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;

  const shoulderWidth = distance(leftShoulder, rightShoulder);
  const hipWidth = distance(leftHip, rightHip);
  const torsoLength = (distance(leftShoulder, leftHip) + distance(rightShoulder, rightHip)) / 2;
  if (torsoLength <= 0) return null;
  return Math.max(shoulderWidth, hipWidth) / torsoLength;
}

function configuredViewIsUsable(ratio: number | null, cameraView: CameraView): boolean {
  if (ratio === null) return false;
  if (cameraView === "side") return ratio < 0.35;
  if (cameraView === "front") return ratio >= 0.75;
  return ratio >= 0.35 && ratio < 0.75;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

export function isCleanReferenceRep(rep: SegmentedCurlRep): boolean {
  const tolerance = STANDING_DUMBBELL_CURL.defaultTolerances;
  return (
    rep.romMinAngle <= STANDING_DUMBBELL_CURL.segmentation.flexedThreshold + tolerance.romTopDeg &&
    rep.romMaxAngle >= STANDING_DUMBBELL_CURL.segmentation.extendedThreshold - tolerance.romBottomDeg &&
    rep.maxUpperArmDrift <= tolerance.upperArmDriftDeg &&
    rep.maxTorsoSwing <= tolerance.torsoSwingDeg &&
    rep.maxShrug <= tolerance.shrugRatio
  );
}

export function buildMedianReference(reps: readonly SegmentedCurlRep[]): CurlScoringTemplate {
  if (reps.length < 3 || reps.length > 5) throw new RangeError("A reference needs 3 to 5 clean repetitions.");
  const curves = reps.map((rep) => resampleTimedCurve(rep.elbowCurve, REFERENCE_CURVE_SAMPLES));
  const elbowCurve = Array.from({ length: REFERENCE_CURVE_SAMPLES }, (_, index) => median(curves.map((curve) => curve[index])));
  return {
    reference: {
      romMinAngle: median(reps.map((rep) => rep.romMinAngle)),
      romMaxAngle: median(reps.map((rep) => rep.romMaxAngle)),
      concentricMs: median(reps.map((rep) => rep.concentricMs)),
      topPauseMs: median(reps.map((rep) => rep.topPauseMs)),
      eccentricMs: median(reps.map((rep) => rep.eccentricMs)),
      elbowCurve,
    },
    tolerances: STANDING_DUMBBELL_CURL.defaultTolerances,
    scoringWeights: STANDING_DUMBBELL_CURL.defaultScoringWeights,
    strictness: "standard",
  };
}

function toRepSummary(repNumber: number, scored: ScoredCurlRep): FormCoachRepSummary {
  return {
    repNumber,
    score: scored.score,
    romScore: scored.romScore,
    maxUpperArmDrift: scored.maxUpperArmDrift,
    maxTorsoSwing: scored.maxTorsoSwing,
    maxShrug: scored.maxShrug,
    curveSimilarity: scored.curveSimilarity,
    faults: scored.faults as RepFaultCode[],
    componentScores: scored.componentScores,
    romMinAngle: scored.romMinAngle,
    romMaxAngle: scored.romMaxAngle,
    concentricMs: scored.concentricMs,
    topPauseMs: scored.topPauseMs,
    eccentricMs: scored.eccentricMs,
  };
}

function faultsAtFrame(metrics: FrameMetrics, template: CurlScoringTemplate): RepFaultCode[] {
  const strictness = template.strictness === "beginner" ? 1.5 : template.strictness === "strict" ? 0.7 : 1;
  const faults: RepFaultCode[] = [];
  if (metrics.upperArmDriftDeg > template.tolerances.upperArmDriftDeg * strictness) faults.push("elbow_drift");
  if (metrics.torsoSwingDeg > template.tolerances.torsoSwingDeg * strictness) faults.push("torso_swing");
  if (metrics.shoulderShrugRatio > template.tolerances.shrugRatio * strictness) faults.push("shoulder_shrug");
  return faults;
}

function mergePairedSegments(left: SegmentedCurlRep, right: SegmentedCurlRep): SegmentedCurlRep {
  const startMs = Math.min(left.startMs, right.startMs);
  const endMs = Math.max(left.endMs, right.endMs);
  const leftCurve = resampleTimedCurve(left.elbowCurve, REFERENCE_CURVE_SAMPLES);
  const rightCurve = resampleTimedCurve(right.elbowCurve, REFERENCE_CURVE_SAMPLES);
  const elbowCurve = leftCurve.map((angle, index) => ({
    timestampMs: startMs + ((endMs - startMs) * index) / (REFERENCE_CURVE_SAMPLES - 1),
    angleDeg: (angle + rightCurve[index]) / 2,
  }));
  return {
    startMs,
    endMs,
    concentricMs: (left.concentricMs + right.concentricMs) / 2,
    topPauseMs: (left.topPauseMs + right.topPauseMs) / 2,
    eccentricMs: (left.eccentricMs + right.eccentricMs) / 2,
    romMinAngle: Math.max(left.romMinAngle, right.romMinAngle),
    romMaxAngle: Math.min(left.romMaxAngle, right.romMaxAngle),
    maxUpperArmDrift: Math.max(left.maxUpperArmDrift, right.maxUpperArmDrift),
    maxTorsoSwing: Math.max(left.maxTorsoSwing, right.maxTorsoSwing),
    maxShrug: Math.max(left.maxShrug, right.maxShrug),
    elbowCurve,
  };
}

function conservativePairedScore(
  left: ScoredCurlRep,
  right: ScoredCurlRep,
  template: CurlScoringTemplate,
): ScoredCurlRep {
  const merged = mergePairedSegments(left, right);
  const scoredAggregate = scoreCurlRep(merged, template);
  const faults = [...new Set([...left.faults, ...right.faults])];
  return {
    ...scoredAggregate,
    romScore: Math.min(left.romScore, right.romScore),
    curveSimilarity: Math.min(left.curveSimilarity, right.curveSimilarity),
    componentScores: {
      rom: Math.min(left.componentScores.rom, right.componentScores.rom),
      elbow: Math.min(left.componentScores.elbow, right.componentScores.elbow),
      torso: Math.min(left.componentScores.torso, right.componentScores.torso),
      tempo: Math.min(left.componentScores.tempo, right.componentScores.tempo),
      shoulders: Math.min(left.componentScores.shoulders, right.componentScores.shoulders),
    },
    score: Math.min(left.score, right.score),
    faults,
  };
}

function createSinglePoseSessionAdapter(options: InternalPoseSessionAdapterOptions) {
  const mode = options.mode;
  const referenceRepTarget = options.referenceRepTarget ?? 3;
  if (mode !== "reference" && mode !== "live") throw new RangeError("Unsupported Form Coach mode.");
  if (!Number.isInteger(referenceRepTarget) || referenceRepTarget < 3 || referenceRepTarget > 5) {
    throw new RangeError("Reference rep target must be between 3 and 5.");
  }
  if (mode === "live" && !options.template) throw new RangeError("Live scoring requires a reference template.");
  const requestedArm = options.arm ?? STANDING_DUMBBELL_CURL.arm;
  if (requestedArm === "both") throw new RangeError("A single-arm adapter requires one arm or auto selection.");
  const cameraView = options.cameraView ?? STANDING_DUMBBELL_CURL.cameraView;

  const smoother = new LandmarkEmaSmoother(0.4, MIN_SETUP_VISIBILITY);
  const selector = new ActiveArmSelector(requestedArm, 1_000);
  const segmenter = new CurlRepSegmenter({
    extendedThreshold: STANDING_DUMBBELL_CURL.segmentation.extendedThreshold,
    flexedThreshold: STANDING_DUMBBELL_CURL.segmentation.flexedThreshold,
    maxSessionSamples: MAX_SET_SAMPLES,
  });
  const cues = new CurlCueScheduler({ enabled: mode === "live" && options.suppressCues !== true, cues: DEFAULT_CURL_CUES });
  const cleanReferenceReps: SegmentedCurlRep[] = [];
  let selectedArm: ArmSide | null = null;
  let lastSetupStep: SetupStep = "show-side-view";
  let selectorStartedAtMs: number | null = null;
  let baselineCandidate: BaselineCandidate | null = null;
  let postureBaseline: ReturnType<typeof createPostureBaseline> | null = null;
  let repCount = 0;
  let currentPhase: "concentric" | "eccentric" | null = null;
  let completedReference: CurlScoringTemplate | null = null;
  let setBoundary = false;
  let lastObservedTimestampMs: number | null = null;

  function chooseSetupStep(landmarks: LandmarkSet, width: number, height: number, timestampMs: number): SetupStep {
    const ratio = sideViewRatio(landmarks, width, height);
    if (!configuredViewIsUsable(ratio, cameraView)) return cameraView === "side" ? "show-side-view" : "show-required-view";
    if (!selectedArm) return "low-confidence";
    if (!armVisibilityIsUsable({ timestampMs, landmarks }, selectedArm)) return "low-confidence";

    const metrics = computeFrameMetrics({ landmarks, videoWidth: width, videoHeight: height, timestampMs, arm: selectedArm });
    if (!metrics) return "low-confidence";
    if (metrics.torsoLengthPx / height < MIN_TORSO_HEIGHT_RATIO) return "move-back";
    if (!postureBaseline) return "extend-arm-hold";
    return "ready";
  }

  function addBaselineSample(metrics: FrameMetrics, timestampMs: number, height: number): boolean {
    if (metrics.elbowAngleDeg < STANDING_DUMBBELL_CURL.segmentation.extendedThreshold) {
      baselineCandidate = null;
      return false;
    }
    if (baselineCandidate) {
      const leanDrift = Math.abs(metrics.signedTorsoLeanDeg - baselineCandidate.reference.signedTorsoLeanDeg);
      const torsoDrift = Math.abs(metrics.torsoLengthPx - baselineCandidate.reference.torsoLengthPx) / height;
      const shoulderDrift = Math.abs(metrics.earShoulderVerticalPx - baselineCandidate.reference.earShoulderVerticalPx) / height;
      if (leanDrift > BASELINE_MAX_LEAN_DRIFT_DEG || torsoDrift > BASELINE_MAX_TORSO_RATIO_DRIFT || shoulderDrift > BASELINE_MAX_TORSO_RATIO_DRIFT) {
        baselineCandidate = null;
      }
    }
    if (!baselineCandidate) {
      baselineCandidate = {
        startedAtMs: timestampMs,
        reference: metrics,
        sum: {
          signedTorsoLeanDeg: metrics.signedTorsoLeanDeg,
          earShoulderVerticalPx: metrics.earShoulderVerticalPx,
          torsoLengthPx: metrics.torsoLengthPx,
        },
        count: 1,
      };
      return false;
    }
    baselineCandidate.sum.signedTorsoLeanDeg += metrics.signedTorsoLeanDeg;
    baselineCandidate.sum.earShoulderVerticalPx += metrics.earShoulderVerticalPx;
    baselineCandidate.sum.torsoLengthPx += metrics.torsoLengthPx;
    baselineCandidate.count += 1;
    if (timestampMs - baselineCandidate.startedAtMs < BASELINE_HOLD_MS) return false;

    const average = baselineCandidate;
    postureBaseline = createPostureBaseline({
      ...metrics,
      signedTorsoLeanDeg: average.sum.signedTorsoLeanDeg / average.count,
      earShoulderVerticalPx: average.sum.earShoulderVerticalPx / average.count,
      torsoLengthPx: average.sum.torsoLengthPx / average.count,
    });
    baselineCandidate = null;
    return true;
  }

  function invalidateCurrentFrame(
    timestampMs: number | undefined,
    reason: "low_confidence" | "sample_gap" | "invalid_metrics",
  ): void {
    baselineCandidate = null;
    smoother.reset();
    currentPhase = null;
    if (postureBaseline) {
      const update = segmenter.invalidateCurrentCandidate(timestampMs, reason);
      setBoundary ||= update.stopReason === "session_sample_limit";
    }
    if (mode === "live" && options.template) {
      const cueTimestamp = Math.max(
        Number.isFinite(timestampMs) ? timestampMs as number : Number.NEGATIVE_INFINITY,
        lastObservedTimestampMs ?? Number.NEGATIVE_INFINITY,
      );
      if (Number.isFinite(cueTimestamp)) {
        cues.handle({ type: "frame", atMs: cueTimestamp, faults: [], currentPhase: null, repNumber: repCount + 1 });
      }
    }
  }

  function processCompletedRep(rep: SegmentedCurlRep, timestampMs: number): { rep?: FormCoachRepSummary; reference?: CurlScoringTemplate; cues: CueCode[]; details: PoseFrameDetails } {
    repCount += 1;
    let repSummary: FormCoachRepSummary | undefined;
    let reference: CurlScoringTemplate | undefined;
    const emittedCues: CueCode[] = [];

    let scoredRep: ScoredCurlRep | undefined;
    if (mode === "reference") {
      if (options.onReferenceCandidate) {
        if (selectedArm) options.onReferenceCandidate({ rep, pairing: "single_arm", arm: selectedArm });
      } else if (!options.deferReferenceAggregation && isCleanReferenceRep(rep)) cleanReferenceReps.push(rep);
      if (!options.onReferenceCandidate && !options.deferReferenceAggregation && cleanReferenceReps.length >= referenceRepTarget && !completedReference) {
        completedReference = buildMedianReference(cleanReferenceReps.slice(0, referenceRepTarget));
        reference = completedReference;
      }
    } else if (options.template) {
      scoredRep = scoreCurlRep(rep, options.template);
      repSummary = toRepSummary(repCount, scoredRep);
      const announcements = cues.handle({
        type: "rep_completed",
        atMs: timestampMs,
        repNumber: repCount,
        faults: scoredRep.faults as RepFaultCode[],
      });
      emittedCues.push(...announcements.map((announcement) => announcement.key as CueCode));
      if (announcements.length > 0) cues.handle({ type: "cue_finished", atMs: timestampMs });
    }
    return {
      ...(repSummary ? { rep: repSummary } : {}),
      ...(reference ? { reference } : {}),
      cues: emittedCues,
      details: { segment: rep, ...(scoredRep ? { scored: scoredRep } : {}) },
    };
  }

  function pushFrameMetrics(metrics: FrameMetrics): { rep?: FormCoachRepSummary; reference?: CurlScoringTemplate; cues: CueCode[]; details?: PoseFrameDetails } {
    const sample = {
      timestampMs: metrics.timestampMs,
      elbowAngleDeg: metrics.elbowAngleDeg,
      upperArmDriftDeg: metrics.upperArmDriftDeg,
      torsoSwingDeg: metrics.torsoSwingDeg,
      shoulderShrugRatio: metrics.shoulderShrugRatio,
      confidence: metrics.confidence,
    };
    const update = segmenter.push(sample);
    if (update.transitions.some((transition) => transition.phase === "seeking_bottom")) currentPhase = null;
    const currentTransition = update.transitions.find((transition) => transition.phase === "concentric" || transition.phase === "eccentric");
    const nextPhase = currentTransition?.phase === "concentric" ? "concentric" : currentTransition?.phase === "eccentric" ? "eccentric" : null;
    const cuesOut: CueCode[] = [];
    if (mode === "live" && options.template) {
      const frameCues = cues.handle({
        type: "frame",
        atMs: metrics.timestampMs,
        faults: faultsAtFrame(metrics, options.template),
        ...(nextPhase && nextPhase !== currentPhase ? { phaseStarted: nextPhase } : {}),
        currentPhase: nextPhase ?? currentPhase,
        repNumber: repCount + 1,
      });
      cuesOut.push(...frameCues.map((cue) => cue.key as CueCode));
      if (frameCues.length > 0) cues.handle({ type: "cue_finished", atMs: metrics.timestampMs });
    }
    if (nextPhase) currentPhase = nextPhase;
    const completed = update.completed[0];
    const result: {
      rep?: FormCoachRepSummary;
      reference?: CurlScoringTemplate;
      cues: CueCode[];
      details?: PoseFrameDetails;
    } = completed ? processCompletedRep(completed, completed.endMs) : { cues: [] };
    cuesOut.push(...result.cues);
    setBoundary ||= update.stopReason === "session_sample_limit";
    return {
      ...(result.rep ? { rep: result.rep } : {}),
      ...(result.reference ? { reference: result.reference } : {}),
      ...(completed ? { details: result.details } : {}),
      cues: cuesOut,
    };
  }

  return {
    process(input: PoseFrameInput): InternalPoseFrameOutput {
      if (!Number.isFinite(input.timestampMs) || input.timestampMs < 0) {
        invalidateCurrentFrame(lastObservedTimestampMs ?? undefined, "invalid_metrics");
        lastSetupStep = "low-confidence";
        return { overlay: [], setupStep: lastSetupStep, cues: [], setBoundary };
      }
      if (lastObservedTimestampMs !== null) {
        const gapMs = input.timestampMs - lastObservedTimestampMs;
        if (gapMs <= 0) {
          invalidateCurrentFrame(input.timestampMs, "invalid_metrics");
          lastSetupStep = "low-confidence";
          return { overlay: [], setupStep: lastSetupStep, cues: [], setBoundary };
        }
        if (gapMs > MAX_FRAME_GAP_MS) {
          invalidateCurrentFrame(input.timestampMs, "sample_gap");
        }
      }
      lastObservedTimestampMs = input.timestampMs;
      if (!Number.isSafeInteger(input.width) || input.width < 1 || !Number.isSafeInteger(input.height) || input.height < 1) {
        invalidateCurrentFrame(input.timestampMs, "invalid_metrics");
        lastSetupStep = "low-confidence";
        return { overlay: [], setupStep: lastSetupStep, cues: [], setBoundary };
      }

      const landmarks = smoother.smooth(input.landmarks);
      const sample: ArmSelectionSample = { timestampMs: input.timestampMs, landmarks };
      if (!selectedArm) {
        selectorStartedAtMs ??= input.timestampMs;
        const selection = selector.observe(sample);
        if (selection.ready && (selection.arm === "left" || selection.arm === "right")) {
          selectedArm = selection.arm;
        } else if (input.timestampMs - selectorStartedAtMs >= 1_000) {
          selector.reset();
          selectorStartedAtMs = input.timestampMs;
        }
      }

      const setupStep = chooseSetupStep(landmarks, input.width, input.height, input.timestampMs);
      if (setupStep !== lastSetupStep) lastSetupStep = setupStep;
      if (
        !selectedArm ||
        setupStep === "show-side-view" ||
        setupStep === "show-required-view" ||
        setupStep === "move-back" ||
        setupStep === "low-confidence"
      ) {
        invalidateCurrentFrame(input.timestampMs, "low_confidence");
        return { overlay: normalizedOverlay(landmarks), setupStep, cues: [], setBoundary };
      }

      const preBaselineMetrics = computeFrameMetrics({
        landmarks,
        videoWidth: input.width,
        videoHeight: input.height,
        timestampMs: input.timestampMs,
        arm: selectedArm,
      });
      if (!preBaselineMetrics) {
        invalidateCurrentFrame(input.timestampMs, "low_confidence");
        lastSetupStep = "low-confidence";
        return { overlay: normalizedOverlay(landmarks), setupStep: lastSetupStep, cues: [], setBoundary };
      }
      if (!postureBaseline) {
        addBaselineSample(preBaselineMetrics, input.timestampMs, input.height);
        const afterBaseline = postureBaseline ? "ready" : "extend-arm-hold";
        lastSetupStep = afterBaseline;
        return { overlay: normalizedOverlay(landmarks), setupStep: afterBaseline, cues: [], setBoundary };
      }

      const metrics = computeFrameMetrics({
        landmarks,
        videoWidth: input.width,
        videoHeight: input.height,
        timestampMs: input.timestampMs,
        arm: selectedArm,
        baseline: postureBaseline,
      });
      if (!metrics) {
        invalidateCurrentFrame(input.timestampMs, "low_confidence");
        lastSetupStep = "low-confidence";
        return { overlay: normalizedOverlay(landmarks), setupStep: lastSetupStep, cues: [], setBoundary };
      }
      const result = pushFrameMetrics(metrics);
      if (setBoundary) {
        return { overlay: normalizedOverlay(landmarks), setupStep: "ready", cues: result.cues, setBoundary: true };
      }
      return {
        overlay: normalizedOverlay(landmarks),
        setupStep: "ready",
        ...(result.rep ? { rep: result.rep } : {}),
        ...(result.reference ? { reference: result.reference } : {}),
        ...(result.details ? { details: result.details } : {}),
        cues: result.cues,
        setBoundary: false,
      };
    },
    invalidateCurrentCandidate(timestampMs: number | undefined): void {
      invalidateCurrentFrame(timestampMs, "low_confidence");
    },
    getSetupStep: () => lastSetupStep,
    getCleanReferenceCount: () => cleanReferenceReps.length,
    getSetSampleLimit: () => MAX_SET_SAMPLES,
  };
}

export function createPoseSessionAdapter(options: PoseSessionAdapterOptions) {
  const requestedArm = options.arm ?? STANDING_DUMBBELL_CURL.arm;
  if (requestedArm !== "both") return createSinglePoseSessionAdapter(options);

  const mode = options.mode;
  const referenceRepTarget = options.referenceRepTarget ?? 3;
  if (mode !== "reference" && mode !== "live") throw new RangeError("Unsupported Form Coach mode.");
  if (!Number.isInteger(referenceRepTarget) || referenceRepTarget < 3 || referenceRepTarget > 5) {
    throw new RangeError("Reference rep target must be between 3 and 5.");
  }
  if (mode === "live" && !options.template) throw new RangeError("Live scoring requires a reference template.");

  const singleOptions: InternalPoseSessionAdapterOptions = {
    ...options,
    onReferenceCandidate: undefined,
    suppressCues: true,
    deferReferenceAggregation: true,
  };
  const left = createSinglePoseSessionAdapter({ ...singleOptions, arm: "left" });
  const right = createSinglePoseSessionAdapter({ ...singleOptions, arm: "right" });
  const pairer = new BilateralRepPairer();
  const pairedReferenceReps: SegmentedCurlRep[] = [];
  const cues = new CurlCueScheduler({ enabled: mode === "live", cues: DEFAULT_CURL_CUES });
  const cameraView = options.cameraView ?? STANDING_DUMBBELL_CURL.cameraView;
  let lastObservedTimestampMs: number | null = null;
  let lastSetupStep: SetupStep = cameraView === "side" ? "show-side-view" : "show-required-view";
  let repCount = 0;
  let setBoundary = false;
  let completedReference: CurlScoringTemplate | null = null;

  function chooseCombinedSetupStep(input: PoseFrameInput, leftOutput: InternalPoseFrameOutput, rightOutput: InternalPoseFrameOutput): SetupStep {
    const leftSample: ArmSelectionSample = { timestampMs: input.timestampMs, landmarks: input.landmarks };
    if (!configuredViewIsUsable(sideViewRatio(input.landmarks, input.width, input.height), cameraView)) {
      return cameraView === "side" ? "show-side-view" : "show-required-view";
    }
    if (!armVisibilityIsUsable(leftSample, "left") || !armVisibilityIsUsable(leftSample, "right")) return "show-both-arms";
    const steps = [leftOutput.setupStep, rightOutput.setupStep];
    if (steps.includes("move-back")) return "move-back";
    if (steps.includes("low-confidence")) return "low-confidence";
    if (steps.includes("extend-arm-hold")) return "extend-arm-hold";
    return "ready";
  }

  return {
    process(input: PoseFrameInput): InternalPoseFrameOutput {
      const rejections: PairRejectionReason[] = [];
      if (!Number.isFinite(input.timestampMs) || input.timestampMs < 0) {
        rejections.push(...pairer.reset());
      } else if (lastObservedTimestampMs !== null) {
        const gapMs = input.timestampMs - lastObservedTimestampMs;
        if (gapMs <= 0 || gapMs > MAX_FRAME_GAP_MS) rejections.push(...pairer.reset());
      }
      if (Number.isFinite(input.timestampMs) && input.timestampMs >= 0) lastObservedTimestampMs = input.timestampMs;

      const leftOutput = left.process(input);
      const rightOutput = right.process(input);
      const setupStep = chooseCombinedSetupStep(input, leftOutput, rightOutput);
      if (setupStep !== lastSetupStep) lastSetupStep = setupStep;

      const ready = setupStep === "ready";
      if (!ready) {
        rejections.push(...pairer.reset());
      }
      const observationUnusable =
        setupStep === "show-side-view" ||
        setupStep === "show-required-view" ||
        setupStep === "show-both-arms" ||
        setupStep === "move-back" ||
        setupStep === "low-confidence";
      if (observationUnusable) {
        left.invalidateCurrentCandidate(input.timestampMs);
        right.invalidateCurrentCandidate(input.timestampMs);
      }
      if (Number.isFinite(input.timestampMs)) rejections.push(...pairer.expire(input.timestampMs));

      let summary: FormCoachRepSummary | undefined;
      let reference: CurlScoringTemplate | undefined;
      const emittedCues: CueCode[] = [];
      if (ready && Number.isFinite(input.timestampMs)) {
        let paired: ReturnType<typeof pairer.push> | null = null;
        if (leftOutput.details) {
          paired = pairer.push("left", leftOutput.details.segment, input.timestampMs);
          rejections.push(...paired.rejected);
        }
        if (rightOutput.details) {
          const rightUpdate = pairer.push("right", rightOutput.details.segment, input.timestampMs);
          if (rightUpdate.pair) paired = rightUpdate;
          rejections.push(...rightUpdate.rejected);
        }
        if (paired) {
          rejections.push(...paired.rejected);
          if (paired.pair) {
            repCount += 1;
            const mergedSegment = mergePairedSegments(paired.pair.left, paired.pair.right);
            if (mode === "reference") {
              if (options.onReferenceCandidate) {
                options.onReferenceCandidate({ rep: mergedSegment, pairing: "matched_bilateral", arm: null });
              } else if (isCleanReferenceRep(mergedSegment)) pairedReferenceReps.push(mergedSegment);
              if (!options.onReferenceCandidate && pairedReferenceReps.length >= referenceRepTarget && !completedReference) {
                completedReference = buildMedianReference(pairedReferenceReps.slice(0, referenceRepTarget));
                reference = completedReference;
              }
            } else if (options.template) {
              const leftScored = scoreCurlRep(paired.pair.left, options.template);
              const rightScored = scoreCurlRep(paired.pair.right, options.template);
              const pairedScore = conservativePairedScore(leftScored, rightScored, options.template);
              summary = toRepSummary(repCount, pairedScore);
              const announcements = cues.handle({
                type: "rep_completed",
                atMs: Math.max(paired.pair.left.endMs, paired.pair.right.endMs),
                repNumber: repCount,
                faults: pairedScore.faults as RepFaultCode[],
              });
              emittedCues.push(...announcements.map((announcement) => announcement.key as CueCode));
              if (announcements.length > 0) cues.handle({ type: "cue_finished", atMs: Math.max(paired.pair.left.endMs, paired.pair.right.endMs) });
            }
          }
        }
      }

      if (leftOutput.setBoundary || rightOutput.setBoundary) {
        setBoundary = true;
        rejections.push(...pairer.reset());
      }
      return {
        overlay: leftOutput.overlay,
        setupStep,
        ...(summary ? { rep: summary } : {}),
        ...(reference ? { reference } : {}),
        ...(rejections.length > 0 ? { pairRejected: rejections[0] } : {}),
        cues: emittedCues,
        setBoundary,
      };
    },
    getSetupStep: () => lastSetupStep,
    getCleanReferenceCount: () => pairedReferenceReps.length,
    getSetSampleLimit: () => Math.min(left.getSetSampleLimit(), right.getSetSampleLimit()),
  };
}
