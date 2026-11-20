"use client";

import { createFrameRateMonitor, type FrameRateSnapshot } from "./frame-rate";
import { createFrameSender, type FrameSender } from "./frame-sender";
import { validateFormCoachAssetRequest } from "./session-network-policy";
import { createWorkerController, type WorkerController, type WorkerControllerEvent, type WorkerPortLike, type WorkerErrorCode, type WorkerModel } from "./worker-controller";
import {
  isBoundedPoseOverlay,
  isCurlScoringTemplate,
  isFormCoachRepSummary,
  isFormCoachWorkerMessage,
  type FormCoachRepSummary,
  type FormCoachRunMode,
  type NetworkAuditEntry,
  type SetupStep,
} from "./worker-protocol";
import type { CurlScoringTemplate, PoseLandmark, TrackedArm } from "./engine/types";

const MANIFEST_PATH = "/form-coach-assets/form-coach-worker/manifest.json";
const WORKER_PATH_PATTERN = /^\/form-coach-worker\/([a-f0-9]{64})\/worker\.js$/;
const CONTROLLER_MESSAGE_TYPES = new Set(["ready", "processed", "rep-summary", "cue", "stopped", "error"]);
const SETUP_STEPS = new Set<SetupStep>(["show-side-view", "move-back", "extend-arm-hold", "ready", "low-confidence"]);

export type FormCoachRuntimeFailure =
  | "unsupported-browser"
  | "asset-manifest-failed"
  | "worker-start-failed"
  | "frame-capture-failed"
  | "invalid-capture-timestamp"
  | "timeline-reset-required"
  | "unsupported-arm-mode"
  | "cancelled"
  | WorkerErrorCode;

export class FormCoachRuntimeError extends Error {
  readonly code: FormCoachRuntimeFailure;

  constructor(code: FormCoachRuntimeFailure) {
    super("Form Coach processing could not continue.");
    this.name = "FormCoachRuntimeError";
    this.code = code;
  }
}

export interface FormCoachPerformanceSummary {
  readonly fps: number | null;
  readonly status: FrameRateSnapshot["status"];
  readonly targetFps: number;
  readonly slowNotice: boolean;
  readonly droppedFrames: number;
  readonly processedFrames: number;
}

export interface FormCoachRuntimeOptions {
  readonly mode: FormCoachRunMode;
  readonly arm?: TrackedArm;
  readonly signal?: AbortSignal;
  /** Starts a dedicated CPU Worker without first making a GPU context, for constrained devices. */
  readonly forceCpu?: boolean;
  readonly referenceRepTarget?: number;
  readonly template?: CurlScoringTemplate;
  readonly onReady?: (info: { readonly model: WorkerModel; readonly delegate: "GPU" | "CPU" }) => void;
  readonly onSetup?: (step: SetupStep) => void;
  readonly onOverlay?: (landmarks: readonly (PoseLandmark | null)[]) => void;
  readonly onRep?: (summary: FormCoachRepSummary) => void;
  readonly onReferenceReady?: (template: CurlScoringTemplate, cleanRepCount: number) => void;
  readonly onCue?: (cue: string) => void;
  readonly onPerformance?: (summary: FormCoachPerformanceSummary) => void;
  readonly onNetworkAudit?: (summary: { readonly allowedAssetGets: number; readonly allowed: readonly NetworkAuditEntry[]; readonly blocked: readonly NetworkAuditEntry[]; readonly observed: readonly NetworkAuditEntry[] }) => void;
  readonly onSetBoundary?: () => void;
  readonly onTimelineResetRequired?: () => void;
  readonly onError?: (code: FormCoachRuntimeFailure) => void;
}

export interface FormCoachProcessingSession {
  readonly model: WorkerModel;
  readonly delegate: "GPU" | "CPU";
  readonly mode: FormCoachRunMode;
  stop(): Promise<void>;
}

type FrameCallbackMetadata = Readonly<{ mediaTime: number }>;
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: FrameCallbackMetadata) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

type WorkerMessage = Readonly<Record<string, unknown>>;

