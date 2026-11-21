/// <reference lib="webworker" />

import { createDetectorLoader, FORM_COACH_ASSET_PATHS } from "@/lib/form-coach/detector-loader";
import type { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { installMediaPipeRequestGuard } from "@/lib/form-coach/mediapipe-request-guard";
import { loadMediaPipeSdk } from "@/lib/form-coach/mediapipe-loader";
import { createPoseSessionAdapter } from "@/lib/form-coach/pose-session-adapter";
import { STANDING_DUMBBELL_CURL } from "@/lib/form-coach/engine/registry";
import { ReferenceCaptureStore } from "@/lib/form-coach/reference-capture-store";
import { validateFormCoachAssetRequest } from "@/lib/form-coach/session-network-policy";
import { hasExactKeys, isCurlScoringTemplate, isFormCoachWorkerMessage, isReferenceCapturePauseReason, type FormCoachWorkerEvent, type FormCoachWorkerFrame, type FormCoachWorkerInit, type ReferenceCapturePauseReason, type SetupStep } from "@/lib/form-coach/worker-protocol";
import { safeParseExerciseTemplate, type ExerciseTemplate } from "@/lib/form-coach/template-schema";
import type { DetectorLoader, FormCoachModel, PoseDetectorHandle } from "@/lib/form-coach/detector-loader";
import type { WorkerErrorCode } from "@/lib/form-coach/worker-controller";

type Detector = PoseDetectorHandle & Pick<PoseLandmarker, "detectForVideo">;

let scope = (typeof self === "undefined" ? null : self) as unknown as DedicatedWorkerGlobalScope;
let epoch = 0;
let loader: DetectorLoader | null = null;
let detector: Detector | null = null;
let gpuContext: WebGL2RenderingContext | null = null;
let requestGuard: ReturnType<typeof installMediaPipeRequestGuard> | null = null;
let adapter: ReturnType<typeof createPoseSessionAdapter> | null = null;
let initialization: Promise<void> | null = null;
let stopPromise: Promise<void> | null = null;
let stopRequested = false;
let stopCompleted = false;
let processing = false;
let lastCaptureTimestampMs = -1;
let lastSetupStep: SetupStep | null = null;
let boundarySent = false;
let resourceObserver: PerformanceObserver | null = null;
const observedRequests = new Map<string, { method: string; host: string; path: string; count: number }>();
let captureStore: ReferenceCaptureStore | null = null;
let captureState: "none" | "running" | "pausing" | "paused" | "closed" = "none";
let capturePauseReason: ReferenceCapturePauseReason = "user_pause";
let lastProcessedSequence = 0;
let lastPauseRequestId = 0;
let lastBuildRequestId = 0;
let captureBuilt = false;
let captureTemplate: ExerciseTemplate | null = null;
let captureGeometry: Readonly<{ width: number; height: number }> | null = null;
let activeFrameSequence = 0;
let capturePauseRequiredSequence = 0;

export type PoseWorkerDependencies = Readonly<{
  createDetectorLoader?: typeof createDetectorLoader;
  installMediaPipeRequestGuard?: typeof installMediaPipeRequestGuard;
  loadMediaPipeSdk?: typeof loadMediaPipeSdk;
  createPoseSessionAdapter?: typeof createPoseSessionAdapter;
}>;
let dependencies: PoseWorkerDependencies = {};

function recordObservedResource(name: string): void {
  try {
    const url = new URL(name, scope.location.origin);
    const entry = { method: "GET", host: url.hostname.slice(0, 100), path: (url.pathname.slice(0, 160) || "/") };
    const key = `${entry.method}\0${entry.host}\0${entry.path}`;
    const existing = observedRequests.get(key);
    if (existing) observedRequests.set(key, { ...existing, count: existing.count + 1 });
    else if (observedRequests.size < 16) observedRequests.set(key, { ...entry, count: 1 });
  } catch {
    const key = "GET\0invalid\0/";
    const existing = observedRequests.get(key);
    if (existing) observedRequests.set(key, { ...existing, count: existing.count + 1 });
    else if (observedRequests.size < 16) observedRequests.set(key, { method: "GET", host: "invalid", path: "/", count: 1 });
  }
}

function collectResourceEntries(entries: readonly PerformanceEntry[]): void {
  for (const entry of entries) {
    if (entry.entryType === "resource" && "name" in entry && typeof entry.name === "string") recordObservedResource(entry.name);
  }
}

function startResourceAudit(): boolean {
  try {
    resourceObserver = new PerformanceObserver((list) => collectResourceEntries(list.getEntries()));
    resourceObserver.observe({ type: "resource", buffered: true });
    return true;
  } catch {
    resourceObserver?.disconnect();
    resourceObserver = null;
    return false;
  }
}

function finishResourceAudit() {
  if (!resourceObserver) return [...observedRequests.values()].slice(0, 16);
  try {
    collectResourceEntries(resourceObserver.takeRecords());
  } catch {
    // The last sanitized snapshot is still useful if browser timing APIs shut down early.
  }
  resourceObserver.disconnect();
  resourceObserver = null;
  return [...observedRequests.values()].slice(0, 16);
}

function isModel(value: unknown): value is FormCoachModel {
  return value === "lite" || value === "full";
}

function deepFreezeTemplate(template: ExerciseTemplate): ExerciseTemplate {
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  };
  freeze(template);
  return template;
}

