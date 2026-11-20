"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CurlScoringTemplate, PoseLandmark, TrackedArm } from "@/lib/form-coach/engine/types";
import type { FormCoachProcessingSession, FormCoachRuntimeFailure, FormCoachPerformanceSummary } from "@/lib/form-coach/browser-runtime";
import type { FormCoachRepSummary, FormCoachRunMode, SetupStep } from "@/lib/form-coach/worker-protocol";

export interface FormCoachProcessorProps {
  readonly mode: FormCoachRunMode;
  readonly arm?: TrackedArm;
  /** Caller-owned stream. This component never requests camera/microphone permission or stops its tracks. */
  readonly liveStream?: MediaStream | null;
  readonly referenceRepTarget?: number;
  readonly template?: CurlScoringTemplate;
  readonly onRepSummary?: (summary: FormCoachRepSummary) => void;
  readonly onReferenceReady?: (template: CurlScoringTemplate, cleanRepCount: number) => void;
}

const CONNECTIONS = [
  [7, 11], [8, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
] as const;
const MAX_VISIBLE_SUMMARIES = 20;

const SETUP_TEXT: Record<SetupStep, string> = {
  "show-side-view": "Turn sideways so the camera sees one shoulder and hip in profile.",
  "move-back": "Move closer until your torso occupies at least one quarter of the frame.",
  "extend-arm-hold": "Keep your arm extended and your torso still for two seconds.",
  ready: "Ready. Move through a controlled repetition.",
  "low-confidence": "Make sure your ear, shoulder, elbow, wrist, and hip stay visible.",
};

const CUE_TEXT: Record<string, string> = {
  elbows_pinned: "Pin your elbows to your sides.",
  no_swing: "Keep your torso still.",
  full_range_down: "All the way down.",
  full_range_up: "Squeeze all the way up.",
  slow_down: "Slow the lowering phase.",
  relax_shoulders: "Relax your shoulders.",
  good_rep: "Good rep.",
  keep_breathing: "Keep breathing.",
  exhale: "Exhale.",
  inhale: "Inhale.",
};

function errorText(code: FormCoachRuntimeFailure): string {
  if (code === "unsupported-browser") return "This browser cannot run the local Form Coach processor.";
  if (code === "timeline-reset-required") return "The clip position changed. Start a new processing run to continue.";
  if (code === "unsupported-arm-mode") return "Two-arm scoring is not supported in this version of Form Coach.";
  if (code === "frame-capture-failed") return "A video frame could not be read. Check the selected video and try again.";
  return "Form Coach could not start or continue local processing.";
}

function drawOverlay(canvas: HTMLCanvasElement | null, video: HTMLVideoElement | null, landmarks: readonly (PoseLandmark | null)[]) {
  if (!canvas || !video || video.videoWidth < 1 || video.videoHeight < 1) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(125, 211, 252, 0.9)";
  context.lineWidth = Math.max(2, canvas.width / 320);
  context.fillStyle = "rgba(34, 211, 238, 0.95)";
  for (const [startIndex, endIndex] of CONNECTIONS) {
    const start = landmarks[startIndex];
    const end = landmarks[endIndex];
    if (!start || !end || (start.visibility ?? 0) < 0.5 || (end.visibility ?? 0) < 0.5) continue;
    context.beginPath();
    context.moveTo(start.x * canvas.width, start.y * canvas.height);
    context.lineTo(end.x * canvas.width, end.y * canvas.height);
    context.stroke();
  }
  for (const landmark of landmarks) {
    if (!landmark || (landmark.visibility ?? 0) < 0.5) continue;
    context.beginPath();
    context.arc(landmark.x * canvas.width, landmark.y * canvas.height, Math.max(3, canvas.width / 180), 0, Math.PI * 2);
    context.fill();
  }
}

export function FormCoachProcessor({
  mode,
  arm = "auto",
  liveStream = null,
  referenceRepTarget = 3,
  template,
  onRepSummary,
  onReferenceReady,
}: FormCoachProcessorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<FormCoachProcessingSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Choose a video or provide a live stream to begin.");
  const [setupStep, setSetupStep] = useState<SetupStep>("show-side-view");
  const [cue, setCue] = useState<string | null>(null);
  const [performance, setPerformance] = useState<FormCoachPerformanceSummary | null>(null);
  const [summaries, setSummaries] = useState<readonly FormCoachRepSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [referenceReady, setReferenceReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoReady(false);
    setError(null);
    setReferenceReady(false);
    if (mode === "reference") {
      if (!selectedFile) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        return;
      }
      const localUrl = URL.createObjectURL(selectedFile);
      video.src = localUrl;
      video.muted = true;
      video.playsInline = true;
      video.load();
      return () => {
        abortRef.current?.abort();
        abortRef.current = null;
        const session = sessionRef.current;
        sessionRef.current = null;
        if (session) void session.stop();
        setRunning(false);
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(localUrl);
      };
    }
    video.muted = true;
    video.playsInline = true;
    video.srcObject = liveStream;
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void session.stop();
      setRunning(false);
      video.pause();
      video.srcObject = null;
    };
  }, [mode, selectedFile, liveStream]);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) void session.stop();
    videoRef.current?.pause();
    if (videoRef.current?.srcObject) videoRef.current.srcObject = null;
  }, []);

  const handleOverlay = useCallback((landmarks: readonly (PoseLandmark | null)[]) => {
    drawOverlay(canvasRef.current, videoRef.current, landmarks);
  }, []);

  const handleRep = useCallback((summary: FormCoachRepSummary) => {
    setSummaries((previous) => [...previous, summary].slice(-MAX_VISIBLE_SUMMARIES));
    onRepSummary?.(summary);
  }, [onRepSummary]);

  const handleReference = useCallback((readyTemplate: CurlScoringTemplate, cleanRepCount: number) => {
    setReferenceReady(true);
    setRunning(false);
    setStatus(`Reference ready from ${cleanRepCount} clean reps. The median reference is available to the calling page.`);
    videoRef.current?.pause();
    onReferenceReady?.(readyTemplate, cleanRepCount);
  }, [onReferenceReady]);

  async function startProcessing() {
    const video = videoRef.current;
    if (!video || !videoReady || (mode === "reference" && !selectedFile) || (mode === "live" && !liveStream)) return;
    setError(null);
    setCue(null);
    setRunning(true);
    setStatus("Loading the local pose model and Worker…");
    const abortController = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abortController;
    const previous = sessionRef.current;
    sessionRef.current = null;
    if (previous) await previous.stop();
    try {
      if (video.ended) {
        await new Promise<void>((resolve) => {
          const onSeeked = () => resolve();
          video.addEventListener("seeked", onSeeked, { once: true });
          video.currentTime = 0;
          if (video.currentTime === 0 && !video.seeking) {
            video.removeEventListener("seeked", onSeeked);
            resolve();
          }
        });
      }
      const { startFormCoachProcessing } = await import("@/lib/form-coach/browser-runtime");
      const session = await startFormCoachProcessing(video, {
        mode,
        arm,
        signal: abortController.signal,
        referenceRepTarget,
        ...(mode === "live" && template ? { template } : {}),
        onReady: ({ model, delegate }) => setStatus(`Processing locally with ${model} model on ${delegate}.`),
        onSetup: (step) => {
          setSetupStep(step);
          setStatus(SETUP_TEXT[step]);
        },
        onOverlay: handleOverlay,
        onRep: handleRep,
        onReferenceReady: handleReference,
        onCue: (key) => setCue(CUE_TEXT[key] ?? null),
        onPerformance: setPerformance,
        onSetBoundary: () => {
          setStatus("This set reached its sample limit. Stop and start a new session to reset the local set buffer.");
          setRunning(false);
          video.pause();
        },
        onTimelineResetRequired: () => setStatus("The clip moved. Start a new session to reset its media timestamp epoch."),
        onError: (code) => {
          setError(errorText(code));
          setRunning(false);
          video.pause();
        },
      });
      if (abortController.signal.aborted) {
        await session.stop();
        return;
      }
      sessionRef.current = session;
      await video.play();
    } catch (cause) {
      if (abortController.signal.aborted) return;
      const failedSession = sessionRef.current;
      sessionRef.current = null;
      if (failedSession) await failedSession.stop();
      video.pause();
      setRunning(false);
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) as FormCoachRuntimeFailure : "worker-start-failed";
      setError(cause instanceof DOMException && cause.name === "NotAllowedError" ? "The selected video could not start playing. Press Start again from this page." : errorText(code));
      setStatus("Processing stopped.");
    } finally {
      if (abortRef.current === abortController) abortRef.current = null;
    }
  }

  async function stopProcessing() {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setStatus("Stopping local processing…");
    videoRef.current?.pause();
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) await session.stop();
    setStatus("Processing stopped. Your video and pose data stayed in this browser session.");
    drawOverlay(canvasRef.current, videoRef.current, []);
  }

  const canStart = videoReady && (mode === "reference" ? Boolean(selectedFile) : Boolean(liveStream)) && !running && !(mode === "reference" && referenceReady);

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-950 p-4 text-slate-100" aria-label="Form Coach local video processor">
      {mode === "reference" ? (
        <label className="block space-y-2 text-sm font-medium">
          <span>Select a reference clip from this device</span>
          <input
            type="file"
            accept="video/*"
            disabled={running}
            onChange={(event) => {
              setSummaries([]);
              setPerformance(null);
              setSelectedFile(event.currentTarget.files?.[0] ?? null);
              setStatus("Loading the selected video locally.");
            }}
            className="block w-full rounded-lg border border-slate-600 bg-slate-900 p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-cyan-700 file:px-3 file:py-2 file:text-white"
          />
        </label>
      ) : (
        <p className="text-sm text-slate-300">
          Live mode accepts a caller-owned video stream. Camera permission and stream ownership stay with the calling page.
        </p>
      )}

      <div className="relative overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          preload="metadata"
          onLoadedData={() => setVideoReady(true)}
          onEmptied={() => setVideoReady(false)}
          className="block aspect-video w-full object-contain"
          aria-label={mode === "reference" ? "Locally selected reference video" : "Caller-provided live video"}
        />
        <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={startProcessing} disabled={!canStart} className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
          {mode === "reference" ? "Build reference" : "Start live analysis"}
        </button>
        <button type="button" onClick={stopProcessing} disabled={!running} className="rounded-lg border border-slate-500 px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40">
          Stop
        </button>
      </div>

      <div role="status" aria-live="polite" className="space-y-1 text-sm">
        <p>{status}</p>
        <p>{SETUP_TEXT[setupStep]}</p>
        {cue ? <p className="font-semibold text-cyan-200">{cue}</p> : null}
        {performance ? (
          <p className={performance.slowNotice ? "text-amber-300" : "text-slate-400"}>
            {performance.fps === null ? "Measuring processing speed…" : `${performance.fps.toFixed(1)} processed FPS`} · {performance.droppedFrames} dropped frames
            {performance.slowNotice ? " · Processing is below 15 FPS." : ""}
          </p>
        ) : null}
        {error ? <p className="text-rose-300">{error}</p> : null}
        {referenceReady ? <p className="text-emerald-300">Reference processing complete.</p> : null}
      </div>

      {summaries.length > 0 ? (
        <ol className="space-y-2" aria-label="Recent rep summaries">
          {summaries.map((summary) => (
            <li key={summary.repNumber} className="rounded-lg bg-slate-900 p-3 text-sm">
              Rep {summary.repNumber}: {summary.score.toFixed(1)} / 100
              {summary.faults.length > 0 ? <span className="ml-2 text-amber-200">{summary.faults.join(", ")}</span> : <span className="ml-2 text-emerald-300">No detected form faults</span>}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
