"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  acceptPrivateSession,
  markPrivateBroadcastLive,
  offerPrivateSession,
  preparePrivateBroadcast,
  privatePlayback,
  readPrivateLiveSession,
  resetSessionToBroadcast,
  revokePrivateSession,
} from "@/app/(app)/calendar/[id]/live/private-actions";
import { checkIn, type LiveChatMessage } from "@/app/(app)/calendar/[id]/live/actions";
import { LiveChat, useCanStartLive } from "@/components/live-room";
import { useT } from "@/i18n/client";
import type {
  PrivateLiveErrorCode,
  PrivateLiveGrantSnapshot,
  PrivateLiveSessionSnapshot,
} from "@/lib/private-live";
import { canGoLive, isLiveSnapshotCurrent } from "@/lib/live";
import { NotLiveYet, play, publish, type Connection } from "@/lib/webrtc";
import { useRouter } from "next/navigation";
import { LiveFullscreenRegion } from "@/components/live-fullscreen";

type OfferProps = {
  sessionId: string;
  memberId: string;
  memberName: string;
};

export function PrivateOneOnOneOffer({
  sessionId,
  memberId,
  memberName,
}: OfferProps) {
  const t = useT().calendar.live.private;
  const router = useRouter();
  const [error, setError] = useState<PrivateLiveErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function offer() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await offerPrivateSession(sessionId, memberId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        setError("temporarily_unavailable");
      }
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div>
        <h2 className="font-semibold">{t.title}</h2>
        <p className="mt-1 text-sm text-muted">
          {t.offerDescription} {memberName}
        </p>
      </div>
      <button
        type="button"
        onClick={offer}
        disabled={pending}
        className="btn-secondary"
      >
        {pending ? t.offering : t.offer}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t.errors[error]}
        </p>
      )}
    </section>
  );
}

type PrivateRoomProps = {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  me: string;
  coachId: string;
  otherName: string;
  names: Record<string, string>;
  canChat: boolean;
  initialChat: LiveChatMessage[];
  initialSnapshot: PrivateLiveSessionSnapshot;
  memberId: string | null;
  memberName: string;
};

function grantKey(grant: PrivateLiveGrantSnapshot | null | undefined) {
  return grant ? `${grant.grantId}:${grant.generation}` : "";
}

function activeGrant(grant: PrivateLiveGrantSnapshot | null, now: number) {
  return Boolean(
    grant &&
      (grant.state === "accepted" || grant.state === "live") &&
      Date.parse(grant.expiresAt) > now,
  );
}

