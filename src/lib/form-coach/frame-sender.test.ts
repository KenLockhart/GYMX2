import { describe, expect, it, vi } from "vitest";
import { createFrameSender, type TransferableFrameLike } from "./frame-sender";
import {
  createWorkerController,
  type WorkerFrameMessage,
  type WorkerFrameSendResult,
  type WorkerPortLike,
} from "./worker-controller";

class FakeFrame implements TransferableFrameLike {
  close = vi.fn();

  constructor(readonly width = 640, readonly height = 480) {}
}

function setup(send?: (message: WorkerFrameMessage<FakeFrame>, transfer: readonly FakeFrame[]) => WorkerFrameSendResult) {
  const sent: WorkerFrameMessage<FakeFrame>[] = [];
  const transfers: FakeFrame[][] = [];
  const post = send ?? ((message, transfer) => {
    sent.push(message);
    (transfers as FakeFrame[][]).push([...transfer]);
    return "transferred" as const;
  });
  const sender = createFrameSender<FakeFrame>({
    sessionEpoch: 11,
    send: (message, transfer) => post(message, transfer),
  });
  return { sender, sent, transfers, post };
}

describe("single-credit frame sender", () => {
  it("transfers only one frame and carries busy drops to the next processed frame", () => {
    const { sender, sent, transfers } = setup();
    const first = new FakeFrame();
    const busyA = new FakeFrame();
    const busyB = new FakeFrame();

    expect(sender.offer(first, 100)).toEqual({ status: "sent", sequence: 1 });
    expect(sender.offer(busyA, 150)).toEqual({ status: "dropped-busy" });
    expect(sender.offer(busyB, 200)).toEqual({ status: "dropped-busy" });
    expect(busyA.close).toHaveBeenCalledOnce();
    expect(busyB.close).toHaveBeenCalledOnce();
    expect(sender.getDroppedFrameCount()).toBe(2);
    expect(sent).toHaveLength(1);
    expect(transfers).toEqual([[first]]);

    expect(sender.complete(1, 100, 300)).toEqual({
      status: "processed",
      sequence: 1,
      captureTimestampMs: 100,
      completionTimestampMs: 300,
      droppedFramesSincePrevious: 0,
    });
    const next = new FakeFrame();
    expect(sender.offer(next, 250)).toEqual({ status: "sent", sequence: 2 });
    expect(sent[1]?.droppedFramesSincePrevious).toBe(2);
    expect(first.close).not.toHaveBeenCalled();
  });

  it("closes a frame explicitly rejected before transfer and restores prior drops once", () => {
    let attempts = 0;
    const { sender, sent } = setup((message, transfer) => {
      attempts += 1;
      if (attempts === 2) return "not-transferred";
      sent.push(message);
      expect(transfer).toHaveLength(1);
      return "transferred";
    });
    const first = new FakeFrame();
    const busy = new FakeFrame();
    const failedTransfer = new FakeFrame();

    sender.offer(first, 100);
    sender.offer(busy, 120);
    sender.complete(1, 100, 150);
    expect(sender.offer(failedTransfer, 170)).toEqual({ status: "rejected", code: "transfer-failed" });
    expect(failedTransfer.close).toHaveBeenCalledOnce();
    expect(sender.getDroppedFrameCount()).toBe(2);

    const next = new FakeFrame();
    expect(sender.offer(next, 200)).toEqual({ status: "sent", sequence: 3 });
    expect(sent[1]?.droppedFramesSincePrevious).toBe(2);
  });

  it("keeps credit for stale acknowledgements and fails closed on a malformed current acknowledgement", () => {
    const { sender } = setup();
    const frame = new FakeFrame();
    sender.offer(frame, 10);

    expect(sender.complete(99, 10, 20)).toEqual({ status: "stale" });
    expect(sender.hasInFlightFrame()).toBe(true);
    expect(sender.complete(1, 9, 20)).toEqual({ status: "rejected", code: "invalid-ack" });
    expect(sender.getState()).toBe("failed");
    expect(sender.hasInFlightFrame()).toBe(true);
    const next = new FakeFrame();
    expect(sender.offer(next, 30)).toEqual({ status: "rejected", code: "sender-failed" });
    expect(next.close).toHaveBeenCalledOnce();
    expect(sender.getDroppedFrameCount()).toBe(0);
  });

  it("does not return frame credit after the worker reports terminal failure", () => {
    const { sender } = setup();
    sender.offer(new FakeFrame(), 10);

    expect(sender.reject(1, "worker-failed")).toEqual({ status: "failed", code: "worker-failed" });
    expect(sender.getState()).toBe("failed");
    expect(sender.hasInFlightFrame()).toBe(true);
    expect(sender.offer(new FakeFrame(), 20)).toEqual({ status: "rejected", code: "sender-failed" });
  });

  it("restores attached drops when the worker rejects a processing attempt", () => {
    const { sender, sent } = setup();
    sender.offer(new FakeFrame(), 10);
    sender.offer(new FakeFrame(), 20);

    expect(sender.reject(1, "processing-failed")).toEqual({ status: "rejected", code: "processing-failed" });
    expect(sender.getDroppedFrameCount()).toBe(2);
    const retry = new FakeFrame();
    expect(sender.offer(retry, 30)).toEqual({ status: "sent", sequence: 2 });
    expect(sent[1]?.droppedFramesSincePrevious).toBe(2);
  });

  it("rejects invalid frame shape/timestamps locally and closes every untransferred resource", () => {
    const { sender, sent } = setup();
    const oversized = new FakeFrame(5_000, 2_000);
    const valid = new FakeFrame();
    const duplicate = new FakeFrame();

    expect(sender.offer(oversized, 10)).toEqual({ status: "rejected", code: "invalid-frame" });
    expect(oversized.close).toHaveBeenCalledOnce();
    expect(sender.offer(valid, 20)).toEqual({ status: "sent", sequence: 1 });
    expect(sender.offer(duplicate, 20)).toEqual({ status: "rejected", code: "invalid-timestamp" });
    expect(duplicate.close).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(1);
  });

  it("does not close transferred frames locally on stop and rejects future sends", () => {
    const { sender, sent } = setup();
    const transferred = new FakeFrame();
    const afterStop = new FakeFrame();
    sender.offer(transferred, 10);
    sender.stop();

    expect(transferred.close).not.toHaveBeenCalled();
    expect(sender.getState()).toBe("stopped");
    expect(sender.hasInFlightFrame()).toBe(false);
    expect(sender.offer(afterStop, 20)).toEqual({ status: "rejected", code: "stopped" });
    expect(afterStop.close).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(1);
  });

  it("stops fail-closed if busy-frame accounting or local close fails", () => {
    const { sender } = setup();
    const first = new FakeFrame();
    const busy = new FakeFrame();
    busy.close.mockImplementation(() => {
      throw new Error("not exposed");
    });
    sender.offer(first, 10);

    expect(sender.offer(busy, 20)).toEqual({ status: "rejected", code: "close-failed" });
    expect(sender.getState()).toBe("failed");
  });

  it("keeps one credit after a controller transfer followed by a wrapper throw and releases only on termination", () => {
    const receivedFrames: FakeFrame[] = [];
    const listeners = new Map<string, Set<(...args: never[]) => void>>();
    let portTerminated = false;
    const port: WorkerPortLike = {
      postMessage(message, transfer) {
        if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "frame") {
          receivedFrames.push(transfer?.[0] as FakeFrame);
        }
      },
      addEventListener(type: string, listener: (...args: never[]) => void) {
        const current = listeners.get(type) ?? new Set<(...args: never[]) => void>();
        current.add(listener);
        listeners.set(type, current);
      },
      removeEventListener(type: string, listener: (...args: never[]) => void) {
        listeners.get(type)?.delete(listener);
      },
      terminate() {
        portTerminated = true;
        // Model the future Worker releasing transferred input frames in its teardown path.
        for (const received of receivedFrames) received.close();
      },
    };
    const controller = createWorkerController({ port, sessionEpoch: 11, now: () => 100, onEvent: () => {} });
    expect(controller.start("lite")).toBe(true);
    for (const listener of listeners.get("message") ?? []) {
      (listener as (event: Readonly<{ data: unknown }>) => void)({
        data: { version: 1, type: "ready", sessionEpoch: 11, model: "lite", delegate: "GPU" },
      });
    }

    const sender = createFrameSender<FakeFrame>({
      sessionEpoch: 11,
      send(message, transfer) {
        const result = controller.sendFrame(message, transfer);
        if (result === "transferred") {
          // The composition layer fails after the controller already transferred ownership.
          controller.dispose();
          throw new Error("wrapper failed after transfer");
        }
        return result;
      },
    });
    const transferred = new FakeFrame();
    expect(sender.offer(transferred, 10)).toEqual({ status: "rejected", code: "transfer-unknown" });
    expect(sender.getState()).toBe("failed");
    expect(sender.hasInFlightFrame()).toBe(true);
    expect(receivedFrames).toEqual([transferred]);
    expect(portTerminated).toBe(true);
    expect(transferred.close).toHaveBeenCalledOnce();

    const next = new FakeFrame();
    expect(sender.offer(next, 20)).toEqual({ status: "rejected", code: "sender-failed" });
    expect(next.close).toHaveBeenCalledOnce();
    expect(receivedFrames).toHaveLength(1);
    sender.stop();
    expect(sender.hasInFlightFrame()).toBe(false);
  });
});
