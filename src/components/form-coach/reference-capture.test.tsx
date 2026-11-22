// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFormCoachReferenceCapture } from "@/lib/form-coach/browser-runtime";
import type { ExerciseTemplate } from "@/lib/form-coach/template-schema";
import { FormCoachReferenceCapture } from "./reference-capture";

vi.mock("@/lib/form-coach/browser-runtime", () => ({ startFormCoachReferenceCapture: vi.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function template(): ExerciseTemplate {
  return {
    exerciseKey: "dumbbell_curl",
    schemaVersion: 1,
    cameraView: "side",
    arm: "auto",
    segmentation: { metric: "elbowAngle", extendedThreshold: 150, flexedThreshold: 60 },
    reference: {
      romMinAngle: 40,
      romMaxAngle: 165,
      concentricMs: 2_000,
      topPauseMs: 500,
      eccentricMs: 3_000,
      elbowCurve: Array.from({ length: 50 }, (_, index) => 165 - index * 2.5),
    },
    tolerances: { romTopDeg: 15, romBottomDeg: 15, upperArmDriftDeg: 15, torsoSwingDeg: 10, shrugRatio: 0.08, tempoPct: 35 },
    scoringWeights: { rom: 30, elbow: 25, torso: 20, tempo: 15, shoulders: 10 },
    strictness: "standard",
    cues: [],
    breathing: { concentric: "exhale", eccentric: "inhale", fullCueReps: 3, thenEvery: 3 },
  };
}

function callerStream() {
  const track = { stop: vi.fn() };
  const liveStream = { getTracks: vi.fn(() => [track]) } as unknown as MediaStream;
  return { liveStream, track };
}

describe("FormCoachReferenceCapture initial state", () => {
  let host: HTMLDivElement;
  let root: Root;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("does not start a worker, play a stream, or request camera permission when disabled", async () => {
    const { liveStream, track } = callerStream();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { baseTemplate: template(), liveStream })));

    expect(host.textContent).toContain("Reference capture is disabled");
    expect(startFormCoachReferenceCapture).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("waits for the explicit Start action even when enabled and given a caller-owned stream", async () => {
    const { liveStream, track } = callerStream();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, baseTemplate: template(), liveStream })));

    expect(host.textContent).toContain("Pose processing can be demanding");
    expect(startFormCoachReferenceCapture).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps capture unavailable when the authoring caller has not provided a stream", async () => {
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, baseTemplate: template() })));

    const startButton = host.querySelector<HTMLButtonElement>('button[type="button"]');
    expect(host.textContent).toContain("must provide a live camera stream");
    expect(startButton?.disabled).toBe(true);
    expect(startFormCoachReferenceCapture).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
