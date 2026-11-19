import type { CurlFrameSample, PhaseTransition, RejectedRep, RepPhase, SegmentedCurlRep } from "./types";

export interface CurlSegmentationOptions {
  readonly extendedThreshold?: number;
  readonly flexedThreshold?: number;
  readonly minDurationMs?: number;
  readonly maxDurationMs?: number;
  readonly minimumConfidence?: number;
  /** Maximum permitted time between valid metric frames before a candidate is discarded. */
  readonly maxGapMs?: number;
  /** Maximum input frames retained in one bounded set; start a new set by resetting the segmenter. */
  readonly maxSessionSamples?: number;
}

export type CurlSegmentationStopReason = "session_sample_limit";

export interface SegmenterUpdate {
  readonly transitions: readonly PhaseTransition[];
  readonly completed: readonly SegmentedCurlRep[];
  readonly rejected: readonly RejectedRep[];
  readonly stopReason: CurlSegmentationStopReason | null;
}

export interface CurlSegmentationResult {
  readonly reps: readonly SegmentedCurlRep[];
  readonly rejected: readonly RejectedRep[];
  readonly transitions: readonly PhaseTransition[];
  readonly stopReason: CurlSegmentationStopReason | null;
}

const DEFAULTS = {
  extendedThreshold: 150,
  flexedThreshold: 60,
  minDurationMs: 600,
  maxDurationMs: 15000,
  minimumConfidence: 0.5,
  maxGapMs: 500,
  maxSessionSamples: 30000,
} as const;

/** Require two rising samples above flexion threshold + 5 degrees before leaving the top. */
const TOP_EXIT_HYSTERESIS_DEG = 5;
const ECCENTRIC_CONFIRMATION_SAMPLES = 2;

interface Candidate {
  startMs: number;
  topAtMs: number | null;
  eccentricAtMs: number | null;
  pendingEccentricAtMs: number | null;
  pendingEccentricLastAngle: number | null;
  pendingEccentricSamples: number;
  samples: CurlFrameSample[];
}

function validOptions(options: CurlSegmentationOptions) {
  const values = { ...DEFAULTS, ...options };
  if (
    !Number.isFinite(values.extendedThreshold) ||
    !Number.isFinite(values.flexedThreshold) ||
    values.extendedThreshold <= values.flexedThreshold + 10 ||
    !Number.isFinite(values.minDurationMs) ||
    values.minDurationMs < 100 ||
    !Number.isFinite(values.maxDurationMs) ||
    values.maxDurationMs <= values.minDurationMs ||
    values.maxDurationMs > 60000 ||
    !Number.isFinite(values.minimumConfidence) ||
    values.minimumConfidence < 0 ||
    values.minimumConfidence > 1 ||
    !Number.isFinite(values.maxGapMs) ||
    values.maxGapMs < 50 ||
    values.maxGapMs > 5000 ||
    !Number.isInteger(values.maxSessionSamples) ||
    values.maxSessionSamples < 1 ||
    values.maxSessionSamples > 1000000 ||
    values.extendedThreshold >= 180
  ) {
    throw new RangeError("Invalid curl segmentation options.");
  }
  return values;
}

/**
 * One bounded set buffer. The default cap retains at most 30,000 input samples (about 16 minutes
 * at 30 fps) and the resulting numeric elbow curves in memory. On the next push after the cap,
 * the segmenter returns `session_sample_limit`, rejects any unfinished candidate with that reason,
 * and ignores further samples until `reset()`. The adapter should surface a set-boundary message,
 * aggregate any desired scores, and explicitly reset before the next set. Curves are ephemeral
 * engine data and must not be uploaded as raw pose history.
 */
export class CurlRepSegmenter {
  private readonly options: ReturnType<typeof validOptions>;
  private currentPhase: RepPhase = "seeking_bottom";
  private lastBottom: CurlFrameSample | null = null;
  private candidate: Candidate | null = null;
  private reps: SegmentedCurlRep[] = [];
  private rejected: RejectedRep[] = [];
  private transitions: PhaseTransition[] = [];
  private lastTimestampMs = Number.NEGATIVE_INFINITY;
  private processedSamples = 0;
  private stopReason: CurlSegmentationStopReason | null = null;

  constructor(options: CurlSegmentationOptions = {}) {
    this.options = validOptions(options);
  }

  get phase(): RepPhase {
    return this.currentPhase;
  }

