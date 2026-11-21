import { afterEach, describe, expect, it, vi } from "vitest";
import { startFormCoachProcessing, startFormCoachReferenceCapture } from "./browser-runtime";
import type { ExerciseTemplate } from "./template-schema";
import { installFormCoachPoseWorker } from "@/workers/form-coach-pose.worker";
import type { PoseWorkerDependencies } from "@/workers/form-coach-pose.worker";

type RuntimeWorkerMessage = Record<string, unknown>;

class MockWorker {
  static latest: MockWorker | null = null;
  static holdFrames = false;
  static holdBuilds = false;
  static rejectBuildWith: string | null = null;
  static throwForType: string | null = null;
  readonly listeners = new Map<string, Set<(event: { data: unknown }) => void>>();
  readonly posted: RuntimeWorkerMessage[] = [];
  readonly received: RuntimeWorkerMessage[] = [];
  terminated = false;
  private baseTemplate: ExerciseTemplate | null = null;
  private candidateGeneration = 0;
  private requiredPauseReason: string | null = null;
  private requiredPauseSequence: number | null = null;

  constructor() {
    MockWorker.latest = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const wrapped = (event: { data: unknown }) => {
      if (typeof listener === "function") listener(event as MessageEvent);
      else listener.handleEvent(event as MessageEvent);
    };
    const entries = this.listeners.get(type) ?? new Set();
    entries.add(wrapped);
    this.listeners.set(type, entries);
  }

  removeEventListener(): void {}

  postMessage(message: unknown): void {
    const data = message as RuntimeWorkerMessage;
    if (data.type === MockWorker.throwForType) throw new Error("private browser transport detail");
    this.posted.push(data);
    if (data.type === "init") {
      this.baseTemplate = (data.referenceSelection as ExerciseTemplate | undefined) ?? null;
      queueMicrotask(() => this.emit({
        version: 1,
        type: "ready",
        sessionEpoch: data.sessionEpoch,
        model: data.model,
        delegate: "CPU",
      }));
    } else if (data.type === "stop") {
      queueMicrotask(() => this.emit({ version: 1, type: "stopped", sessionEpoch: data.sessionEpoch }));
    } else if (data.type === "frame" && !MockWorker.holdFrames) {
      queueMicrotask(() => this.emit({ version: 1, type: "processed", sessionEpoch: data.sessionEpoch, sequence: data.sequence, captureTimestampMs: data.captureTimestampMs }));
    } else if (data.type === "reference-capture-pause") {
      if ((this.requiredPauseReason !== null && data.reason !== this.requiredPauseReason) ||
          (this.requiredPauseSequence !== null && data.lastProcessedSequence !== this.requiredPauseSequence)) return;
      queueMicrotask(() => this.emit({
        version: 1,
        type: "reference-capture-paused",
        sessionEpoch: data.sessionEpoch,
        requestId: data.requestId,
        lastProcessedSequence: data.lastProcessedSequence,
        candidateGeneration: this.candidateGeneration,
        reason: data.reason,
      }));
      this.requiredPauseReason = null;
      this.requiredPauseSequence = null;
    } else if (data.type === "reference-build" && !MockWorker.holdBuilds) {
      const rejectCode = MockWorker.rejectBuildWith;
      MockWorker.rejectBuildWith = null;
      queueMicrotask(() => this.emit(rejectCode
        ? {
            version: 1, type: "reference-build-rejected", sessionEpoch: data.sessionEpoch,
            requestId: data.requestId, candidateGeneration: data.candidateGeneration,
            selectedCandidateIds: data.selectedCandidateIds, code: rejectCode,
          }
        : {
            version: 1, type: "reference-built", sessionEpoch: data.sessionEpoch,
            requestId: data.requestId, candidateGeneration: data.candidateGeneration,
            selectedCandidateIds: data.selectedCandidateIds, template: this.baseTemplate,
          }));
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    const message = data as RuntimeWorkerMessage;
    if (message.type === "reference-capture-pause-required") {
      this.requiredPauseReason = String(message.reason);
      this.requiredPauseSequence = Number(message.lastProcessedSequence);
    }
    this.received.push(message);
    if (message.type === "reference-candidate" && Number.isSafeInteger(message.candidateGeneration)) {
      this.candidateGeneration = message.candidateGeneration as number;
    }
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }
}

class MockBitmap {
  closed = false;
  constructor(readonly width: number, readonly height: number) {}
  close() { this.closed = true; }
}

function validTemplate(): ExerciseTemplate {
  return {
    exerciseKey: "dumbbell_curl",
    schemaVersion: 1,
    cameraView: "side",
    arm: "right",
    segmentation: { metric: "elbowAngle", extendedThreshold: 150, flexedThreshold: 60 },
    reference: { romMinAngle: 45, romMaxAngle: 165, concentricMs: 900, topPauseMs: 200, eccentricMs: 1_000, elbowCurve: Array.from({ length: 50 }, (_, i) => 165 - i) },
    tolerances: { romTopDeg: 15, romBottomDeg: 15, upperArmDriftDeg: 15, torsoSwingDeg: 10, shrugRatio: 0.08, tempoPct: 35 },
    scoringWeights: { rom: 30, elbow: 25, torso: 20, tempo: 15, shoulders: 10 },
    strictness: "standard",
    cues: [{ key: "elbows_pinned", fault: "elbow_drift", text: "Keep elbows steady", priority: 1, minPersistMs: 300, cooldownMs: 2_000 }],
    breathing: { concentric: "exhale", eccentric: "inhale", fullCueReps: 3, thenEvery: 3 },
  };
}

function makeVideo() {
  const callbacks = new Map<number, (now: number, metadata: { mediaTime: number }) => void>();
  const listeners = new Map<string, Set<() => void>>();
  let callbackId = 0;
  const video = {
    readyState: 2,
    videoWidth: 640,
    videoHeight: 480,
    currentSrc: "https://local.test/input.mp4",
    src: "https://local.test/input.mp4",
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const values = listeners.get(type) ?? new Set();
      values.add(listener as unknown as () => void);
      listeners.set(type, values);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => listeners.get(type)?.delete(listener as unknown as () => void)),
    requestVideoFrameCallback: vi.fn((callback: (now: number, metadata: { mediaTime: number }) => void) => {
      callbackId += 1;
      callbacks.set(callbackId, callback);
      return callbackId;
    }),
    cancelVideoFrameCallback: vi.fn((id: number) => callbacks.delete(id)),
    fireFrame(id: number, mediaTime: number) {
      const callback = callbacks.get(id);
      callbacks.delete(id);
      callback?.(mediaTime * 1_000, { mediaTime });
    },
    fireEvent(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    latestCallbackId() { return callbackId; },
  };
  return video as unknown as HTMLVideoElement & {
    fireFrame: (id: number, mediaTime: number) => void;
    fireEvent: (type: string) => void;
    latestCallbackId: () => number;
    videoWidth: number;
    videoHeight: number;
    currentSrc: string;
  };
}

function stubRuntimeGlobals() {
  vi.stubGlobal("window", {});
  vi.stubGlobal("Worker", MockWorker);
  vi.stubGlobal("OffscreenCanvas", class MockOffscreenCanvas {});
  vi.stubGlobal("ImageBitmap", MockBitmap);
  vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
  vi.stubGlobal("location", { origin: "https://form-coach.test" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    version: 1,
    sdkVersion: "1.2.3",
    bundleHash: "a".repeat(64),
    workerUrl: `/form-coach-worker/${"a".repeat(64)}/worker.js`,
  }), { status: 200, headers: { "content-type": "application/json" } })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockWorker.latest = null;
  MockWorker.holdFrames = false;
  MockWorker.holdBuilds = false;
  MockWorker.rejectBuildWith = null;
  MockWorker.throwForType = null;
});

