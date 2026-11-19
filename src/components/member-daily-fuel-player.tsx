"use client";

import "./member-daily-fuel-player.css";

import { Pause, Play, RefreshCw, Zap } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMediaTime, mediaProgress } from "@/lib/daily-fuel";

type CloudflareStreamPlayer = {
  play: () => Promise<void>;
  pause: () => void;
  currentTime: number;
  duration: number;
  addEventListener: (event: string, listener: () => void) => void;
  removeEventListener: (event: string, listener: () => void) => void;
};

declare global {
  interface Window {
    Stream?: (iframe: HTMLIFrameElement) => CloudflareStreamPlayer;
  }
}

let sdkPromise: Promise<void> | null = null;

export function loadStreamPlayerSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Player unavailable"));
  if (window.Stream) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  const pending = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      'script[data-gymx2-stream-player="true"]',
    );
    const shouldAppend = !script;
    if (!script) {
      script = document.createElement("script");
      script.src = "https://embed.cloudflarestream.com/embed/sdk.latest.js";
      script.async = true;
      script.dataset.gymx2StreamPlayer = "true";
    }
    const handleLoad = () => {
      if (window.Stream) {
        script!.dataset.gymx2StreamPlayerLoaded = "true";
        resolve();
      } else {
        script!.remove();
        reject(new Error("Player unavailable"));
      }
    };
    const handleError = () => {
      script!.remove();
      reject(new Error("Player unavailable"));
    };
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (window.Stream) handleLoad();
    else if (script.dataset.gymx2StreamPlayerLoaded === "true")
      handleLoad();
    else if (shouldAppend) document.head.append(script);
  }).catch((error: unknown) => {
    sdkPromise = null;
    throw error;
  });
  sdkPromise = pending;
  return pending;
}

export function MemberDailyFuelPlayer({
  title,
  playerUrl,
  thumbnailUrl,
  totalDuration,
  todayLabel,
  playLabel,
  pauseLabel,
  loadingLabel,
  unavailableLabel,
  retryLabel,
}: {
  title: string;
  playerUrl: string;
  thumbnailUrl: string | null;
  totalDuration: number | null;
  todayLabel: string;
  playLabel: string;
  pauseLabel: string;
  loadingLabel: string;
  unavailableLabel: string;
  retryLabel: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<CloudflareStreamPlayer | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(totalDuration ?? 0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let attached: CloudflareStreamPlayer | null = null;
    const attach = async () => {
      try {
        await loadStreamPlayerSdk();
        const iframe = iframeRef.current;
        if (!active || !iframe || !window.Stream) return;
        attached = window.Stream(iframe);
        playerRef.current = attached;
        const onPlay = () => {
          if (!active) return;
          setHasStarted(true);
          setPlaying(true);
        };
        const onPause = () => active && setPlaying(false);
        const onEnded = () => active && setPlaying(false);
        const onTimeUpdate = () => {
          if (!active || !attached) return;
          setCurrentTime(attached.currentTime || 0);
          if (attached.duration > 0) setPlayerDuration(attached.duration);
        };
        const onLoaded = () => {
          if (!active || !attached) return;
          if (attached.duration > 0) setPlayerDuration(attached.duration);
          setReady(true);
        };
        const onError = () => active && setError(true);
        attached.addEventListener("play", onPlay);
        attached.addEventListener("pause", onPause);
        attached.addEventListener("ended", onEnded);
        attached.addEventListener("timeupdate", onTimeUpdate);
        attached.addEventListener("loadedmetadata", onLoaded);
        attached.addEventListener("error", onError);
        // Cloudflare can finish loading metadata before its SDK object is attached.
        onLoaded();
        const listeners = [
          ["play", onPlay],
          ["pause", onPause],
          ["ended", onEnded],
          ["timeupdate", onTimeUpdate],
          ["loadedmetadata", onLoaded],
          ["error", onError],
        ] as const;
        cleanupListeners = () => {
          for (const [name, listener] of listeners)
            attached?.removeEventListener(name, listener);
        };
      } catch {
        if (active) setError(true);
      }
    };
    let cleanupListeners = () => undefined;
    void attach();
    return () => {
      active = false;
      cleanupListeners();
      if (playerRef.current === attached) playerRef.current = null;
    };
  }, [playerUrl, retryKey]);

  const retryPlayback = useCallback(() => {
    setError(false);
    setReady(false);
    setPlaying(false);
    setHasStarted(false);
    setCurrentTime(0);
    setPlayerDuration(totalDuration ?? 0);
    setRetryKey((current) => current + 1);
  }, [totalDuration]);

  const togglePlayback = useCallback(async () => {
    if (error) {
      retryPlayback();
      return;
    }
    const player = playerRef.current;
    if (!player || !ready) return;
    setError(false);
    try {
      if (playing) player.pause();
      else await player.play();
    } catch {
      setPlaying(false);
      setError(true);
    }
  }, [error, playing, ready, retryPlayback]);

  const duration = playerDuration > 0 ? playerDuration : totalDuration ?? 0;
  const progress = mediaProgress(currentTime, duration);
  const embedUrl = `${playerUrl}${playerUrl.includes("?") ? "&" : "?"}controls=false&preload=false&primaryColor=%23CDF23A`;

  return (
    <div className="member-daily-fuel-player">
      <iframe
        key={retryKey}
        ref={iframeRef}
        src={embedUrl}
        title={title}
        loading="lazy"
        tabIndex={-1}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
      {thumbnailUrl && !hasStarted && (
        // The image is decorative; the video title supplies its accessible name.
        <Image
          className="daily-fuel-poster"
          src={thumbnailUrl}
          alt=""
          width={960}
          height={540}
          unoptimized
        />
      )}
      <span className="daily-fuel-today" aria-label={todayLabel}>
        <Zap size={14} strokeWidth={2} aria-hidden="true" />
        {todayLabel}
      </span>
      <button
        type="button"
        className="daily-fuel-play"
        onClick={() => void togglePlayback()}
        disabled={!ready && !error}
        aria-label={error ? retryLabel : playing ? pauseLabel : playLabel}
      >
        {error ? (
          <RefreshCw aria-hidden="true" />
        ) : playing ? (
          <Pause aria-hidden="true" />
        ) : (
          <Play aria-hidden="true" />
        )}
      </button>
      {!ready && !error && <p className="daily-fuel-player-status">{loadingLabel}</p>}
      {error && <p className="daily-fuel-player-error" role="alert">{unavailableLabel}</p>}
      <div className="daily-fuel-controls" aria-label={title}>
        <span>{formatMediaTime(currentTime)}</span>
        <div
          className="daily-fuel-progress"
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <span>{duration > 0 ? formatMediaTime(duration) : "—:—"}</span>
      </div>
    </div>
  );
}
