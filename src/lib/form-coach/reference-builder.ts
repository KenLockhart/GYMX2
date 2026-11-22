import { buildMedianReference, isCleanReferenceRep } from "./pose-session-adapter";
import { STANDING_DUMBBELL_CURL } from "./engine/registry";
import type { SegmentedCurlRep } from "./engine/types";
import { isExerciseFault, safeParseExerciseTemplate, type ExerciseTemplate } from "./template-schema";

const MIN_SELECTED_REPS = 3;
const MAX_SELECTED_REPS = 5;
const MAX_CANDIDATES = 100;
const MAX_CURVE_POINTS = 30_000;
const PRODUCER_EXTENDED_THRESHOLD = STANDING_DUMBBELL_CURL.segmentation.extendedThreshold;

export type ReferenceCandidateStatus = "complete" | "partial" | "occluded" | "missing_visibility" | "missing";
export type ReferenceCandidatePairing = "single_arm" | "matched_bilateral" | "unmatched_bilateral";

/**
 * A local, pre-serialization engine candidate. For bilateral templates, `rep` must be the one
 * already synchronized logical segment produced after the existing engine pairer accepts both
 * arms. `matched_bilateral` is a trusted local producer precondition, not verifiable pairing
 * evidence. This type is not a claim of authorization or a persisted result contract.
 */
export type FormCoachReferenceCandidate = Readonly<{
  id: string;
  status: ReferenceCandidateStatus;
  pairing: ReferenceCandidatePairing;
  rep: SegmentedCurlRep | null;
  faults: readonly string[];
}>;

export type BuildFormCoachReferenceInput = Readonly<{
  baseTemplate: ExerciseTemplate;
  candidates: readonly FormCoachReferenceCandidate[];
  selectedCandidateIds: readonly string[];
}>;

export type FormCoachReferenceFailureCode =
  | "invalid-template"
  | "too-many-candidates"
  | "invalid-candidate-id"
  | "duplicate-candidate-id"
  | "invalid-selection-count"
  | "duplicate-selection"
  | "candidate-not-found"
  | "candidate-incomplete"
  | "candidate-occluded"
  | "candidate-missing-visibility"
  | "candidate-missing"
  | "unmatched-bilateral-rep"
  | "candidate-pairing-mismatch"
  | "missing-rep-segment"
  | "invalid-fault-list"
  | "unknown-fault"
  | "candidate-has-faults"
  | "invalid-rep-metrics"
  | "invalid-rep-curve"
  | "unclean-rep"
  | "invalid-final-template";

export type FormCoachReferenceFailure = Readonly<{
  ok: false;
  code: FormCoachReferenceFailureCode;
  message: string;
  candidateId?: string;
}>;

export type BuildFormCoachReferenceResult =
  | Readonly<{
      ok: true;
      template: ExerciseTemplate;
      selectedCandidateIds: readonly string[];
      excludedCandidateIds: readonly string[];
    }>
  | FormCoachReferenceFailure;