  push(sample: CurlFrameSample): SegmenterUpdate {
    const transitions: PhaseTransition[] = [];
    const completed: SegmentedCurlRep[] = [];
    const rejected: RejectedRep[] = [];
    if (this.stopReason) {
      return { transitions, completed, rejected, stopReason: this.stopReason };
    }
    if (!Number.isFinite(sample.timestampMs) || sample.timestampMs < this.lastTimestampMs) {
      return { transitions, completed, rejected, stopReason: null };
    }
    if (this.processedSamples >= this.options.maxSessionSamples) {
      this.rejectCandidate(sample.timestampMs, "session_sample_limit", rejected);
      this.lastBottom = null;
      this.changePhase("seeking_bottom", sample.timestampMs, transitions);
      this.stopReason = "session_sample_limit";
      return { transitions, completed, rejected, stopReason: this.stopReason };
    }
    this.processedSamples += 1;
    if (Number.isFinite(this.lastTimestampMs) && sample.timestampMs - this.lastTimestampMs > this.options.maxGapMs) {
      this.rejectCandidate(sample.timestampMs, "sample_gap", rejected);
      this.lastBottom = null;
      this.changePhase("seeking_bottom", sample.timestampMs, transitions);
    }
    this.lastTimestampMs = sample.timestampMs;

    const confidence = sample.confidence;
    if (
      sample.elbowAngleDeg === null ||
      !Number.isFinite(sample.elbowAngleDeg) ||
      sample.elbowAngleDeg < 0 ||
      sample.elbowAngleDeg > 180 ||
      !Number.isFinite(confidence) ||
      confidence < this.options.minimumConfidence
    ) {
      if (this.candidate) {
        const badRep = {
          startMs: this.candidate.startMs,
          endMs: sample.timestampMs,
          reason: "low_confidence" as const,
        };
        this.rejected.push(badRep);
        rejected.push(badRep);
      }
      this.candidate = null;
      this.lastBottom = null;
      this.changePhase("seeking_bottom", sample.timestampMs, transitions);
      return { transitions, completed, rejected, stopReason: null };
    }
    if (
      !Number.isFinite(sample.upperArmDriftDeg) || sample.upperArmDriftDeg < 0 || sample.upperArmDriftDeg > 180 ||
      !Number.isFinite(sample.torsoSwingDeg) || sample.torsoSwingDeg < 0 || sample.torsoSwingDeg > 180 ||
      !Number.isFinite(sample.shoulderShrugRatio)
    ) {
      if (this.candidate) this.rejectCandidate(sample.timestampMs, "invalid_metrics", rejected);
      this.lastBottom = null;
      this.changePhase("seeking_bottom", sample.timestampMs, transitions);
      return { transitions, completed, rejected, stopReason: null };
    }

    const angle = sample.elbowAngleDeg;
    switch (this.currentPhase) {
      case "seeking_bottom":
        if (angle > this.options.extendedThreshold) {
          this.lastBottom = sample;
          this.changePhase("bottom", sample.timestampMs, transitions);
        }
        break;
      case "bottom":
        if (angle > this.options.extendedThreshold) {
          this.lastBottom = sample;
        } else if (angle < this.options.extendedThreshold) {
          this.candidate = {
            startMs: sample.timestampMs,
            topAtMs: null,
            eccentricAtMs: null,
            pendingEccentricAtMs: null,
            pendingEccentricLastAngle: null,
            pendingEccentricSamples: 0,
            samples: this.lastBottom ? [this.lastBottom, sample] : [sample],
          };
          this.changePhase("concentric", sample.timestampMs, transitions);
        }
        break;
      case "concentric":
        this.appendSample(sample);
        if (angle < this.options.flexedThreshold) {
          this.candidate!.topAtMs = sample.timestampMs;
          this.changePhase("top", sample.timestampMs, transitions);
        } else if (angle > this.options.extendedThreshold) {
          this.rejectCandidate(sample.timestampMs, "short_rom_top", rejected);
          this.lastBottom = sample;
          this.changePhase("bottom", sample.timestampMs, transitions);
        } else {
          this.rejectIfTooLong(sample.timestampMs, rejected, transitions);
        }
        break;
      case "top":
        this.appendSample(sample);
        if (angle <= this.options.flexedThreshold + TOP_EXIT_HYSTERESIS_DEG) {
          this.candidate!.pendingEccentricAtMs = null;
          this.candidate!.pendingEccentricLastAngle = null;
          this.candidate!.pendingEccentricSamples = 0;
          this.rejectIfTooLong(sample.timestampMs, rejected, transitions);
        } else {
          const candidate = this.candidate!;
          if (candidate.pendingEccentricAtMs === null || candidate.pendingEccentricLastAngle === null) {
            candidate.pendingEccentricAtMs = sample.timestampMs;
            candidate.pendingEccentricLastAngle = angle;
            candidate.pendingEccentricSamples = 1;
          } else if (angle > candidate.pendingEccentricLastAngle) {
            candidate.pendingEccentricLastAngle = angle;
            candidate.pendingEccentricSamples += 1;
          } else {
            candidate.pendingEccentricAtMs = sample.timestampMs;
            candidate.pendingEccentricLastAngle = angle;
            candidate.pendingEccentricSamples = 1;
          }
          if (candidate.pendingEccentricSamples >= ECCENTRIC_CONFIRMATION_SAMPLES) {
            candidate.eccentricAtMs = candidate.pendingEccentricAtMs;
            this.changePhase("eccentric", candidate.pendingEccentricAtMs, transitions);
            if (angle > this.options.extendedThreshold) {
              const rep = this.completeCandidate(sample.timestampMs, rejected);
              if (rep) completed.push(rep);
              this.lastBottom = sample;
              this.changePhase("bottom", sample.timestampMs, transitions);
            }
          } else {
            this.rejectIfTooLong(sample.timestampMs, rejected, transitions);
          }
        }
        break;
      case "eccentric":
        this.appendSample(sample);
        if (angle > this.options.extendedThreshold) {
          const rep = this.completeCandidate(sample.timestampMs, rejected);
          if (rep) completed.push(rep);
          this.lastBottom = sample;
          this.changePhase("bottom", sample.timestampMs, transitions);
        } else {
          this.rejectIfTooLong(sample.timestampMs, rejected, transitions);
        }
        break;
    }

    return { transitions, completed, rejected, stopReason: null };
  }

