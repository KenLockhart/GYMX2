/// <reference lib="webworker" />

import { createDetectorLoader, FORM_COACH_ASSET_PATHS } from "@/lib/form-coach/detector-loader";
import type { PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { installMediaPipeRequestGuard } from "@/lib/form-coach/mediapipe-request-guard";
import { loadMediaPipeSdk } from "@/lib/form-coach/mediapipe-loader";
import { createPoseSessionAdapter } from "@/lib/form-coach/pose-session-adapter";
import { validateFormCoachAssetRequest } from "@/lib/form-coach/session-network-policy";
import { isCurlScoringTemplate, isFormCoachWorkerMessage, type FormCoachWorkerEvent, type FormCoachWorkerFrame, type FormCoachWorkerInit, type SetupStep } from "@/lib/form-coach/worker-protocol";
import type { DetectorLoader, FormCoachModel, PoseDetectorHandle } from "@/lib/form-coach/detector-loader";
import type { WorkerErrorCode } from "@/lib/form-coach/worker-controller";

type Detector = PoseDetectorHandle & Pick<PoseLandmarker, "detectForVideo">;

const scope = self as DedicatedWorkerGlobalScope;
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

function send(message: FormCoachWorkerEvent) {
  try {
    scope.postMessage(message);
  } catch {
    // Worker messages contain only bounded numeric/status output; delivery failures stay local.
  }
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
  const expected = ["version", "type", "sessionEpoch", "model", "mode", "arm", "referenceRepTarget", "forceCpu", "gpuCanvas"];
  const isExact = (keys: readonly string[]) => {
    const actual = Object.keys(value).sort();
    const wanted = [...keys].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
  };
  const commonValid =
    Number.isSafeInteger(value.sessionEpoch) && (value.sessionEpoch as number) > 0 &&
    value.version === 1 && value.type === "init" && isModel(value.model) &&
    (value.mode === "reference" || value.mode === "live") &&
    (value.arm === "left" || value.arm === "right" || value.arm === "auto") &&
    Number.isInteger(value.referenceRepTarget) && (value.referenceRepTarget as number) >= 3 && (value.referenceRepTarget as number) <= 5 &&
    typeof value.forceCpu === "boolean" &&
    (value.gpuCanvas === null || (typeof OffscreenCanvas !== "undefined" && value.gpuCanvas instanceof OffscreenCanvas));
  if (!commonValid) return false;
  if (value.mode === "live") {
    return isExact([...expected, "template"]) && isCurlScoringTemplate(value.template);
  }
  return isExact(expected) && value.template === undefined;
}

async function initialize(message: FormCoachWorkerInit): Promise<void> {
  epoch = message.sessionEpoch;
  if (!isModel(message.model) || typeof OffscreenCanvas === "undefined") {
    await failWorker("unsupported-platform");
    return;
  }
  if (!startResourceAudit()) {
    await failWorker("unsupported-platform");
    return;
  }

  loader = createDetectorLoader({
    installRequestGuard() {
      requestGuard = installMediaPipeRequestGuard(scope as unknown as Parameters<typeof installMediaPipeRequestGuard>[0]);
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
    loadSdk: loadMediaPipeSdk,
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
  adapter = createPoseSessionAdapter({
    mode: message.mode,
    arm: message.arm,
    referenceRepTarget: message.referenceRepTarget,
    ...(message.mode === "live" ? { template: message.template } : {}),
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

  processing = true;
  lastCaptureTimestampMs = message.captureTimestampMs;
  let errorCode: WorkerErrorCode | null = null;
  try {
    result = activeDetector.detectForVideo(frame, message.captureTimestampMs);
    if (!stopRequested) {
      const output = activeAdapter.process({
        landmarks: mapLandmarks(result),
        timestampMs: message.captureTimestampMs,
        width: message.width,
        height: message.height,
      });
      send({ version: 1, type: "overlay", sessionEpoch: epoch, landmarks: output.overlay });
      if (output.setupStep !== lastSetupStep) {
        lastSetupStep = output.setupStep;
        send({ version: 1, type: "setup", sessionEpoch: epoch, step: output.setupStep });
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
        send({ version: 1, type: "set-boundary", sessionEpoch: epoch, reason: "session_sample_limit" });
      }
      if (!stopRequested) {
        send({ version: 1, type: "processed", sessionEpoch: epoch, sequence: message.sequence, captureTimestampMs: message.captureTimestampMs });
      }
    }
  } catch {
    errorCode = "processing-failed";
  } finally {
    closeResultResources(result);
    closeTransferableFrame(frame);
    processing = false;
  }
  if (errorCode) await failWorker(errorCode);
}

async function handleStop(message: Record<string, unknown>): Promise<void> {
  if (message.version !== 1 || message.type !== "stop" || message.sessionEpoch !== epoch) return;
  stopRequested = true;
  await stopDetector();
  if (initialization) await initialization;
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isFormCoachWorkerMessage(event.data)) return;
  const message = event.data;
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
  if (message.type === "frame") {
    if (!isFormCoachWorkerMessage(message) || !("frame" in message)) return;
    void processFrame(message as unknown as FormCoachWorkerFrame);
  }
});
