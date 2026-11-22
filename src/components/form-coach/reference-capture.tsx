"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  FormCoachReferenceCaptureSession,
  ReferenceCaptureBuildResult,
  ReferenceCaptureBuildFailureCode,
} from "@/lib/form-coach/browser-runtime";
import type { ExerciseTemplate } from "@/lib/form-coach/template-schema";
import {
  isReferenceCaptureCandidateSummary,
  type ReferenceCaptureCandidateSummary,
  type ReferenceCapturePauseReason,
  type SetupStep,
} from "@/lib/form-coach/worker-protocol";

export interface FormCoachReferenceCaptureProps {
  /** Supplied by the authoring flow after it has decided this coach may capture a reference. */
  readonly enabled?: boolean;
  /** Caller-owned camera stream. This component never requests permission or stops its tracks. */
  readonly liveStream?: MediaStream | null;
  readonly baseTemplate: ExerciseTemplate;
  /** Receives only the validated local numeric exercise template after a successful build. */
  readonly onReferenceBuilt?: (template: ExerciseTemplate) => void;
}

type CaptureStage = "idle" | "starting" | "capturing" | "pausing" | "review" | "building" | "ready" | "error";
type CandidateEntry = Readonly<{ summary: ReferenceCaptureCandidateSummary; generation: number }>;
type CaptureUiState = Readonly<{
  enabled: boolean;
  liveStream: MediaStream | null;
  templateKey: string;
  runId: number | null;
  stage: CaptureStage;
  candidates: readonly CandidateEntry[];
  selectedIds: readonly string[];
  candidateGeneration: number;
  pauseReason: ReferenceCapturePauseReason | null;
  setupStep: SetupStep | null;
  delegate: "GPU" | "CPU" | null;
  notice: string;
  error: string | null;
}>;

type ActiveCapture = {
  id: number;
  liveStream: MediaStream;
  templateKey: string;
  video: HTMLVideoElement;
  abortController: AbortController;
  session: FormCoachReferenceCaptureSession | null;
  stopPromise: Promise<void> | null;
  candidates: ReferenceCaptureCandidateSummary[];
  candidateGeneration: number;
  pausedGeneration: number | null;
  built: boolean;
};

type CurrentProps = Readonly<{
  enabled: boolean;
  liveStream: MediaStream | null;
  templateKey: string;
  onReferenceBuilt?: (template: ExerciseTemplate) => void;
}>;

const SETUP_TEXT: Record<SetupStep, string> = {
  "show-side-view": "Turn sideways so one shoulder and hip are visible in profile.",
  "show-required-view": "Adjust the camera to the view required by this exercise.",
  "show-both-arms": "Keep both shoulders, elbows, and wrists visible during the rep.",
  "move-back": "Move back until your torso fills at least one quarter of the frame.",
  "extend-arm-hold": "Extend your arm and keep your torso still for two seconds.",
  ready: "Ready. Complete a controlled reference repetition.",
  "low-confidence": "Keep your ear, shoulder, elbow, wrist, and hip visible.",
};

const PAUSE_TEXT: Record<ReferenceCapturePauseReason, string> = {
  user_pause: "Capture paused. Review the clean repetitions and choose three to five.",
  video_end: "The camera stream ended. Review any clean repetitions that were captured.",
  candidate_cap: "The safe repetition limit was reached. Review the clean repetitions captured so far.",
  curve_point_cap: "The local measurement limit was reached. Review the clean repetitions captured so far.",
  session_sample_limit: "The local sample limit was reached. Review the clean repetitions captured so far.",
};

function emptyState(props: CurrentProps, runId: number | null = null): CaptureUiState {
  return {
    enabled: props.enabled,
    liveStream: props.liveStream,
    templateKey: props.templateKey,
    runId,
    stage: "idle",
    candidates: [],
    selectedIds: [],
    candidateGeneration: 0,
    pauseReason: null,
    setupStep: null,
    delegate: null,
    notice: "",
    error: null,
  };
}

