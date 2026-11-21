import { describe, expect, it } from "vitest";
import { CurlRepSegmenter } from "./engine/rep-segmentation";
import type { CurlFrameSample, SegmentedCurlRep } from "./engine/types";
import { buildFormCoachReference, type BuildFormCoachReferenceInput, type FormCoachReferenceCandidate } from "./reference-builder";
import type { ExerciseTemplate } from "./template-schema";

function validTemplate(overrides: Partial<ExerciseTemplate> = {}): ExerciseTemplate {
  return {
    exerciseKey: "dumbbell_curl",
    schemaVersion: 1,
    cameraView: "side",
    arm: "auto",
    segmentation: { metric: "elbowAngle", extendedThreshold: 150, flexedThreshold: 60 },
    reference: {
      romMinAngle: 40,
      romMaxAngle: 165,
      concentricMs: 2_000,
      topPauseMs: 500,
      eccentricMs: 3_000,
      elbowCurve: Array.from({ length: 50 }, (_, index) => 165 - index * 2.5),
    },
    tolerances: {
      romTopDeg: 15,
      romBottomDeg: 15,
      upperArmDriftDeg: 15,
      torsoSwingDeg: 10,
      shrugRatio: 0.08,
      tempoPct: 35,
    },
    scoringWeights: { rom: 30, elbow: 25, torso: 20, tempo: 15, shoulders: 10 },
    strictness: "standard",
    cues: [{ key: "elbows_pinned", fault: "elbow_drift", text: "Pin your elbows", priority: 1, minPersistMs: 300, cooldownMs: 4_000 }],
    breathing: { concentric: "exhale", eccentric: "inhale", fullCueReps: 3, thenEvery: 3 },
    ...overrides,
  };
}

function makeRep(offset: number, timing: Partial<Pick<SegmentedCurlRep, "concentricMs" | "topPauseMs" | "eccentricMs">> = {}): SegmentedCurlRep {
  const concentricMs = timing.concentricMs ?? 700 + offset;
  const topPauseMs = timing.topPauseMs ?? 200 + offset;
  const eccentricMs = timing.eccentricMs ?? 1_100 + offset;
  const startMs = 1_000;
  const endMs = startMs + concentricMs + topPauseMs + eccentricMs;
  const romMinAngle = 50 + offset;
  const romMaxAngle = 170 - offset;
  const elbowCurve = Array.from({ length: 50 }, (_, index) => {
    const value = index <= 24
      ? romMaxAngle - ((romMaxAngle - romMinAngle) * index) / 24
      : romMinAngle + ((romMaxAngle - romMinAngle) * (index - 24)) / 25;
    return { timestampMs: startMs + ((endMs - startMs) * index) / 49, angleDeg: value };
  });
  return {
    startMs,
    endMs,
    concentricMs,
    topPauseMs,
    eccentricMs,
    romMinAngle,
    romMaxAngle,
    maxUpperArmDrift: 5,
    maxTorsoSwing: 2,
    maxShrug: 0.02,
    elbowCurve,
  };
}

function candidate(
  id: string,
  offset: number,
  overrides: Partial<FormCoachReferenceCandidate> = {},
): FormCoachReferenceCandidate {
  return {
    id,
    status: "complete",
    pairing: "single_arm",
    rep: makeRep(offset),
    faults: [],
    ...overrides,
  };
}

function input(
  offsets: readonly number[],
  selectedIndexes: readonly number[] = offsets.map((_, index) => index),
): BuildFormCoachReferenceInput {
  const candidates = offsets.map((offset, index) => candidate(`rep-${index + 1}`, offset));
  return {
    baseTemplate: validTemplate(),
    candidates,
    selectedCandidateIds: selectedIndexes.map((index) => candidates[index].id),
  };
}

function curlSample(timestampMs: number, elbowAngleDeg: number): CurlFrameSample {
  return {
    timestampMs,
    elbowAngleDeg,
    upperArmDriftDeg: 0,
    torsoSwingDeg: 0,
    shoulderShrugRatio: 0,
    confidence: 1,
  };
}

