"use client";

import { createFrameRateMonitor, type FrameRateSnapshot } from "./frame-rate";
import { createFrameSender, type FrameSender } from "./frame-sender";
import { validateFormCoachAssetRequest } from "./session-network-policy";
import { createWorkerController, type WorkerController, type WorkerControllerEvent, type WorkerPortLike, type WorkerErrorCode, type WorkerModel } from "./worker-controller";
import {
  hasExactKeys,
  isBoundedPoseOverlay,
  isCurlScoringTemplate,
  isFormCoachRepSummary,
  isFormCoachWorkerMessage,
  isReferenceCaptureCandidateSummary,
  isReferenceCapturePauseReason,
  type FormCoachRepSummary,
  type FormCoachRunMode,
  type NetworkAuditEntry,
  type SetupStep,
} from "./worker-protocol";
import { STANDING_DUMBBELL_CURL } from "./engine/registry";
import type { CameraView } from "./engine/types";
import { serializeFormCoachRepResult, type PersistableFormCoachRepResult } from "./runtime-results";
import type { CurlScoringTemplate, PoseLandmark, TrackedArm } from "./engine/types";
import { safeParseExerciseTemplate, type ExerciseTemplate } from "./template-schema";
import type { ReferenceCaptureCandidateSummary, ReferenceCapturePauseReason } from "./worker-protocol";

const MANIFEST_PATH = "/form-coach-assets/form-coach-worker/manifest.json";
const WORKER_PATH_PATTERN = /^\/form-coach-worker\/([a-f0-9]{64})\/worker\.js$/;
const CONTROLLER_MESSAGE_TYPES = new Set(["ready", "processed", "rep-summary", "cue", "stopped", "error"]);
const SETUP_STEPS = new Set<SetupStep>(["show-side-view", "show-required-view", "show-both-arms", "move-back", "extend-arm-hold", "ready", "low-confidence"]);

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
  readonly cameraView?: CameraView;
  readonly signal?: AbortSignal;
  /** Starts a dedicated CPU Worker without first making a GPU context, for constrained devices. */
  readonly forceCpu?: boolean;
  readonly referenceRepTarget?: number;
  readonly template?: CurlScoringTemplate;
  readonly onReady?: (info: { readonly model: WorkerModel; readonly delegate: "GPU" | "CPU" }) => void;
  readonly onSetup?: (step: SetupStep) => void;
  readonly onOverlay?: (landmarks: readonly (PoseLandmark | null)[]) => void;
  readonly onRep?: (summary: FormCoachRepSummary) => void;
  readonly onRepResult?: (result: PersistableFormCoachRepResult) => void;
  readonly onRepResultRejected?: (reason: "outside-persisted-result-domain") => void;
  readonly onPairRejected?: (reason: "missing-partner" | "out-of-phase" | "phase-mismatch" | "asymmetric") => void;
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

export type ReferenceCaptureBuildFailureCode = "not-paused" | "stale-generation" | "invalid-selection" | "already-built" | "invalid-request" | "worker-failed";

export type ReferenceCaptureBuildResult =
  | Readonly<{ ok: true; template: ExerciseTemplate; requestId: number; candidateGeneration: number; selectedCandidateIds: readonly string[] }>
  | Readonly<{ ok: false; code: ReferenceCaptureBuildFailureCode; requestId: number; candidateGeneration: number; selectedCandidateIds: readonly string[] }>;

export interface FormCoachReferenceCaptureSession extends FormCoachProcessingSession {
  readonly mode: "reference";
  pauseCapture(reason?: "user_pause"): Promise<Readonly<{
    sessionEpoch: number;
    requestId: number;
    lastProcessedSequence: number;
    candidateGeneration: number;
    reason: ReferenceCapturePauseReason;
  }>>;
  buildReference(selectedCandidateIds: readonly string[]): Promise<ReferenceCaptureBuildResult>;
}

