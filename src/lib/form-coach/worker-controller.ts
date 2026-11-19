export type WorkerModel = "lite" | "full";
export type WorkerDelegate = "GPU" | "CPU";

export type WorkerErrorCode =
  | "unsupported-platform"
  | "asset-policy-rejected"
  | "sdk-init-failed"
  | "gpu-init-failed"
  | "cpu-init-failed"
  | "worker-failed"
  | "invalid-frame"
  | "processing-failed"
  | "cancelled"
  | "internal";

export type RepFaultCode =
  | "elbow_drift"
  | "torso_swing"
  | "short_rom_bottom"
  | "short_rom_top"
  | "eccentric_too_fast"
  | "shoulder_shrug";

export type CueCode =
  | "elbows_pinned"
  | "no_swing"
  | "full_range_down"
  | "full_range_up"
  | "slow_down"
  | "relax_shoulders"
  | "good_rep"
  | "keep_breathing"
  | "exhale"
  | "inhale";

/** Tri-state so callers never mistake a postMessage exception for proof no transfer occurred. */
export type WorkerFrameSendResult = "transferred" | "not-transferred" | "unknown";

export type WorkerControllerState = "idle" | "starting" | "ready" | "running" | "stopping" | "stopped" | "failed";

export type WorkerControllerEvent =
  | Readonly<{ type: "ready"; sessionEpoch: number; model: WorkerModel; delegate: WorkerDelegate }>
  | Readonly<{
      type: "processed";
      sessionEpoch: number;
      sequence: number;
      captureTimestampMs: number;
      completionTimestampMs: number;
    }>
  | Readonly<{
      type: "rep-summary";
      sessionEpoch: number;
      repNumber: number;
      score: number;
      durationMs: number;
      faults: readonly RepFaultCode[];
    }>
  | Readonly<{ type: "cue"; sessionEpoch: number; cue: CueCode }>
  | Readonly<{ type: "stopped"; sessionEpoch: number }>
  | Readonly<{ type: "error"; sessionEpoch: number; code: WorkerErrorCode }>;

export type WorkerFrameMessage<F = unknown> = Readonly<{
  version: 1;
  type: "frame";
  sessionEpoch: number;
  sequence: number;
  captureTimestampMs: number;
  width: number;
  height: number;
  droppedFramesSincePrevious: number;
  frame: F;
}>;

export interface WorkerPortLike {
  postMessage(message: unknown, transfer?: readonly unknown[]): void;
  addEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: () => void): void;
  terminate(): void;
}

export interface WorkerControllerOptions {
  readonly port: WorkerPortLike;
  readonly sessionEpoch: number;
  readonly now: () => number;
  readonly onEvent: (event: WorkerControllerEvent) => void;
}

export interface WorkerController {
  getState(): WorkerControllerState;
  start(model: WorkerModel): boolean;
  sendFrame<F>(message: WorkerFrameMessage<F>, transfer: readonly F[]): WorkerFrameSendResult;
  requestStop(): boolean;
  dispose(): void;
}

const MAX_TIMESTAMP_MS = 1_000_000_000_000;
const MAX_FRAME_DIMENSION = 4_096;
const MAX_FRAME_PIXELS = 16_777_216;
const MAX_DROPPED_FRAMES_PER_MESSAGE = 1_000_000;

const ERROR_CODES = new Set<WorkerErrorCode>([
  "unsupported-platform",
  "asset-policy-rejected",
  "sdk-init-failed",
  "gpu-init-failed",
  "cpu-init-failed",
  "worker-failed",
  "invalid-frame",
  "processing-failed",
  "cancelled",
  "internal",
]);

const FAULT_CODES = new Set<RepFaultCode>([
  "elbow_drift",
  "torso_swing",
  "short_rom_bottom",
  "short_rom_top",
  "eccentric_too_fast",
  "shoulder_shrug",
]);