function produceActualCleanReferenceReps(): SegmentedCurlRep[] {
  const segmenter = new CurlRepSegmenter();
  const completed: SegmentedCurlRep[] = [];
  let bottomAtMs = 0;
  segmenter.push(curlSample(bottomAtMs, 160));

  const timings = [
    { delayMs: 137, concentricMs: 377, topPauseMs: 211, eccentricMs: 389, romMinAngle: 50 },
    { delayMs: 143, concentricMs: 431, topPauseMs: 233, eccentricMs: 407, romMinAngle: 54 },
    { delayMs: 127, concentricMs: 389, topPauseMs: 197, eccentricMs: 421, romMinAngle: 58 },
  ] as const;

  const push = (timestampMs: number, angle: number) => {
    completed.push(...segmenter.push(curlSample(timestampMs, angle)).completed);
  };

  for (const timing of timings) {
    const startMs = bottomAtMs + timing.delayMs;
    const topAtMs = startMs + timing.concentricMs;
    const pauseMidpointMs = topAtMs + Math.floor(timing.topPauseMs / 2);
    const firstEccentricMs = topAtMs + timing.topPauseMs;
    const endMs = firstEccentricMs + timing.eccentricMs;
    const firstRisingAngle = Math.max(70, timing.romMinAngle + 18);

    push(startMs, 140);
    push(startMs + Math.floor(timing.concentricMs * 0.43), 105);
    push(topAtMs, timing.romMinAngle);
    push(pauseMidpointMs, timing.romMinAngle);
    push(firstEccentricMs, firstRisingAngle);
    push(firstEccentricMs + 83, firstRisingAngle + 9);
    push(endMs - 131, 120);
    push(endMs, 160);
    bottomAtMs = endMs;
  }

  const result = segmenter.result();
  expect(result.rejected).toEqual([]);
  expect(completed).toHaveLength(3);
  return completed;
}

function expectFailure(
  result: ReturnType<typeof buildFormCoachReference>,
  code: string,
) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(code);
}