function failure(
  code: FormCoachReferenceFailureCode,
  message: string,
  candidateId?: string,
): FormCoachReferenceFailure {
  return { ok: false, code, message, ...(candidateId === undefined ? {} : { candidateId }) };
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validateRepSegment(
  candidateId: string,
  input: unknown,
  extendedThreshold: number,
  allowLeadingBottomAnchor: boolean,
): FormCoachReferenceFailure | SegmentedCurlRep {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure("invalid-rep-metrics", "The selected candidate has no valid completed rep segment.", candidateId);
  }

  const rep = input as Record<string, unknown>;
  if (
    !isFiniteRange(rep.startMs, 0, Number.MAX_SAFE_INTEGER) ||
    !isFiniteRange(rep.endMs, 0, Number.MAX_SAFE_INTEGER) ||
    rep.endMs <= rep.startMs ||
    !isFiniteRange(rep.concentricMs, 1, 15_000) ||
    !isFiniteRange(rep.topPauseMs, 0, 15_000) ||
    !isFiniteRange(rep.eccentricMs, 1, 15_000) ||
    rep.concentricMs + rep.topPauseMs + rep.eccentricMs < 600 ||
    rep.concentricMs + rep.topPauseMs + rep.eccentricMs > 15_000 ||
    !isFiniteRange(rep.romMinAngle, 0, 180) ||
    !isFiniteRange(rep.romMaxAngle, 0, 180) ||
    rep.romMinAngle >= rep.romMaxAngle ||
    !isFiniteRange(rep.maxUpperArmDrift, 0, 180) ||
    !isFiniteRange(rep.maxTorsoSwing, 0, 180) ||
    !isFiniteRange(rep.maxShrug, 0, 1)
  ) {
    return failure("invalid-rep-metrics", "The selected candidate contains non-finite or out-of-range rep measurements.", candidateId);
  }

  if (!Array.isArray(rep.elbowCurve) || rep.elbowCurve.length < 2 || rep.elbowCurve.length > MAX_CURVE_POINTS) {
    return failure("invalid-rep-curve", `The selected candidate needs 2 to ${MAX_CURVE_POINTS} timed elbow-angle samples.`, candidateId);
  }

  const curve = rep.elbowCurve as unknown[];
  const firstPoint = curve[0];
  if (!firstPoint || typeof firstPoint !== "object" || Array.isArray(firstPoint)) {
    return failure("invalid-rep-curve", "The selected candidate contains a malformed elbow-curve sample.", candidateId);
  }
  const firstSample = firstPoint as Record<string, unknown>;
  const hasLeadingBottomAnchor =
    typeof firstSample.timestampMs === "number" &&
    Number.isFinite(firstSample.timestampMs) &&
    firstSample.timestampMs < rep.startMs;

  if (hasLeadingBottomAnchor) {
    const secondPoint = curve[1];
    if (
      !allowLeadingBottomAnchor ||
      !isFiniteRange(firstSample.timestampMs, 0, rep.startMs) ||
      firstSample.timestampMs >= rep.startMs ||
      !isFiniteRange(firstSample.angleDeg, 0, 180) ||
      firstSample.angleDeg <= extendedThreshold ||
      firstSample.angleDeg > rep.romMaxAngle ||
      !secondPoint ||
      typeof secondPoint !== "object" ||
      Array.isArray(secondPoint) ||
      (secondPoint as Record<string, unknown>).timestampMs !== rep.startMs
    ) {
      return failure(
        "invalid-rep-curve",
        "A single-arm curve may include one earlier extended-bottom anchor only when the next sample is exactly the rep start.",
        candidateId,
      );
    }
  } else if (firstSample.timestampMs !== rep.startMs) {
    return failure(
      "invalid-rep-curve",
      "The first elbow-curve sample must be the rep start, optionally preceded by one valid single-arm bottom anchor.",
      candidateId,
    );
  }

  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, point] of curve.entries()) {
    if (!point || typeof point !== "object" || Array.isArray(point)) {
      return failure("invalid-rep-curve", "The selected candidate contains a malformed elbow-curve sample.", candidateId);
    }
    const sample = point as Record<string, unknown>;
    const minimumTimestamp = hasLeadingBottomAnchor && index === 0 ? 0 : rep.startMs;
    if (
      !isFiniteRange(sample.timestampMs, minimumTimestamp, rep.endMs) ||
      sample.timestampMs <= previousTimestamp ||
      !isFiniteRange(sample.angleDeg, 0, 180) ||
      (hasLeadingBottomAnchor && index === 1 && sample.angleDeg >= extendedThreshold)
    ) {
      return failure(
        "invalid-rep-curve",
        "The selected candidate's curve must preserve the producer's start and optional bottom-anchor order with finite angles from 0 to 180 degrees.",
        candidateId,
      );
    }
    previousTimestamp = sample.timestampMs;
  }

  return input as SegmentedCurlRep;
}

function validateCandidate(
  template: ExerciseTemplate,
  candidate: FormCoachReferenceCandidate,
): FormCoachReferenceFailure | SegmentedCurlRep {
  if (candidate.status !== "complete") {
    if (candidate.status === "partial") {
      return failure("candidate-incomplete", "Partial repetitions cannot be used as reference samples.", candidate.id);
    }
    if (candidate.status === "occluded") {
      return failure("candidate-occluded", "Occluded repetitions cannot be used as reference samples.", candidate.id);
    }
    if (candidate.status === "missing_visibility") {
      return failure("candidate-missing-visibility", "A repetition with missing required visibility cannot be used as a reference sample.", candidate.id);
    }
    return failure("candidate-missing", "A missing repetition cannot be used as a reference sample.", candidate.id);
  }

  if (candidate.pairing === "unmatched_bilateral") {
    return failure("unmatched-bilateral-rep", "An unmatched arm cannot count as a bilateral reference repetition.", candidate.id);
  }
  const expectsBilateral = template.arm === "both";
  if ((expectsBilateral && candidate.pairing !== "matched_bilateral") || (!expectsBilateral && candidate.pairing !== "single_arm")) {
    return failure(
      "candidate-pairing-mismatch",
      expectsBilateral
        ? "A bilateral template needs one already synchronized logical rep from a matched pair."
        : "A single-arm template needs a single-arm logical rep.",
      candidate.id,
    );
  }

  if (!Array.isArray(candidate.faults)) {
    return failure("invalid-fault-list", "The selected candidate has no valid engine fault list.", candidate.id);
  }
  for (const fault of candidate.faults) {
    if (typeof fault !== "string" || !isExerciseFault(fault)) {
      return failure("unknown-fault", "The selected candidate contains an unknown form fault code.", candidate.id);
    }
  }
  if (candidate.faults.length > 0) {
    return failure("candidate-has-faults", "Only completed candidates with no form faults can be used as reference samples.", candidate.id);
  }
  if (candidate.rep === null) {
    return failure("missing-rep-segment", "The selected candidate is missing its completed engine segment.", candidate.id);
  }

  const rep = validateRepSegment(
    candidate.id,
    candidate.rep,
    PRODUCER_EXTENDED_THRESHOLD,
    candidate.pairing === "single_arm",
  );
  if ("ok" in rep) return rep;
  if (!isCleanReferenceRep(rep)) {
    return failure("unclean-rep", "The selected repetition falls outside the engine's existing clean-reference thresholds.", candidate.id);
  }
  return rep;
}

