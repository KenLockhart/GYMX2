/**
 * Pure contracts for the future pose adapter and Form Coach UI. An adapter maps normalized
 * MediaPipe landmarks into `LandmarkSet`, smooths them, locks an arm with `ActiveArmSelector`,
 * computes `FrameMetrics`, and feeds only numeric `CurlFrameSample`s to `CurlRepSegmenter`.
 * Score completed segments with `scoreCurlRep`; send cue events to `CurlCueScheduler` separately.
 * All positions are normalized image coordinates at this boundary, metric angles are degrees,
 * geometry dimensions are pixels, durations/timestamps are milliseconds, and no camera/media
 * object is part of an attempt/result contract.
 */

export type ArmSide = "left" | "right";
export type TrackedArm = ArmSide | "both" | "auto";
export type CameraView = "side" | "front" | "three_quarter";

/** One normalized image landmark. Visibility is preserved so low-confidence points can be ignored. */
export interface PoseLandmark {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
  readonly visibility?: number;
}

export type LandmarkSet = ReadonlyArray<PoseLandmark | null | undefined>;

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface ArmSelectionSample {
  readonly timestampMs: number;
  readonly landmarks: LandmarkSet;
}

export interface ArmSelectionResult {
  readonly arm: ArmSide | "both" | null;
  readonly ready: boolean;
  readonly averageVisibility: Readonly<Record<ArmSide, number>>;
}

export interface PostureBaseline {
  readonly signedTorsoLeanDeg: number;
  readonly earShoulderVerticalPx: number;
  readonly torsoLengthPx: number;
}

/** Numeric per-frame measurements. This is an in-memory engine value, not a frame/landmark payload. */
export interface FrameMetrics {
  readonly timestampMs: number;
  readonly arm: ArmSide;
  readonly confidence: number;
  readonly elbowAngleDeg: number;
  readonly upperArmDriftDeg: number;
  /** Absolute angle from vertical. */
  readonly torsoLeanDeg: number;
  /** Signed angle from vertical; used for baseline-relative sway. */
  readonly signedTorsoLeanDeg: number;
  readonly torsoSwingDeg: number;
  readonly shoulderShrugRatio: number;
  /** Internal numeric geometry used to make a setup baseline. */
  readonly earShoulderVerticalPx: number;
  readonly torsoLengthPx: number;
}

export type RepPhase = "seeking_bottom" | "bottom" | "concentric" | "top" | "eccentric";

/** Minimal finite metric sample consumed by the curl segmentation state machine. */
export interface CurlFrameSample {
  readonly timestampMs: number;
  readonly elbowAngleDeg: number | null;
  readonly upperArmDriftDeg: number;
  readonly torsoSwingDeg: number;
  readonly shoulderShrugRatio: number;
  /** Explicit confidence propagated from the required pose landmarks. */
  readonly confidence: number;
}

export interface PhaseTransition {
  readonly phase: RepPhase;
  readonly atMs: number;
}

export interface RejectedRep {
  readonly startMs: number;
  readonly endMs: number;
  readonly reason:
    | "short_rom_top"
    | "short_rom_bottom"
    | "too_short"
    | "too_long"
    | "low_confidence"
    | "invalid_metrics"
    | "sample_gap"
    | "session_sample_limit"
    | "unfinished";
}

/** A completed, duration-validated rep before template scoring. */
export interface SegmentedCurlRep {
  readonly startMs: number;
  readonly endMs: number;
  readonly concentricMs: number;
  readonly topPauseMs: number;
  readonly eccentricMs: number;
  readonly romMinAngle: number;
  readonly romMaxAngle: number;
  readonly maxUpperArmDrift: number;
  readonly maxTorsoSwing: number;
  readonly maxShrug: number;
  readonly elbowCurve: readonly { readonly timestampMs: number; readonly angleDeg: number }[];
}

export interface RepComponentScores {
  readonly rom: number;
  readonly elbow: number;
  readonly torso: number;
  readonly tempo: number;
  readonly shoulders: number;
}

/** Persistable numeric rep result; raw pose landmarks and media are deliberately absent. */
export interface ScoredCurlRep extends SegmentedCurlRep {
  readonly romScore: number;
  readonly curveSimilarity: number;
  readonly componentScores: RepComponentScores;
  readonly score: number;
  readonly faults: readonly string[];
}

export type ExerciseFault =
  | "elbow_drift"
  | "torso_swing"
  | "short_rom_bottom"
  | "short_rom_top"
  | "eccentric_too_fast"
  | "shoulder_shrug";

export interface ScoringWeights {
  readonly rom: number;
  readonly elbow: number;
  readonly torso: number;
  readonly tempo: number;
  readonly shoulders: number;
}

export interface CurlTolerances {
  readonly romTopDeg: number;
  readonly romBottomDeg: number;
  readonly upperArmDriftDeg: number;
  readonly torsoSwingDeg: number;
  readonly shrugRatio: number;
  readonly tempoPct: number;
}

export interface CurlReference {
  readonly romMinAngle: number;
  readonly romMaxAngle: number;
  readonly concentricMs: number;
  readonly topPauseMs: number;
  readonly eccentricMs: number;
  readonly elbowCurve: readonly number[];
}

export type Strictness = "beginner" | "standard" | "strict";

export interface CurlScoringTemplate {
  readonly reference: CurlReference;
  readonly tolerances: CurlTolerances;
  readonly scoringWeights: ScoringWeights;
  readonly strictness: Strictness;
}

export interface TimedCurvePoint {
  readonly timestampMs: number;
  readonly angleDeg: number;
}