export interface FormCoachReferenceCaptureOptions {
  readonly baseTemplate: ExerciseTemplate;
  readonly signal?: AbortSignal;
  readonly forceCpu?: boolean;
  readonly onReady?: (info: { readonly model: WorkerModel; readonly delegate: "GPU" | "CPU" }) => void;
  readonly onSetup?: (step: SetupStep) => void;
  readonly onCandidate?: (candidate: ReferenceCaptureCandidateSummary, candidateGeneration: number) => void;
  readonly onPaused?: (value: { readonly candidateGeneration: number; readonly reason: ReferenceCapturePauseReason }) => void;
  readonly onBuilt?: (result: Extract<ReferenceCaptureBuildResult, { ok: true }>) => void;
  readonly onBuildRejected?: (result: Extract<ReferenceCaptureBuildResult, { ok: false }>) => void;
  readonly onError?: (code: FormCoachRuntimeFailure) => void;
  readonly onTimelineResetRequired?: () => void;
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
    private readonly cameraView: CameraView,
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
        cameraView: this.cameraView,
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

/** Separate opt-in bridge; the existing controller port/filter remains unchanged. */
class ReferenceCaptureWorkerPort implements WorkerPortLike {
  private readonly messageListeners = new Map<(event: Readonly<{ data: unknown }>) => void, (event: MessageEvent<unknown>) => void>();
  private readonly eventListeners = new Map<() => void, EventListener>();

  constructor(
    private readonly worker: Worker,
    private readonly arm: TrackedArm,
    private readonly cameraView: CameraView,
    private readonly baseTemplate: ExerciseTemplate,
    private readonly gpuCanvas: OffscreenCanvas | null,
    private readonly forceCpu: boolean,
  ) {}