const CUE_CODES = new Set<CueCode>([
  "elbows_pinned",
  "no_swing",
  "full_range_down",
  "full_range_up",
  "slow_down",
  "relax_shoulders",
  "good_rep",
  "keep_breathing",
  "exhale",
  "inhale",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isModel(value: unknown): value is WorkerModel {
  return value === "lite" || value === "full";
}

function isDelegate(value: unknown): value is WorkerDelegate {
  return value === "GPU" || value === "CPU";
}

function isFaultCode(value: unknown): value is RepFaultCode {
  return typeof value === "string" && FAULT_CODES.has(value as RepFaultCode);
}

function isCueCode(value: unknown): value is CueCode {
  return typeof value === "string" && CUE_CODES.has(value as CueCode);
}

function validateFrameMessage<F>(
  message: WorkerFrameMessage<F>,
  sessionEpoch: number,
  lastSequence: number,
  lastCaptureTimestampMs: number,
): boolean {
  if (!isRecord(message)) return false;
  if (
    !hasExactKeys(message, [
      "version",
      "type",
      "sessionEpoch",
      "sequence",
      "captureTimestampMs",
      "width",
      "height",
      "droppedFramesSincePrevious",
      "frame",
    ])
  ) {
    return false;
  }
  return (
    message.version === 1 &&
    message.type === "frame" &&
    message.sessionEpoch === sessionEpoch &&
    isSafeIntegerInRange(message.sequence, lastSequence + 1) &&
    isFiniteInRange(message.captureTimestampMs, 0, MAX_TIMESTAMP_MS) &&
    message.captureTimestampMs > lastCaptureTimestampMs &&
    isSafeIntegerInRange(message.width, 1, MAX_FRAME_DIMENSION) &&
    isSafeIntegerInRange(message.height, 1, MAX_FRAME_DIMENSION) &&
    message.width * message.height <= MAX_FRAME_PIXELS &&
    isSafeIntegerInRange(message.droppedFramesSincePrevious, 0, MAX_DROPPED_FRAMES_PER_MESSAGE) &&
    message.frame !== null &&
    message.frame !== undefined
  );
}

export function createWorkerController(options: WorkerControllerOptions): WorkerController {
  const { port, sessionEpoch, onEvent, now } = options;
  if (!isSafeIntegerInRange(sessionEpoch, 1)) throw new RangeError("sessionEpoch must be a positive safe integer.");

  let state: WorkerControllerState = "idle";
  let selectedModel: WorkerModel | null = null;
  let lastSentSequence = 0;
  let lastSentCaptureTimestampMs = -1;
  let lastProcessedSequence = 0;
  let lastProcessedCaptureTimestampMs = -1;
  let lastCompletionTimestampMs = -1;
  let lastRepNumber = 0;
  let disposed = false;

  function detachAndTerminate() {
    if (disposed) return;
    disposed = true;
    port.removeEventListener("message", onMessage);
    port.removeEventListener("error", onError);
    port.removeEventListener("messageerror", onMessageError);
    try {
      port.terminate();
    } catch {
      // Termination errors are intentionally not exposed across the protocol.
    }
  }

  function emit(event: WorkerControllerEvent) {
    try {
      onEvent(event);
    } catch {
      state = "failed";
      detachAndTerminate();
    }
  }

  function fail(code: WorkerErrorCode) {
    if (state === "failed" || state === "stopped") return;
    state = "failed";
    emit({ type: "error", sessionEpoch, code });
    detachAndTerminate();
  }

  function onError() {
    fail("worker-failed");
  }

  function onMessageError() {
    fail("worker-failed");
  }

  function onMessage(event: Readonly<{ data: unknown }>) {
    if (state === "stopped" || state === "failed" || disposed) return;
    const message = event?.data;
    if (!isRecord(message) || message.version !== 1 || !isSafeIntegerInRange(message.sessionEpoch, 1)) {
      fail("internal");
      return;
    }
    if (message.sessionEpoch !== sessionEpoch) return;

    if (message.type === "ready") {
      if (
        state !== "starting" ||
        !hasExactKeys(message, ["version", "type", "sessionEpoch", "model", "delegate"]) ||
        !isModel(message.model) ||
        message.model !== selectedModel ||
        !isDelegate(message.delegate)
      ) {
        fail("internal");
        return;
      }
      state = "ready";
      emit({ type: "ready", sessionEpoch, model: message.model, delegate: message.delegate });
      return;
    }

    if (message.type === "processed") {
      if (
        (state !== "ready" && state !== "running" && state !== "stopping") ||
        !hasExactKeys(message, ["version", "type", "sessionEpoch", "sequence", "captureTimestampMs"]) ||
        !isSafeIntegerInRange(message.sequence, lastProcessedSequence + 1) ||
        message.sequence > lastSentSequence ||
        !isFiniteInRange(message.captureTimestampMs, 0, MAX_TIMESTAMP_MS) ||
        message.captureTimestampMs <= lastProcessedCaptureTimestampMs
      ) {
        fail("internal");
        return;
      }
      let completionTimestampMs: number;
      try {
        completionTimestampMs = now();
      } catch {
        fail("internal");
        return;
      }
      if (
        !isFiniteInRange(completionTimestampMs, 0, MAX_TIMESTAMP_MS) ||
        completionTimestampMs <= lastCompletionTimestampMs
      ) {
        fail("internal");
        return;
      }
      lastProcessedSequence = message.sequence;
      lastProcessedCaptureTimestampMs = message.captureTimestampMs;
      lastCompletionTimestampMs = completionTimestampMs;
      if (state !== "stopping") state = "running";
      emit({
        type: "processed",
        sessionEpoch,
        sequence: message.sequence,
        captureTimestampMs: message.captureTimestampMs,
        completionTimestampMs,
      });
      return;
    }

    if (message.type === "rep-summary") {
      if (
        (state !== "ready" && state !== "running" && state !== "stopping") ||
        !hasExactKeys(message, ["version", "type", "sessionEpoch", "repNumber", "score", "durationMs", "faults"]) ||
        !isSafeIntegerInRange(message.repNumber, 1, 1_000_000) ||
        message.repNumber <= lastRepNumber ||
        !isFiniteInRange(message.score, 0, 100) ||
        !isFiniteInRange(message.durationMs, 0, 60_000) ||
        !Array.isArray(message.faults) ||
        message.faults.length > FAULT_CODES.size ||
        !message.faults.every(isFaultCode)
      ) {
        fail("internal");
        return;
      }
      lastRepNumber = message.repNumber;
      emit({
        type: "rep-summary",
        sessionEpoch,
        repNumber: message.repNumber,
        score: message.score,
        durationMs: message.durationMs,
        faults: [...message.faults],
      });
      return;
    }

    if (message.type === "cue") {
      if (
        (state !== "ready" && state !== "running" && state !== "stopping") ||
        !hasExactKeys(message, ["version", "type", "sessionEpoch", "cue"]) ||
        !isCueCode(message.cue)
      ) {
        fail("internal");
        return;
      }
      emit({ type: "cue", sessionEpoch, cue: message.cue });
      return;
    }

    if (message.type === "stopped") {
      if (state !== "stopping" || !hasExactKeys(message, ["version", "type", "sessionEpoch"])) {
        fail("internal");
        return;
      }
      state = "stopped";
      emit({ type: "stopped", sessionEpoch });
      detachAndTerminate();
      return;
    }

    if (message.type === "error") {
      if (
        !hasExactKeys(message, ["version", "type", "sessionEpoch", "code"]) ||
        typeof message.code !== "string" ||
        !ERROR_CODES.has(message.code as WorkerErrorCode)
      ) {
        fail("internal");
        return;
      }
      fail(message.code as WorkerErrorCode);
      return;
    }

    fail("internal");
  }

  port.addEventListener("message", onMessage);
  port.addEventListener("error", onError);
  port.addEventListener("messageerror", onMessageError);

  return {
    getState: () => state,

    start(model) {
      if (state !== "idle" || !isModel(model)) return false;
      state = "starting";
      selectedModel = model;
      try {
        port.postMessage({ version: 1, type: "init", sessionEpoch, model });
        return true;
      } catch {
        fail("worker-failed");
        return false;
      }
    },

    sendFrame<F>(message: WorkerFrameMessage<F>, transfer: readonly F[]) {
      if ((state !== "ready" && state !== "running") || transfer.length !== 1 || transfer[0] !== message.frame) {
        return "not-transferred";
      }
      if (
        !validateFrameMessage(message, sessionEpoch, lastSentSequence, lastSentCaptureTimestampMs)
      ) {
        return "not-transferred";
      }
      lastSentSequence = message.sequence;
      lastSentCaptureTimestampMs = message.captureTimestampMs;
      try {
        port.postMessage(message, transfer);
      } catch {
        fail("worker-failed");
        return "unknown";
      }
      state = "running";
      return "transferred";
    },

    requestStop() {
      if (state === "stopped" || state === "failed" || state === "stopping") return false;
      if (state === "idle") {
        state = "stopped";
        detachAndTerminate();
        return true;
      }
      state = "stopping";
      try {
        port.postMessage({ version: 1, type: "stop", sessionEpoch });
        return true;
      } catch {
        fail("worker-failed");
        return false;
      }
    },

    dispose() {
      if (state === "stopped" || state === "failed") {
        detachAndTerminate();
        return;
      }
      state = "stopped";
      detachAndTerminate();
    },
  };
}
