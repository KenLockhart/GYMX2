import { afterEach, describe, expect, it, vi } from "vitest";
import { CurlRepSegmenter } from "./engine/rep-segmentation";
import type { CurlFrameSample, SegmentedCurlRep } from "./engine/types";
import { BilateralRepPairer } from "./engine/bilateral-pairing";
import { ReferenceCaptureStore, MAX_REFERENCE_CAPTURE_CANDIDATES, MAX_REFERENCE_CAPTURE_CURVE_POINTS } from "./reference-capture-store";
import type { ExerciseTemplate } from "./template-schema";
import { installFormCoachPoseWorker } from "@/workers/form-coach-pose.worker";
import type { PoseWorkerDependencies } from "@/workers/form-coach-pose.worker";

function validTemplate(overrides: Partial<ExerciseTemplate> = {}): ExerciseTemplate {
  return {
    exerciseKey: "dumbbell_curl",
    schemaVersion: 1,
    cameraView: "side",
    arm: "right",
    segmentation: { metric: "elbowAngle", extendedThreshold: 150, flexedThreshold: 60 },
    reference: {
      romMinAngle: 45,
      romMaxAngle: 165,
      concentricMs: 900,
      topPauseMs: 200,
      eccentricMs: 1_000,
      elbowCurve: Array.from({ length: 50 }, (_, index) => 165 - (120 * index) / 49),
    },
    tolerances: { romTopDeg: 15, romBottomDeg: 15, upperArmDriftDeg: 15, torsoSwingDeg: 10, shrugRatio: 0.08, tempoPct: 35 },
    scoringWeights: { rom: 30, elbow: 25, torso: 20, tempo: 15, shoulders: 10 },
    strictness: "standard",
    cues: [{ key: "elbows_pinned", fault: "elbow_drift", text: "Keep elbows steady", priority: 1, minPersistMs: 300, cooldownMs: 2_000 }],
    breathing: { concentric: "exhale", eccentric: "inhale", fullCueReps: 3, thenEvery: 3 },
    ...overrides,
  };
}

function sample(timestampMs: number, elbowAngleDeg: number, drift = 0): CurlFrameSample {
  return { timestampMs, elbowAngleDeg, upperArmDriftDeg: drift, torsoSwingDeg: 1, shoulderShrugRatio: 0.01, confidence: 1 };
}

function produceActualReps(count: number, drift = 0): SegmentedCurlRep[] {
  const segmenter = new CurlRepSegmenter();
  const reps: SegmentedCurlRep[] = [];
  let bottomAtMs = 0;
  segmenter.push(sample(bottomAtMs, 160, drift));
  for (let index = 0; index < count; index += 1) {
    const offset = index * 2;
    const concentricMs = 377 + index * 9;
    const topPauseMs = 211 + index * 7;
    const eccentricMs = 389 + index * 11;
    const minAngle = 50 + offset;
    const startMs = bottomAtMs + 137;
    const topMs = startMs + concentricMs;
    const pauseMiddleMs = topMs + Math.floor(topPauseMs / 2);
    const firstEccentricMs = topMs + topPauseMs;
    const endMs = firstEccentricMs + eccentricMs;
    const firstRise = Math.max(70, minAngle + 18);
    const points = [
      sample(startMs, 140, drift),
      sample(startMs + Math.floor(concentricMs * 0.43), 105, drift),
      sample(topMs, minAngle, drift),
      sample(pauseMiddleMs, minAngle, drift),
      sample(firstEccentricMs, firstRise, drift),
      sample(firstEccentricMs + 83, firstRise + 9, drift),
      sample(endMs - 131, 120, drift),
      sample(endMs, 160, drift),
    ];
    for (const point of points) reps.push(...segmenter.push(point).completed);
    bottomAtMs = endMs;
  }
  expect(segmenter.result().rejected).toEqual([]);
  expect(reps).toHaveLength(count);
  return reps;
}

function produceLongActualRep(): SegmentedCurlRep {
  const segmenter = new CurlRepSegmenter({ maxSessionSamples: 10_000 });
  const completed: SegmentedCurlRep[] = [];
  const push = (at: number, angle: number) => completed.push(...segmenter.push(sample(at, angle)).completed);
  push(0, 160);
  push(2, 140);
  for (let index = 1; index <= 2_400; index += 1) push(2 + index * 2, 140 - (90 * index) / 2_400);
  const topAt = 4_802;
  for (let index = 1; index <= 500; index += 1) push(topAt + index * 2, 50);
  const eccentricAt = topAt + 1_000;
  for (let index = 1; index <= 2_100; index += 1) push(eccentricAt + index * 2, 50 + (110 * index) / 2_100);
  expect(completed).toHaveLength(1);
  return completed[0] as SegmentedCurlRep;
}