export function PrivateLiveRoom(props: PrivateRoomProps) {
  const t = useT().calendar.live.private;
  const liveT = useT().calendar.live;
  const fullscreenT = useT().common.fullscreen;
  const isCoach = props.me === props.coachId;
  const [snapshot, setSnapshot] = useState(props.initialSnapshot);
  const [now, setNow] = useState(0);
  const [authorized, setAuthorized] = useState(true);
  const [error, setError] = useState<PrivateLiveErrorCode | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const [memberCameraOptIn, setMemberCameraOptIn] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(true);
  const [working, startTransition] = useTransition();
  const router = useRouter();
  const canGo = useCanStartLive(
    props.startsAt,
    props.endsAt,
    canGoLive({ starts_at: props.startsAt, ends_at: props.endsAt }),
  );

  const mounted = useRef(false);
  const snapshotRef = useRef(snapshot);
  const cameraRequest = useRef(0);
  const mediaRef = useRef<MediaStream | null>(null);
  const publisherRef = useRef<Connection | null>(null);
  const playbackRef = useRef<Connection | null>(null);
  const publishAbort = useRef<AbortController | null>(null);
  const playbackAbort = useRef<AbortController | null>(null);
  const videoLocal = useRef<HTMLVideoElement>(null);
  const videoRemote = useRef<HTMLVideoElement>(null);
  const checkedIn = useRef(false);
  const grantIdentity = useRef(grantKey(props.initialSnapshot.grant));
  const snapshotRevision = useRef(0);
  const liveChatProps = {
    sessionId: props.sessionId,
    me: props.me,
    coachId: props.coachId,
    canChat: props.canChat,
    names: props.names,
    initialChat: props.initialChat,
  };

  const stopPublisher = useCallback(() => {
    publishAbort.current?.abort();
    publishAbort.current = null;
    publisherRef.current?.stop();
    publisherRef.current = null;
    if (mounted.current) {
      setPublishing(false);
    }
  }, []);

  const stopPlayback = useCallback(() => {
    playbackAbort.current?.abort();
    playbackAbort.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    if (videoRemote.current) videoRemote.current.srcObject = null;
    if (mounted.current) {
      setRemoteStream(null);
    }
  }, []);

  const stopCamera = useCallback(() => {
    cameraRequest.current += 1;
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    mediaRef.current = null;
    if (videoLocal.current) videoLocal.current.srcObject = null;
    if (mounted.current) {
      setCamera(null);
      setCameraBusy(false);
    }
  }, []);

  const stopAllMedia = useCallback(() => {
    stopPublisher();
    stopPlayback();
    stopCamera();
  }, [stopCamera, stopPlayback, stopPublisher]);

  useEffect(() => {
    mounted.current = true;
    const localVideo = videoLocal.current;
    const remoteVideo = videoRemote.current;
    return () => {
      mounted.current = false;
      cameraRequest.current += 1;
      publishAbort.current?.abort();
      publishAbort.current = null;
      playbackAbort.current?.abort();
      playbackAbort.current = null;
      publisherRef.current?.stop();
      publisherRef.current = null;
      playbackRef.current?.stop();
      playbackRef.current = null;
      mediaRef.current?.getTracks().forEach((track) => track.stop());
      mediaRef.current = null;
      if (localVideo) localVideo.srcObject = null;
      if (remoteVideo) remoteVideo.srcObject = null;
    };
  }, []);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const interval = setInterval(updateNow, 1_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (videoLocal.current) videoLocal.current.srcObject = camera;
  }, [camera]);

  useEffect(() => {
    if (videoRemote.current) videoRemote.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    checkedIn.current = false;
  }, [props.sessionId]);

  const refreshSnapshot = useCallback(async () => {
    const requestRevision = ++snapshotRevision.current;
    try {
      const result = await readPrivateLiveSession(props.sessionId);
      if (
        !mounted.current ||
        !isLiveSnapshotCurrent(requestRevision, snapshotRevision.current)
      )
        return;
      if (!result.ok) {
        stopAllMedia();
        setAuthorized(false);
        setError(result.error);
        return;
      }
      if (result.mode !== "one_on_one") {
        stopAllMedia();
        setSnapshot({ mode: result.mode, grant: result.grant });
        setAuthorized(true);
        setError("wrong_mode");
        return;
      }

      const nextIdentity = grantKey(result.grant);
      if (grantIdentity.current !== nextIdentity) {
        stopAllMedia();
        grantIdentity.current = nextIdentity;
        setMemberCameraOptIn(false);
      }
      if (!activeGrant(result.grant, Date.now())) stopAllMedia();
      if (!isCoach && result.grant && !result.grant.memberCameraAllowed) {
        stopPublisher();
        stopCamera();
      }
      if (
        result.grant &&
        (result.grant.state === "revoking" ||
          result.grant.state === "revoked")
      )
        stopAllMedia();
      setAuthorized(true);
      setError(null);
      setSnapshot({ mode: result.mode, grant: result.grant });
    } catch {
      if (
        !mounted.current ||
        !isLiveSnapshotCurrent(requestRevision, snapshotRevision.current)
      )
        return;
      stopAllMedia();
      setAuthorized(false);
      setError("temporarily_unavailable");
    }
  }, [isCoach, props.sessionId, stopAllMedia, stopCamera, stopPublisher]);

  // Private room state is read only through the participant-authorized server action.
  // Polling also observes reconnects and role/window changes when realtime isn't available.
  useEffect(() => {
    const initialRefresh = setTimeout(() => void refreshSnapshot(), 0);
    const interval = setInterval(() => void refreshSnapshot(), 5_000);
    const onFocus = () => void refreshSnapshot();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshSnapshot();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      snapshotRevision.current += 1;
      clearTimeout(initialRefresh);
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshSnapshot]);

  const grant = snapshot.grant;
  const valid = snapshot.mode === "one_on_one" && activeGrant(grant, now);
  const accepted = Boolean(
    valid && grant && (grant.state === "accepted" || grant.state === "live"),
  );
  const cameraAllowed = Boolean(
    valid && (isCoach || grant?.memberCameraAllowed),
  );
  const remoteLive = Boolean(
    valid && (isCoach ? grant?.memberLive : grant?.coachLive),
  );
  const ownLive = Boolean(valid && (isCoach ? grant?.coachLive : grant?.memberLive));

  useEffect(() => {
    if (!valid) stopAllMedia();
  }, [stopAllMedia, valid]);

  useEffect(() => {
    const currentGrantId = grant?.grantId;
    const currentGeneration = grant?.generation;
    if (
      !authorized ||
      !valid ||
      !currentGrantId ||
      !currentGeneration ||
      !remoteLive
    ) {
      stopPlayback();
      return;
    }
    const remoteVideo = videoRemote.current;
    let active = true;
    let attempt = 0;
    let connecting = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;

    const stopCurrent = () => {
      const currentController = controller;
      currentController?.abort();
      controller = null;
      if (playbackAbort.current === currentController)
        playbackAbort.current = null;
      playbackRef.current?.stop();
      playbackRef.current = null;
    };
    const retry = (delay: number) => {
      if (!active) return;
      attempt += 1;
      connecting = false;
      if (retryTimer) clearTimeout(retryTimer);
      stopCurrent();
      if (remoteVideo) remoteVideo.srcObject = null;
      if (mounted.current) setRemoteStream(null);
      retryTimer = setTimeout(() => void connect(), delay);
    };
    const connect = async () => {
      if (!active || connecting) return;
      connecting = true;
      const thisAttempt = ++attempt;
      const thisController = new AbortController();
      controller = thisController;
      playbackAbort.current = thisController;
      try {
        // Never reuse a private playback URL after a retry; each one is freshly authorized.
        const playback = await privatePlayback(
          props.sessionId,
          currentGrantId,
          currentGeneration,
        );
        if (!active || thisAttempt !== attempt) return;
        if (!playback.ok) {
          if (
            playback.error === "not_ready" ||
            playback.error === "temporarily_unavailable"
          ) {
            connecting = false;
            retry(3_000);
            return;
          }
          connecting = false;
          if (mounted.current) setError(playback.error);
          return;
        }
        if (Date.parse(playback.expiresAt) <= Date.now()) {
          connecting = false;
          retry(3_000);
          return;
        }
        const next = await play(
          playback.playbackUrl,
          (stream) => {
            if (!active || thisAttempt !== attempt || !mounted.current) return;
            if (remoteVideo?.srcObject !== stream) {
              if (remoteVideo) remoteVideo.srcObject = stream;
              setRemoteStream(stream);
            }
          },
          { signal: thisController.signal },
        );
        if (playbackAbort.current === thisController)
          playbackAbort.current = null;
        connecting = false;
        if (!active || thisAttempt !== attempt) {
          next.stop();
          return;
        }
        playbackRef.current = next;
        const onState = () => {
          if (!active || playbackRef.current !== next) return;
          if (
            next.pc.connectionState === "failed" ||
            next.pc.connectionState === "disconnected"
          )
            retry(3_000);
        };
        next.pc.addEventListener("connectionstatechange", onState);
        onState();
      } catch (playError) {
        connecting = false;
        if (!active || thisAttempt !== attempt) return;
        retry(playError instanceof NotLiveYet ? 3_000 : 5_000);
      }
    };

    void connect();
    return () => {
      active = false;
      attempt += 1;
      if (retryTimer) clearTimeout(retryTimer);
      stopCurrent();
      if (remoteVideo) remoteVideo.srcObject = null;
    };
  }, [
    grant?.expiresAt,
    grant?.generation,
    grant?.grantId,
    props.sessionId,
    authorized,
    remoteLive,
    stopPlayback,
    valid,
  ]);

  async function turnCameraOn() {
    if (!cameraAllowed || camera || cameraBusy || !accepted) return;
    const request = ++cameraRequest.current;
    setCameraBusy(true);
    setCameraError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const latest = snapshotRef.current.grant;
      if (
        !mounted.current ||
        request !== cameraRequest.current ||
        !activeGrant(latest, Date.now()) ||
        (!isCoach && !latest?.memberCameraAllowed)
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaRef.current = stream;
      setCamera(stream);
    } catch {
      if (mounted.current && request === cameraRequest.current)
        setCameraError(true);
    } finally {
      if (mounted.current && request === cameraRequest.current)
        setCameraBusy(false);
    }
  }

  function turnCameraOff() {
    stopPublisher();
    stopCamera();
    setCameraError(false);
  }

  function goLive() {
    if (
      !camera ||
      !canGo ||
      working ||
      !valid ||
      !grant ||
      (!isCoach && !grant.coachLive)
    )
      return;
    const currentGrant = grant;
    const controller = new AbortController();
    publishAbort.current = controller;
    setError(null);
    startTransition(async () => {
      let next: Connection | null = null;
      try {
        const prepared = await preparePrivateBroadcast(
          props.sessionId,
          currentGrant.grantId,
        );
        if (!mounted.current || controller.signal.aborted) return;
        if (!prepared.ok) {
          setError(prepared.error);
          return;
        }
        next = await publish(prepared.ingestUrl, camera, {
          signal: controller.signal,
        });
        if (!mounted.current || controller.signal.aborted) {
          next.stop();
          return;
        }
        if (
          next.pc.connectionState === "failed" ||
          next.pc.connectionState === "disconnected"
        ) {
          next.stop();
          next = null;
          setError("temporarily_unavailable");
          return;
        }
        const marked = await markPrivateBroadcastLive(
          props.sessionId,
          currentGrant.grantId,
          prepared.generation,
          prepared.leaseToken,
        );
        if (!mounted.current || controller.signal.aborted) {
          next.stop();
          return;
        }
        if (!marked.ok) {
          next.stop();
          next = null;
          setError(marked.error);
          return;
        }
        publisherRef.current = next;
        setPublishing(true);
        const currentConnection = next;
        const onState = () => {
          if (
            publisherRef.current !== currentConnection ||
            (currentConnection.pc.connectionState !== "failed" &&
              currentConnection.pc.connectionState !== "disconnected")
          )
            return;
          currentConnection.stop();
          publisherRef.current = null;
          if (mounted.current) {
            setPublishing(false);
            setError("temporarily_unavailable");
          }
        };
        currentConnection.pc.addEventListener("connectionstatechange", onState);
        next = null;
      } catch {
        next?.stop();
        if (mounted.current && !controller.signal.aborted)
          setError("temporarily_unavailable");
      } finally {
        if (publishAbort.current === controller) publishAbort.current = null;
      }
    });
  }

  function endSession() {
    if (!grant || !window.confirm(t.confirmEnd) || working) return;
    const currentGrant = grant;
    stopAllMedia();
    setError(null);
    startTransition(async () => {
      try {
        const result = await revokePrivateSession(
          props.sessionId,
          currentGrant.grantId,
        );
        if (!mounted.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (grantIdentity.current === grantKey(currentGrant)) {
          snapshotRevision.current += 1;
          setSnapshot({
            mode: "one_on_one",
            grant: { ...currentGrant, state: result.state },
          });
        }
        void refreshSnapshot();
        router.refresh();
      } catch {
        if (mounted.current) setError("temporarily_unavailable");
      }
    });
  }

  function resetToBroadcast() {
    if (!isCoach || working || (grant && grant.state !== "revoked")) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await resetSessionToBroadcast(props.sessionId);
        if (!mounted.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        if (mounted.current) setError("temporarily_unavailable");
      }
    });
  }

  function accept(allowCamera: boolean) {
    if (!grant || working) return;
    const currentGrant = grant;
    setError(null);
    startTransition(async () => {
      try {
        const result = await acceptPrivateSession(
          props.sessionId,
          currentGrant.grantId,
          allowCamera,
        );
        if (!mounted.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
        void refreshSnapshot();
      } catch {
        if (mounted.current) setError("temporarily_unavailable");
      }
    });
  }

  function decline() {
    if (!grant || working) return;
    const currentGrant = grant;
    startTransition(async () => {
      try {
        const result = await revokePrivateSession(
          props.sessionId,
          currentGrant.grantId,
        );
        if (!mounted.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (grantIdentity.current === grantKey(currentGrant)) {
          snapshotRevision.current += 1;
          setSnapshot({
            mode: "one_on_one",
            grant: { ...currentGrant, state: result.state },
          });
        }
        void refreshSnapshot();
        router.refresh();
      } catch {
        if (mounted.current) setError("temporarily_unavailable");
      }
    });
  }

  const grantExpired = Boolean(grant && Date.parse(grant.expiresAt) <= now);
  const closed =
    !grant ||
    grantExpired ||
    grant.state === "revoking" ||
    grant.state === "revoked";
  const privateLive = Boolean(valid && grant && !closed);

  if (snapshot.mode !== "one_on_one") {
    return (
      <p role="status" className="rounded-lg border border-border p-4 text-sm text-muted">
        {t.errors.wrong_mode}
      </p>
    );
  }
  if (!authorized) {
    return (
      <p role="alert" className="rounded-lg border border-border p-4 text-sm text-danger">
        {t.errors[error ?? "not_allowed"]}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{t.notRecorded}</p>
      {isCoach &&
        props.memberId &&
        (!grant || grant.state === "revoked") && (
          <PrivateOneOnOneOffer
            sessionId={props.sessionId}
            memberId={props.memberId}
            memberName={props.memberName}
          />
        )}
      {isCoach && (!grant || grant.state === "revoked") && (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-muted">{t.modeResetDescription}</p>
          <button
            type="button"
            onClick={resetToBroadcast}
            disabled={working}
            className="btn-secondary"
          >
            {working ? t.resettingMode : t.resetToGroupMode}
          </button>
        </section>
      )}
      {grant?.state === "offered" && !isCoach && (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div>
            <h2 className="font-semibold">{t.acceptTitle}</h2>
            <p className="mt-1 text-sm text-muted">{t.acceptDescription}</p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={memberCameraOptIn}
              onChange={(event) => setMemberCameraOptIn(event.target.checked)}
              className="mt-1"
            />
            <span>{t.allowMemberCamera}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => accept(memberCameraOptIn)}
              disabled={working}
              className="btn-primary"
            >
              {working ? t.accepting : t.accept}
            </button>
            <button
              type="button"
              onClick={decline}
              disabled={working}
              className="btn-secondary"
            >
              {t.decline}
            </button>
          </div>
        </section>
      )}
      {grant?.state === "offered" && isCoach && (
        <p className="rounded-lg border border-border p-4 text-sm text-muted">
          {t.waitingForMember}
        </p>
      )}
      {grant?.state === "accepted" && !isCoach && (
        <p className="rounded-lg border border-border p-4 text-sm text-muted">
          {t.acceptedWaiting}
        </p>
      )}
      {closed && (grant || !isCoach) && (
        <p className="rounded-lg border border-border p-4 text-sm text-muted">
          {grant?.state === "revoking"
            ? t.revoking
            : grantExpired
              ? t.expired
              : grant?.state === "revoked"
                ? t.ended
                : isCoach
                  ? t.offered
                  : t.waitingForCoach}
        </p>
      )}
      {accepted && (
        <LiveFullscreenRegion
          label={fullscreenT.liveRoom}
          className="relative"
          controlPlacement="inline"
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <LiveFullscreenRegion
                    label={fullscreenT.yourVideo}
                    className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black"
                  >
                  <video
                    ref={videoLocal}
                    autoPlay
                    muted
                    playsInline
                    className="size-full object-cover -scale-x-100"
                  />
                  {!camera && (
                    <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white/80">
                      {t.cameraDisabled}
                    </p>
                  )}
                  </LiveFullscreenRegion>
                  <p className="text-sm text-muted">{liveT.you}</p>
                  <div className="flex flex-wrap gap-2">
                    {!camera ? (
                      <button
                        type="button"
                        onClick={turnCameraOn}
                        disabled={!cameraAllowed || cameraBusy || working}
                        className="btn-secondary"
                      >
                        {cameraBusy ? t.cameraStarting : t.enableCamera}
                      </button>
                    ) : publishing ? (
                      <span role="status" className="text-sm text-muted">
                        {t.broadcasting}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={goLive}
                        disabled={
                          !canGo ||
                          working ||
                          !privateLive ||
                          (!isCoach && !grant?.coachLive)
                        }
                        className="btn-primary"
                      >
                        {ownLive ? t.reconnect : t.goLive}
                      </button>
                    )}
                    {camera && (
                      <button
                        type="button"
                        onClick={turnCameraOff}
                        className="btn-secondary"
                      >
                        {t.turnCameraOff}
                      </button>
                    )}
                  </div>
                  {!isCoach && (
                    <p className="text-xs text-muted">
                      {cameraAllowed ? t.cameraPermission : t.cameraNotAllowed}
                    </p>
                  )}
                  {!isCoach && cameraAllowed && !grant?.coachLive && (
                    <p className="text-xs text-muted">{t.waitForCoachVideo}</p>
                  )}
                  {cameraError && (
                    <p role="alert" className="text-sm text-danger">
                      {t.cameraError}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <LiveFullscreenRegion
                    label={props.otherName}
                    className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black"
                  >
                  <video
                    ref={videoRemote}
                    autoPlay
                    playsInline
                    muted={muted}
                    className="size-full object-contain"
                    onPlaying={() => {
                      if (
                        !videoRemote.current?.srcObject ||
                        isCoach ||
                        checkedIn.current
                      )
                        return;
                      checkedIn.current = true;
                      void checkIn(props.sessionId).catch(() => {});
                    }}
                  />
                  {!remoteStream && (
                    <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white/80">
                      {remoteLive
                        ? liveT.connecting
                        : isCoach
                          ? ownLive
                            ? t.waitingForMemberVideo
                            : t.startVideoFirst
                          : t.waitingForCoach}
                    </p>
                  )}
                  </LiveFullscreenRegion>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-muted">{props.otherName}</p>
                    {remoteStream && (
                      <button
                        type="button"
                        onClick={() => setMuted((value) => !value)}
                        className="btn-secondary px-3 py-2 text-sm"
                      >
                        {muted ? liveT.soundOn : liveT.mute}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={endSession}
                  disabled={working || !grant}
                  className="btn-secondary"
                >
                  {working ? t.ending : t.end}
                </button>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {t.errors[error]}
                  </p>
                )}
                {!isCoach && !grant?.memberCameraAllowed && (
                  <span className="text-xs text-muted">{t.cameraNotAllowed}</span>
                )}
              </div>
            </div>
            <LiveChat
              {...liveChatProps}
              live={Boolean(grant?.coachLive)}
              privateSession
            />
          </div>
        </LiveFullscreenRegion>
      )}
      {!accepted && error && (
        <p role="alert" className="text-sm text-danger">
          {t.errors[error]}
        </p>
      )}
      {accepted && !canGo && (
        <p className="text-xs text-muted">{t.window}</p>
      )}
    </div>
  );
}
