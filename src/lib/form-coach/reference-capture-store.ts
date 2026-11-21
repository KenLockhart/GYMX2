import { buildFormCoachReference, type FormCoachReferenceCandidate } from "./reference-builder";
import { isCleanReferenceRep } from "./pose-session-adapter";
import type { SegmentedCurlRep } from "./engine/types";
import { isReferenceCaptureCandidateSummary, type ReferenceCaptureCandidateReason, type ReferenceCaptureCandidateSummary } from "./worker-protocol";
import type { ExerciseTemplate } from "./template-schema";

export const MAX_REFERENCE_CAPTURE_CANDIDATES = 100;
export const MAX_REFERENCE_CAPTURE_CURVE_POINTS = 30_000;

export type ReferenceCaptureContext = Readonly<{
  sessionEpoch: number;
  exerciseKey: string;
  arm: "left" | "right" | "both" | "auto";
  cameraView: "side" | "front" | "three_quarter";
  width: number;
  height: number;
}>;

export type CapturedReferenceCandidate = Readonly<{
  summary: ReferenceCaptureCandidateSummary;
  source: FormCoachReferenceCandidate;
}>;

export type ReferenceCaptureAddResult =
  | Readonly<{ ok: true; candidate: ReferenceCaptureCandidateSummary; generation: number; pauseReason: "candidate_cap" | "curve_point_cap" | null }>
  | Readonly<{ ok: false; generation: number; pauseReason: "candidate_cap" | "curve_point_cap" | "invalid_candidate" }>;

export type ReferenceCaptureBuildResult = ReturnType<typeof buildFormCoachReference>;

function reasonForRep(rep: SegmentedCurlRep): ReferenceCaptureCandidateReason | null {
  return isCleanReferenceRep(rep) ? null : "outside_clean_reference";
}

function hasFiniteCurve(rep: SegmentedCurlRep): boolean {
  return Number.isFinite(rep.startMs) && Number.isFinite(rep.endMs) && rep.endMs > rep.startMs &&
    Number.isFinite(rep.concentricMs) && Number.isFinite(rep.topPauseMs) && Number.isFinite(rep.eccentricMs) &&
    Number.isFinite(rep.romMinAngle) && Number.isFinite(rep.romMaxAngle) &&
    Number.isFinite(rep.maxUpperArmDrift) && Number.isFinite(rep.maxTorsoSwing) && Number.isFinite(rep.maxShrug) &&
    Array.isArray(rep.elbowCurve) && rep.elbowCurve.length >= 2 && rep.elbowCurve.every((point) =>
      Number.isFinite(point.timestampMs) && Number.isFinite(point.angleDeg),
    );
}

/** Worker-local storage for completed logical reps; never serialize its `source` values. */
export class ReferenceCaptureStore {
  private baseTemplate: ExerciseTemplate | null;
  private readonly candidates: CapturedReferenceCandidate[] = [];
  private totalCurvePoints = 0;
  private generation = 0;
  private closed = false;

  constructor(readonly context: ReferenceCaptureContext, baseTemplate: ExerciseTemplate) {
    this.baseTemplate = baseTemplate;
  }

  get candidateGeneration(): number {
    return this.generation;
  }

  get curvePointCount(): number {
    return this.totalCurvePoints;
  }

  get candidateCount(): number {
    return this.candidates.length;
  }

  listSummaries(): readonly ReferenceCaptureCandidateSummary[] {
    return this.candidates.map(({ summary }) => ({ ...summary }));
  }

  add(rep: SegmentedCurlRep, pairing: "single_arm" | "matched_bilateral", arm: "left" | "right" | null): ReferenceCaptureAddResult {
    if (this.closed || !this.baseTemplate || !hasFiniteCurve(rep)) {
      return { ok: false, generation: this.generation, pauseReason: "invalid_candidate" };
    }
    if (this.candidates.length >= MAX_REFERENCE_CAPTURE_CANDIDATES) {
      return { ok: false, generation: this.generation, pauseReason: "candidate_cap" };
    }
    if (rep.elbowCurve.length > MAX_REFERENCE_CAPTURE_CURVE_POINTS - this.totalCurvePoints) {
      return { ok: false, generation: this.generation, pauseReason: "curve_point_cap" };
    }
    if ((pairing === "single_arm" && arm !== "left" && arm !== "right") || (pairing === "matched_bilateral" && arm !== null)) {
      return { ok: false, generation: this.generation, pauseReason: "invalid_candidate" };
    }

    const ordinal = this.candidates.length + 1;
    const id = `candidate-${ordinal}`;
    const reason = reasonForRep(rep);
    const summary: ReferenceCaptureCandidateSummary = {
      id,
      ordinal,
      pairing,
      arm,
      selectable: reason === null,
      reason,
      romMinAngle: rep.romMinAngle,
      romMaxAngle: rep.romMaxAngle,
      concentricMs: rep.concentricMs,
      topPauseMs: rep.topPauseMs,
      eccentricMs: rep.eccentricMs,
      maxUpperArmDrift: rep.maxUpperArmDrift,
      maxTorsoSwing: rep.maxTorsoSwing,
      maxShrug: rep.maxShrug,
    };
    if (!isReferenceCaptureCandidateSummary(summary)) {
      return { ok: false, generation: this.generation, pauseReason: "invalid_candidate" };
    }
    const source: FormCoachReferenceCandidate = {
      id,
      status: "complete",
      pairing,
      rep,
      faults: [],
    };
    this.candidates.push({ summary, source });
    this.totalCurvePoints += rep.elbowCurve.length;
    this.generation += 1;
    const pauseReason: "candidate_cap" | "curve_point_cap" | null = this.candidates.length >= MAX_REFERENCE_CAPTURE_CANDIDATES
      ? "candidate_cap"
      : this.totalCurvePoints >= MAX_REFERENCE_CAPTURE_CURVE_POINTS
        ? "curve_point_cap"
        : null;
    return { ok: true, candidate: { ...summary }, generation: this.generation, pauseReason };
  }

  build(candidateGeneration: number, selectedCandidateIds: readonly string[]): ReferenceCaptureBuildResult {
    if (this.closed || !this.baseTemplate || candidateGeneration !== this.generation) {
      return { ok: false, code: "invalid-template", message: "The local capture changed before the reference could be built." };
    }
    return buildFormCoachReference({
      baseTemplate: this.baseTemplate,
      candidates: this.candidates.map(({ source }) => source),
      selectedCandidateIds,
    });
  }

  clear(): void {
    this.closed = true;
    this.baseTemplate = null;
    this.candidates.length = 0;
    this.totalCurvePoints = 0;
    this.generation += 1;
  }
}
