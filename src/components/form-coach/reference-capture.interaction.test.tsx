// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startFormCoachReferenceCapture,
  type FormCoachReferenceCaptureOptions,
  type FormCoachReferenceCaptureSession,
  type ReferenceCaptureBuildResult,
} from "@/lib/form-coach/browser-runtime";
import type { ExerciseTemplate } from "@/lib/form-coach/template-schema";
import type { ReferenceCaptureCandidateSummary } from "@/lib/form-coach/worker-protocol";
import { FormCoachReferenceCapture } from "./reference-capture";

vi.mock("@/lib/form-coach/browser-runtime", () => ({ startFormCoachReferenceCapture: vi.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function template(overrides: Partial<ExerciseTemplate> = {}): ExerciseTemplate {
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
    ...overrides,
  };
}

function candidate(ordinal: number, selectable = true): ReferenceCaptureCandidateSummary {
  return {
    id: `candidate-${ordinal}`,
    ordinal,
    pairing: "single_arm",
    arm: "left",
    selectable,
    reason: selectable ? null : "form_faults",
    romMinAngle: 42 + ordinal,
    romMaxAngle: 165,
    concentricMs: 1_000,
    topPauseMs: 200,
    eccentricMs: 1_400,
    maxUpperArmDrift: 4,
    maxTorsoSwing: 2,
    maxShrug: 0.02,
  };
}

function callerStream() {
  const track = { stop: vi.fn() };
  const liveStream = { getTracks: vi.fn(() => [track]) } as unknown as MediaStream;
  return { liveStream, track };
}

function sessionFixture() {
  const session = {
    mode: "reference",
    model: "lite",
    delegate: "CPU",
    stop: vi.fn(async () => undefined),
    pauseCapture: vi.fn(),
    buildReference: vi.fn(),
  } as unknown as FormCoachReferenceCaptureSession;
  return session;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`Expected a button containing: ${text}`);
  return found;
}

async function click(target: HTMLElement) {
  await act(async () => target.click());
  await settle();
}

async function emitCandidates(options: FormCoachReferenceCaptureOptions, count = 3) {
  for (let ordinal = 1; ordinal <= count; ordinal += 1) {
    await act(async () => options.onCandidate?.(candidate(ordinal), ordinal));
  }
}

async function enterReview(host: HTMLElement, options: FormCoachReferenceCaptureOptions, session: FormCoachReferenceCaptureSession, generation: number) {
  vi.mocked(session.pauseCapture).mockImplementation(async () => {
    options.onPaused?.({ candidateGeneration: generation, reason: "user_pause" });
    return { sessionEpoch: 1, requestId: 1, lastProcessedSequence: generation, candidateGeneration: generation, reason: "user_pause" };
  });
  await click(button(host, "Pause and review"));
}

describe("FormCoachReferenceCapture local journeys", () => {
  let host: HTMLDivElement;
  let root: Root;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let optionsList: FormCoachReferenceCaptureOptions[];
  let sessions: FormCoachReferenceCaptureSession[];

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
    optionsList = [];
    sessions = [];
    vi.mocked(startFormCoachReferenceCapture).mockImplementation(async (_video, options) => {
      optionsList.push(options);
      options.onReady?.({ model: "lite", delegate: "CPU" });
      const session = sessionFixture();
      sessions.push(session);
      return session;
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("captures numeric summaries, caps selection at five, builds locally, and discards on a new capture", async () => {
    const { liveStream, track } = callerStream();
    const onReferenceBuilt = vi.fn();
    const builtTemplate = template({ reference: { ...template().reference, concentricMs: 1_500 } });
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template(), onReferenceBuilt })));

    await click(button(host, "Start capture"));
    expect(startFormCoachReferenceCapture).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("CPU mode is active");
    expect(getUserMedia).not.toHaveBeenCalled();

    const options = optionsList[0];
    if (!options) throw new Error("Capture options were not provided to the runtime.");
    await act(async () => options.onSetup?.("show-side-view"));
    expect(host.textContent).toContain("Turn sideways");

    for (let ordinal = 1; ordinal <= 7; ordinal += 1) {
      const summary = candidate(ordinal, ordinal !== 7);
      await act(async () => options.onCandidate?.(summary, ordinal));
    }
    expect(host.textContent).toContain("6 clean available");
    expect(host.textContent).not.toContain("elbowCurve");

    const session = sessions[0];
    if (!session) throw new Error("Capture session was not created.");
    vi.mocked(session.pauseCapture).mockImplementation(async () => {
      options.onPaused?.({ candidateGeneration: 7, reason: "user_pause" });
      return { sessionEpoch: 1, requestId: 1, lastProcessedSequence: 20, candidateGeneration: 7, reason: "user_pause" };
    });
    vi.mocked(session.buildReference).mockResolvedValue({
      ok: true,
      template: builtTemplate,
      requestId: 1,
      candidateGeneration: 7,
      selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
    } satisfies ReferenceCaptureBuildResult);

    await click(button(host, "Pause and review"));
    expect(host.textContent).toContain("Review captured reps");
    expect(host.textContent).toContain("Choose three to five clean repetitions");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Select repetition 7"]')?.disabled).toBe(true);

    const buildButton = button(host, "Build local reference");
    const first = host.querySelector<HTMLInputElement>('input[aria-label="Select repetition 1"]');
    const second = host.querySelector<HTMLInputElement>('input[aria-label="Select repetition 2"]');
    const third = host.querySelector<HTMLInputElement>('input[aria-label="Select repetition 3"]');
    if (!first || !second || !third) throw new Error("Clean repetition controls were not rendered.");
    await click(first);
    await click(second);
    expect(buildButton.disabled).toBe(true);
    await click(third);
    const fourth = host.querySelector<HTMLInputElement>('input[aria-label="Select repetition 4"]');
    const fifth = host.querySelector<HTMLInputElement>('input[aria-label="Select repetition 5"]');
    const sixth = host.querySelector<HTMLInputElement>('input[aria-label="Select repetition 6"]');
    if (!fourth || !fifth || !sixth) throw new Error("The available clean repetition controls were not rendered.");
    await click(fourth);
    await click(fifth);
    expect(sixth.disabled).toBe(true);
    await click(sixth);
    expect(sixth.checked).toBe(false);
    expect(host.textContent).toContain("5 clean repetitions selected");
    await click(fourth);
    await click(fifth);
    expect(button(host, "Build local reference").disabled).toBe(false);

    await click(button(host, "Build local reference"));
    expect(session.buildReference).toHaveBeenCalledWith(["candidate-1", "candidate-2", "candidate-3"]);
    expect(onReferenceBuilt).toHaveBeenCalledWith(builtTemplate);
    expect(host.textContent).toContain("Local numeric reference ready");
    expect(host.textContent).toContain("not been saved or published");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();

    const video = host.querySelector("video");
    expect(video?.srcObject).toBe(liveStream);
    await click(button(host, "Discard capture"));
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(video?.srcObject).toBe(null);
    expect(host.textContent).not.toContain("Local numeric reference ready");
    expect(track.stop).not.toHaveBeenCalled();

    await click(button(host, "Start capture"));
    expect(sessions).toHaveLength(2);
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Repetition 1");
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("stops a late runtime start and fences its callbacks after the caller changes streams", async () => {
    const first = callerStream();
    const second = callerStream();
    let resolveStart: ((session: FormCoachReferenceCaptureSession) => void) | null = null;
    vi.mocked(startFormCoachReferenceCapture).mockImplementation((_video, options) => {
      optionsList.push(options);
      return new Promise((resolve) => { resolveStart = resolve; });
    });
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream: first.liveStream, baseTemplate: template() })));

    await click(button(host, "Start capture"));
    expect(startFormCoachReferenceCapture).toHaveBeenCalledTimes(1);
    const pendingOptions = optionsList[0];
    if (!pendingOptions || !resolveStart) throw new Error("The simulated pending runtime start was not initialized.");
    expect(pendingOptions.signal?.aborted).toBe(false);

    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream: second.liveStream, baseTemplate: template() })));
    expect(pendingOptions.signal?.aborted).toBe(true);
    expect(host.textContent).not.toContain("Captured reps");
    await act(async () => {
      pendingOptions.onCandidate?.(candidate(1), 1);
      pendingOptions.onPaused?.({ candidateGeneration: 0, reason: "user_pause" });
    });
    expect(host.textContent).not.toContain("Repetition 1");

    const lateSession = sessionFixture();
    await act(async () => {
      resolveStart?.(lateSession);
      await Promise.resolve();
    });
    await settle();
    expect(lateSession.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Review captured reps");
    expect(first.track.stop).not.toHaveBeenCalled();
    expect(second.track.stop).not.toHaveBeenCalled();
  });

  it("discards candidates and suppresses a build result after the base template changes", async () => {
    const { liveStream } = callerStream();
    let resolveBuild: ((result: ReferenceCaptureBuildResult) => void) | null = null;
    const onReferenceBuilt = vi.fn();
    vi.mocked(startFormCoachReferenceCapture).mockImplementation(async (_video, options) => {
      optionsList.push(options);
      const session = sessionFixture();
      sessions.push(session);
      options.onReady?.({ model: "lite", delegate: "GPU" });
      return session;
    });
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template(), onReferenceBuilt })));
    await click(button(host, "Start capture"));

    const options = optionsList[0];
    const session = sessions[0];
    if (!options || !session) throw new Error("The reference capture journey did not start.");
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await act(async () => options.onCandidate?.(candidate(ordinal), ordinal));
    }
    vi.mocked(session.pauseCapture).mockImplementation(async () => {
      options.onPaused?.({ candidateGeneration: 3, reason: "candidate_cap" });
      return { sessionEpoch: 1, requestId: 1, lastProcessedSequence: 9, candidateGeneration: 3, reason: "candidate_cap" };
    });
    vi.mocked(session.buildReference).mockImplementation(() => new Promise((resolve) => { resolveBuild = resolve; }));
    await click(button(host, "Pause and review"));
    expect(host.textContent).toContain("safe repetition limit was reached");
    await click(host.querySelector<HTMLInputElement>('input[aria-label="Select repetition 1"]')!);
    await click(host.querySelector<HTMLInputElement>('input[aria-label="Select repetition 2"]')!);
    await click(host.querySelector<HTMLInputElement>('input[aria-label="Select repetition 3"]')!);
    await click(button(host, "Build local reference"));

    const nextTemplate = template({ cameraView: "front" });
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: nextTemplate, onReferenceBuilt })));
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Repetition 1");

    await act(async () => {
      resolveBuild?.({
        ok: true,
        template: template(),
        requestId: 1,
        candidateGeneration: 3,
        selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
      });
      await Promise.resolve();
    });
    await settle();
    expect(onReferenceBuilt).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Local numeric reference ready");
  });

  it("discards a final review, stops its session, and detaches the preview without stopping caller tracks", async () => {
    const { liveStream, track } = callerStream();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template() })));
    await click(button(host, "Start capture"));
    const options = optionsList[0];
    const session = sessions[0];
    if (!options || !session) throw new Error("Capture session was not created.");
    await emitCandidates(options);
    await enterReview(host, options, session, 3);
    expect(host.textContent).toContain("Review captured reps");

    const video = host.querySelector("video");
    expect(video?.srcObject).toBe(liveStream);
    await click(button(host, "Discard capture"));

    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(video?.srcObject).toBe(null);
    expect(host.textContent).not.toContain("Repetition 1");
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("stops while video.play is pending and ignores the late play completion", async () => {
    const { liveStream, track } = callerStream();
    let resolvePlay: (() => void) | undefined;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise<void>((resolve) => { resolvePlay = resolve; }));
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template() })));
    await click(button(host, "Start capture"));

    const video = host.querySelector("video");
    expect(video?.srcObject).toBe(liveStream);
    expect(startFormCoachReferenceCapture).not.toHaveBeenCalled();
    await click(button(host, "Stop capture"));
    expect(video?.srcObject).toBe(null);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();

    await act(async () => resolvePlay?.());
    await settle();
    expect(startFormCoachReferenceCapture).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Captured reps");
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("unmounts while video.play is pending without starting the runtime or stopping caller tracks", async () => {
    const { liveStream, track } = callerStream();
    let resolvePlay: (() => void) | undefined;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise<void>((resolve) => { resolvePlay = resolve; }));
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template() })));
    await click(button(host, "Start capture"));
    const video = host.querySelector("video");
    expect(video?.srcObject).toBe(liveStream);

    await act(async () => root.unmount());
    expect(video?.srcObject).toBe(null);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(startFormCoachReferenceCapture).not.toHaveBeenCalled();
    await act(async () => resolvePlay?.());
    await settle();
    expect(startFormCoachReferenceCapture).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("aborts a pending runtime start when disabled and stops a late session", async () => {
    const { liveStream, track } = callerStream();
    let resolveStart: ((session: FormCoachReferenceCaptureSession) => void) | undefined;
    vi.mocked(startFormCoachReferenceCapture).mockImplementation((_video, options) => {
      optionsList.push(options);
      return new Promise((resolve) => { resolveStart = resolve; });
    });
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template() })));
    await click(button(host, "Start capture"));
    const options = optionsList[0];
    if (!options || !resolveStart) throw new Error("The pending runtime start was not initialized.");

    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: false, liveStream, baseTemplate: template() })));
    expect(options.signal?.aborted).toBe(true);
    await act(async () => options.onCandidate?.(candidate(1), 1));
    const lateSession = sessionFixture();
    await act(async () => resolveStart?.(lateSession));
    await settle();

    expect(lateSession.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Reference capture is disabled");
    expect(host.textContent).not.toContain("Repetition 1");
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("stops an active session when disabled and preserves caller-owned tracks", async () => {
    const { liveStream, track } = callerStream();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template() })));
    await click(button(host, "Start capture"));
    const session = sessions[0];
    if (!session) throw new Error("Capture session was not created.");

    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: false, liveStream, baseTemplate: template() })));
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Reference capture is disabled");
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("stops during a pending build and ignores its eventual result", async () => {
    const { liveStream, track } = callerStream();
    let resolveBuild: ((result: ReferenceCaptureBuildResult) => void) | undefined;
    const onReferenceBuilt = vi.fn();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template(), onReferenceBuilt })));
    await click(button(host, "Start capture"));
    const options = optionsList[0];
    const session = sessions[0];
    if (!options || !session) throw new Error("Capture session was not created.");
    await emitCandidates(options);
    await enterReview(host, options, session, 3);
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await click(host.querySelector<HTMLInputElement>(`input[aria-label="Select repetition ${ordinal}"]`)!);
    }
    vi.mocked(session.buildReference).mockImplementation(() => new Promise((resolve) => { resolveBuild = resolve; }));
    await click(button(host, "Build local reference"));
    expect(host.textContent).toContain("Building a numeric reference locally");

    await click(button(host, "Stop capture"));
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Repetition 1");
    expect(onReferenceBuilt).not.toHaveBeenCalled();
    await act(async () => resolveBuild?.({
      ok: true,
      template: template(),
      requestId: 1,
      candidateGeneration: 3,
      selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
    }));
    await settle();

    expect(onReferenceBuilt).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Local numeric reference ready");
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("unmounts during a pending build, stops the session, and ignores the late result", async () => {
    const { liveStream, track } = callerStream();
    let resolveBuild: ((result: ReferenceCaptureBuildResult) => void) | undefined;
    const onReferenceBuilt = vi.fn();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template(), onReferenceBuilt })));
    await click(button(host, "Start capture"));
    const options = optionsList[0];
    const session = sessions[0];
    if (!options || !session) throw new Error("Capture session was not created.");
    await emitCandidates(options);
    await enterReview(host, options, session, 3);
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await click(host.querySelector<HTMLInputElement>(`input[aria-label="Select repetition ${ordinal}"]`)!);
    }
    vi.mocked(session.buildReference).mockImplementation(() => new Promise((resolve) => { resolveBuild = resolve; }));
    await click(button(host, "Build local reference"));
    const video = host.querySelector("video");

    await act(async () => root.unmount());
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(video?.srcObject).toBe(null);
    await act(async () => resolveBuild?.({
      ok: true,
      template: template(),
      requestId: 1,
      candidateGeneration: 3,
      selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
    }));
    await settle();

    expect(onReferenceBuilt).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("fails closed on a skipped candidate generation", async () => {
    const { liveStream, track } = callerStream();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template() })));
    await click(button(host, "Start capture"));
    const options = optionsList[0];
    const session = sessions[0];
    if (!options || !session) throw new Error("Capture session was not created.");

    await act(async () => options.onCandidate?.(candidate(1), 2));

    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Local reference capture stopped");
    expect(host.textContent).not.toContain("Repetition 1");
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("fails closed when the build reply has a different candidate generation", async () => {
    const { liveStream, track } = callerStream();
    const onReferenceBuilt = vi.fn();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template(), onReferenceBuilt })));
    await click(button(host, "Start capture"));
    const options = optionsList[0];
    const session = sessions[0];
    if (!options || !session) throw new Error("Capture session was not created.");
    await emitCandidates(options);
    await enterReview(host, options, session, 3);
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await click(host.querySelector<HTMLInputElement>(`input[aria-label="Select repetition ${ordinal}"]`)!);
    }
    vi.mocked(session.buildReference).mockResolvedValue({
      ok: true,
      template: template(),
      requestId: 1,
      candidateGeneration: 2,
      selectedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
    });

    await click(button(host, "Build local reference"));

    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Local reference capture stopped");
    expect(onReferenceBuilt).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("handles a rejected build with generic error text and stops the session", async () => {
    const { liveStream, track } = callerStream();
    const onReferenceBuilt = vi.fn();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template(), onReferenceBuilt })));
    await click(button(host, "Start capture"));
    const options = optionsList[0];
    const session = sessions[0];
    if (!options || !session) throw new Error("Capture session was not created.");
    await emitCandidates(options);
    await enterReview(host, options, session, 3);
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await click(host.querySelector<HTMLInputElement>(`input[aria-label="Select repetition ${ordinal}"]`)!);
    }
    vi.mocked(session.buildReference).mockRejectedValue(new Error("private worker failure details"));

    await click(button(host, "Build local reference"));

    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Local reference capture stopped");
    expect(host.textContent).not.toContain("private worker failure details");
    expect(onReferenceBuilt).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("stops an active session on unmount without stopping caller-owned tracks", async () => {
    const { liveStream, track } = callerStream();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template() })));
    await click(button(host, "Start capture"));
    const session = sessions[0];
    if (!session) throw new Error("Capture session was not created.");

    await act(async () => root.unmount());
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("handles an unsupported runtime error with generic copy and stops without exposing private details", async () => {
    const { liveStream } = callerStream();
    vi.mocked(startFormCoachReferenceCapture).mockRejectedValue(Object.assign(
      new Error("private model path C:\\secret\\weights.bin"),
      { code: "unsupported-browser" },
    ));
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template() })));
    await click(button(host, "Start capture"));

    expect(host.textContent).toContain("This browser cannot run local reference capture.");
    expect(host.textContent).not.toContain("secret");
    expect(host.textContent).not.toContain("weights.bin");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("discards the active capture on Stop and pagehide while leaving caller tracks untouched", async () => {
    const { liveStream, track } = callerStream();
    await act(async () => root.render(createElement(FormCoachReferenceCapture, { enabled: true, liveStream, baseTemplate: template() })));
    await click(button(host, "Start capture"));
    const firstSession = sessions[0];
    const firstOptions = optionsList[0];
    if (!firstSession || !firstOptions) throw new Error("Capture session was not created.");
    await act(async () => firstOptions.onCandidate?.(candidate(1), 1));
    await click(button(host, "Stop and discard"));
    expect(firstSession.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Repetition 1");

    await click(button(host, "Start capture"));
    const secondSession = sessions[1];
    if (!secondSession) throw new Error("Second capture session was not created.");
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(secondSession.stop).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Capture stopped when the page was hidden");
    expect(track.stop).not.toHaveBeenCalled();
  });
});