/**
 * Rebuilds a strict exercise template from the selected local clean-rep samples on each call.
 * The existing engine median/resampler is the sole phase/ROM/curve aggregator; this function
 * never pads, clamps, rewrites, or mutates candidate measurements.
 */
export function buildFormCoachReference(
  input: BuildFormCoachReferenceInput,
): BuildFormCoachReferenceResult {
  const parsedBase = safeParseExerciseTemplate(input.baseTemplate);
  if (!parsedBase.success) {
    return failure("invalid-template", "The base exercise template does not satisfy the existing strict template schema.");
  }
  if (!Array.isArray(input.candidates) || input.candidates.length > MAX_CANDIDATES) {
    return failure("too-many-candidates", `Reference building accepts at most ${MAX_CANDIDATES} candidate reps at a time.`);
  }
  if (!Array.isArray(input.selectedCandidateIds) || input.selectedCandidateIds.length < MIN_SELECTED_REPS || input.selectedCandidateIds.length > MAX_SELECTED_REPS) {
    return failure("invalid-selection-count", `Select ${MIN_SELECTED_REPS} to ${MAX_SELECTED_REPS} unique completed clean repetitions.`);
  }

  const candidateById = new Map<string, FormCoachReferenceCandidate>();
  for (const candidate of input.candidates) {
    if (!candidate || typeof candidate.id !== "string" || candidate.id.trim().length === 0 || candidate.id.length > 128) {
      return failure("invalid-candidate-id", "Every candidate needs a non-empty ID no longer than 128 characters.");
    }
    if (candidateById.has(candidate.id)) {
      return failure("duplicate-candidate-id", "Candidate IDs must be unique before selection.", candidate.id);
    }
    candidateById.set(candidate.id, candidate);
  }

  const selectedSet = new Set<string>();
  for (const id of input.selectedCandidateIds) {
    if (selectedSet.has(id)) return failure("duplicate-selection", "A repetition can only be selected once.", id);
    selectedSet.add(id);
    if (!candidateById.has(id)) return failure("candidate-not-found", "A selected repetition is no longer available; refresh the candidate list.", id);
  }

  const selectedReps: SegmentedCurlRep[] = [];
  for (const id of input.selectedCandidateIds) {
    const candidate = candidateById.get(id);
    if (!candidate) return failure("candidate-not-found", "A selected repetition is no longer available; refresh the candidate list.", id);
    const validated = validateCandidate(parsedBase.data, candidate);
    if ("ok" in validated) return validated;
    selectedReps.push(validated);
  }

  let aggregatedReference: ReturnType<typeof buildMedianReference>["reference"];
  try {
    aggregatedReference = buildMedianReference(selectedReps).reference;
  } catch {
    return failure("invalid-rep-curve", "The selected engine curves could not be resampled into a reference.");
  }

  const finalTemplate = safeParseExerciseTemplate({
    ...parsedBase.data,
    reference: {
      ...parsedBase.data.reference,
      ...aggregatedReference,
      elbowCurve: [...aggregatedReference.elbowCurve],
    },
  });
  if (!finalTemplate.success) {
    return failure("invalid-final-template", "The measured median reference does not satisfy the existing exercise template schema.");
  }

  const selectedCandidateIds = [...input.selectedCandidateIds];
  return {
    ok: true,
    template: finalTemplate.data,
    selectedCandidateIds,
    excludedCandidateIds: input.candidates.filter((candidate) => !selectedSet.has(candidate.id)).map((candidate) => candidate.id),
  };
}