describe("Form Coach reference builder", () => {
  it.each([
    { count: 3, medianOffset: 2 },
    { count: 4, medianOffset: 3 },
    { count: 5, medianOffset: 4 },
  ])("uses the existing per-field and per-curve median for $count selected reps", ({ count, medianOffset }) => {
    const result = buildFormCoachReference(input([0, 2, 4, 6, 8].slice(0, count)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.reference).toMatchObject({
      romMinAngle: 50 + medianOffset,
      romMaxAngle: 170 - medianOffset,
      concentricMs: 700 + medianOffset,
      topPauseMs: 200 + medianOffset,
      eccentricMs: 1_100 + medianOffset,
    });
    expect(result.template.reference.elbowCurve).toHaveLength(50);
    expect(result.template.reference.elbowCurve[0]).toBe(170 - medianOffset);
    expect(result.template.reference.elbowCurve[24]).toBe(50 + medianOffset);
    expect(result.template.reference.elbowCurve[49]).toBe(170 - medianOffset);
  });

  it("recomputes every reference target after excluding a clean outlier", () => {
    const candidates = [0, 2, 4, 20].map((offset, index) => candidate(`rep-${index + 1}`, offset));
    const base = validTemplate();
    const first = buildFormCoachReference({
      baseTemplate: base,
      candidates,
      selectedCandidateIds: ["rep-1", "rep-2", "rep-3"],
    });
    const afterExclusion = buildFormCoachReference({
      baseTemplate: base,
      candidates,
      selectedCandidateIds: ["rep-2", "rep-3", "rep-4"],
    });
    expect(first.ok && first.excludedCandidateIds).toEqual(["rep-4"]);
    expect(afterExclusion.ok && afterExclusion.excludedCandidateIds).toEqual(["rep-1"]);
    if (!first.ok || !afterExclusion.ok) return;

    expect(first.template.reference).toMatchObject({ romMinAngle: 52, romMaxAngle: 168, concentricMs: 702, topPauseMs: 202, eccentricMs: 1_102 });
    expect(afterExclusion.template.reference).toMatchObject({ romMinAngle: 54, romMaxAngle: 166, concentricMs: 704, topPauseMs: 204, eccentricMs: 1_104 });
    expect(first.template.reference.elbowCurve[0]).toBe(168);
    expect(first.template.reference.elbowCurve[24]).toBe(52);
    expect(afterExclusion.template.reference.elbowCurve[0]).toBe(166);
    expect(afterExclusion.template.reference.elbowCurve[24]).toBe(54);
  });

  it("builds a median from genuine segmenter reps with one preserved leading bottom anchor", () => {
    const reps = produceActualCleanReferenceReps();
    for (const rep of reps) {
      expect(rep.elbowCurve[0].timestampMs).toBeLessThan(rep.startMs);
      expect(rep.elbowCurve[0].angleDeg).toBeGreaterThan(150);
      expect(rep.elbowCurve[1].timestampMs).toBe(rep.startMs);
      expect(new Set(rep.elbowCurve.slice(1).map((point, index, points) =>
        point.timestampMs - (index === 0 ? rep.elbowCurve[0].timestampMs : points[index - 1].timestampMs),
      )).size).toBeGreaterThan(1);
    }

    const candidates = reps.map((rep, index) => candidate(`engine-rep-${index + 1}`, index * 2, { rep }));
    const originalCandidates = structuredClone(candidates);
    const result = buildFormCoachReference({
      baseTemplate: validTemplate(),
      candidates,
      selectedCandidateIds: candidates.map(({ id }) => id),
    });

    expect(result.ok).toBe(true);
    expect(candidates).toEqual(originalCandidates);
    if (!result.ok) return;
    expect(result.template.reference).toMatchObject({
      romMinAngle: 54,
      romMaxAngle: 160,
      concentricMs: 389,
      topPauseMs: 211,
      eccentricMs: 407,
    });
    expect(result.template.reference.elbowCurve).toHaveLength(50);
    expect(result.template.reference.elbowCurve[0]).toBe(160);
  });

  it.each([140, 160])("validates genuine engine anchors against the producer threshold with template threshold %i", (templateThreshold) => {
    const reps = produceActualCleanReferenceReps();
    expect(reps.map((rep) => [rep.elbowCurve[0].angleDeg, rep.elbowCurve[1].angleDeg])).toEqual([
      [160, 140],
      [160, 140],
      [160, 140],
    ]);
    const candidates = reps.map((rep, index) => candidate(`threshold-${templateThreshold}-${index + 1}`, index * 2, { rep }));
    const originalCandidates = structuredClone(candidates);
    const baseTemplate = validTemplate({
      segmentation: { metric: "elbowAngle", extendedThreshold: templateThreshold, flexedThreshold: 60 },
    });
    const originalSegmentation = structuredClone(baseTemplate.segmentation);
    const result = buildFormCoachReference({
      baseTemplate,
      candidates,
      selectedCandidateIds: candidates.map(({ id }) => id),
    });

    expect(result.ok).toBe(true);
    expect(candidates).toEqual(originalCandidates);
    expect(baseTemplate.segmentation).toEqual(originalSegmentation);
    if (!result.ok) return;
    expect(result.template.segmentation).toEqual(originalSegmentation);
  });

  it("does not mutate or replace unrelated template settings", () => {
    const base = validTemplate();
    const before = structuredClone(base);
    const result = buildFormCoachReference({
      baseTemplate: base,
      candidates: [candidate("a", 0), candidate("b", 2), candidate("c", 4)],
      selectedCandidateIds: ["a", "b", "c"],
    });
    expect(result.ok).toBe(true);
    expect(base).toEqual(before);
    if (!result.ok) return;
    expect(result.template).not.toBe(base);
    expect(result.template.reference.elbowCurve).not.toBe(base.reference.elbowCurve);
    expect(result.template.segmentation).toEqual(base.segmentation);
    expect(result.template.tolerances).toEqual(base.tolerances);
    expect(result.template.scoringWeights).toEqual(base.scoringWeights);
    expect(result.template.cues).toEqual(base.cues);
    expect(result.template.breathing).toEqual(base.breathing);
  });

  it("rejects fewer or more than three-to-five unique selected IDs", () => {
    expectFailure(buildFormCoachReference(input([0, 2, 4], [0, 1])), "invalid-selection-count");
    expectFailure(buildFormCoachReference(input([0, 2, 4, 6, 8, 10])), "invalid-selection-count");
    expectFailure(buildFormCoachReference({ ...input([0, 2, 4]), selectedCandidateIds: ["rep-1", "rep-1", "rep-3"] }), "duplicate-selection");
    expectFailure(buildFormCoachReference({ ...input([0, 2, 4]), selectedCandidateIds: ["rep-1", "rep-2", "missing"] }), "candidate-not-found");
    expectFailure(buildFormCoachReference({ ...input([0, 2, 4]), candidates: [candidate("rep-1", 0), candidate("rep-1", 2), candidate("rep-3", 4)] }), "duplicate-candidate-id");
  });

  it("bounds the candidate list before doing selection work", () => {
    const candidates = Array.from({ length: 101 }, (_, index) => candidate(`rep-${index}`, 0));
    const result = buildFormCoachReference({
      baseTemplate: validTemplate(),
      candidates,
      selectedCandidateIds: ["rep-0", "rep-1", "rep-2"],
    });
    expectFailure(result, "too-many-candidates");
  });

  it.each([
    { status: "partial" as const, code: "candidate-incomplete" },
    { status: "occluded" as const, code: "candidate-occluded" },
    { status: "missing_visibility" as const, code: "candidate-missing-visibility" },
    { status: "missing" as const, code: "candidate-missing" },
  ])("rejects selected $status candidates", ({ status, code }) => {
    const result = buildFormCoachReference({
      baseTemplate: validTemplate(),
      candidates: [candidate("a", 0, { status }), candidate("b", 2), candidate("c", 4)],
      selectedCandidateIds: ["a", "b", "c"],
    });
    expectFailure(result, code);
  });

  it("rejects missing segments, known form faults, unknown fault codes, and unclean metrics", () => {
    const clean = [candidate("a", 0), candidate("b", 2), candidate("c", 4)];
    expectFailure(buildFormCoachReference({
      baseTemplate: validTemplate(),
      candidates: [{ ...clean[0], rep: null }, clean[1], clean[2]],
      selectedCandidateIds: ["a", "b", "c"],
    }), "missing-rep-segment");
    expectFailure(buildFormCoachReference({
      baseTemplate: validTemplate(),
      candidates: [{ ...clean[0], faults: ["elbow_drift"] }, clean[1], clean[2]],
      selectedCandidateIds: ["a", "b", "c"],
    }), "candidate-has-faults");
    expectFailure(buildFormCoachReference({
      baseTemplate: validTemplate(),
      candidates: [{ ...clean[0], faults: ["other_fault"] }, clean[1], clean[2]],
      selectedCandidateIds: ["a", "b", "c"],
    }), "unknown-fault");
    const unclean = makeRep(0);
    const badCleanMetric = { ...unclean, maxTorsoSwing: 50 };
    expectFailure(buildFormCoachReference({
      baseTemplate: validTemplate(),
      candidates: [{ ...clean[0], rep: badCleanMetric }, clean[1], clean[2]],
      selectedCandidateIds: ["a", "b", "c"],
    }), "unclean-rep");
  });

  it("rejects non-finite/out-of-range metrics and malformed, non-finite, or unordered curves", () => {
    const makeInput = (rep: SegmentedCurlRep) => ({
      baseTemplate: validTemplate(),
      candidates: [candidate("a", 0, { rep }), candidate("b", 2), candidate("c", 4)],
      selectedCandidateIds: ["a", "b", "c"],
    });
    const baseRep = makeRep(0);
    expectFailure(buildFormCoachReference(makeInput({ ...baseRep, romMaxAngle: Number.NaN })), "invalid-rep-metrics");
    expectFailure(buildFormCoachReference(makeInput({ ...baseRep, maxShrug: 2 })), "invalid-rep-metrics");
    expectFailure(buildFormCoachReference(makeInput({ ...baseRep, concentricMs: 0 })), "invalid-rep-metrics");
    expectFailure(buildFormCoachReference(makeInput({ ...baseRep, elbowCurve: [] })), "invalid-rep-curve");
    expectFailure(buildFormCoachReference(makeInput({
      ...baseRep,
      elbowCurve: [{ timestampMs: 1_000, angleDeg: Number.NaN }, ...baseRep.elbowCurve.slice(1)],
    })), "invalid-rep-curve");
    expectFailure(buildFormCoachReference(makeInput({
      ...baseRep,
      elbowCurve: [{ timestampMs: 1_000, angleDeg: 170 }, { timestampMs: 2_000, angleDeg: 181 }],
    })), "invalid-rep-curve");
    expectFailure(buildFormCoachReference(makeInput({
      ...baseRep,
      elbowCurve: [{ timestampMs: 1_000, angleDeg: 170 }, { timestampMs: 1_000, angleDeg: 50 }],
    })), "invalid-rep-curve");

    const validBottomAnchor = { timestampMs: 990, angleDeg: 160 };
    expectFailure(buildFormCoachReference(makeInput({
      ...baseRep,
      elbowCurve: [validBottomAnchor, { timestampMs: 995, angleDeg: 160 }, ...baseRep.elbowCurve],
    })), "invalid-rep-curve");
    expectFailure(buildFormCoachReference(makeInput({
      ...baseRep,
      elbowCurve: [{ ...validBottomAnchor, angleDeg: 150 }, ...baseRep.elbowCurve],
    })), "invalid-rep-curve");
    expectFailure(buildFormCoachReference(makeInput({
      ...baseRep,
      elbowCurve: [{ ...validBottomAnchor, angleDeg: 171 }, ...baseRep.elbowCurve],
    })), "invalid-rep-curve");
    expectFailure(buildFormCoachReference(makeInput({
      ...baseRep,
      elbowCurve: [validBottomAnchor, baseRep.elbowCurve[0], baseRep.elbowCurve[2], baseRep.elbowCurve[1], ...baseRep.elbowCurve.slice(3)],
    })), "invalid-rep-curve");
  });

  it("requires an already matched logical rep for bilateral templates", () => {
    const base = validTemplate({ arm: "both" });
    const matched = [
      candidate("a", 0, { pairing: "matched_bilateral" }),
      candidate("b", 2, { pairing: "matched_bilateral" }),
      candidate("c", 4, { pairing: "matched_bilateral" }),
    ];
    expect(buildFormCoachReference({ baseTemplate: base, candidates: matched, selectedCandidateIds: ["a", "b", "c"] }).ok).toBe(true);
    expectFailure(buildFormCoachReference({
      baseTemplate: base,
      candidates: [{ ...matched[0], pairing: "unmatched_bilateral" }, matched[1], matched[2]],
      selectedCandidateIds: ["a", "b", "c"],
    }), "unmatched-bilateral-rep");
    expectFailure(buildFormCoachReference({
      baseTemplate: base,
      candidates: [candidate("a", 0), matched[1], matched[2]],
      selectedCandidateIds: ["a", "b", "c"],
    }), "candidate-pairing-mismatch");

    const matchedRep = makeRep(0);
    expectFailure(buildFormCoachReference({
      baseTemplate: base,
      candidates: [
        { ...matched[0], rep: { ...matchedRep, elbowCurve: [{ timestampMs: 990, angleDeg: 160 }, ...matchedRep.elbowCurve] } },
        matched[1],
        matched[2],
      ],
      selectedCandidateIds: ["a", "b", "c"],
    }), "invalid-rep-curve");
  });

  it("keeps a measured 80 ms sample when the selected median meets reference bounds", () => {
    const candidates = [
      candidate("fast", 0, { rep: makeRep(0, { concentricMs: 80 }) }),
      candidate("normal-1", 2, { rep: makeRep(2, { concentricMs: 110 }) }),
      candidate("normal-2", 4, { rep: makeRep(4, { concentricMs: 120 }) }),
    ];
    const result = buildFormCoachReference({
      baseTemplate: validTemplate(),
      candidates,
      selectedCandidateIds: ["fast", "normal-1", "normal-2"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.reference.concentricMs).toBe(110);
    expect(candidates[0].rep?.concentricMs).toBe(80);
  });

  it("does not clamp or pad a median 80 ms reference phase to the schema minimum", () => {
    const candidates = [
      candidate("fast-1", 0, { rep: makeRep(0, { concentricMs: 80, topPauseMs: 0 }) }),
      candidate("fast-2", 2, { rep: makeRep(2, { concentricMs: 80, topPauseMs: 0 }) }),
      candidate("normal", 4, { rep: makeRep(4, { concentricMs: 120, topPauseMs: 0 }) }),
    ];
    expectFailure(buildFormCoachReference({
      baseTemplate: validTemplate(),
      candidates,
      selectedCandidateIds: ["fast-1", "fast-2", "normal"],
    }), "invalid-final-template");
  });

  it("returns a typed failure if the base or resulting template violates the strict schema", () => {
    const invalidBase = { ...validTemplate(), arm: "sideways" } as unknown as ExerciseTemplate;
    expectFailure(buildFormCoachReference({ ...input([0, 2, 4]), baseTemplate: invalidBase }), "invalid-template");
  });
});
