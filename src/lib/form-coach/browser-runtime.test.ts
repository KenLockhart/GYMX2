import { afterEach, describe, expect, it, vi } from "vitest";
import { startFormCoachProcessing } from "./browser-runtime";

type RuntimeWorkerMessage = Record<string, unknown>;

class MockWorker {
  static latest: MockWorker | null = null;
  readonly listeners = new Map<string, Set<(event: { data: unknown }) => void>>();
  readonly posted: RuntimeWorkerMessage[] = [];
  terminated = false;

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
    this.posted.push(data);
    if (data.type === "init") {
      queueMicrotask(() => this.emit({
        version: 1,
        type: "ready",
        sessionEpoch: data.sessionEpoch,
        model: data.model,
        delegate: "CPU",
      }));
    } else if (data.type === "stop") {
      queueMicrotask(() => this.emit({ version: 1, type: "stopped", sessionEpoch: data.sessionEpoch }));
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockWorker.latest = null;
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
});