  finish(atMs = this.lastTimestampMs): SegmenterUpdate {
    const rejected: RejectedRep[] = [];
    const transitions: PhaseTransition[] = [];
    if (this.candidate) {
      const reason = this.currentPhase === "concentric"
        ? "short_rom_top"
        : this.currentPhase === "top" || this.currentPhase === "eccentric"
          ? "short_rom_bottom"
          : "unfinished";
      this.rejectCandidate(atMs, reason, rejected);
    }
    this.lastBottom = null;
    this.changePhase("seeking_bottom", atMs, transitions);
    return { transitions, completed: [], rejected, stopReason: this.stopReason };
  }

  result(): CurlSegmentationResult {
    return {
      reps: [...this.reps],
      rejected: [...this.rejected],
      transitions: [...this.transitions],
      stopReason: this.stopReason,
    };
  }

  reset(): void {
    this.currentPhase = "seeking_bottom";
    this.lastBottom = null;
    this.candidate = null;
    this.reps = [];
    this.rejected = [];
    this.transitions = [];
    this.lastTimestampMs = Number.NEGATIVE_INFINITY;
    this.processedSamples = 0;
    this.stopReason = null;
  }

  private appendSample(sample: CurlFrameSample): void {
    if (!this.candidate) return;
    const last = this.candidate.samples[this.candidate.samples.length - 1];
    if (last?.timestampMs !== sample.timestampMs) this.candidate.samples.push(sample);
  }

  private changePhase(phase: RepPhase, atMs: number, transitions: PhaseTransition[]): void {
    if (phase === this.currentPhase) return;
    const transition = { phase, atMs };
    this.currentPhase = phase;
    transitions.push(transition);
    this.transitions.push(transition);
  }

  private rejectCandidate(atMs: number, reason: RejectedRep["reason"], rejected: RejectedRep[]): void {
    if (!this.candidate) return;
    const rejection = { startMs: this.candidate.startMs, endMs: atMs, reason };
    this.rejected.push(rejection);
    rejected.push(rejection);
    this.candidate = null;
  }

  private rejectIfTooLong(atMs: number, rejected: RejectedRep[], transitions: PhaseTransition[]): void {
    if (!this.candidate || atMs - this.candidate.startMs <= this.options.maxDurationMs) return;
    this.rejectCandidate(atMs, "too_long", rejected);
    this.lastBottom = null;
    this.changePhase("seeking_bottom", atMs, transitions);
  }

  private completeCandidate(atMs: number, rejected: RejectedRep[]): SegmentedCurlRep | null {
    const candidate = this.candidate;
    if (!candidate || candidate.topAtMs === null || candidate.eccentricAtMs === null) {
      this.rejectCandidate(atMs, "short_rom_top", rejected);
      return null;
    }
    const durationMs = atMs - candidate.startMs;
    if (durationMs < this.options.minDurationMs) {
      this.rejectCandidate(atMs, "too_short", rejected);
      return null;
    }
    if (durationMs > this.options.maxDurationMs) {
      this.rejectCandidate(atMs, "too_long", rejected);
      return null;
    }

    const angles = candidate.samples.map((item) => item.elbowAngleDeg as number);
    const rep: SegmentedCurlRep = {
      startMs: candidate.startMs,
      endMs: atMs,
      concentricMs: candidate.topAtMs - candidate.startMs,
      topPauseMs: candidate.eccentricAtMs - candidate.topAtMs,
      eccentricMs: atMs - candidate.eccentricAtMs,
      romMinAngle: Math.min(...angles),
      romMaxAngle: Math.max(...angles),
      maxUpperArmDrift: Math.max(...candidate.samples.map((item) => item.upperArmDriftDeg)),
      maxTorsoSwing: Math.max(...candidate.samples.map((item) => item.torsoSwingDeg)),
      maxShrug: Math.max(0, ...candidate.samples.map((item) => item.shoulderShrugRatio)),
      elbowCurve: candidate.samples.map((item) => ({
        timestampMs: item.timestampMs,
        angleDeg: item.elbowAngleDeg as number,
      })),
    };
    this.candidate = null;
    this.reps.push(rep);
    return rep;
  }
}

export function segmentCurlSequence(
  frames: readonly CurlFrameSample[],
  options: CurlSegmentationOptions = {},
): CurlSegmentationResult {
  const segmenter = new CurlRepSegmenter(options);
  for (const frame of frames) segmenter.push(frame);
  if (frames.length > 0) segmenter.finish(frames[frames.length - 1].timestampMs);
  return segmenter.result();
}