function isControllerMessage(data: unknown): data is WorkerMessage {
  return isFormCoachWorkerMessage(data) && typeof data.type === "string" && CONTROLLER_MESSAGE_TYPES.has(data.type);
}

function isNetworkAudit(value: unknown): value is { readonly allowedAssetGets: number; readonly allowed: readonly NetworkAuditEntry[]; readonly blocked: readonly NetworkAuditEntry[]; readonly observed: readonly NetworkAuditEntry[] } {
  if (!value || typeof value !== "object") return false;
  const audit = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(audit.allowedAssetGets) && (audit.allowedAssetGets as number) >= 0 &&
    Array.isArray(audit.allowed) && audit.allowed.length <= 16 && audit.allowed.every(isNetworkAuditEntry) &&
    Array.isArray(audit.blocked) && audit.blocked.length <= 16 && audit.blocked.every(isNetworkAuditEntry) &&
    Array.isArray(audit.observed) && audit.observed.length <= 16 && audit.observed.every(isNetworkAuditEntry)
  );
}

function isNetworkAuditEntry(entry: unknown): entry is NetworkAuditEntry {
  if (!entry || typeof entry !== "object") return false;
  const item = entry as Record<string, unknown>;
  return (
    typeof item.method === "string" && item.method.length <= 12 &&
    typeof item.host === "string" && item.host.length <= 100 &&
    typeof item.path === "string" && item.path.startsWith("/") && item.path.length <= 160 && !item.path.includes("?") && !item.path.includes("#") &&
    Number.isSafeInteger(item.count) && (item.count as number) > 0
  );
}

function selectModel(): WorkerModel {
  try {
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const hardware = navigator.hardwareConcurrency;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (!coarsePointer && finePointer && Number.isFinite(hardware) && hardware >= 4 && Number.isFinite(memory) && (memory as number) >= 4) {
      return "full";
    }
  } catch {
    // Unknown capability profiles stay on the Lite model.
  }
  return "lite";
}

