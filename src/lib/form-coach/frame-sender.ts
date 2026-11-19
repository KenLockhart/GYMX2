import type { WorkerFrameMessage, WorkerFrameSendResult } from "./worker-controller";

export interface TransferableFrameLike {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export type FrameSenderState = "active" | "stopped" | "failed";

export type FrameOfferResult =
  | Readonly<{ status: "sent"; sequence: number }>
  | Readonly<{ status: "dropped-busy" }>
  | Readonly<{ status: "rejected"; code: "invalid-frame" | "invalid-timestamp" | "stopped" | "sender-failed" | "drop-counter-overflow" | "close-failed" | "transfer-failed" | "transfer-unknown" }>;

export type FrameCompletionResult =
  | Readonly<{
      status: "processed";
      sequence: number;
      captureTimestampMs: number;
      completionTimestampMs: number;
      droppedFramesSincePrevious: number;
    }>
  | Readonly<{ status: "stale" }>
  | Readonly<{ status: "rejected"; code: "invalid-ack" | "invalid-timestamp" }>;

export type FrameWorkerFailure = "invalid-frame" | "processing-failed" | "cancelled" | "worker-failed";

export type FrameRejectResult =
  | Readonly<{ status: "rejected"; code: FrameWorkerFailure }>
  | Readonly<{ status: "stale" }>
  | Readonly<{ status: "failed"; code: "drop-counter-overflow" | "worker-failed" }>;

export interface FrameSenderOptions<F extends TransferableFrameLike> {
  readonly sessionEpoch: number;
  /**
   * Must return `transferred` after ownership passes, or `not-transferred` only when it can prove
   * no transfer occurred. Throwing or returning `unknown` fails closed without closing the frame.
   */
  readonly send: (message: WorkerFrameMessage<F>, transfer: readonly F[]) => WorkerFrameSendResult;
}

export interface FrameSender<F extends TransferableFrameLike> {
  getState(): FrameSenderState;
  getDroppedFrameCount(): number;
  hasInFlightFrame(): boolean;
  offer(frame: F, captureTimestampMs: number): FrameOfferResult;
  complete(sequence: number, captureTimestampMs: number, completionTimestampMs: number): FrameCompletionResult;
  reject(sequence: number, code: FrameWorkerFailure): FrameRejectResult;
  stop(): void;
}

const MAX_FRAME_DIMENSION = 4_096;
const MAX_FRAME_PIXELS = 16_777_216;
const MAX_TIMESTAMP_MS = 1_000_000_000_000;
const MAX_PENDING_DROPS = 1_000_000;

interface InFlightFrame {
  readonly sequence: number;
  readonly captureTimestampMs: number;
  readonly droppedFramesSincePrevious: number;
}

function validDimension(frame: TransferableFrameLike): boolean {
  return (
    frame !== null &&
    typeof frame === "object" &&
    typeof frame.close === "function" &&
    Number.isSafeInteger(frame.width) &&
    frame.width > 0 &&
    frame.width <= MAX_FRAME_DIMENSION &&
    Number.isSafeInteger(frame.height) &&
    frame.height > 0 &&
    frame.height <= MAX_FRAME_DIMENSION &&
    frame.width * frame.height <= MAX_FRAME_PIXELS
  );
}

function safeClose(frame: TransferableFrameLike): boolean {
  try {
    frame.close();
    return true;
  } catch {
    return false;
  }
}

export function createFrameSender<F extends TransferableFrameLike>(options: FrameSenderOptions<F>): FrameSender<F> {
  if (!Number.isSafeInteger(options.sessionEpoch) || options.sessionEpoch < 1) {
    throw new RangeError("sessionEpoch must be a positive safe integer.");
  }

  let state: FrameSenderState = "active";
  let nextSequence = 1;
  let lastObservedCaptureTimestampMs = -1;
  let lastCompletionTimestampMs = -1;
  let pendingDroppedFrames = 0;
  let totalDroppedFrames = 0;
  let inFlight: InFlightFrame | null = null;

  function countDrop(count = 1): boolean {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      pendingDroppedFrames + count > MAX_PENDING_DROPS ||
      totalDroppedFrames + count > Number.MAX_SAFE_INTEGER
    ) {
      state = "failed";
      return false;
    }
    pendingDroppedFrames += count;
    totalDroppedFrames += count;
    return true;
  }

  function restoreFailedFrame(droppedBeforeSend: number): boolean {
    if (
      !Number.isSafeInteger(droppedBeforeSend) ||
      droppedBeforeSend < 0 ||
      pendingDroppedFrames + droppedBeforeSend + 1 > MAX_PENDING_DROPS ||
      totalDroppedFrames + 1 > Number.MAX_SAFE_INTEGER
    ) {
      state = "failed";
      return false;
    }
    pendingDroppedFrames += droppedBeforeSend + 1;
    totalDroppedFrames += 1;
    return true;
  }