function copyCandidateSummary(candidate: ReferenceCaptureCandidateSummary): ReferenceCaptureCandidateSummary {
  // Keep the UI boundary to the runtime's allowlisted numeric summary; worker-local curves never enter React state.
  return {
    id: candidate.id,
    ordinal: candidate.ordinal,
    pairing: candidate.pairing,
    arm: candidate.arm,
    selectable: candidate.selectable,
    reason: candidate.reason,
    romMinAngle: candidate.romMinAngle,
    romMaxAngle: candidate.romMaxAngle,
    concentricMs: candidate.concentricMs,
    topPauseMs: candidate.topPauseMs,
    eccentricMs: candidate.eccentricMs,
    maxUpperArmDrift: candidate.maxUpperArmDrift,
    maxTorsoSwing: candidate.maxTorsoSwing,
    maxShrug: candidate.maxShrug,
  };
}

function errorCopy(code?: string): string {
  if (code === "unsupported-browser") return "This browser cannot run local reference capture.";
  return "Local reference capture stopped. Start a new capture to continue.";
}

function failureCopy(code: ReferenceCaptureBuildFailureCode): string {
  if (code === "invalid-selection") return "Choose three to five clean repetitions from this review.";
  if (code === "stale-generation") return "This review changed before the reference was built. Check the selection and try again.";
  if (code === "already-built") return "This capture was already used. Start a new capture to build another reference.";
  if (code === "not-paused") return "Pause the capture before building a reference.";
  return "The local reference could not be built. Start a new capture to continue.";
}

function reasonCopy(reason: ReferenceCaptureCandidateSummary["reason"]): string {
  if (reason === "form_faults") return "Not selectable: form faults were detected.";
  if (reason === "outside_clean_reference") return "Not selectable: measurements were outside the clean reference range.";
  return "Clean repetition";
}

function formatAngle(value: number): string {
  return `${Math.round(value)}°`;
}

function formatTime(value: number): string {
  return `${(value / 1000).toFixed(1)} s`;
}