function manifestWorkerUrl(value: unknown, origin: string): string | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Record<string, unknown>;
  if (manifest.version !== 1 || manifest.sdkVersion !== "1.2.3" || typeof manifest.workerUrl !== "string" || typeof manifest.bundleHash !== "string") {
    return null;
  }
  const match = WORKER_PATH_PATTERN.exec(manifest.workerUrl);
  if (!match || match[1] !== manifest.bundleHash) return null;
  try {
    const parsed = new URL(manifest.workerUrl, origin);
    if (parsed.origin !== origin || parsed.pathname !== manifest.workerUrl || parsed.search !== "" || parsed.hash !== "") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

async function loadWorkerUrl(): Promise<string> {
  const origin = location.origin;
  const decision = validateFormCoachAssetRequest(
    {
      url: MANIFEST_PATH,
      method: "GET",
      mode: "same-origin",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
    { trustedOrigin: origin, allowedPaths: [MANIFEST_PATH] },
  );
  if (!decision.allowed) throw new FormCoachRuntimeError("asset-manifest-failed");
  try {
    const response = await fetch(decision.url, decision.init);
    if (!response.ok) throw new FormCoachRuntimeError("asset-manifest-failed");
    const url = manifestWorkerUrl(await response.json(), origin);
    if (!url) throw new FormCoachRuntimeError("asset-manifest-failed");
    return url;
  } catch (error) {
    if (error instanceof FormCoachRuntimeError) throw error;
    throw new FormCoachRuntimeError("asset-manifest-failed");
  }
}

class ControllerWorkerPort implements WorkerPortLike {
  private readonly messageListeners = new Map<(event: Readonly<{ data: unknown }>) => void, (event: MessageEvent<unknown>) => void>();
  private readonly eventListeners = new Map<() => void, EventListener>();

  constructor(
    private readonly worker: Worker,
    private readonly mode: FormCoachRunMode,
    private readonly arm: TrackedArm,
    private readonly referenceRepTarget: number,
    private readonly template: CurlScoringTemplate | undefined,
    private readonly gpuCanvas: OffscreenCanvas | null,
    private readonly forceCpu: boolean,
  ) {}

  postMessage(message: unknown, transfer: readonly unknown[] = []): void {
    if (isFormCoachWorkerMessage(message) && message.type === "init") {
      const init = {
        ...message,
        mode: this.mode,
        arm: this.arm,
        referenceRepTarget: this.referenceRepTarget,
        forceCpu: this.forceCpu,
        gpuCanvas: this.forceCpu ? null : this.gpuCanvas,
        ...(this.mode === "live" ? { template: this.template } : {}),
      };
      const transferables = [...transfer, ...(!this.forceCpu && this.gpuCanvas ? [this.gpuCanvas] : [])] as Transferable[];
      this.worker.postMessage(init, transferables);
      return;
    }
    this.worker.postMessage(message, transfer as Transferable[]);
  }

  addEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  addEventListener(type: "message" | "error" | "messageerror", listener: ((event: Readonly<{ data: unknown }>) => void) | (() => void)): void {
    if (type === "message") {
      const handler = (event: MessageEvent<unknown>) => {
        if (isControllerMessage(event.data)) (listener as (event: Readonly<{ data: unknown }>) => void)({ data: event.data });
      };
      this.messageListeners.set(listener as (event: Readonly<{ data: unknown }>) => void, handler);
      this.worker.addEventListener("message", handler);
      return;
    }
    const handler: EventListener = () => (listener as () => void)();
    this.eventListeners.set(listener as () => void, handler);
    this.worker.addEventListener(type, handler);
  }

  removeEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: () => void): void;
  removeEventListener(type: "message" | "error" | "messageerror", listener: ((event: Readonly<{ data: unknown }>) => void) | (() => void)): void {
    if (type === "message") {
      const handler = this.messageListeners.get(listener as (event: Readonly<{ data: unknown }>) => void);
      if (handler) this.worker.removeEventListener("message", handler);
      this.messageListeners.delete(listener as (event: Readonly<{ data: unknown }>) => void);
      return;
    }
    const handler = this.eventListeners.get(listener as () => void);
    if (handler) this.worker.removeEventListener(type, handler);
    this.eventListeners.delete(listener as () => void);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

function createTransferredGpuCanvas(): OffscreenCanvas | null {
  if (typeof document === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  const canvas = document.createElement("canvas");
  const transfer = (canvas as HTMLCanvasElement & { transferControlToOffscreen?: () => OffscreenCanvas }).transferControlToOffscreen;
  if (typeof transfer !== "function") return null;
  try {
    canvas.width = 1;
    canvas.height = 1;
    return transfer.call(canvas);
  } catch {
    return null;
  }
}

function createRuntimeError(code: FormCoachRuntimeFailure): FormCoachRuntimeError {
  return new FormCoachRuntimeError(code);
}

/** Starts processing frames from an already supplied video element; it never requests camera or audio access. */
export async function startFormCoachProcessing(
  video: HTMLVideoElement,
  options: FormCoachRuntimeOptions,
): Promise<FormCoachProcessingSession> {
  if (
    typeof window === "undefined" || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap !== "function" || !video
  ) {
    throw createRuntimeError("unsupported-browser");
  }
  if (options.mode === "live" && !isCurlScoringTemplate(options.template)) throw createRuntimeError("worker-start-failed");
  if (options.mode !== "reference" && options.mode !== "live") throw createRuntimeError("worker-start-failed");
  const arm = options.arm ?? "auto";
  if (arm === "both") throw createRuntimeError("unsupported-arm-mode");
  if (arm !== "auto" && arm !== "left" && arm !== "right") throw createRuntimeError("worker-start-failed");
  if (options.signal?.aborted) throw createRuntimeError("cancelled");
  const referenceRepTarget = options.referenceRepTarget ?? 3;
  if (!Number.isInteger(referenceRepTarget) || referenceRepTarget < 3 || referenceRepTarget > 5) {
    throw createRuntimeError("worker-start-failed");
  }

  const frameVideo = video as VideoWithFrameCallback;
  if (typeof frameVideo.requestVideoFrameCallback !== "function" || typeof frameVideo.cancelVideoFrameCallback !== "function") {
    throw createRuntimeError("unsupported-browser");
  }
  const workerUrl = await loadWorkerUrl();
  if (options.signal?.aborted) throw createRuntimeError("cancelled");
  const model = selectModel();
  const forceCpuInitial = options.forceCpu === true;
  let worker: Worker;
  try {
    worker = new Worker(workerUrl, { type: "module", credentials: "omit", name: forceCpuInitial ? "form-coach-pose-cpu" : "form-coach-pose" });
  } catch {
    throw createRuntimeError("worker-start-failed");
  }
  const gpuCanvas = createTransferredGpuCanvas();
  const epoch = Math.max(1, Math.floor(performance.now() * 1000));
  let lastReceiverTimestampMs = -1;
  const receiverNow = () => {
    const timestamp = performance.now();
    const normalized = Number.isFinite(timestamp) && timestamp > lastReceiverTimestampMs ? timestamp : lastReceiverTimestampMs + 0.001;
    lastReceiverTimestampMs = normalized;
    return normalized;
  };

  let frameSender: FrameSender<ImageBitmap> | null = null;
  let controller!: WorkerController;
  let closed = false;
  let preparingFrame = false;
  let captureCallbackId: number | null = null;
  let performanceTimer: ReturnType<typeof setInterval> | null = null;
  let lastCaptureTimestampMs = -1;
  let videoEnded = false;
  let errorNotified = false;
  let readySettled = false;
  let readyResolve!: (value: FormCoachProcessingSession) => void;
  let readyReject!: (error: FormCoachRuntimeError) => void;
  let stoppedResolve!: () => void;
  let activeModelDelegate: "GPU" | "CPU" = "GPU";
  let forceCpuWorker = forceCpuInitial;
  let removeWorkerListeners = () => undefined;
  let removeAbortListener: () => void = () => {};
  let finalization: Promise<void> | null = null;
  const stopped = new Promise<void>((resolve) => { stoppedResolve = resolve; });
  const ready = new Promise<FormCoachProcessingSession>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const frameRate = createFrameRateMonitor({ targetFps: 20, slowThresholdFps: 15, slowDurationMs: 3_000 });

  function cancelCapture(): void {
    if (captureCallbackId !== null) {
      frameVideo.cancelVideoFrameCallback?.(captureCallbackId);
      captureCallbackId = null;
    }
  }

  function removeVideoListeners(): void {
    video.removeEventListener("seeking", onTimelineDiscontinuity);
    video.removeEventListener("ended", onVideoEnded);
  }

  function finishWorkerAfterStop(): Promise<void> {
    if (finalization) return finalization;
    finalization = new Promise<void>((resolve) => {
      const timeoutId = setTimeout(resolve, 3_000);
      void stopped.then(() => {
        clearTimeout(timeoutId);
        resolve();
      });
    }).then(() => {
      controller.dispose();
      removeWorkerListeners();
      removeAbortListener();
      stoppedResolve();
    });
    return finalization;
  }

  function notifyError(code: FormCoachRuntimeFailure): void {
    if (errorNotified) return;
    errorNotified = true;
    options.onError?.(code);
    if (!readySettled) {
      readySettled = true;
      readyReject(createRuntimeError(code));
    }
    frameSender?.stop();
    cancelCapture();
    if (performanceTimer !== null) clearInterval(performanceTimer);
    performanceTimer = null;
    closed = true;
    removeVideoListeners();
    const terminal = controller.getState() === "stopped" || controller.getState() === "failed";
    if (!terminal) controller.requestStop();
    finishWorkerAfterStop();
  }

  function publishPerformance(nowMs = performance.now()): void {
    if (closed) return;
    const snapshot = frameRate.snapshot(Math.max(0, nowMs));
    options.onPerformance?.({
      fps: snapshot.fps,
      status: snapshot.status,
      targetFps: snapshot.targetFps,
      slowNotice: snapshot.slowNotice,
      droppedFrames: snapshot.totalDroppedFrames,
      processedFrames: snapshot.processedFramesInWindow,
    });
  }

  function onTimelineDiscontinuity(): void {
    if (closed || videoEnded) return;
    options.onTimelineResetRequired?.();
    if (!errorNotified) {
      errorNotified = true;
      options.onError?.("timeline-reset-required");
    }
    void stop();
  }

  function onVideoEnded(): void {
    videoEnded = true;
    void stop();
  }

  function scheduleCapture(): void {
    if (closed) return;
    captureCallbackId = frameVideo.requestVideoFrameCallback?.((now, metadata) => {
      captureCallbackId = null;
      if (closed) return;
      let captureTimestampMs: number;
      if (options.mode === "reference") {
        if (!Number.isFinite(metadata.mediaTime) || metadata.mediaTime < 0) {
          notifyError("invalid-capture-timestamp");
          return;
        }
        captureTimestampMs = metadata.mediaTime * 1_000;
        if (captureTimestampMs < lastCaptureTimestampMs) {
          onTimelineDiscontinuity();
          return;
        }
        if (captureTimestampMs === lastCaptureTimestampMs) {
          frameSender?.recordDroppedFrame();
          scheduleCapture();
          return;
        }
      } else {
        if (!Number.isFinite(now) || now < 0) {
          notifyError("invalid-capture-timestamp");
          return;
        }
        captureTimestampMs = now > lastCaptureTimestampMs ? now : lastCaptureTimestampMs + 0.001;
      }
      lastCaptureTimestampMs = captureTimestampMs;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleCapture();
        return;
      }
      if (preparingFrame || frameSender?.hasInFlightFrame()) {
        frameSender?.recordDroppedFrame();
        scheduleCapture();
        return;
      }
      preparingFrame = true;
      void createImageBitmap(video)
        .then((bitmap) => {
          if (closed || !frameSender) {
            bitmap.close();
            return;
          }
          const offered = frameSender.offer(bitmap, captureTimestampMs);
          if (offered.status === "rejected" && offered.code !== "stopped") notifyError("worker-failed");
        })
        .catch(() => notifyError("frame-capture-failed"))
        .finally(() => { preparingFrame = false; });
      scheduleCapture();
    });
  }

  function onControllerEvent(event: WorkerControllerEvent): void {
    if (event.type === "ready") {
      activeModelDelegate = event.delegate;
      frameSender = createFrameSender<ImageBitmap>({
        sessionEpoch: epoch,
        send(message, transfer) {
          return controller.sendFrame(message, transfer);
        },
      });
      options.onReady?.({ model: event.model, delegate: event.delegate });
      video.addEventListener("seeking", onTimelineDiscontinuity);
      video.addEventListener("ended", onVideoEnded);
      performanceTimer = setInterval(() => publishPerformance(receiverNow()), 250);
      scheduleCapture();
      if (!readySettled) {
        readySettled = true;
        readyResolve(session);
      }
      return;
    }
    if (event.type === "processed") {
      const completion = frameSender?.complete(event.sequence, event.captureTimestampMs, event.completionTimestampMs);
      if (!completion || completion.status === "processed") {
        if (completion?.status === "processed") {
          frameRate.recordFrame(completion.completionTimestampMs, completion.droppedFramesSincePrevious);
          publishPerformance(completion.completionTimestampMs);
        }
      } else if (completion.status === "rejected" && !closed) {
        notifyError("worker-failed");
      }
      return;
    }
    if (event.type === "cue") {
      options.onCue?.(event.cue);
      return;
    }
    if (event.type === "error") {
      if (event.code === "gpu-init-failed" && !readySettled && !forceCpuWorker && startCpuFallback()) return;
      notifyError(event.code);
      return;
    }
    if (event.type === "stopped") stoppedResolve();
  }

  function onRuntimeMessage(event: MessageEvent<unknown>): void {
    const data = event.data;
    if (!isFormCoachWorkerMessage(data) || data.version !== 1 || data.sessionEpoch !== epoch || typeof data.type !== "string") return;
    if (CONTROLLER_MESSAGE_TYPES.has(data.type)) return;
    if (data.type === "setup") {
      if (SETUP_STEPS.has(data.step as SetupStep)) options.onSetup?.(data.step as SetupStep);
      else notifyError("worker-failed");
      return;
    }
    if (data.type === "overlay") {
      if (isBoundedPoseOverlay(data.landmarks)) options.onOverlay?.(data.landmarks);
      else notifyError("worker-failed");
      return;
    }
    if (data.type === "rep-result") {
      if (isFormCoachRepSummary(data.summary)) options.onRep?.(data.summary);
      else notifyError("worker-failed");
      return;
    }
    if (data.type === "reference-ready") {
      if (isCurlScoringTemplate(data.template) && Number.isInteger(data.cleanRepCount) && (data.cleanRepCount as number) >= 3 && (data.cleanRepCount as number) <= 5) {
        options.onReferenceReady?.(data.template, data.cleanRepCount as number);
        void stop();
      } else notifyError("worker-failed");
      return;
    }
    if (data.type === "set-boundary") {
      if (data.reason === "session_sample_limit") {
        options.onSetBoundary?.();
        void stop();
      } else notifyError("worker-failed");
      return;
    }
    if (data.type === "network-audit") {
      if (isNetworkAudit(data)) options.onNetworkAudit?.({
        allowedAssetGets: data.allowedAssetGets as number,
        allowed: data.allowed,
        blocked: data.blocked,
        observed: data.observed,
      });
      else notifyError("worker-failed");
      return;
    }
    notifyError("worker-failed");
  }

  function attachWorker(targetWorker: Worker, forceCpu: boolean): boolean {
    worker = targetWorker;
    forceCpuWorker = forceCpu;
    const port = new ControllerWorkerPort(worker, options.mode, arm, referenceRepTarget, options.template, gpuCanvas, forceCpu);
    controller = createWorkerController({ port, sessionEpoch: epoch, now: receiverNow, onEvent: onControllerEvent });
    const onWorkerError = () => notifyError("worker-failed");
    const onWorkerMessageError = () => notifyError("worker-failed");
    removeWorkerListeners = () => {
      worker.removeEventListener("message", onRuntimeMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onWorkerMessageError);
    };
    worker.addEventListener("message", onRuntimeMessage);
    worker.addEventListener("error", onWorkerError);
    worker.addEventListener("messageerror", onWorkerMessageError);
    return controller.start(model);
  }

  function startCpuFallback(): boolean {
    if (closed || readySettled || forceCpuWorker) return false;
    removeWorkerListeners();
    controller.dispose();
    let replacement: Worker;
    try {
      replacement = new Worker(workerUrl, { type: "module", credentials: "omit", name: "form-coach-pose-cpu" });
    } catch {
      notifyError("worker-start-failed");
      return false;
    }
    if (!attachWorker(replacement, true)) {
      notifyError("worker-start-failed");
      return false;
    }
    return true;
  }

  const onAbort = () => { void stop(); };
  if (options.signal) {
    options.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
  }

  async function stop(): Promise<void> {
    if (closed) {
      await stopped;
      return;
    }
    closed = true;
    cancelCapture();
    removeVideoListeners();
    frameSender?.stop();
    if (performanceTimer !== null) clearInterval(performanceTimer);
    performanceTimer = null;
    const terminal = controller.getState() === "stopped" || controller.getState() === "failed";
    if (!terminal) controller.requestStop();
    await finishWorkerAfterStop();
    if (!readySettled) {
      readySettled = true;
      readyReject(createRuntimeError(options.signal?.aborted ? "cancelled" : "worker-start-failed"));
    }
    stoppedResolve();
  }

  const session: FormCoachProcessingSession = {
    model,
    get delegate() { return activeModelDelegate; },
    mode: options.mode,
    stop,
  };

  try {
    if (!attachWorker(worker, forceCpuInitial)) throw createRuntimeError("worker-start-failed");
    if (options.signal?.aborted) void stop();
    return await ready;
  } catch (error) {
    await stop();
    if (error instanceof FormCoachRuntimeError) throw error;
    throw createRuntimeError("worker-start-failed");
  }
}