function send(message: FormCoachWorkerEvent) {
  try {
    scope.postMessage(message);
  } catch {
    // Worker messages contain only bounded numeric/status output; delivery failures stay local.
  }
}

function clearCapture(): void {
  captureStore?.clear();
  captureStore = null;
  captureTemplate = null;
  captureGeometry = null;
  captureState = "closed";
}

function sendAudit() {
  const summary = requestGuard?.getSummary() ?? { allowedAssetGets: 0, allowed: [], blocked: [] };
  send({
    version: 1,
    type: "network-audit",
    sessionEpoch: epoch,
    allowedAssetGets: summary.allowedAssetGets,
    allowed: summary.allowed.slice(0, 16),
    blocked: summary.blocked.slice(0, 16),
    observed: finishResourceAudit(),
  });
}

function requestAutomaticCapturePause(reason: ReferenceCapturePauseReason, sequence: number): void {
  if (captureState !== "running") return;
  captureState = "pausing";
  capturePauseReason = reason;
  capturePauseRequiredSequence = sequence;
  send({
    version: 1,
    type: "reference-capture-pause-required",
    sessionEpoch: epoch,
    reason,
    lastProcessedSequence: sequence,
    candidateGeneration: captureStore?.candidateGeneration ?? 0,
  });
}

function mapLoaderFailure(code: string): WorkerErrorCode {
  if (code === "asset-not-allowed") return "asset-policy-rejected";
  if (code === "gpu-cleanup-failed" || code === "gpu-init-failed") return "gpu-init-failed";
  if (code === "cpu-init-failed") return "cpu-init-failed";
  if (code === "unsupported-platform") return "unsupported-platform";
  if (code === "guard-install-failed" || code === "sdk-load-failed" || code === "fileset-failed") return "sdk-init-failed";
  return "internal";
}

function closeTransferableFrame(value: unknown): void {
  try {
    if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) value.close();
  } catch {
    // Ownership cleanup must never expose browser exception strings across the Worker boundary.
  }
}

function closeResultResources(result: PoseLandmarkerResult | null): void {
  if (!result) return;
  const masks = result.segmentationMasks;
  if (!Array.isArray(masks)) return;
  for (const mask of masks) {
    try {
      mask.close();
    } catch {
      // Segmentation is disabled for this task; still close unexpected resources defensively.
    }
  }
}