describe("browser runtime initialization protocol", () => {
  it("threads both-arm selection and configured camera view through the Worker init packet", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("Worker", MockWorker);
    vi.stubGlobal("OffscreenCanvas", class MockOffscreenCanvas {});
    vi.stubGlobal("location", { origin: "https://form-coach.test" });
    vi.stubGlobal("createImageBitmap", vi.fn());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      version: 1,
      sdkVersion: "1.2.3",
      bundleHash: "a".repeat(64),
      workerUrl: `/form-coach-worker/${"a".repeat(64)}/worker.js`,
    }), { status: 200, headers: { "content-type": "application/json" } })));

    let frameCallbackId = 0;
    const video = {
      readyState: 2,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestVideoFrameCallback: vi.fn(() => ++frameCallbackId),
      cancelVideoFrameCallback: vi.fn(),
    } as unknown as HTMLVideoElement;

    const session = await startFormCoachProcessing(video, {
      mode: "reference",
      arm: "both",
      cameraView: "front",
      forceCpu: true,
    });
    const init = MockWorker.latest?.posted.find((message) => message.type === "init");
    expect(init).toMatchObject({ arm: "both", cameraView: "front", mode: "reference", forceCpu: true, gpuCanvas: null });
    expect(init).not.toHaveProperty("template");
    await session.stop();
    expect(MockWorker.latest?.terminated).toBe(true);
  });

  it("drains bitmap creation before acknowledging an explicit pause and rejects early builds", async () => {
    stubRuntimeGlobals();
    const video = makeVideo();
    let resolveBitmap!: (bitmap: MockBitmap) => void;
    const bitmapPromise = new Promise<MockBitmap>((resolve) => { resolveBitmap = resolve; });
    vi.stubGlobal("createImageBitmap", vi.fn(() => bitmapPromise));
    const session = await startFormCoachReferenceCapture(video, { baseTemplate: validTemplate(), forceCpu: true });
    const frameId = video.latestCallbackId();
    video.fireFrame(frameId, 1.25);
    const prematureBuild = await session.buildReference(["candidate-1", "candidate-2", "candidate-3"]);
    expect(prematureBuild).toMatchObject({ ok: false, code: "not-paused" });
    const pausePromise = session.pauseCapture();
    expect(await session.buildReference(["candidate-1", "candidate-2", "candidate-3"])).toMatchObject({ ok: false, code: "not-paused" });
    expect(MockWorker.latest?.posted.some((message) => message.type === "reference-capture-pause")).toBe(false);
    const bitmap = new MockBitmap(640, 480);
    resolveBitmap(bitmap);
    const ack = await pausePromise;
    expect(bitmap.closed).toBe(true);
    expect(MockWorker.latest?.posted.some((message) => message.type === "frame")).toBe(false);
    expect(ack).toMatchObject({ reason: "user_pause", lastProcessedSequence: 0, candidateGeneration: 0 });
    await session.stop();
  });

  it("waits for the transferred final frame before the pause command and accepts only exact response fences", async () => {
    stubRuntimeGlobals();
    MockWorker.holdFrames = true;
    const video = makeVideo();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockBitmap(640, 480)));
    const seen: string[] = [];
    const session = await startFormCoachReferenceCapture(video, {
      baseTemplate: validTemplate(),
      forceCpu: true,
      onCandidate: (candidate) => seen.push(candidate.id),
    });
    const worker = MockWorker.latest as MockWorker;
    const init = worker.posted.find((message) => message.type === "init");
    const epoch = init?.sessionEpoch;
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      worker.emit({
        version: 1,
        type: "reference-candidate",
        sessionEpoch: (epoch as number) + 1,
        candidateGeneration: ordinal,
        candidate: {
          id: `candidate-${ordinal}`, ordinal, pairing: "single_arm", arm: "right", selectable: true, reason: null,
          romMinAngle: 50, romMaxAngle: 160, concentricMs: 700, topPauseMs: 200, eccentricMs: 900,
          maxUpperArmDrift: 4, maxTorsoSwing: 2, maxShrug: 0.02,
        },
      });
    }
    // The candidate events above intentionally use a wrong epoch and must not reach callbacks.
    expect(seen).toEqual([]);
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      worker.emit({
        version: 1,
        type: "reference-candidate",
        sessionEpoch: epoch,
        candidateGeneration: ordinal,
        candidate: {
          id: `candidate-${ordinal}`, ordinal, pairing: "single_arm", arm: "right", selectable: true, reason: null,
          romMinAngle: 50, romMaxAngle: 160, concentricMs: 700, topPauseMs: 200, eccentricMs: 900,
          maxUpperArmDrift: 4, maxTorsoSwing: 2, maxShrug: 0.02,
        },
      });
    }
    expect(seen).toEqual(["candidate-1", "candidate-2", "candidate-3"]);
    const frameId = video.latestCallbackId();
    video.fireFrame(frameId, 2);
    await vi.waitFor(() => expect(worker.posted.some((message) => message.type === "frame")).toBe(true));
    const pausePromise = session.pauseCapture();
    await Promise.resolve();
    expect(worker.posted.some((message) => message.type === "reference-capture-pause")).toBe(false);
    const frame = worker.posted.find((message) => message.type === "frame");
    worker.emit({ version: 1, type: "processed", sessionEpoch: frame?.sessionEpoch, sequence: frame?.sequence, captureTimestampMs: frame?.captureTimestampMs });
    const ack = await pausePromise;
    expect(ack.lastProcessedSequence).toBe(1);
    expect(worker.posted.find((message) => message.type === "reference-capture-pause")).toMatchObject({ lastProcessedSequence: 1 });
    const buildPromise = session.buildReference(["candidate-1", "candidate-2", "candidate-3"]);
    const buildCommand = worker.posted.find((message) => message.type === "reference-build");
    worker.emit({
      version: 1,
      type: "reference-built",
      sessionEpoch: epoch,
      requestId: buildCommand?.requestId,
      candidateGeneration: 2,
      selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
      template: validTemplate(),
    });
    worker.emit({
      version: 1,
      type: "reference-built",
      sessionEpoch: epoch,
      requestId: buildCommand?.requestId,
      candidateGeneration: 3,
      selectedCandidateIds: ["candidate-3", "candidate-2", "candidate-1"],
      template: validTemplate(),
    });
    const built = await buildPromise;
    expect(built).toMatchObject({ ok: true, candidateGeneration: 3, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"] });
    const afterStop = session.stop();
    worker.emit({
      version: 1, type: "reference-candidate", sessionEpoch: ack.sessionEpoch, candidateGeneration: 4,
      candidate: { id: "candidate-1", ordinal: 1, pairing: "single_arm", arm: "right", selectable: true, reason: null,
        romMinAngle: 50, romMaxAngle: 160, concentricMs: 700, topPauseMs: 200, eccentricMs: 900,
        maxUpperArmDrift: 4, maxTorsoSwing: 2, maxShrug: 0.02 },
    });
    expect(seen).toEqual(["candidate-1", "candidate-2", "candidate-3"]);
    await afterStop;
  });

  it("uses the same drain barrier when candidate limits request an automatic pause", async () => {
    stubRuntimeGlobals();
    MockWorker.holdFrames = true;
    const video = makeVideo();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockBitmap(640, 480)));
    const session = await startFormCoachReferenceCapture(video, { baseTemplate: validTemplate(), forceCpu: true });
    const worker = MockWorker.latest as MockWorker;
    const frameId = video.latestCallbackId();
    video.fireFrame(frameId, 3);
    await vi.waitFor(() => expect(worker.posted.some((message) => message.type === "frame")).toBe(true));
    const frame = worker.posted.find((message) => message.type === "frame");
    worker.emit({
      version: 1, type: "reference-capture-pause-required", sessionEpoch: frame?.sessionEpoch,
      reason: "candidate_cap", lastProcessedSequence: frame?.sequence, candidateGeneration: 0,
    });
    await Promise.resolve();
    expect(worker.posted.some((message) => message.type === "reference-capture-pause")).toBe(false);
    worker.emit({ version: 1, type: "processed", sessionEpoch: frame?.sessionEpoch, sequence: frame?.sequence, captureTimestampMs: frame?.captureTimestampMs });
    const pause = await vi.waitFor(async () => {
      const command = worker.posted.find((message) => message.type === "reference-capture-pause");
      expect(command).toBeDefined();
      expect(command).toMatchObject({ reason: "candidate_cap", lastProcessedSequence: 1 });
      const ack = worker.received.find((message) => message.type === "reference-capture-paused");
      expect(ack).toBeDefined();
      return ack;
    });
    expect(pause).toMatchObject({ reason: "candidate_cap", lastProcessedSequence: 1, candidateGeneration: 0 });
    await session.stop();
  });

  it.each([
    { initiator: "user_pause", reason: "candidate_cap" },
    { initiator: "user_pause", reason: "curve_point_cap" },
    { initiator: "user_pause", reason: "session_sample_limit" },
    { initiator: "video_end", reason: "candidate_cap" },
    { initiator: "video_end", reason: "curve_point_cap" },
    { initiator: "video_end", reason: "session_sample_limit" },
  ] as const)("coalesces $initiator with the final-frame $reason pause reason", async ({ initiator, reason }) => {
    stubRuntimeGlobals();
    MockWorker.holdFrames = true;
    const video = makeVideo();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockBitmap(640, 480)));
    const session = await startFormCoachReferenceCapture(video, { baseTemplate: validTemplate(), forceCpu: true });
    const worker = MockWorker.latest as MockWorker;
    const epoch = worker.posted.find((message) => message.type === "init")?.sessionEpoch;
    const candidate = (generation: number) => ({
      version: 1, type: "reference-candidate", sessionEpoch: epoch, candidateGeneration: generation,
      candidate: {
        id: `candidate-${generation}`, ordinal: generation, pairing: "single_arm", arm: "right", selectable: true, reason: null,
        romMinAngle: 50, romMaxAngle: 160, concentricMs: 700, topPauseMs: 200, eccentricMs: 900,
        maxUpperArmDrift: 4, maxTorsoSwing: 2, maxShrug: 0.02,
      },
    });
    for (let generation = 1; generation <= 3; generation += 1) worker.emit(candidate(generation));
    video.fireFrame(video.latestCallbackId(), 2);
    await vi.waitFor(() => expect(worker.posted.some((message) => message.type === "frame")).toBe(true));
    const frame = worker.posted.find((message) => message.type === "frame");
    let userPause: Promise<Awaited<ReturnType<typeof session.pauseCapture>>> | null = null;
    if (initiator === "user_pause") userPause = session.pauseCapture();
    else video.fireEvent("ended");
    worker.emit(candidate(4));
    worker.emit({
      version: 1, type: "reference-capture-pause-required", sessionEpoch: epoch,
      reason, lastProcessedSequence: frame?.sequence, candidateGeneration: 4,
    });
    worker.emit({ version: 1, type: "processed", sessionEpoch: epoch, sequence: frame?.sequence, captureTimestampMs: frame?.captureTimestampMs });
    const pauseCommand = await vi.waitFor(() => {
      const command = worker.posted.find((message) => message.type === "reference-capture-pause");
      expect(command).toMatchObject({ reason, lastProcessedSequence: 1 });
      return command;
    });
    const acknowledgement = userPause
      ? await userPause
      : await vi.waitFor(() => worker.received.find((message) => message.type === "reference-capture-paused"));
    expect(worker.posted.filter((message) => message.type === "reference-capture-pause")).toHaveLength(1);
    expect(pauseCommand).toMatchObject({ reason, sessionEpoch: epoch, lastProcessedSequence: 1 });
    expect(acknowledgement).toMatchObject({ reason, sessionEpoch: epoch, lastProcessedSequence: 1, candidateGeneration: 4 });
    await expect(session.buildReference(["candidate-1", "candidate-2", "candidate-3"])).resolves.toMatchObject({
      ok: true, candidateGeneration: 4, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
    });
    await session.stop();
  });

  it("settles pause and build promises even when optional completion callbacks throw", async () => {
    stubRuntimeGlobals();
    const video = makeVideo();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockBitmap(640, 480)));
    const session = await startFormCoachReferenceCapture(video, {
      baseTemplate: validTemplate(), forceCpu: true,
      onPaused: () => { throw new Error("consumer pause callback failed"); },
      onBuilt: () => { throw new Error("consumer built callback failed"); },
      onBuildRejected: () => { throw new Error("consumer rejected callback failed"); },
    });
    const worker = MockWorker.latest as MockWorker;
    const epoch = worker.posted.find((message) => message.type === "init")?.sessionEpoch;
    for (let generation = 1; generation <= 3; generation += 1) worker.emit({
      version: 1, type: "reference-candidate", sessionEpoch: epoch, candidateGeneration: generation,
      candidate: {
        id: `candidate-${generation}`, ordinal: generation, pairing: "single_arm", arm: "right", selectable: true, reason: null,
        romMinAngle: 50, romMaxAngle: 160, concentricMs: 700, topPauseMs: 200, eccentricMs: 900,
        maxUpperArmDrift: 4, maxTorsoSwing: 2, maxShrug: 0.02,
      },
    });
    await expect(session.pauseCapture()).resolves.toMatchObject({ reason: "user_pause", candidateGeneration: 3 });
    await expect(session.buildReference(["candidate-1", "candidate-2", "candidate-3"])).resolves.toMatchObject({ ok: true });
    MockWorker.rejectBuildWith = "invalid-selection";
    await expect(session.buildReference(["candidate-1", "candidate-2", "candidate-3"])).resolves.toMatchObject({ ok: false, code: "invalid-selection" });
    await session.stop();
  });

  it.each(["explicit-stop", "seek", "abort"] as const)("ignores queued capture and setup outputs after %s", async (terminalAction) => {
    stubRuntimeGlobals();
    MockWorker.holdBuilds = true;
    const video = makeVideo();
    const abortController = new AbortController();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockBitmap(640, 480)));
    const callbacks: string[] = [];
    const session = await startFormCoachReferenceCapture(video, {
      baseTemplate: validTemplate(), forceCpu: true, signal: abortController.signal,
      onSetup: () => callbacks.push("setup"),
      onCandidate: () => callbacks.push("candidate"),
      onBuilt: () => callbacks.push("built"),
      onBuildRejected: () => callbacks.push("build-rejected"),
    });
    const worker = MockWorker.latest as MockWorker;
    const epoch = worker.posted.find((message) => message.type === "init")?.sessionEpoch;
    for (let generation = 1; generation <= 3; generation += 1) worker.emit({
      version: 1, type: "reference-candidate", sessionEpoch: epoch, candidateGeneration: generation,
      candidate: {
        id: `candidate-${generation}`, ordinal: generation, pairing: "single_arm", arm: "right", selectable: true, reason: null,
        romMinAngle: 50, romMaxAngle: 160, concentricMs: 700, topPauseMs: 200, eccentricMs: 900,
        maxUpperArmDrift: 4, maxTorsoSwing: 2, maxShrug: 0.02,
      },
    });
    await session.pauseCapture();
    const callbacksBeforeTerminal = [...callbacks];
    const buildPromise = session.buildReference(["candidate-1", "candidate-2", "candidate-3"]);
    const buildRequestId = worker.posted.find((message) => message.type === "reference-build")?.requestId;
    if (terminalAction === "explicit-stop") void session.stop();
    else if (terminalAction === "seek") video.fireEvent("seeking");
    else abortController.abort();
    worker.emit({ version: 1, type: "setup", sessionEpoch: epoch, step: "ready" });
    worker.emit({ version: 1, type: "overlay", sessionEpoch: epoch, landmarks: [{ x: 0.5, y: 0.5 }] });
    worker.emit({
      version: 1, type: "reference-candidate", sessionEpoch: epoch, candidateGeneration: 4,
      candidate: {
        id: "candidate-4", ordinal: 4, pairing: "single_arm", arm: "right", selectable: true, reason: null,
        romMinAngle: 50, romMaxAngle: 160, concentricMs: 700, topPauseMs: 200, eccentricMs: 900,
        maxUpperArmDrift: 4, maxTorsoSwing: 2, maxShrug: 0.02,
      },
    });
    worker.emit({
      version: 1, type: "reference-built", sessionEpoch: epoch, requestId: buildRequestId,
      candidateGeneration: 3, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"], template: validTemplate(),
    });
    worker.emit({
      version: 1, type: "reference-build-rejected", sessionEpoch: epoch, requestId: buildRequestId,
      candidateGeneration: 3, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"], code: "invalid-selection",
    });
    await expect(buildPromise).resolves.toMatchObject({ ok: false, code: "worker-failed" });
    expect(callbacks).toEqual(callbacksBeforeTerminal);
    await session.stop();
  });

  it("invalidates same-URL source reloads and srcObject replacement before reference building", async () => {
    stubRuntimeGlobals();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockBitmap(640, 480)));
    const reloadVideo = makeVideo();
    const reloadSession = await startFormCoachReferenceCapture(reloadVideo, { baseTemplate: validTemplate(), forceCpu: true });
    await reloadSession.pauseCapture();
    reloadVideo.fireEvent("loadstart");
    await expect(reloadSession.buildReference(["candidate-1", "candidate-2", "candidate-3"])).resolves.toMatchObject({ ok: false, code: "worker-failed" });
    await reloadSession.stop();

    stubRuntimeGlobals();
    const objectVideo = makeVideo();
    objectVideo.currentSrc = "";
    objectVideo.src = "";
    objectVideo.srcObject = null;
    const objectSession = await startFormCoachReferenceCapture(objectVideo, { baseTemplate: validTemplate(), forceCpu: true });
    objectVideo.fireEvent("ended");
    await vi.waitFor(() => expect(MockWorker.latest?.received.some((message) => message.type === "reference-capture-paused")).toBe(true));
    objectVideo.srcObject = {} as MediaProvider;
    await expect(objectSession.buildReference(["candidate-1", "candidate-2", "candidate-3"])).resolves.toMatchObject({ ok: false, code: "worker-failed" });
    await objectSession.stop();
  });

  it("suppresses all frame output when actual Worker candidate validation fails and closes queued bitmaps after stop", async () => {
    vi.stubGlobal("OffscreenCanvas", class MockOffscreenCanvas {});
    vi.stubGlobal("ImageBitmap", MockBitmap);
    vi.stubGlobal("PerformanceObserver", class MockPerformanceObserver {
      constructor(callback: (list: { getEntries(): PerformanceEntry[] }) => void) { void callback; }
      observe() {}
      disconnect() {}
      takeRecords() { return []; }
    });
    const posted: Array<Record<string, unknown>> = [];
    let listener: ((event: MessageEvent<unknown>) => void) | null = null;
    const scope = {
      location: { origin: "https://worker.test" },
      postMessage(message: unknown) { posted.push(message as Record<string, unknown>); },
      addEventListener(_type: "message", handler: (event: MessageEvent<unknown>) => void) { listener = handler; },
      removeEventListener() { listener = null; },
    } as unknown as DedicatedWorkerGlobalScope;
    let releaseStop!: () => void;
    const detectForVideo = vi.fn(() => ({ landmarks: [[]], segmentationMasks: [] }));
    const detector = { detectForVideo, close: vi.fn() };
    const loader = {
      start: vi.fn(async () => ({ status: "ready" as const, detector, delegate: "CPU" as const })),
      stop: vi.fn(() => new Promise<void>((resolve) => { releaseStop = resolve; })),
    };
    const adapterProcess = vi.fn(() => ({ overlay: [{ x: 0.5, y: 0.5 }], setupStep: "ready", cues: [], setBoundary: false }));
    const adapterFactory = vi.fn((options: { onReferenceCandidate?: (candidate: unknown) => void }) => ({
      process() {
        options.onReferenceCandidate?.({
          rep: { startMs: 10, endMs: 900, concentricMs: 400, topPauseMs: 100, eccentricMs: 390, romMinAngle: 45,
            romMaxAngle: 165, maxUpperArmDrift: 0, maxTorsoSwing: 0, maxShrug: 0, elbowCurve: [] },
          pairing: "single_arm", arm: "right",
        });
        return adapterProcess();
      },
      getSetupStep: () => null, getCleanReferenceCount: () => 0, getSetSampleLimit: () => 30_000,
    }));
    const dependencies: PoseWorkerDependencies = {
      createDetectorLoader: vi.fn(() => loader as never) as never,
      createPoseSessionAdapter: adapterFactory as never,
    };
    const uninstall = installFormCoachPoseWorker(scope, dependencies);
    const emit = (value: unknown) => listener?.({ data: value } as MessageEvent<unknown>);
    emit({
      version: 1, type: "init", sessionEpoch: 77, model: "lite", mode: "reference", arm: "right", cameraView: "side",
      referenceRepTarget: 3, forceCpu: true, gpuCanvas: null, referenceSelection: validTemplate(),
    });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "ready")).toBe(true));
    posted.length = 0;
    const failedFrame = new MockBitmap(640, 480);
    emit({ version: 1, type: "frame", sessionEpoch: 77, sequence: 1, captureTimestampMs: 1, width: 640, height: 480, droppedFramesSincePrevious: 0, frame: failedFrame });
    await vi.waitFor(() => expect(adapterProcess).toHaveBeenCalledOnce());
    expect(failedFrame.closed).toBe(true);
    expect(detectForVideo).toHaveBeenCalledOnce();
    expect(posted.some((message) => ["overlay", "setup", "rep-result", "rep-summary", "cue", "reference-ready", "reference-candidate", "processed"].includes(String(message.type)))).toBe(false);
    const queuedFrame = new MockBitmap(640, 480);
    emit({ version: 1, type: "frame", sessionEpoch: 77, sequence: 2, captureTimestampMs: 2, width: 640, height: 480, droppedFramesSincePrevious: 0, frame: queuedFrame });
    expect(queuedFrame.closed).toBe(true);
    expect(detectForVideo).toHaveBeenCalledOnce();
    emit({ version: 1, type: "reference-build", sessionEpoch: 77, requestId: 1, candidateGeneration: 0, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"] });
    expect(posted.some((message) => message.type === "reference-build-rejected")).toBe(false);
    releaseStop();
    await vi.waitFor(() => expect(posted.some((message) => message.type === "error" && message.code === "processing-failed")).toBe(true));
    expect(posted.some((message) => message.type === "overlay")).toBe(false);
    uninstall();
  });

  it("pauses through the actual Worker candidate cap and builds from its retained candidates", async () => {
    vi.stubGlobal("OffscreenCanvas", class MockOffscreenCanvas {});
    vi.stubGlobal("ImageBitmap", MockBitmap);
    vi.stubGlobal("PerformanceObserver", class MockPerformanceObserver {
      constructor(callback: (list: { getEntries(): PerformanceEntry[] }) => void) { void callback; }
      observe() {}
      disconnect() {}
      takeRecords() { return []; }
    });
    const posted: Array<Record<string, unknown>> = [];
    let listener: ((event: MessageEvent<unknown>) => void) | null = null;
    const scope = {
      location: { origin: "https://worker.test" },
      postMessage(message: unknown) { posted.push(message as Record<string, unknown>); },
      addEventListener(_type: "message", handler: (event: MessageEvent<unknown>) => void) { listener = handler; },
      removeEventListener() { listener = null; },
    } as unknown as DedicatedWorkerGlobalScope;
    const detector = { detectForVideo: vi.fn(() => ({ landmarks: [[]], segmentationMasks: [] })), close: vi.fn() };
    const loader = {
      start: vi.fn(async () => ({ status: "ready" as const, detector, delegate: "CPU" as const })),
      stop: vi.fn(async () => undefined),
    };
    const rep = {
      startMs: 10, endMs: 900, concentricMs: 400, topPauseMs: 100, eccentricMs: 390,
      romMinAngle: 50, romMaxAngle: 160, maxUpperArmDrift: 0, maxTorsoSwing: 0, maxShrug: 0,
      elbowCurve: [{ timestampMs: 9, angleDeg: 160 }, { timestampMs: 10, angleDeg: 140 }, { timestampMs: 900, angleDeg: 50 }],
    };
    const adapterFactory = vi.fn((options: { onReferenceCandidate?: (candidate: unknown) => void }) => ({
      process() {
        for (let index = 0; index < 100; index += 1) {
          options.onReferenceCandidate?.({ rep, pairing: "single_arm", arm: "right" });
        }
        return { overlay: [{ x: 0.5, y: 0.5 }], setupStep: "ready", cues: [], setBoundary: false };
      },
      getSetupStep: () => null, getCleanReferenceCount: () => 0, getSetSampleLimit: () => 30_000,
    }));
    const dependencies: PoseWorkerDependencies = {
      createDetectorLoader: vi.fn(() => loader as never) as never,
      createPoseSessionAdapter: adapterFactory as never,
    };
    const uninstall = installFormCoachPoseWorker(scope, dependencies);
    const emit = (value: unknown) => listener?.({ data: value } as MessageEvent<unknown>);
    emit({
      version: 1, type: "init", sessionEpoch: 78, model: "lite", mode: "reference", arm: "right", cameraView: "side",
      referenceRepTarget: 3, forceCpu: true, gpuCanvas: null, referenceSelection: validTemplate(),
    });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "ready")).toBe(true));
    const frame = new MockBitmap(640, 480);
    emit({ version: 1, type: "frame", sessionEpoch: 78, sequence: 1, captureTimestampMs: 1, width: 640, height: 480, droppedFramesSincePrevious: 0, frame });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "processed")).toBe(true));
    expect(frame.closed).toBe(true);
    expect(posted.filter((message) => message.type === "reference-candidate")).toHaveLength(100);
    expect(posted.filter((message) => message.type === "reference-capture-pause-required")).toEqual([expect.objectContaining({ reason: "candidate_cap", lastProcessedSequence: 1, candidateGeneration: 100 })]);
    expect(posted.some((message) => message.type === "overlay")).toBe(false);
    emit({ version: 1, type: "reference-capture-pause", sessionEpoch: 78, requestId: 1, lastProcessedSequence: 1, reason: "candidate_cap" });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "reference-capture-paused")).toBe(true));
    emit({ version: 1, type: "reference-build", sessionEpoch: 78, requestId: 1, candidateGeneration: 100, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"] });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "reference-built")).toBe(true));
    expect(posted.find((message) => message.type === "reference-built")).toMatchObject({
      candidateGeneration: 100, selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
    });
    emit({ version: 1, type: "stop", sessionEpoch: 78 });
    await vi.waitFor(() => expect(posted.some((message) => message.type === "stopped")).toBe(true));
    uninstall();
  });

  it("converts direct pause postMessage failures to a sanitized runtime error", async () => {
    stubRuntimeGlobals();
    const video = makeVideo();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockBitmap(640, 480)));
    const errors: string[] = [];
    const session = await startFormCoachReferenceCapture(video, {
      baseTemplate: validTemplate(), forceCpu: true, onError: (code) => errors.push(code),
    });
    MockWorker.throwForType = "reference-capture-pause";
    await expect(session.pauseCapture()).rejects.toMatchObject({ code: "worker-failed" });
    expect(errors).toEqual(["worker-failed"]);
    expect(errors.join(" ")).not.toContain("private browser transport detail");
    MockWorker.throwForType = null;
    await session.stop();
  });

  it("invalidates capture on a seek while bitmap creation is pending", async () => {
    stubRuntimeGlobals();
    const video = makeVideo();
    let resolveBitmap!: (bitmap: MockBitmap) => void;
    vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise<MockBitmap>((resolve) => { resolveBitmap = resolve; })));
    const errors: string[] = [];
    const session = await startFormCoachReferenceCapture(video, { baseTemplate: validTemplate(), forceCpu: true, onError: (code) => errors.push(code) });
    video.fireFrame(video.latestCallbackId(), 1);
    video.fireEvent("seeking");
    const bitmap = new MockBitmap(640, 480);
    resolveBitmap(bitmap);
    await vi.waitFor(() => expect(MockWorker.latest?.posted.some((message) => message.type === "stop")).toBe(true));
    expect(bitmap.closed).toBe(true);
    expect(errors).toContain("timeline-reset-required");
    expect(MockWorker.latest?.posted.some((message) => message.type === "frame")).toBe(false);
    await session.stop();
  });

  it("keeps geometry and seek invalidation active while paused and after video end", async () => {
    stubRuntimeGlobals();
    const video = makeVideo();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockBitmap(640, 480)));
    const resets: string[] = [];
    const session = await startFormCoachReferenceCapture(video, {
      baseTemplate: validTemplate(), forceCpu: true, onTimelineResetRequired: () => resets.push("reset"),
    });
    const frameId = video.latestCallbackId();
    video.fireFrame(frameId, 0.5);
    await vi.waitFor(() => expect(MockWorker.latest?.posted.some((message) => message.type === "frame")).toBe(true));
    await vi.waitFor(() => expect(MockWorker.latest?.listeners.get("message")).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await session.pauseCapture();
    video.videoWidth = 320;
    video.fireEvent("resize");
    await vi.waitFor(() => expect(MockWorker.latest?.posted.some((message) => message.type === "stop")).toBe(true));
    expect(resets).toEqual(["reset"]);
    await session.stop();

    stubRuntimeGlobals();
    const endedVideo = makeVideo();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockBitmap(640, 480)));
    const endedSession = await startFormCoachReferenceCapture(endedVideo, { baseTemplate: validTemplate(), forceCpu: true });
    endedVideo.fireEvent("ended");
    await vi.waitFor(() => expect(MockWorker.latest?.posted.some((message) => message.type === "reference-capture-pause")).toBe(true));
    await vi.waitFor(() => expect(MockWorker.latest?.received.some((message) => message.type === "reference-capture-paused"), JSON.stringify(MockWorker.latest?.received)).toBe(true));
    endedVideo.fireEvent("seeking");
    await vi.waitFor(() => expect(MockWorker.latest?.posted.some((message) => message.type === "stop")).toBe(true));
    await endedSession.stop();

    stubRuntimeGlobals();
    const sourceVideo = makeVideo();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockBitmap(640, 480)));
    const sourceSession = await startFormCoachReferenceCapture(sourceVideo, { baseTemplate: validTemplate(), forceCpu: true });
    await sourceSession.pauseCapture();
    sourceVideo.currentSrc = "https://local.test/replacement.mp4";
    const prebuild = await sourceSession.buildReference(["candidate-1", "candidate-2", "candidate-3"]);
    expect(prebuild).toMatchObject({ ok: false, code: "worker-failed" });
    expect(MockWorker.latest?.posted.some((message) => message.type === "stop")).toBe(true);
    await sourceSession.stop();
  });
});