export function FormCoachReferenceCapture({
  enabled = false,
  liveStream = null,
  baseTemplate,
  onReferenceBuilt,
}: FormCoachReferenceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef<ActiveCapture | null>(null);
  const generationRef = useRef(0);
  const templateKey = JSON.stringify(baseTemplate);
  const currentProps: CurrentProps = { enabled, liveStream, templateKey, onReferenceBuilt };
  const currentPropsRef = useRef(currentProps);
  const [ui, setUi] = useState<CaptureUiState>(() => emptyState(currentProps));
  const uiRef = useRef(ui);

  useLayoutEffect(() => {
    currentPropsRef.current = currentProps;
    uiRef.current = ui;
  });

  const isCurrent = useCallback((run: ActiveCapture) => {
    const props = currentPropsRef.current;
    return activeRef.current === run && generationRef.current === run.id && props.enabled &&
      props.liveStream === run.liveStream && props.templateKey === run.templateKey;
  }, []);

  const stopRun = useCallback((run: ActiveCapture) => {
    if (activeRef.current === run) {
      activeRef.current = null;
      if (generationRef.current === run.id) generationRef.current += 1;
    }
    run.abortController.abort();
    if (!run.stopPromise) {
      run.stopPromise = run.session ? run.session.stop().catch(() => undefined) : Promise.resolve();
    }
    run.video.pause();
    if (run.video.srcObject === run.liveStream) run.video.srcObject = null;
  }, []);

  useLayoutEffect(() => {
    const active = activeRef.current;
    if (active && (!enabled || active.liveStream !== liveStream || active.templateKey !== templateKey)) {
      stopRun(active);
    }
    setUi(emptyState(currentPropsRef.current));
    return () => {
      const run = activeRef.current;
      if (run && run.liveStream === liveStream && run.templateKey === templateKey) stopRun(run);
    };
  }, [enabled, liveStream, stopRun, templateKey]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    video.playsInline = true;
    const source = enabled ? liveStream : null;
    video.srcObject = source;
    return () => {
      video.pause();
      if (video.srcObject === source) video.srcObject = null;
    };
  }, [enabled, liveStream]);

  useLayoutEffect(() => {
    const handlePageHide = () => {
      const run = activeRef.current;
      if (!run) return;
      stopRun(run);
      setUi({ ...emptyState(currentPropsRef.current), notice: "Capture stopped when the page was hidden. Start a new capture to continue." });
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [stopRun]);

  const updateRun = useCallback((run: ActiveCapture, update: (previous: CaptureUiState) => CaptureUiState) => {
    if (!isCurrent(run)) return;
    setUi((previous) => previous.runId === run.id ? update(previous) : previous);
  }, [isCurrent]);

  const failRun = useCallback((run: ActiveCapture, message: string) => {
    if (!isCurrent(run)) return;
    stopRun(run);
    setUi({ ...emptyState(currentPropsRef.current), stage: "error", error: message });
  }, [isCurrent, stopRun]);

  const startCapture = useCallback(async () => {
    const props = currentPropsRef.current;
    const video = videoRef.current;
    if (!props.enabled || !props.liveStream || !video) return;

    const previous = activeRef.current;
    if (previous) stopRun(previous);

    const id = ++generationRef.current;
    const run: ActiveCapture = {
      id,
      liveStream: props.liveStream,
      templateKey: props.templateKey,
      video,
      abortController: new AbortController(),
      session: null,
      stopPromise: null,
      candidates: [],
      candidateGeneration: 0,
      pausedGeneration: null,
      built: false,
    };
    activeRef.current = run;
    setUi({ ...emptyState(props, id), stage: "starting", notice: "Starting local capture…" });

    try {
      if (video.srcObject !== props.liveStream) video.srcObject = props.liveStream;
      await video.play();
      if (!isCurrent(run)) return;
      const { startFormCoachReferenceCapture } = await import("@/lib/form-coach/browser-runtime");
      if (!isCurrent(run)) return;
      const session = await startFormCoachReferenceCapture(video, {
        baseTemplate,
        signal: run.abortController.signal,
        onReady: ({ delegate }) => updateRun(run, (previousState) => ({
          ...previousState,
          stage: "capturing",
          delegate,
          notice: delegate === "CPU"
            ? "Capturing locally on CPU. Processing may be slower on this device."
            : "Capturing locally. Complete controlled repetitions, then pause to review.",
        })),
        onSetup: (step) => updateRun(run, (previousState) => ({
          ...previousState,
          setupStep: step,
          notice: SETUP_TEXT[step],
        })),
        onCandidate: (incoming, candidateGeneration) => {
          if (!isCurrent(run)) return;
          if (!isReferenceCaptureCandidateSummary(incoming) || candidateGeneration !== run.candidateGeneration + 1 || run.candidates.some(({ id: candidateId }) => candidateId === incoming.id)) {
            failRun(run, errorCopy("worker-failed"));
            return;
          }
          const summary = copyCandidateSummary(incoming);
          run.candidateGeneration = candidateGeneration;
          run.candidates = [...run.candidates, summary];
          updateRun(run, (previousState) => ({
            ...previousState,
            candidates: [...previousState.candidates, { summary, generation: candidateGeneration }],
            candidateGeneration,
            notice: summary.selectable
              ? `Clean repetition ${summary.ordinal} captured. Pause when you are ready to review.`
              : `Repetition ${summary.ordinal} was recorded for review but cannot be selected.`,
          }));
        },
        onPaused: ({ candidateGeneration, reason }) => {
          if (!isCurrent(run)) return;
          if (candidateGeneration !== run.candidateGeneration) {
            failRun(run, errorCopy("worker-failed"));
            return;
          }
          run.pausedGeneration = candidateGeneration;
          updateRun(run, (previousState) => ({
            ...previousState,
            stage: "review",
            candidateGeneration,
            pauseReason: reason,
            notice: PAUSE_TEXT[reason],
          }));
        },
        onError: (code) => failRun(run, errorCopy(code)),
        onTimelineResetRequired: () => failRun(run, errorCopy("timeline-reset-required")),
      });
      if (!isCurrent(run)) {
        await session.stop();
        return;
      }
      run.session = session;
      updateRun(run, (previousState) => previousState.stage === "starting"
        ? { ...previousState, stage: "capturing", notice: "Capturing locally. Complete controlled repetitions, then pause to review." }
        : previousState);
    } catch (error) {
      if (!isCurrent(run)) return;
      failRun(run, errorCopy((error as { code?: string } | null)?.code));
    }
  }, [baseTemplate, failRun, isCurrent, stopRun, updateRun]);

  const pauseCapture = useCallback(async () => {
    const run = activeRef.current;
    if (!run || !isCurrent(run) || !run.session || uiRef.current.stage !== "capturing") return;
    updateRun(run, (previousState) => ({ ...previousState, stage: "pausing", notice: "Pausing and finishing local frame work…" }));
    try {
      const acknowledgement = await run.session.pauseCapture();
      if (!isCurrent(run)) return;
      if (acknowledgement.candidateGeneration !== run.candidateGeneration) {
        failRun(run, errorCopy("worker-failed"));
        return;
      }
      run.pausedGeneration = acknowledgement.candidateGeneration;
      updateRun(run, (previousState) => ({
        ...previousState,
        stage: "review",
        candidateGeneration: acknowledgement.candidateGeneration,
        pauseReason: acknowledgement.reason,
        notice: PAUSE_TEXT[acknowledgement.reason],
      }));
    } catch {
      if (isCurrent(run)) failRun(run, errorCopy("worker-failed"));
    }
  }, [failRun, isCurrent, updateRun]);

  const toggleCandidate = useCallback((candidateId: string) => {
    const run = activeRef.current;
    const state = uiRef.current;
    if (!run || !isCurrent(run) || state.stage !== "review" || run.pausedGeneration !== run.candidateGeneration) return;
    const candidate = run.candidates.find(({ id }) => id === candidateId);
    if (!candidate?.selectable) return;
    const selected = new Set(state.selectedIds);
    if (selected.has(candidateId)) {
      selected.delete(candidateId);
      updateRun(run, (previousState) => ({ ...previousState, selectedIds: [...selected], notice: "Selection updated." }));
      return;
    }
    if (selected.size >= 5) {
      updateRun(run, (previousState) => ({ ...previousState, notice: "Choose no more than five clean repetitions." }));
      return;
    }
    selected.add(candidateId);
    updateRun(run, (previousState) => ({
      ...previousState,
      selectedIds: [...selected],
      notice: `${selected.size} clean ${selected.size === 1 ? "repetition" : "repetitions"} selected; choose three to five to build the reference.`,
    }));
  }, [isCurrent, updateRun]);

  const buildReference = useCallback(async () => {
    const run = activeRef.current;
    const state = uiRef.current;
    if (!run || !isCurrent(run) || !run.session || state.stage !== "review" || run.pausedGeneration !== run.candidateGeneration) return;
    const selectedIds = [...state.selectedIds];
    const selectableIds = new Set(run.candidates.filter(({ selectable }) => selectable).map(({ id }) => id));
    if (selectedIds.length < 3 || selectedIds.length > 5 || new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !selectableIds.has(id))) {
      updateRun(run, (previousState) => ({ ...previousState, notice: "Choose three to five clean repetitions from this review." }));
      return;
    }
    const candidateGeneration = run.candidateGeneration;
    updateRun(run, (previousState) => ({ ...previousState, stage: "building", notice: "Building a numeric reference locally…", error: null }));
    try {
      const result: ReferenceCaptureBuildResult = await run.session.buildReference(selectedIds);
      if (!isCurrent(run)) return;
      if (result.candidateGeneration !== candidateGeneration || result.selectedCandidateIds.length !== selectedIds.length || result.selectedCandidateIds.some((id, index) => id !== selectedIds[index])) {
        failRun(run, errorCopy("worker-failed"));
        return;
      }
      if (!result.ok) {
        if (result.code === "already-built" || result.code === "worker-failed" || result.code === "not-paused") {
          failRun(run, failureCopy(result.code));
          return;
        }
        updateRun(run, (previousState) => ({
          ...previousState,
          stage: "review",
          selectedIds: result.code === "invalid-selection" || result.code === "stale-generation" ? [] : previousState.selectedIds,
          notice: failureCopy(result.code),
        }));
        return;
      }
      run.built = true;
      updateRun(run, (previousState) => ({ ...previousState, stage: "ready", notice: "Reference built locally. It has not been saved or published." }));
      try {
        currentPropsRef.current.onReferenceBuilt?.(result.template);
      } catch {
        updateRun(run, (previousState) => ({ ...previousState, notice: "Reference built locally, but the authoring screen could not receive it." }));
      }
    } catch {
      if (isCurrent(run)) failRun(run, errorCopy("worker-failed"));
    }
  }, [failRun, isCurrent, updateRun]);

  const discardCapture = useCallback((notice = "Local candidates and the reference were discarded. Start a new capture to collect reps.") => {
    const run = activeRef.current;
    if (run) stopRun(run);
    setUi({ ...emptyState(currentPropsRef.current), notice });
  }, [stopRun]);

  const stateIsCurrent = ui.enabled === enabled && ui.liveStream === liveStream && ui.templateKey === templateKey;
  const visible = stateIsCurrent ? ui : emptyState(currentProps);
  const canStart = enabled && liveStream !== null;
  const cleanCount = visible.candidates.filter(({ summary }) => summary.selectable).length;
  const canBuild = visible.stage === "review" && visible.selectedIds.length >= 3 && visible.selectedIds.length <= 5 &&
    visible.candidateGeneration > 0;
  const startingNewCapture = visible.stage === "review" || visible.stage === "ready" || visible.stage === "error";

  return (
    <section className="space-y-5 rounded-2xl border border-border bg-surface p-5" aria-labelledby="reference-capture-heading">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Local reference capture</p>
        <h2 id="reference-capture-heading" className="text-xl font-semibold">Capture clean dumbbell curl reps</h2>
        <p className="text-sm text-muted">Capture reference reps for local review. This does not create or save a video.</p>
      </div>

      <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm" role="note">
        Pose processing can be demanding on this device. Keep the camera view steady and stop if processing feels too slow.
      </p>

      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
        <video ref={videoRef} aria-label="Local reference capture preview" className="aspect-video w-full object-contain" muted playsInline />
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-surface-raised p-4" aria-live="polite" aria-atomic="true">
        <p className="font-medium">{visible.error ?? (visible.notice || (enabled ? "Ready when you are." : "Reference capture is disabled for this authoring session."))}</p>
        {visible.setupStep ? <p className="text-sm text-muted">{SETUP_TEXT[visible.setupStep]}</p> : null}
        {visible.delegate === "CPU" ? <p className="text-sm text-warning">CPU mode is active; live pose processing may be slower.</p> : null}
      </div>

      {!liveStream ? <p className="text-sm text-muted">The authoring screen must provide a live camera stream before capture can start.</p> : null}

      <div className="flex flex-wrap gap-3">
        {visible.stage === "capturing" ? (
          <>
            <button className="rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => void pauseCapture()}>
              Pause and review
            </button>
            <button className="rounded-lg border border-border px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => discardCapture()}>
              Stop and discard
            </button>
          </>
        ) : null}
        {visible.stage === "starting" || visible.stage === "pausing" || visible.stage === "building" ? (
          <button className="rounded-lg border border-border px-4 py-2 font-semibold" type="button" onClick={() => discardCapture("Capture stopped. Start a new capture to continue.")}>
            Stop capture
          </button>
        ) : null}
        {visible.stage === "idle" || visible.stage === "error" || visible.stage === "review" || visible.stage === "ready" ? (
          <button
            className="rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={!canStart}
            onClick={() => void startCapture()}
          >
            {startingNewCapture ? "Start a new capture · discard current review" : "Start capture"}
          </button>
        ) : null}
        {visible.stage === "review" || visible.stage === "ready" ? (
          <button className="rounded-lg border border-border px-4 py-2 font-semibold" type="button" onClick={() => discardCapture()}>
            Discard capture
          </button>
        ) : null}
      </div>

      {visible.stage === "review" || visible.stage === "building" ? (
        <section className="space-y-3" aria-labelledby="reference-candidates-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="reference-candidates-heading" className="font-semibold">Review captured reps</h3>
            <p className="text-sm text-muted">{cleanCount} clean available · {visible.selectedIds.length} selected</p>
          </div>
          {visible.candidates.length === 0 ? <p className="rounded-lg border border-border bg-surface-raised p-3 text-sm text-muted">No completed reps were captured. Start a new capture to try again.</p> : null}
          <ul className="space-y-2">
            {visible.candidates.map(({ summary }) => (
              <li key={summary.id} className="rounded-xl border border-border bg-surface-raised p-3">
                <label className={`flex items-start gap-3 ${summary.selectable && visible.stage === "review" ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}>
                  <input
                    type="checkbox"
                    className="mt-1 accent-accent"
                    checked={visible.selectedIds.includes(summary.id)}
                    disabled={!summary.selectable || visible.stage !== "review" || (!visible.selectedIds.includes(summary.id) && visible.selectedIds.length >= 5)}
                    onChange={() => toggleCandidate(summary.id)}
                    aria-label={`Select repetition ${summary.ordinal}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center justify-between gap-2 font-medium">
                      <span>Repetition {summary.ordinal}</span>
                      <span className="text-xs text-muted">{summary.pairing === "matched_bilateral" ? "Matched bilateral" : `${summary.arm ?? "Auto"} arm`}</span>
                    </span>
                    <span className="mt-1 block text-sm text-muted">{reasonCopy(summary.reason)}</span>
                    <span className="mt-2 block text-xs tabular-nums text-muted">
                      ROM {formatAngle(summary.romMinAngle)}–{formatAngle(summary.romMaxAngle)} · up {formatTime(summary.concentricMs)} · hold {formatTime(summary.topPauseMs)} · down {formatTime(summary.eccentricMs)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Choose three to five clean repetitions from this paused review. Starting a new capture discards this review.</p>
          <button
            className="rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={!canBuild || visible.stage !== "review"}
            onClick={() => void buildReference()}
          >
            Build local reference
          </button>
        </section>
      ) : null}

      {visible.stage === "capturing" ? (
        <section className="space-y-3" aria-labelledby="captured-reps-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="captured-reps-heading" className="font-semibold">Captured reps</h3>
            <p className="text-sm text-muted">{cleanCount} clean available</p>
          </div>
          {visible.candidates.length === 0 ? <p className="text-sm text-muted">Completed reps will appear here as numeric summaries.</p> : null}
          <ul className="space-y-2">
            {visible.candidates.map(({ summary }) => (
              <li key={summary.id} className="rounded-xl border border-border bg-surface-raised p-3">
                <p className="flex flex-wrap items-center justify-between gap-2 font-medium">
                  <span>Repetition {summary.ordinal}</span>
                  <span className="text-xs text-muted">{summary.pairing === "matched_bilateral" ? "Matched bilateral" : `${summary.arm ?? "Auto"} arm`}</span>
                </p>
                <p className="mt-1 text-sm text-muted">{reasonCopy(summary.reason)}</p>
                <p className="mt-2 text-xs tabular-nums text-muted">
                  ROM {formatAngle(summary.romMinAngle)}–{formatAngle(summary.romMaxAngle)} · up {formatTime(summary.concentricMs)} · hold {formatTime(summary.topPauseMs)} · down {formatTime(summary.eccentricMs)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {visible.stage === "ready" ? (
        <p className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm" role="status">
          Local numeric reference ready. It has not been saved or published.
        </p>
      ) : null}

      <p className="text-xs text-muted">Frames, pose landmarks, and rep curves stay in the local capture worker. Only numeric candidate summaries are shown here; the built numeric template is returned to the calling authoring screen.</p>
    </section>
  );
}