  return {
    getState: () => state,
    getDroppedFrameCount: () => totalDroppedFrames,
    hasInFlightFrame: () => inFlight !== null,

    offer(frame, captureTimestampMs) {
      if (state !== "active") {
        return safeClose(frame)
          ? { status: "rejected", code: state === "stopped" ? "stopped" : "sender-failed" }
          : { status: "rejected", code: "close-failed" };
      }
      if (!validDimension(frame)) {
        const closed = safeClose(frame);
        if (!closed) state = "failed";
        return { status: "rejected", code: closed ? "invalid-frame" : "close-failed" };
      }
      if (
        !Number.isFinite(captureTimestampMs) ||
        captureTimestampMs < 0 ||
        captureTimestampMs > MAX_TIMESTAMP_MS ||
        captureTimestampMs <= lastObservedCaptureTimestampMs
      ) {
        const closed = safeClose(frame);
        if (!closed) state = "failed";
        return { status: "rejected", code: closed ? "invalid-timestamp" : "close-failed" };
      }
      lastObservedCaptureTimestampMs = captureTimestampMs;

      if (inFlight !== null) {
        const closed = safeClose(frame);
        const counted = countDrop();
        if (!closed) state = "failed";
        if (!counted) return { status: "rejected", code: "drop-counter-overflow" };
        return closed ? { status: "dropped-busy" } : { status: "rejected", code: "close-failed" };
      }

      if (!Number.isSafeInteger(nextSequence) || nextSequence > Number.MAX_SAFE_INTEGER) {
        state = "failed";
        const closed = safeClose(frame);
        return { status: "rejected", code: closed ? "drop-counter-overflow" : "close-failed" };
      }

      const sequence = nextSequence;
      nextSequence += 1;
      const droppedFramesSincePrevious = pendingDroppedFrames;
      const flight: InFlightFrame = { sequence, captureTimestampMs, droppedFramesSincePrevious };
      const message: WorkerFrameMessage<F> = {
        version: 1,
        type: "frame",
        sessionEpoch: options.sessionEpoch,
        sequence,
        captureTimestampMs,
        width: frame.width,
        height: frame.height,
        droppedFramesSincePrevious,
        frame,
      };

      inFlight = flight;
      pendingDroppedFrames = 0;
      let outcome: WorkerFrameSendResult;
      try {
        outcome = options.send(message, [frame]);
      } catch {
        state = "failed";
        return { status: "rejected", code: "transfer-unknown" };
      }

      if (outcome !== "transferred" && outcome !== "not-transferred") {
        state = "failed";
        return { status: "rejected", code: "transfer-unknown" };
      }
      if (outcome === "not-transferred") {
        inFlight = null;
        const closed = safeClose(frame);
        const counted = restoreFailedFrame(droppedFramesSincePrevious);
        if (!closed) state = "failed";
        if (!counted) return { status: "rejected", code: "drop-counter-overflow" };
        return { status: "rejected", code: closed ? "transfer-failed" : "close-failed" };
      }

      return { status: "sent", sequence };
    },

    complete(sequence, captureTimestampMs, completionTimestampMs) {
      if (state !== "active" || inFlight === null || sequence !== inFlight.sequence) return { status: "stale" };
      if (!Number.isFinite(captureTimestampMs) || captureTimestampMs !== inFlight.captureTimestampMs) {
        // The transferred frame may still be processing; never grant another credit on a bad ack.
        state = "failed";
        return { status: "rejected", code: "invalid-ack" };
      }
      if (
        !Number.isFinite(completionTimestampMs) ||
        completionTimestampMs < 0 ||
        completionTimestampMs > MAX_TIMESTAMP_MS ||
        completionTimestampMs <= lastCompletionTimestampMs
      ) {
        state = "failed";
        return { status: "rejected", code: "invalid-timestamp" };
      }

      const completed = inFlight;
      inFlight = null;
      lastCompletionTimestampMs = completionTimestampMs;
      return {
        status: "processed",
        sequence,
        captureTimestampMs,
        completionTimestampMs,
        droppedFramesSincePrevious: completed.droppedFramesSincePrevious,
      };
    },

    reject(sequence, code) {
      if (state !== "active" || inFlight === null || sequence !== inFlight.sequence) return { status: "stale" };
      if (code === "worker-failed") {
        // A dead worker cannot safely return the transferred-frame credit.
        state = "failed";
        return { status: "failed", code };
      }
      const rejected = inFlight;
      inFlight = null;
      if (!restoreFailedFrame(rejected.droppedFramesSincePrevious)) {
        return { status: "failed", code: "drop-counter-overflow" };
      }
      return { status: "rejected", code };
    },

    stop() {
      state = "stopped";
      inFlight = null;
      pendingDroppedFrames = 0;
    },
  };
}
