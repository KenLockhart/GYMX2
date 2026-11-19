import { describe, expect, it, vi } from "vitest";
import { CurlCueScheduler } from "./engine/cues";
import {
  createWorkerController,
  type WorkerPortLike,
} from "./worker-controller";

type Listener = (...args: never[]) => void;

class FakeWorkerPort implements WorkerPortLike {
  readonly sent: Array<{ message: unknown; transfer?: readonly unknown[] }> = [];
  readonly listeners = new Map<string, Set<Listener>>();
  terminate = vi.fn();
  throwOnPost = false;

  postMessage(message: unknown, transfer?: readonly unknown[]) {
    if (this.throwOnPost) throw new Error("private transport error");
    this.sent.push({ message, transfer });
  }

  addEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  addEventListener(type: string, listener: Listener) {
    const items = this.listeners.get(type) ?? new Set<Listener>();
    items.add(listener);
    this.listeners.set(type, items);
  }

  removeEventListener(type: "message", listener: (event: Readonly<{ data: unknown }>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: () => void): void;
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emitMessage(data: unknown) {
    for (const listener of this.listeners.get("message") ?? []) {
      (listener as (event: Readonly<{ data: unknown }>) => void)({ data });
    }
  }

  emitError(type: "error" | "messageerror") {
    for (const listener of this.listeners.get(type) ?? []) (listener as () => void)();
  }
}

function createController(port = new FakeWorkerPort(), now = vi.fn(() => 100)) {
  const events: unknown[] = [];
  const controller = createWorkerController({
    port,
    sessionEpoch: 7,
    now,
    onEvent: (event) => events.push(event),
  });
  return { controller, port, events, now };
}

function ready(port: FakeWorkerPort, model: "lite" | "full" = "lite", delegate: "GPU" | "CPU" = "GPU") {
  port.emitMessage({ version: 1, type: "ready", sessionEpoch: 7, model, delegate });
}

describe("injected Form Coach worker controller", () => {
  it("does not create or start a Worker; only explicit start sends the init command", () => {
    const { controller, port, events } = createController();
    expect(port.sent).toEqual([]);
    expect(controller.getState()).toBe("idle");

    expect(controller.start("lite")).toBe(true);
    expect(port.sent).toEqual([{ message: { version: 1, type: "init", sessionEpoch: 7, model: "lite" } }]);
    expect(controller.getState()).toBe("starting");
    expect(events).toEqual([]);
  });

  it("ignores stale sessions, accepts allowlisted ready and processed events, and stamps completion locally", () => {
    const { controller, port, events, now } = createController(new FakeWorkerPort(), vi.fn(() => 120));
    controller.start("lite");
    port.emitMessage({ version: 1, type: "ready", sessionEpoch: 6, model: "lite", delegate: "GPU" });
    expect(controller.getState()).toBe("starting");
    ready(port);
    expect(controller.getState()).toBe("ready");

    const frame = { width: 640, height: 480, close() {} };
    expect(
      controller.sendFrame(
        {
          version: 1,
          type: "frame",
          sessionEpoch: 7,
          sequence: 1,
          captureTimestampMs: 100,
          width: 640,
          height: 480,
          droppedFramesSincePrevious: 2,
          frame,
        },
        [frame],
      ),
    ).toBe("transferred");

    port.emitMessage({ version: 1, type: "processed", sessionEpoch: 7, sequence: 1, captureTimestampMs: 100 });
    expect(events).toEqual([
      { type: "ready", sessionEpoch: 7, model: "lite", delegate: "GPU" },
      {
        type: "processed",
        sessionEpoch: 7,
        sequence: 1,
        captureTimestampMs: 100,
        completionTimestampMs: 120,
      },
    ]);
    expect(now).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toBe("running");
  });

  it("rejects oversized, non-monotonic, mismatched, or extra-field frame messages before transfer", () => {
    const { controller, port } = createController();
    controller.start("lite");
    ready(port);
    const frame = { width: 640, height: 480, close() {} };
    const message = {
      version: 1 as const,
      type: "frame" as const,
      sessionEpoch: 7,
      sequence: 1,
      captureTimestampMs: 10,
      width: 640,
      height: 480,
      droppedFramesSincePrevious: 0,
      frame,
    };
    expect(controller.sendFrame({ ...message, width: 9_000 }, [frame])).toBe("not-transferred");
    expect(controller.sendFrame({ ...message, captureTimestampMs: Number.NaN }, [frame])).toBe("not-transferred");
    expect(controller.sendFrame({ ...message, sessionEpoch: 6 }, [frame])).toBe("not-transferred");
    expect(controller.sendFrame({ ...message, unsafe: [1, 2, 3] } as typeof message, [frame])).toBe("not-transferred");
    expect(controller.sendFrame(message, [])).toBe("not-transferred");
    expect(port.sent).toHaveLength(1);
  });

  it("rejects non-allowlisted response fields without exposing raw SDK objects", () => {
    const { controller, port, events } = createController();
    controller.start("full");
    ready(port, "full", "CPU");
    port.emitMessage({
      version: 1,
      type: "rep-summary",
      sessionEpoch: 7,
      repNumber: 1,
      score: 88,
      durationMs: 2_000,
      faults: ["elbow_drift"],
      landmarks: [{ x: 0.1, y: 0.2 }],
      error: new Error("secret SDK detail"),
    });

    expect(events).toEqual([
      { type: "ready", sessionEpoch: 7, model: "full", delegate: "CPU" },
      { type: "error", sessionEpoch: 7, code: "internal" },
    ]);
    expect(controller.getState()).toBe("failed");
    expect(port.terminate).toHaveBeenCalledTimes(1);
  });

  it("accepts only bounded numeric summaries and curated cue/fault enums", () => {
    const { controller, port, events } = createController();
    controller.start("lite");
    ready(port);
    port.emitMessage({
      version: 1,
      type: "rep-summary",
      sessionEpoch: 7,
      repNumber: 1,
      score: 90,
      durationMs: 1_400,
      faults: ["torso_swing"],
    });
    port.emitMessage({ version: 1, type: "cue", sessionEpoch: 7, cue: "elbows_pinned" });
    port.emitMessage({
      version: 1,
      type: "rep-summary",
      sessionEpoch: 7,
      repNumber: 2,
      score: 999,
      durationMs: 1_400,
      faults: [],
    });

    expect(events).toEqual([
      { type: "ready", sessionEpoch: 7, model: "lite", delegate: "GPU" },
      { type: "rep-summary", sessionEpoch: 7, repNumber: 1, score: 90, durationMs: 1_400, faults: ["torso_swing"] },
      { type: "cue", sessionEpoch: 7, cue: "elbows_pinned" },
      { type: "error", sessionEpoch: 7, code: "internal" },
    ]);
  });

  it("accepts breathing cue keys produced by the curl cue engine", () => {
    const { controller, port, events } = createController();
    controller.start("lite");
    ready(port);
    const scheduler = new CurlCueScheduler({ globalGapMs: 0 });
    const exhale = scheduler.handle({
      type: "frame",
      atMs: 0,
      faults: [],
      phaseStarted: "concentric",
      repNumber: 1,
    })[0];
    scheduler.handle({ type: "cue_finished", atMs: 1 });
    const inhale = scheduler.handle({
      type: "frame",
      atMs: 2,
      faults: [],
      phaseStarted: "eccentric",
      repNumber: 1,
    })[0];

    expect([exhale?.key, inhale?.key]).toEqual(["exhale", "inhale"]);
    for (const cue of [exhale, inhale]) {
      port.emitMessage({ version: 1, type: "cue", sessionEpoch: 7, cue: cue?.key });
    }
    expect(events).toEqual([
      { type: "ready", sessionEpoch: 7, model: "lite", delegate: "GPU" },
      { type: "cue", sessionEpoch: 7, cue: "exhale" },
      { type: "cue", sessionEpoch: 7, cue: "inhale" },
    ]);
  });

  it("allows a processed acknowledgement for an in-flight message after stop is requested", () => {
    const { controller, port, events } = createController();
    controller.start("lite");
    ready(port);
    const frame = { width: 320, height: 240, close() {} };
    controller.sendFrame(
      {
        version: 1,
        type: "frame",
        sessionEpoch: 7,
        sequence: 1,
        captureTimestampMs: 50,
        width: 320,
        height: 240,
        droppedFramesSincePrevious: 0,
        frame,
      },
      [frame],
    );
    expect(controller.requestStop()).toBe(true);

    port.emitMessage({ version: 1, type: "processed", sessionEpoch: 7, sequence: 1, captureTimestampMs: 50 });
    port.emitMessage({ version: 1, type: "stopped", sessionEpoch: 7 });

    expect(events.map((event) => (event as { type: string }).type)).toEqual(["ready", "processed", "stopped"]);
    expect(controller.getState()).toBe("stopped");
    expect(port.terminate).toHaveBeenCalledTimes(1);
  });

  it("sanitizes worker and message transport errors and removes listeners on dispose", () => {
    const port = new FakeWorkerPort();
    const { controller, events } = createController(port);
    controller.start("lite");
    port.emitError("messageerror");

    expect(events).toEqual([{ type: "error", sessionEpoch: 7, code: "worker-failed" }]);
    expect(controller.getState()).toBe("failed");
    expect(port.terminate).toHaveBeenCalledTimes(1);
    expect([...port.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    controller.dispose();
    expect(port.terminate).toHaveBeenCalledTimes(1);
  });

  it("reports an ambiguous postMessage exception separately from a definite pre-transfer rejection", () => {
    const port = new FakeWorkerPort();
    const { controller, events } = createController(port);
    controller.start("lite");
    ready(port);
    port.throwOnPost = true;
    const frame = { width: 320, height: 240, close() {} };

    expect(
      controller.sendFrame(
        {
          version: 1,
          type: "frame",
          sessionEpoch: 7,
          sequence: 1,
          captureTimestampMs: 10,
          width: 320,
          height: 240,
          droppedFramesSincePrevious: 0,
          frame,
        },
        [frame],
      ),
    ).toBe("unknown");
    expect(controller.getState()).toBe("failed");
    expect(events).toEqual([
      { type: "ready", sessionEpoch: 7, model: "lite", delegate: "GPU" },
      { type: "error", sessionEpoch: 7, code: "worker-failed" },
    ]);
  });
});