async function stopDetector(): Promise<void> {
  if (stopPromise) return stopPromise;
  stopRequested = true;
  stopPromise = (async () => {
    const activeLoader = loader;
    if (activeLoader) {
      try {
        await activeLoader.stop();
      } catch {
        // Do not forward SDK exception details.
      }
    } else {
      try {
        detector?.close();
      } catch {
        // A Worker termination still releases the isolate if SDK cleanup fails.
      }
    }
    detector = null;
    loader = null;
    gpuContext = null;
    if (!stopCompleted) {
      stopCompleted = true;
      sendAudit();
      send({ version: 1, type: "stopped", sessionEpoch: epoch });
    }
  })();
  return stopPromise;
}

async function failWorker(code: WorkerErrorCode): Promise<void> {
  if (stopCompleted) return;
  stopRequested = true;
  clearCapture();
  adapter = null;
  const activeLoader = loader;
  if (activeLoader) {
    try {
      await activeLoader.stop();
    } catch {
      // Keep the sanitized error code only.
    }
  } else {
    try {
      detector?.close();
    } catch {
      // Keep the sanitized error code only.
    }
  }
  detector = null;
  loader = null;
  gpuContext = null;
  sendAudit();
  send({ version: 1, type: "error", sessionEpoch: epoch, code });
}

function validateInit(value: Record<string, unknown>): value is FormCoachWorkerInit {
  const expected = ["version", "type", "sessionEpoch", "model", "mode", "arm", "cameraView", "referenceRepTarget", "forceCpu", "gpuCanvas"];
  const isExact = (keys: readonly string[]) => {
    const actual = Object.keys(value).sort();
    const wanted = [...keys].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
  };
  const commonValid =
    Number.isSafeInteger(value.sessionEpoch) && (value.sessionEpoch as number) > 0 &&
    value.version === 1 && value.type === "init" && isModel(value.model) &&
    (value.mode === "reference" || value.mode === "live") &&
    (value.arm === "left" || value.arm === "right" || value.arm === "both" || value.arm === "auto") &&
    (value.cameraView === "side" || value.cameraView === "front" || value.cameraView === "three_quarter") &&
    Number.isInteger(value.referenceRepTarget) && (value.referenceRepTarget as number) >= 3 && (value.referenceRepTarget as number) <= 5 &&
    typeof value.forceCpu === "boolean" &&
    (value.gpuCanvas === null || (typeof OffscreenCanvas !== "undefined" && value.gpuCanvas instanceof OffscreenCanvas));
  if (!commonValid) return false;
  if (value.mode === "live") {
    return isExact([...expected, "template"]) && isCurlScoringTemplate(value.template);
  }
  if ("referenceSelection" in value) {
    const parsed = safeParseExerciseTemplate(value.referenceSelection);
    return isExact([...expected, "referenceSelection"]) && parsed.success &&
      parsed.data.exerciseKey === STANDING_DUMBBELL_CURL.exerciseKey &&
      parsed.data.arm === value.arm && parsed.data.cameraView === value.cameraView;
  }
  return isExact(expected) && value.template === undefined;
}