function context() {
  return { sessionEpoch: 9, exerciseKey: "dumbbell_curl", arm: "right" as const, cameraView: "side" as const, width: 640, height: 480 };
}

describe("Worker-local reference capture store", () => {
  it("recomputes a selected median from actual completed segmenter output without mutation", () => {
    const reps = produceActualReps(4);
    expect(reps.every((rep) => rep.elbowCurve[0]?.timestampMs < rep.startMs)).toBe(true);
    const original = structuredClone(reps);
    const base = validTemplate();
    const baseSnapshot = structuredClone(base);
    const store = new ReferenceCaptureStore(context(), base);
    const additions = reps.map((rep) => store.add(rep, "single_arm", "right"));
    expect(additions.every((value) => value.ok)).toBe(true);
    const summaries = store.listSummaries();
    expect(summaries.map((item) => item.id)).toEqual(["candidate-1", "candidate-2", "candidate-3", "candidate-4"]);
    expect(summaries.every((item) => item.selectable && item.arm === "right" && item.pairing === "single_arm")).toBe(true);
    const built = store.build(store.candidateGeneration, ["candidate-1", "candidate-3", "candidate-4"]);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.template.reference.elbowCurve).toHaveLength(50);
      expect(built.template.cues).toEqual(base.cues);
      expect(built.template.breathing).toEqual(base.breathing);
      expect(built.excludedCandidateIds).toEqual(["candidate-2"]);
    }
    expect(reps).toEqual(original);
    expect(base).toEqual(baseSnapshot);
    store.clear();
    expect(store.candidateCount).toBe(0);
    expect(store.build(store.candidateGeneration, ["candidate-1", "candidate-2", "candidate-3"]).ok).toBe(false);
  });

  it("retains a complete unclean rep as nonselectable and enforces actual arm pairing", () => {
    const [unclean] = produceActualReps(1, 22);
    const store = new ReferenceCaptureStore(context(), validTemplate());
    const added = store.add(unclean as SegmentedCurlRep, "single_arm", "right");
    expect(added.ok).toBe(true);
    expect(store.listSummaries()[0]).toMatchObject({ selectable: false, reason: "outside_clean_reference" });
    expect(store.add(produceActualReps(1)[0] as SegmentedCurlRep, "single_arm", null).ok).toBe(false);
    expect(store.add(produceActualReps(1)[0] as SegmentedCurlRep, "matched_bilateral", "left").ok).toBe(false);
  });

  it("accepts only actual pairer output as one bilateral logical candidate", () => {
    const [left] = produceActualReps(1);
    const [right] = produceActualReps(1);
    const pairer = new BilateralRepPairer();
    expect(pairer.push("left", left as SegmentedCurlRep, left?.endMs ?? 0).pair).toBeUndefined();
    const matched = pairer.push("right", right as SegmentedCurlRep, right?.endMs ?? 0).pair;
    expect(matched).toBeDefined();
    if (!matched) throw new Error("Test setup failed to produce a real paired rep.");
    const store = new ReferenceCaptureStore({ ...context(), arm: "both" }, validTemplate({ arm: "both" }));
    const merged = { ...matched.left, elbowCurve: matched.left.elbowCurve };
    const added = store.add(merged, "matched_bilateral", null);
    expect(added.ok).toBe(true);
    expect(store.listSummaries()).toHaveLength(1);
    expect(store.listSummaries()[0]?.pairing).toBe("matched_bilateral");
    expect(store.add(left as SegmentedCurlRep, "matched_bilateral", null).ok).toBe(true);
  });

  it("halts at the candidate cap without adding or trimming a 101st candidate", () => {
    const [rep] = produceActualReps(1);
    const store = new ReferenceCaptureStore(context(), validTemplate());
    let finalResult;
    for (let index = 0; index < MAX_REFERENCE_CAPTURE_CANDIDATES; index += 1) finalResult = store.add(rep as SegmentedCurlRep, "single_arm", "right");
    expect(finalResult).toMatchObject({ ok: true, pauseReason: "candidate_cap", generation: MAX_REFERENCE_CAPTURE_CANDIDATES });
    expect(store.add(rep as SegmentedCurlRep, "single_arm", "right")).toMatchObject({ ok: false, pauseReason: "candidate_cap" });
    expect(store.candidateCount).toBe(MAX_REFERENCE_CAPTURE_CANDIDATES);
  });

  it("enforces the aggregate curve-point cap using genuine long segmenter output", () => {
    const rep = produceLongActualRep();
    expect(rep.elbowCurve.length).toBeGreaterThan(4_700);
    const store = new ReferenceCaptureStore(context(), validTemplate());
    let accepted = 0;
    let result;
    while (accepted < 10) {
      result = store.add(rep, "single_arm", "right");
      if (!result.ok) break;
      accepted += 1;
      if (result.pauseReason) break;
    }
    expect(accepted).toBeLessThanOrEqual(Math.floor(MAX_REFERENCE_CAPTURE_CURVE_POINTS / rep.elbowCurve.length));
    expect(store.curvePointCount).toBeLessThanOrEqual(MAX_REFERENCE_CAPTURE_CURVE_POINTS);
    expect(result?.ok === false ? result.pauseReason : result?.pauseReason).toBe("curve_point_cap");
  });
});