  postMessage(message: unknown, transfer: readonly unknown[] = []): void {
    if (isFormCoachWorkerMessage(message) && message.type === "init") {
      const init = {
        ...message,
        mode: "reference" as const,
        arm: this.arm,
        cameraView: this.cameraView,
        referenceRepTarget: 3,
        forceCpu: this.forceCpu,
        gpuCanvas: this.forceCpu ? null : this.gpuCanvas,
        referenceSelection: this.baseTemplate,
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

type ReferenceCaptureRuntimeConfig = Omit<FormCoachReferenceCaptureOptions, "baseTemplate" | "signal" | "forceCpu"> & Readonly<{ baseTemplate: ExerciseTemplate }>;

/** Starts processing frames from an already supplied video element; it never requests camera or audio access. */
export function startFormCoachProcessing(video: HTMLVideoElement, options: FormCoachRuntimeOptions): Promise<FormCoachProcessingSession> {
  return startFormCoachProcessingInternal(video, options) as Promise<FormCoachProcessingSession>;
}

/** Starts the opt-in local candidate capture flow; it never requests camera or audio access. */
export function startFormCoachReferenceCapture(
  video: HTMLVideoElement,
  options: FormCoachReferenceCaptureOptions,
): Promise<FormCoachReferenceCaptureSession> {
  const parsed = safeParseExerciseTemplate(options.baseTemplate);
  if (!parsed.success || parsed.data.exerciseKey !== STANDING_DUMBBELL_CURL.exerciseKey) {
    return Promise.reject(createRuntimeError("worker-start-failed"));
  }
  const baseTemplate = parsed.data;
  const runtimeOptions: FormCoachRuntimeOptions = {
    mode: "reference",
    arm: baseTemplate.arm,
    cameraView: baseTemplate.cameraView,
    signal: options.signal,
    forceCpu: options.forceCpu,
    onReady: options.onReady,
    onSetup: options.onSetup,
    onError: options.onError,
    onTimelineResetRequired: options.onTimelineResetRequired,
  };
  return startFormCoachProcessingInternal(video, runtimeOptions, { ...options, baseTemplate }) as Promise<FormCoachReferenceCaptureSession>;
}

async function startFormCoachProcessingInternal(
  video: HTMLVideoElement,
  options: FormCoachRuntimeOptions,
  captureConfig?: ReferenceCaptureRuntimeConfig,
): Promise<FormCoachProcessingSession | FormCoachReferenceCaptureSession> {
  if (
    typeof window === "undefined" || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap !== "function" || !video
  ) {
    throw createRuntimeError("unsupported-browser");
  }
  if (options.mode === "live" && !isCurlScoringTemplate(options.template)) throw createRuntimeError("worker-start-failed");
  if (options.mode !== "reference" && options.mode !== "live") throw createRuntimeError("worker-start-failed");
  const arm = options.arm ?? "auto";
  if (arm !== "auto" && arm !== "left" && arm !== "right" && arm !== "both") throw createRuntimeError("worker-start-failed");
  const cameraView = options.cameraView ?? STANDING_DUMBBELL_CURL.cameraView;
  if (cameraView !== "side" && cameraView !== "front" && cameraView !== "three_quarter") throw createRuntimeError("worker-start-failed");
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
  let captureState: "running" | "pausing" | "paused" | "closed" | "none" = captureConfig ? "running" : "none";
  const captureSource = video.currentSrc || video.src || "";
  const captureSourceObject = video.srcObject;
  let captureDimensions: Readonly<{ width: number; height: number }> | null = null;
  let candidateGeneration = 0;
  let candidateIds: string[] = [];
  let pauseRequestId = 0;
  let buildRequestId = 0;
  let pendingPauseTargetSequence: number | null = null;
  let requestedPauseReason: ReferenceCapturePauseReason | null = null;
  let workerRequiredPauseReason: ReferenceCapturePauseReason | null = null;
  let pauseReasonForAck: ReferenceCapturePauseReason | null = null;
  let lastPauseAck: Awaited<ReturnType<FormCoachReferenceCaptureSession["pauseCapture"]>> | null = null;
  let pendingPauseResolve: ((value: Awaited<ReturnType<FormCoachReferenceCaptureSession["pauseCapture"]>>) => void) | null = null;
  let pendingPauseReject: ((error: FormCoachRuntimeError) => void) | null = null;
  let pendingBuild: Readonly<{
    requestId: number;
    candidateGeneration: number;
    selectedCandidateIds: readonly string[];
    resolve: (result: ReferenceCaptureBuildResult) => void;
  }> | null = null;
  let pendingBitmap: Promise<void> | null = null;
  let frameDrainWaiters: Array<() => void> = [];
  let lastProcessedSequence = 0;
  let capturePausePromise: Promise<Awaited<ReturnType<FormCoachReferenceCaptureSession["pauseCapture"]>>> | null = null;
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
    if (captureConfig) {
      video.removeEventListener("resize", onGeometryDiscontinuity);
      video.removeEventListener("emptied", onCaptureSourceReset);
      video.removeEventListener("loadstart", onCaptureSourceReset);
      video.removeEventListener("loadedmetadata", onGeometryDiscontinuity);
    }
  }

  function resolveFrameDrain(): void {
    const waiters = frameDrainWaiters;
    frameDrainWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function drainCaptureFrames(): Promise<void> {
    while (pendingBitmap) await pendingBitmap;
    while (frameSender?.hasInFlightFrame()) {
      await new Promise<void>((resolve) => frameDrainWaiters.push(resolve));
    }
  }

  function captureSourceIsCurrent(): boolean {
    if (!captureConfig) return true;
    const currentSource = video.currentSrc || video.src || "";
    return currentSource === captureSource && video.srcObject === captureSourceObject;
  }

  function captureSessionIsClosed(): boolean {
    return closed || captureState === "closed";
  }

  function onGeometryDiscontinuity(): void {
    if (!captureConfig || closed || captureState === "closed") return;
    if (!captureSourceIsCurrent()) {
      onTimelineDiscontinuity();
      return;
    }
    if (captureDimensions &&
        (video.videoWidth !== captureDimensions.width || video.videoHeight !== captureDimensions.height)) {
      onTimelineDiscontinuity();
    }
  }

  function onCaptureSourceReset(): void {
    if (!captureConfig || closed || captureState === "closed") return;
    onTimelineDiscontinuity();
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
    resolveFrameDrain();
    if (captureConfig) {
      captureState = "closed";
      candidateIds = [];
      requestedPauseReason = null;
      workerRequiredPauseReason = null;
      pauseReasonForAck = null;
      pendingPauseReject?.(createRuntimeError(code));
      pendingPauseReject = null;
      pendingPauseResolve = null;
      if (pendingBuild) {
        pendingBuild.resolve({ ok: false, code: "worker-failed", requestId: pendingBuild.requestId, candidateGeneration: pendingBuild.candidateGeneration, selectedCandidateIds: pendingBuild.selectedCandidateIds });
        pendingBuild = null;
      }
    }
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
    if (closed || (videoEnded && !captureConfig)) return;
    options.onTimelineResetRequired?.();
    if (!errorNotified) {
      errorNotified = true;
      options.onError?.("timeline-reset-required");
    }
    void stop();
  }

  function onVideoEnded(): void {
    videoEnded = true;
    if (captureConfig) void pauseCaptureInternal("video_end").catch(() => undefined);
    else void stop();
  }

  function onReferenceCapturePauseRequired(data: Record<string, unknown>): void {
    if (!captureConfig || closed || captureState === "closed" ||
        !hasExactKeys(data, ["version", "type", "sessionEpoch", "reason", "lastProcessedSequence", "candidateGeneration"]) ||
        data.version !== 1 || data.type !== "reference-capture-pause-required" || data.sessionEpoch !== epoch ||
        !isReferenceCapturePauseReason(data.reason) || !Number.isSafeInteger(data.lastProcessedSequence) ||
        !Number.isSafeInteger(data.candidateGeneration) || (data.candidateGeneration as number) !== candidateGeneration) {
      if (captureConfig && !closed) notifyError("worker-failed");
      return;
    }
    if ((workerRequiredPauseReason !== null && workerRequiredPauseReason !== data.reason) ||
        (pendingPauseTargetSequence !== null && pendingPauseTargetSequence !== data.lastProcessedSequence)) {
      notifyError("worker-failed");
      return;
    }
    workerRequiredPauseReason = data.reason;
    pendingPauseTargetSequence = data.lastProcessedSequence as number;
    void pauseCaptureInternal(data.reason, true).catch(() => undefined);
  }

  function onReferenceCaptureMessage(data: Record<string, unknown>): void {
    if (!captureConfig || closed || data.sessionEpoch !== epoch) return;
    if (data.type === "reference-candidate") {
      if (!hasExactKeys(data, ["version", "type", "sessionEpoch", "candidateGeneration", "candidate"]) ||
          data.version !== 1 || !Number.isSafeInteger(data.candidateGeneration) ||
          (data.candidateGeneration as number) !== candidateGeneration + 1 ||
          (captureState !== "running" && captureState !== "pausing") ||
          !isReferenceCaptureCandidateSummary(data.candidate)) {
        notifyError("worker-failed");
        return;
      }
      candidateGeneration = data.candidateGeneration as number;
      candidateIds.push(data.candidate.id);
      captureConfig.onCandidate?.(data.candidate, candidateGeneration);
      return;
    }
    if (data.type === "reference-capture-pause-required") {
      onReferenceCapturePauseRequired(data);
      return;
    }
    if (data.type === "reference-capture-paused") {
      if (!hasExactKeys(data, ["version", "type", "sessionEpoch", "requestId", "lastProcessedSequence", "candidateGeneration", "reason"]) ||
          data.version !== 1 || !Number.isSafeInteger(data.requestId) || (data.requestId as number) !== pauseRequestId ||
          !Number.isSafeInteger(data.lastProcessedSequence) || (data.lastProcessedSequence as number) !== lastProcessedSequence ||
          (pendingPauseTargetSequence !== null && (data.lastProcessedSequence as number) !== pendingPauseTargetSequence) ||
          !Number.isSafeInteger(data.candidateGeneration) || (data.candidateGeneration as number) !== candidateGeneration ||
          !isReferenceCapturePauseReason(data.reason) || data.reason !== pauseReasonForAck || captureState !== "pausing") {
        notifyError("worker-failed");
        return;
      }
      captureState = "paused";
      pendingPauseTargetSequence = null;
      const ack = {
        sessionEpoch: epoch,
        requestId: pauseRequestId,
        lastProcessedSequence,
        candidateGeneration,
        reason: data.reason,
      } as const;
      lastPauseAck = ack;
      try {
        captureConfig.onPaused?.({ candidateGeneration, reason: data.reason });
      } catch {
        // Observation callbacks cannot prevent the pause operation from settling.
      }
      pendingPauseResolve?.(ack);
      pendingPauseResolve = null;
      pendingPauseReject = null;
      requestedPauseReason = null;
      workerRequiredPauseReason = null;
      pauseReasonForAck = null;
      return;
    }
    if (data.type === "reference-built" || data.type === "reference-build-rejected") {
      const pending = pendingBuild;
      const expectedKeys = data.type === "reference-built"
        ? ["version", "type", "sessionEpoch", "requestId", "candidateGeneration", "selectedCandidateIds", "template"]
        : ["version", "type", "sessionEpoch", "requestId", "candidateGeneration", "selectedCandidateIds", "code"];
      const idsMatch = Array.isArray(data.selectedCandidateIds) && pending &&
        data.selectedCandidateIds.length === pending.selectedCandidateIds.length &&
        data.selectedCandidateIds.every((id, index) => id === pending.selectedCandidateIds[index]);
      if (!pending || !hasExactKeys(data, expectedKeys) || data.version !== 1 || data.sessionEpoch !== epoch ||
          data.requestId !== pending.requestId || data.candidateGeneration !== pending.candidateGeneration ||
          candidateGeneration !== pending.candidateGeneration || !idsMatch || captureState !== "paused") {
        return;
      }
      pendingBuild = null;
      if (data.type === "reference-build-rejected") {
        const codes = ["not-paused", "stale-generation", "invalid-selection", "already-built", "invalid-request"];
        if (!codes.includes(String(data.code))) {
          pending.resolve({ ok: false, code: "worker-failed", requestId: pending.requestId, candidateGeneration: pending.candidateGeneration, selectedCandidateIds: pending.selectedCandidateIds });
          return;
        }
        const result = { ok: false as const, code: data.code as ReferenceCaptureBuildFailureCode, requestId: pending.requestId, candidateGeneration: pending.candidateGeneration, selectedCandidateIds: pending.selectedCandidateIds };
        try {
          captureConfig.onBuildRejected?.(result);
        } catch {
          // Observation callbacks cannot prevent the build operation from settling.
        }
        pending.resolve(result);
        return;
      }
      const parsed = safeParseExerciseTemplate(data.template);
      if (!parsed.success) {
        pending.resolve({ ok: false, code: "worker-failed", requestId: pending.requestId, candidateGeneration: pending.candidateGeneration, selectedCandidateIds: pending.selectedCandidateIds });
        notifyError("worker-failed");
        return;
      }
      const result = { ok: true as const, template: parsed.data, requestId: pending.requestId, candidateGeneration: pending.candidateGeneration, selectedCandidateIds: pending.selectedCandidateIds };
      try {
        captureConfig.onBuilt?.(result);
      } catch {
        // Observation callbacks cannot prevent the build operation from settling.
      }
      pending.resolve(result);
      return;
    }
  }

  function pauseCaptureInternal(reason: ReferenceCapturePauseReason, workerRequired = false): Promise<Awaited<ReturnType<FormCoachReferenceCaptureSession["pauseCapture"]>>> {
    if (!captureConfig) return Promise.reject(createRuntimeError("worker-start-failed"));
    if (captureState === "paused" && lastPauseAck) return Promise.resolve(lastPauseAck);
    if (captureState === "pausing" && capturePausePromise) {
      if (workerRequired) workerRequiredPauseReason = reason;
      else if (reason === "video_end" && workerRequiredPauseReason === null) requestedPauseReason = reason;
      return capturePausePromise;
    }
    if (captureState !== "running") return Promise.reject(createRuntimeError("cancelled"));
    captureState = "pausing";
    requestedPauseReason = reason;
    if (workerRequired) workerRequiredPauseReason = reason;
    else workerRequiredPauseReason = null;
    cancelCapture();
    const operation = (async () => {
      await drainCaptureFrames();
      if (captureSessionIsClosed()) throw createRuntimeError("cancelled");
      onGeometryDiscontinuity();
      if (captureSessionIsClosed()) throw createRuntimeError("timeline-reset-required");
      if (pendingPauseTargetSequence !== null && pendingPauseTargetSequence !== lastProcessedSequence) {
        notifyError("worker-failed");
        throw createRuntimeError("worker-failed");
      }
      const finalReason = workerRequiredPauseReason ?? requestedPauseReason ?? reason;
      pauseReasonForAck = finalReason;
      pauseRequestId += 1;
      const ack = new Promise<Awaited<ReturnType<FormCoachReferenceCaptureSession["pauseCapture"]>>>((resolve, reject) => {
        pendingPauseResolve = resolve;
        pendingPauseReject = reject;
      });
      void ack.catch(() => undefined);
      try {
        worker.postMessage({
          version: 1,
          type: "reference-capture-pause",
          sessionEpoch: epoch,
          requestId: pauseRequestId,
          lastProcessedSequence,
          reason: finalReason,
        });
      } catch {
        notifyError("worker-failed");
        throw createRuntimeError("worker-failed");
      }
      return await ack;
    })();
    capturePausePromise = operation.finally(() => { capturePausePromise = null; });
    return capturePausePromise;
  }

  function buildReferenceInternal(selectedCandidateIds: readonly string[]): Promise<ReferenceCaptureBuildResult> {
    if (!captureConfig) return Promise.resolve({ ok: false, code: "worker-failed", requestId: 0, candidateGeneration, selectedCandidateIds: [] });
    const ids = Array.isArray(selectedCandidateIds) ? [...selectedCandidateIds] : [];
    onGeometryDiscontinuity();
    if (closed || captureState === "closed") return Promise.resolve({ ok: false, code: "worker-failed", requestId: buildRequestId, candidateGeneration, selectedCandidateIds: ids });
    if (captureState !== "paused") return Promise.resolve({ ok: false, code: "not-paused", requestId: buildRequestId, candidateGeneration, selectedCandidateIds: ids });
    if (ids.length < 3 || ids.length > 5 || new Set(ids).size !== ids.length || ids.some((id) => !candidateIds.includes(id))) {
      return Promise.resolve({ ok: false, code: "invalid-selection", requestId: buildRequestId, candidateGeneration, selectedCandidateIds: ids });
    }
    if (pendingBuild) return Promise.resolve({ ok: false, code: "invalid-request", requestId: buildRequestId, candidateGeneration, selectedCandidateIds: ids });
    buildRequestId += 1;
    const requestId = buildRequestId;
    return new Promise((resolve) => {
      pendingBuild = { requestId, candidateGeneration, selectedCandidateIds: ids, resolve };
      try {
        worker.postMessage({
          version: 1,
          type: "reference-build",
          sessionEpoch: epoch,
          requestId,
          candidateGeneration,
          selectedCandidateIds: ids,
        });
      } catch {
        pendingBuild = null;
        resolve({ ok: false, code: "worker-failed", requestId, candidateGeneration, selectedCandidateIds: ids });
        notifyError("worker-failed");
      }
    });
  }

  function scheduleCapture(): void {
    if (closed || (captureConfig && captureState !== "running")) return;
    captureCallbackId = frameVideo.requestVideoFrameCallback?.((now, metadata) => {
      captureCallbackId = null;
      if (closed || (captureConfig && captureState !== "running")) return;
      if (captureConfig && !captureSourceIsCurrent()) {
        onTimelineDiscontinuity();
        return;
      }
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
      const bitmapPromise = createImageBitmap(video)
        .then((bitmap) => {
          if (closed || (captureConfig && captureState !== "running") || !frameSender) {
            bitmap.close();
            return;
          }
          if (captureConfig) {
            if (!captureSourceIsCurrent()) {
              bitmap.close();
              onTimelineDiscontinuity();
              return;
            }
            if (captureDimensions && (captureDimensions.width !== bitmap.width || captureDimensions.height !== bitmap.height)) {
              bitmap.close();
              onTimelineDiscontinuity();
              return;
            }
            captureDimensions ??= { width: bitmap.width, height: bitmap.height };
          }
          const offered = frameSender.offer(bitmap, captureTimestampMs);
          if (offered.status === "rejected" && offered.code !== "stopped") notifyError("worker-failed");
        })
        .catch(() => { if (!closed) notifyError("frame-capture-failed"); })
        .finally(() => {
          preparingFrame = false;
          if (pendingBitmap === bitmapPromise) pendingBitmap = null;
          resolveFrameDrain();
        });
      pendingBitmap = bitmapPromise;
      scheduleCapture();
    });
  }

  function onControllerEvent(event: WorkerControllerEvent): void {
    if (captureConfig && captureSessionIsClosed() && event.type !== "processed" && event.type !== "stopped") return;
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
      if (captureConfig) {
        video.addEventListener("resize", onGeometryDiscontinuity);
        video.addEventListener("emptied", onCaptureSourceReset);
        video.addEventListener("loadstart", onCaptureSourceReset);
        video.addEventListener("loadedmetadata", onGeometryDiscontinuity);
      }
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
      lastProcessedSequence = event.sequence;
      resolveFrameDrain();
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
    if (captureConfig && captureSessionIsClosed()) return;
    if (captureConfig && (data.type === "reference-candidate" || data.type === "reference-capture-pause-required" || data.type === "reference-capture-paused" || data.type === "reference-built" || data.type === "reference-build-rejected")) {
      onReferenceCaptureMessage(data);
      return;
    }
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
      if (isFormCoachRepSummary(data.summary)) {
        options.onRep?.(data.summary);
        const serialized = serializeFormCoachRepResult(data.summary);
        if (serialized.ok) options.onRepResult?.(serialized.value);
        else if (serialized.reason === "outside-persisted-result-domain") options.onRepResultRejected?.(serialized.reason);
      } else notifyError("worker-failed");
      return;
    }
    if (data.type === "pair-rejected") {
      if (data.reason === "missing-partner" || data.reason === "out-of-phase" || data.reason === "phase-mismatch" || data.reason === "asymmetric") {
        options.onPairRejected?.(data.reason);
      } else notifyError("worker-failed");
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
    const port = captureConfig
      ? new ReferenceCaptureWorkerPort(worker, captureConfig.baseTemplate.arm, captureConfig.baseTemplate.cameraView, captureConfig.baseTemplate, gpuCanvas, forceCpu)
      : new ControllerWorkerPort(worker, options.mode, arm, cameraView, referenceRepTarget, options.template, gpuCanvas, forceCpu);
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
    if (captureConfig) {
      captureState = "closed";
      candidateIds = [];
      requestedPauseReason = null;
      workerRequiredPauseReason = null;
      pauseReasonForAck = null;
      pendingPauseReject?.(createRuntimeError("cancelled"));
      pendingPauseResolve = null;
      pendingPauseReject = null;
      if (pendingBuild) {
        pendingBuild.resolve({ ok: false, code: "worker-failed", requestId: pendingBuild.requestId, candidateGeneration: pendingBuild.candidateGeneration, selectedCandidateIds: pendingBuild.selectedCandidateIds });
        pendingBuild = null;
      }
      resolveFrameDrain();
    }
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

  const processingSession: FormCoachProcessingSession = {
    model,
    get delegate() { return activeModelDelegate; },
    mode: options.mode,
    stop,
  };
  const session: FormCoachProcessingSession | FormCoachReferenceCaptureSession = captureConfig
    ? {
      ...processingSession,
      pauseCapture: () => pauseCaptureInternal("user_pause"),
      buildReference: buildReferenceInternal,
    }
    : processingSession;

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