async function initialize(message: FormCoachWorkerInit): Promise<void> {
  epoch = message.sessionEpoch;
  const parsedCaptureTemplate = message.referenceSelection === undefined ? null : safeParseExerciseTemplate(message.referenceSelection);
  if (message.referenceSelection !== undefined && (!parsedCaptureTemplate || !parsedCaptureTemplate.success)) {
    await failWorker("internal");
    return;
  }
  if (parsedCaptureTemplate?.success) {
    captureTemplate = deepFreezeTemplate(parsedCaptureTemplate.data);
    captureState = "running";
    captureStore = null;
    captureGeometry = null;
    lastProcessedSequence = 0;
    lastPauseRequestId = 0;
    lastBuildRequestId = 0;
    captureBuilt = false;
    capturePauseRequiredSequence = 0;
  } else {
    captureTemplate = null;
    captureState = "none";
  }
  if (!isModel(message.model) || typeof OffscreenCanvas === "undefined") {
    await failWorker("unsupported-platform");
    return;
  }
  if (!startResourceAudit()) {
    await failWorker("unsupported-platform");
    return;
  }

  loader = (dependencies.createDetectorLoader ?? createDetectorLoader)({
    installRequestGuard() {
      requestGuard = (dependencies.installMediaPipeRequestGuard ?? installMediaPipeRequestGuard)(scope as unknown as Parameters<typeof installMediaPipeRequestGuard>[0]);
    },
    isAssetAllowed(path) {
      return validateFormCoachAssetRequest(
        {
          url: path,
          method: "GET",
          mode: "same-origin",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
        },
        {
          trustedOrigin: scope.location.origin,
          allowedPaths: [
            FORM_COACH_ASSET_PATHS.wasmModuleLoader,
            FORM_COACH_ASSET_PATHS.wasmModuleBinary,
            FORM_COACH_ASSET_PATHS.liteModel,
            FORM_COACH_ASSET_PATHS.fullModel,
          ],
        },
      ).allowed;
    },
    loadSdk: dependencies.loadMediaPipeSdk ?? loadMediaPipeSdk,
    createGpuCanvas() {
      const canvas = message.gpuCanvas ?? new OffscreenCanvas(1, 1);
      const context = canvas.getContext("webgl2", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      });
      if (!context) throw new TypeError("GPU context unavailable.");
      gpuContext = context;
      return canvas;
    },
    disposeGpuAttempt(canvas) {
      if (!canvas) return true;
      try {
        const context = gpuContext ?? (canvas as OffscreenCanvas).getContext("webgl2");
        if (!context || context.isContextLost()) return true;
        const extension = context.getExtension("WEBGL_lose_context");
        if (!extension) return false;
        extension.loseContext();
        return context.isContextLost();
      } catch {
        return false;
      } finally {
        gpuContext = null;
      }
    },
  });

  const loaded = await loader.start(message.model, message.forceCpu);
  if (stopRequested) {
    await stopDetector();
    return;
  }
  if (loaded.status !== "ready") {
    await failWorker(mapLoaderFailure(loaded.code));
    return;
  }
  detector = loaded.detector as Detector;
  const createAdapter = dependencies.createPoseSessionAdapter ?? createPoseSessionAdapter;
  adapter = createAdapter({
    mode: message.mode,
    arm: message.arm,
    cameraView: message.cameraView,
    referenceRepTarget: message.referenceRepTarget,
    ...(message.mode === "live" ? { template: message.template } : {}),
    ...(parsedCaptureTemplate?.success ? {
      onReferenceCandidate(candidate) {
        if (!captureStore || captureState !== "running") return;
        const added = captureStore.add(candidate.rep, candidate.pairing, candidate.arm);
        if (!added.ok) {
          if (added.pauseReason === "candidate_cap" || added.pauseReason === "curve_point_cap") {
            requestAutomaticCapturePause(added.pauseReason, activeFrameSequence);
          } else {
            void failWorker("processing-failed");
          }
          return;
        }
        send({ version: 1, type: "reference-candidate", sessionEpoch: epoch, candidateGeneration: added.generation, candidate: added.candidate });
        if (added.pauseReason) requestAutomaticCapturePause(added.pauseReason, activeFrameSequence);
      },
    } : {}),
  });
  lastSetupStep = adapter.getSetupStep();
  send({ version: 1, type: "ready", sessionEpoch: epoch, model: message.model, delegate: loaded.delegate });
  if (lastSetupStep) send({ version: 1, type: "setup", sessionEpoch: epoch, step: lastSetupStep });
}

function mapLandmarks(result: PoseLandmarkerResult): Array<{ x: number; y: number; z?: number; visibility?: number } | null> {
  const landmarks = result.landmarks[0] ?? [];
  return landmarks.slice(0, 33).map((landmark) => {
    if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
    return {
      x: landmark.x,
      y: landmark.y,
      ...(Number.isFinite(landmark.z) ? { z: landmark.z } : {}),
      ...(Number.isFinite(landmark.visibility) ? { visibility: landmark.visibility } : {}),
    };
  });
}