class TestBitmap {
  closed = false;
  constructor(readonly width: number, readonly height: number) {}
  close() { this.closed = true; }
}

class TestPerformanceObserver {
  constructor(private readonly callback: (list: { getEntries(): PerformanceEntry[] }) => void) {}
  observe() {}
  disconnect() {}
  takeRecords() { return []; }
}

afterEach(() => vi.unstubAllGlobals());

describe("actual Form Coach Worker handler capture protocol", () => {
  it("validates the full template, pauses after processed frames, and posts no raw candidate data", async () => {
    vi.stubGlobal("OffscreenCanvas", class MockOffscreenCanvas {});
    vi.stubGlobal("ImageBitmap", TestBitmap);
    vi.stubGlobal("PerformanceObserver", TestPerformanceObserver);
    const posted: Array<Record<string, unknown>> = [];
    let listener: ((event: MessageEvent<unknown>) => void) | null = null;
    const scope = {
      location: { origin: "https://worker.test" },
      postMessage(message: unknown) { posted.push(message as Record<string, unknown>); },
      addEventListener(_type: "message", handler: (event: MessageEvent<unknown>) => void) { listener = handler; },
      removeEventListener() { listener = null; },
    } as unknown as DedicatedWorkerGlobalScope;
    const [rep] = produceActualReps(1);
    const adapterFactory = vi.fn((options: { onReferenceCandidate?: (candidate: { rep: SegmentedCurlRep; pairing: "single_arm"; arm: "right" }) => void }) => ({
      process() {
        options.onReferenceCandidate?.({ rep: rep as SegmentedCurlRep, pairing: "single_arm", arm: "right" });
        return { overlay: [], setupStep: "ready" as const, cues: [], setBoundary: false };
      },
      getSetupStep: () => "ready" as const,
      getCleanReferenceCount: () => 0,
      getSetSampleLimit: () => 30_000,
    }));
    const detector = { detectForVideo: vi.fn(() => ({ landmarks: [[]], segmentationMasks: [] })), close: vi.fn() };
    const loader = {
      start: vi.fn(async () => ({ status: "ready" as const, detector, delegate: "CPU" as const })),
      stop: vi.fn(async () => undefined),
    };
    const dependencies: PoseWorkerDependencies = {
      createDetectorLoader: vi.fn(() => loader as never) as never,
      createPoseSessionAdapter: adapterFactory as never,
    };
    const uninstall = installFormCoachPoseWorker(scope, dependencies);
    const emit = (value: unknown) => listener?.({ data: value } as MessageEvent<unknown>);
    const template = validTemplate();
    const templateSnapshot = structuredClone(template);
    const initTemplate = structuredClone(template);
    const init = {
      version: 1, type: "init", sessionEpoch: 17, model: "lite", mode: "reference", arm: "right", cameraView: "side",
      referenceRepTarget: 3, forceCpu: true, gpuCanvas: null, referenceSelection: initTemplate,
    };
    emit(init);
    (initTemplate.cues[0] as { text: string }).text = "mutated after init dispatch";
    await vi.waitFor(() => expect(posted.some((message) => message.type === "ready")).toBe(true));
    expect(adapterFactory).toHaveBeenCalledOnce();
    expect(template.reference.elbowCurve).toHaveLength(50);

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      emit({
        version: 1, type: "frame", sessionEpoch: 17, sequence, captureTimestampMs: sequence * 100,
        width: 640, height: 480, droppedFramesSincePrevious: 0, frame: new TestBitmap(640, 480),
      });
      await vi.waitFor(() => expect(posted.filter((message) => message.type === "processed")).toHaveLength(sequence));
    }
    const candidateEvents = posted.filter((message) => message.type === "reference-candidate");
    expect(candidateEvents).toHaveLength(3);
    for (const event of candidateEvents) {
      expect(JSON.stringify(event)).not.toMatch(/elbowCurve|landmarks|frame|video|source/i);
    }
    expect(posted.some((message) => message.type === "overlay")).toBe(false);
    expect(posted.some((message) => message.type === "reference-ready")).toBe(false);

    emit({ version: 1, type: "reference-build", sessionEpoch: 17, requestId: 1, candidateGeneration: 3, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"] });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "reference-build-rejected" && message.code === "not-paused")).toBe(true));
    expect(posted.find((message) => message.type === "reference-build-rejected")).toMatchObject({
      sessionEpoch: 17, requestId: 1, candidateGeneration: 3, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"], code: "not-paused",
    });

    emit({ version: 1, type: "reference-capture-pause", sessionEpoch: 17, requestId: 1, lastProcessedSequence: 3, reason: "user_pause" });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "reference-capture-paused")).toBe(true));
    const paused = posted.find((message) => message.type === "reference-capture-paused");
    expect(paused).toMatchObject({ sessionEpoch: 17, requestId: 1, lastProcessedSequence: 3, candidateGeneration: 3, reason: "user_pause" });

    emit({ version: 1, type: "reference-build", sessionEpoch: 17, requestId: 2, candidateGeneration: 3, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"] });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "reference-built")).toBe(true));
    const built = posted.find((message) => message.type === "reference-built");
    expect(built).toMatchObject({ candidateGeneration: 3, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"] });
    expect((built?.template as ExerciseTemplate).cues).toEqual(template.cues);
    expect((built?.template as ExerciseTemplate).breathing).toEqual(template.breathing);
    expect(template).toEqual(templateSnapshot);
    expect(JSON.stringify(built)).not.toMatch(/landmarks|frame|source/i);
    emit({ version: 1, type: "reference-build", sessionEpoch: 17, requestId: 3, candidateGeneration: 3, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"] });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "reference-build-rejected" && message.code === "already-built")).toBe(true));
    const exactKeysByType: Record<string, string[]> = {
      ready: ["version", "type", "sessionEpoch", "model", "delegate"],
      setup: ["version", "type", "sessionEpoch", "step"],
      processed: ["version", "type", "sessionEpoch", "sequence", "captureTimestampMs"],
      "reference-candidate": ["version", "type", "sessionEpoch", "candidateGeneration", "candidate"],
      "reference-build-rejected": ["version", "type", "sessionEpoch", "requestId", "candidateGeneration", "selectedCandidateIds", "code"],
      "reference-capture-paused": ["version", "type", "sessionEpoch", "requestId", "lastProcessedSequence", "candidateGeneration", "reason"],
      "reference-built": ["version", "type", "sessionEpoch", "requestId", "candidateGeneration", "selectedCandidateIds", "template"],
      "network-audit": ["version", "type", "sessionEpoch", "allowedAssetGets", "allowed", "blocked", "observed"],
      stopped: ["version", "type", "sessionEpoch"],
    };
    for (const message of posted) {
      const expected = exactKeysByType[String(message.type)];
      expect(expected, `unexpected worker post type ${String(message.type)}`).toBeDefined();
      if (expected) expect(Object.keys(message).sort()).toEqual([...expected].sort());
    }
    emit({ version: 1, type: "stop", sessionEpoch: 17 });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "stopped")).toBe(true));
    uninstall();

    const rejectInit = async (invalidInit: unknown, expectedEpoch: number) => {
      const invalidPosted: Array<Record<string, unknown>> = [];
      let invalidHandler: ((event: MessageEvent<unknown>) => void) | null = null;
      const invalidScope = {
        location: { origin: "https://worker.test" },
        postMessage(message: unknown) { invalidPosted.push(message as Record<string, unknown>); },
        addEventListener(_type: "message", handler: (event: MessageEvent<unknown>) => void) { invalidHandler = handler; },
        removeEventListener() { invalidHandler = null; },
      } as unknown as DedicatedWorkerGlobalScope;
      const uninstallInvalid = installFormCoachPoseWorker(invalidScope, dependencies);
      const overrides = invalidInit as Record<string, unknown>;
      const sendInvalid = invalidHandler as unknown as (event: MessageEvent<unknown>) => void;
      sendInvalid({ data: { ...init, sessionEpoch: expectedEpoch, ...overrides } } as MessageEvent<unknown>);
      await vi.waitFor(() => expect(invalidPosted.some((message) => message.type === "error")).toBe(true));
      expect(invalidPosted.some((message) => message.type === "ready")).toBe(false);
      uninstallInvalid();
    };
    await rejectInit({ referenceSelection: { ...template, exerciseKey: "unsupported_curl" } }, 18);
    await rejectInit({ unexpected: "key" }, 19);
  });
});