async function processFrame(message: FormCoachWorkerFrame): Promise<void> {
  const frame = message.frame;
  const referenceTemplate = captureTemplate;
  const frameWasReferenceCapture = referenceTemplate !== null;
  if (stopRequested || stopCompleted || captureState === "closed") {
    closeTransferableFrame(frame);
    return;
  }
  const activeDetector = detector;
  const activeAdapter = adapter;
  let result: PoseLandmarkerResult | null = null;
  if (processing || !activeDetector || !activeAdapter) {
    closeTransferableFrame(frame);
    await failWorker("invalid-frame");
    return;
  }
  const invalidFrame =
    message.type !== "frame" || message.version !== 1 || message.sessionEpoch !== epoch ||
    !Number.isSafeInteger(message.sequence) || message.sequence < 1 ||
    !Number.isFinite(message.captureTimestampMs) || message.captureTimestampMs <= lastCaptureTimestampMs ||
    !Number.isSafeInteger(message.width) || !Number.isSafeInteger(message.height) ||
    !(typeof ImageBitmap !== "undefined" && frame instanceof ImageBitmap) ||
    frame.width !== message.width || frame.height !== message.height ||
    message.width < 1 || message.height < 1 || message.width > 4_096 || message.height > 4_096 || message.width * message.height > 16_777_216;
  if (invalidFrame) {
    closeTransferableFrame(frame);
    await failWorker("invalid-frame");
    return;
  }

  if (referenceTemplate) {
    if (captureState !== "running") {
      closeTransferableFrame(frame);
      await failWorker("invalid-frame");
      return;
    }
    if (captureGeometry && (captureGeometry.width !== message.width || captureGeometry.height !== message.height)) {
      closeTransferableFrame(frame);
      await failWorker("invalid-frame");
      return;
    }
    captureGeometry ??= { width: message.width, height: message.height };
    captureStore ??= new ReferenceCaptureStore({
      sessionEpoch: epoch,
      exerciseKey: referenceTemplate.exerciseKey,
      arm: referenceTemplate.arm,
      cameraView: referenceTemplate.cameraView,
      width: message.width,
      height: message.height,
    }, referenceTemplate);
  }

  processing = true;
  activeFrameSequence = message.sequence;
  lastCaptureTimestampMs = message.captureTimestampMs;
  let errorCode: WorkerErrorCode | null = null;
  let didProcess = false;
  try {
    result = activeDetector.detectForVideo(frame, message.captureTimestampMs);
    if (!stopRequested) {
      const output = activeAdapter.process({
        landmarks: mapLandmarks(result),
        timestampMs: message.captureTimestampMs,
        width: message.width,
        height: message.height,
      });
      if (stopRequested || stopCompleted) return;
      if (!frameWasReferenceCapture) send({ version: 1, type: "overlay", sessionEpoch: epoch, landmarks: output.overlay });
      if (output.setupStep !== lastSetupStep) {
        lastSetupStep = output.setupStep;
        send({ version: 1, type: "setup", sessionEpoch: epoch, step: output.setupStep });
      }
      if (output.pairRejected) {
        send({ version: 1, type: "pair-rejected", sessionEpoch: epoch, reason: output.pairRejected });
      }
      if (output.rep) {
        send({ version: 1, type: "rep-result", sessionEpoch: epoch, summary: output.rep });
        send({
          version: 1,
          type: "rep-summary",
          sessionEpoch: epoch,
          repNumber: output.rep.repNumber,
          score: output.rep.score,
          durationMs: output.rep.concentricMs + output.rep.topPauseMs + output.rep.eccentricMs,
          faults: output.rep.faults,
        });
      }
      if (output.reference) {
        send({ version: 1, type: "reference-ready", sessionEpoch: epoch, template: output.reference, cleanRepCount: activeAdapter.getCleanReferenceCount() });
      }
      for (const cue of output.cues) send({ version: 1, type: "cue", sessionEpoch: epoch, cue });
      if (output.setBoundary && !boundarySent) {
        boundarySent = true;
        if (captureTemplate) requestAutomaticCapturePause("session_sample_limit", message.sequence);
        else send({ version: 1, type: "set-boundary", sessionEpoch: epoch, reason: "session_sample_limit" });
      }
      if (!stopRequested) didProcess = true;
    }
  } catch {
    errorCode = "processing-failed";
  } finally {
    closeResultResources(result);
    closeTransferableFrame(frame);
    processing = false;
  }
  if (errorCode) {
    await failWorker(errorCode);
    return;
  }
  if (didProcess && !stopRequested) {
    lastProcessedSequence = message.sequence;
    send({ version: 1, type: "processed", sessionEpoch: epoch, sequence: message.sequence, captureTimestampMs: message.captureTimestampMs });
  }
}

function handleCapturePause(value: Record<string, unknown>): void {
  if (!captureTemplate || captureState === "none" || captureState === "closed") return;
  if (!hasExactKeys(value, ["version", "type", "sessionEpoch", "requestId", "lastProcessedSequence", "reason"]) ||
      value.version !== 1 || value.type !== "reference-capture-pause" || value.sessionEpoch !== epoch ||
      !Number.isSafeInteger(value.requestId) || (value.requestId as number) <= lastPauseRequestId ||
      !Number.isSafeInteger(value.lastProcessedSequence) || value.lastProcessedSequence !== lastProcessedSequence ||
      !isReferenceCapturePauseReason(value.reason) || processing ||
      (captureState !== "running" && captureState !== "pausing") ||
      (captureState === "pausing" && (value.reason !== capturePauseReason || value.lastProcessedSequence !== capturePauseRequiredSequence))) {
    return;
  }
  lastPauseRequestId = value.requestId as number;
  capturePauseReason = value.reason;
  captureState = "paused";
  adapter = null;
  send({
    version: 1,
    type: "reference-capture-paused",
    sessionEpoch: epoch,
    requestId: lastPauseRequestId,
    lastProcessedSequence,
    candidateGeneration: captureStore?.candidateGeneration ?? 0,
    reason: capturePauseReason,
  });
}

function handleReferenceBuild(value: Record<string, unknown>): void {
  if (!captureTemplate || captureState === "none" || captureState === "closed") return;
  const exact = hasExactKeys(value, ["version", "type", "sessionEpoch", "requestId", "candidateGeneration", "selectedCandidateIds"]);
  const requestId = Number.isSafeInteger(value.requestId) && (value.requestId as number) > 0 ? value.requestId as number : 0;
  const candidateGeneration = Number.isSafeInteger(value.candidateGeneration) && (value.candidateGeneration as number) >= 0 ? value.candidateGeneration as number : 0;
  const selectedCandidateIds = Array.isArray(value.selectedCandidateIds) && value.selectedCandidateIds.length <= 5 &&
    value.selectedCandidateIds.every((id) => typeof id === "string" && /^candidate-[1-9][0-9]{0,2}$/.test(id))
    ? [...value.selectedCandidateIds] as string[] : [];
  const reject = (code: "not-paused" | "stale-generation" | "invalid-selection" | "already-built" | "invalid-request") => {
    send({ version: 1, type: "reference-build-rejected", sessionEpoch: epoch, requestId, candidateGeneration, selectedCandidateIds, code });
  };
  if (!exact || value.version !== 1 || value.type !== "reference-build" || value.sessionEpoch !== epoch || requestId === 0 || requestId <= lastBuildRequestId) {
    reject("invalid-request");
    return;
  }
  lastBuildRequestId = requestId;
  if (captureState !== "paused") {
    reject("not-paused");
    return;
  }
  if (captureBuilt) {
    reject("already-built");
    return;
  }
  if (candidateGeneration !== (captureStore?.candidateGeneration ?? 0)) {
    reject("stale-generation");
    return;
  }
  if (selectedCandidateIds.length < 3 || selectedCandidateIds.length > 5 || new Set(selectedCandidateIds).size !== selectedCandidateIds.length) {
    reject("invalid-selection");
    return;
  }
  const result = captureStore?.build(candidateGeneration, selectedCandidateIds);
  if (!result || !result.ok) {
    reject("invalid-selection");
    return;
  }
  captureBuilt = true;
  send({
    version: 1,
    type: "reference-built",
    sessionEpoch: epoch,
    requestId,
    candidateGeneration,
    selectedCandidateIds,
    template: result.template,
  });
}

async function handleStop(message: Record<string, unknown>): Promise<void> {
  if (message.version !== 1 || message.type !== "stop" || message.sessionEpoch !== epoch) return;
  stopRequested = true;
  clearCapture();
  adapter = null;
  await stopDetector();
  if (initialization) await initialization;
}

function handleMessage(event: MessageEvent<unknown>): void {
  if (!isFormCoachWorkerMessage(event.data)) return;
  const message = event.data;
  if ((stopRequested || stopCompleted) && message.type !== "stop") {
    if (message.type === "frame" && "frame" in message) closeTransferableFrame(message.frame);
    return;
  }
  if (message.type === "init") {
    if (!validateInit(message)) {
      epoch = Number.isSafeInteger(message.sessionEpoch) && (message.sessionEpoch as number) > 0 ? (message.sessionEpoch as number) : 1;
      void failWorker("internal");
      return;
    }
    if (initialization || loader || stopRequested) {
      epoch = message.sessionEpoch;
      void failWorker("internal");
      return;
    }
    initialization = initialize(message);
    void initialization.catch(() => failWorker("internal"));
    return;
  }
  if (message.type === "stop") {
    void handleStop(message);
    return;
  }
  if (message.type === "reference-capture-pause") {
    handleCapturePause(message);
    return;
  }
  if (message.type === "reference-build") {
    handleReferenceBuild(message);
    return;
  }
  if (message.type === "frame") {
    if (!isFormCoachWorkerMessage(message) || !("frame" in message)) return;
    void processFrame(message as unknown as FormCoachWorkerFrame);
  }
}

/** Installs the same message handler on a supplied scope, allowing handler tests without a real detector. */
export function installFormCoachPoseWorker(target: DedicatedWorkerGlobalScope, injected: PoseWorkerDependencies = {}): () => void {
  if (resourceObserver) resourceObserver.disconnect();
  scope = target;
  dependencies = injected;
  epoch = 0;
  loader = null;
  detector = null;
  gpuContext = null;
  requestGuard = null;
  adapter = null;
  initialization = null;
  stopPromise = null;
  stopRequested = false;
  stopCompleted = false;
  processing = false;
  lastCaptureTimestampMs = -1;
  lastSetupStep = null;
  boundarySent = false;
  resourceObserver = null;
  observedRequests.clear();
  captureStore = null;
  captureState = "none";
  capturePauseReason = "user_pause";
  lastProcessedSequence = 0;
  lastPauseRequestId = 0;
  lastBuildRequestId = 0;
  captureTemplate = null;
  captureGeometry = null;
  activeFrameSequence = 0;
  capturePauseRequiredSequence = 0;
  captureBuilt = false;
  target.addEventListener("message", handleMessage);
  return () => {
    target.removeEventListener("message", handleMessage);
    clearCapture();
    adapter = null;
    resourceObserver?.disconnect();
    resourceObserver = null;
    dependencies = {};
  };
}

if (typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof WorkerGlobalScope) {
  installFormCoachPoseWorker(self as DedicatedWorkerGlobalScope);
}
