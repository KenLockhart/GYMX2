"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  checkIn,
  deleteLiveChat,
  endLive,
  markLive,
  postLiveChat,
  prepareBroadcast,
  type LiveChatMessage,
} from "@/app/(app)/calendar/[id]/live/actions";
import { useLocale, useT } from "@/i18n/client";
import { translateServerText } from "@/i18n/server-text";
import {
  canGoLive,
  isLiveRoomActive,
  isLiveSnapshotCurrent,
  LIVE_CHAT_HISTORY,
  LIVE_CHAT_MAX,
  mergeLiveMessages,
  nextLiveWindowBoundary,
  type LiveRoom as Room,
} from "@/lib/live";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { NotLiveYet, play, publish, type Connection } from "@/lib/webrtc";

type Props = {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  me: string;
  coachId: string;
  mode: "coach" | "viewer";
  canChat: boolean;
  canStart: boolean;
  playbackUrl: string | null;
  initialRoom: Room;
  names: Record<string, string>;
  initialChat: LiveChatMessage[];
};

export type LiveChatProps = Pick<
  Props,
  "sessionId" | "me" | "coachId" | "canChat" | "names" | "initialChat"
> & { live: boolean; privateSession?: boolean };

const isLive = (room: Room) =>
  Boolean(room?.live_started_at && !room.live_ended_at);

export function LiveRoom(props: Props) {
  const [room, setRoom] = useState<Room>(props.initialRoom);
  const [playbackUrl, setPlaybackUrl] = useState(props.playbackUrl);
  const roomRevision = useRef(0);
  const canStart = useCanStartLive(
    props.startsAt,
    props.endsAt,
    props.canStart,
  );

  // Coach going live or ending shows up for everyone straight away.
  useEffect(() => {
    const supabase = createBrowserSupabase();
    let active = true;
    let fallback: ReturnType<typeof setInterval> | undefined;
    const refreshRoom = async () => {
      const requestedRevision = roomRevision.current;
      const { data, error } = await supabase
        .from("session_live")
        .select("playback_url, live_started_at, live_ended_at")
        .eq("session_id", props.sessionId)
        .maybeSingle();
      if (
        !active ||
        error ||
        !isLiveSnapshotCurrent(requestedRevision, roomRevision.current)
      )
        return;
      roomRevision.current += 1;
      setRoom(
        data
          ? {
              live_started_at: data.live_started_at,
              live_ended_at: data.live_ended_at,
            }
          : null,
      );
      setPlaybackUrl(data?.playback_url ?? null);
    };
    const syncOnFocus = () => void refreshRoom();
    // Keep an authorized snapshot refresh in addition to realtime so a missed or
    // unfilterable DELETE event cannot leave a stale live state in the room.
    const reconcile = setInterval(syncOnFocus, 30_000);
    const startFallback = () => {
      if (!fallback) fallback = setInterval(syncOnFocus, 15_000);
    };
    const stopFallback = () => {
      if (fallback) clearInterval(fallback);
      fallback = undefined;
    };

    const channel = supabase
      .channel(`live-${props.sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_live",
          filter: `session_id=eq.${props.sessionId}`,
        },
        (payload) => {
          if (!active) return;
          if (payload.eventType === "DELETE") {
            roomRevision.current += 1;
            void refreshRoom();
            return;
          }
          const next = payload.new as {
            live_started_at: string | null;
            live_ended_at: string | null;
            playback_url?: string;
          };
          if (!next || !("live_started_at" in next)) return;
          roomRevision.current += 1;
          setRoom({
            live_started_at: next.live_started_at,
            live_ended_at: next.live_ended_at,
          });
          setPlaybackUrl(next.playback_url ?? null);
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          stopFallback();
          void refreshRoom();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          startFallback();
        }
      });
    window.addEventListener("focus", syncOnFocus);
    startFallback();
    return () => {
      active = false;
      clearInterval(reconcile);
      stopFallback();
      window.removeEventListener("focus", syncOnFocus);
      void supabase.removeChannel(channel);
    };
  }, [props.sessionId]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      {props.mode === "coach" ? (
        <Broadcaster
          sessionId={props.sessionId}
          live={isLive(room)}
          room={room}
          canStart={canStart}
          onRoom={setRoom}
        />
      ) : (
        <Viewer
          sessionId={props.sessionId}
          live={isLive(room)}
          ended={Boolean(room?.live_ended_at)}
          playbackUrl={playbackUrl}
        />
      )}
      <LiveChat
        sessionId={props.sessionId}
        me={props.me}
        coachId={props.coachId}
        canChat={props.canChat}
        names={props.names}
        initialChat={props.initialChat}
        live={isLive(room)}
      />
    </div>
  );
}

export function useCanStartLive(startsAt: string, endsAt: string, initial: boolean) {
  const [canStart, setCanStart] = useState(initial);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const session = { starts_at: startsAt, ends_at: endsAt };
    const sync = () => setCanStart(canGoLive(session));
    const schedule = () => {
      if (timer) clearTimeout(timer);
      const boundary = nextLiveWindowBoundary(session);
      if (boundary === null) return;
      const MAX_TIMEOUT = 2_147_000_000;
      timer = setTimeout(() => {
        sync();
        schedule();
      }, Math.min(Math.max(0, boundary - Date.now()), MAX_TIMEOUT));
    };
    const refresh = () => {
      sync();
      schedule();
    };

    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [startsAt, endsAt]);

  return canStart;
}

function Stage({
  children,
  status,
}: {
  children: React.ReactNode;
  status?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black">
        {children}
      </div>
      {status}
    </div>
  );
}

function LiveBadge() {
  const t = useT().calendar.live;
  return (
    <span className="absolute left-3 top-3 rounded bg-danger px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
      {t.live}
    </span>
  );
}

function Broadcaster({
  sessionId,
  live,
  room,
  canStart,
  onRoom,
}: {
  sessionId: string;
  live: boolean;
  room: Room;
  canStart: boolean;
  onRoom: (room: Room) => void;
}) {
  const t = useT().calendar.live;
  const locale = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const mounted = useRef(false);
  const cameraRequest = useRef(0);
  const mediaRef = useRef<MediaStream | null>(null);
  const activeConnection = useRef<Connection | null>(null);
  const broadcastAbort = useRef<AbortController | null>(null);
  const [media, setMedia] = useState<MediaStream | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [busy, startBusy] = useTransition();

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = media;
  }, [media]);

  useEffect(() => {
    mounted.current = true;
    const previewVideo = videoRef.current;
    return () => {
      mounted.current = false;
      cameraRequest.current += 1;
      broadcastAbort.current?.abort();
      activeConnection.current?.stop();
      activeConnection.current = null;
      mediaRef.current?.getTracks().forEach((track) => track.stop());
      mediaRef.current = null;
      if (previewVideo) previewVideo.srcObject = null;
    };
  }, []);

  async function camera() {
    if (cameraBusy) return;
    const request = ++cameraRequest.current;
    setCameraBusy(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!mounted.current || request !== cameraRequest.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaRef.current = stream;
      setMedia(stream);
    } catch {
      if (mounted.current && request === cameraRequest.current)
        setError(t.cameraError);
    } finally {
      if (mounted.current && request === cameraRequest.current)
        setCameraBusy(false);
    }
  }

  function goLive() {
    if (!media || !canStart || busy) return;
    setError(null);
    const controller = new AbortController();
    broadcastAbort.current = controller;
    startBusy(async () => {
      let next: Connection | null = null;
      try {
        const prepared = await prepareBroadcast(sessionId);
        if (!mounted.current || controller.signal.aborted) return;
        if (!prepared.ingestUrl) {
          setError(translateServerText(prepared.error ?? t.couldntGoLive, locale));
          return;
        }
        next = await publish(prepared.ingestUrl, media, {
          signal: controller.signal,
        });
        if (!mounted.current || controller.signal.aborted) {
          next.stop();
          return;
        }
        if (next.pc.connectionState === "failed") {
          next.stop();
          setError(t.dropped);
          return;
        }
        const marked = await markLive(sessionId);
        if (!mounted.current || controller.signal.aborted) {
          next.stop();
          if (!marked.error) void endLive(sessionId).catch(() => {});
          return;
        }
        if (marked.error) {
          next.stop();
          next = null;
          setError(translateServerText(marked.error, locale));
          return;
        }

        activeConnection.current = next;
        const liveConnection = next;
        const onConnectionState = () => {
          if (
            activeConnection.current === liveConnection &&
            liveConnection.pc.connectionState === "failed"
          ) {
            liveConnection.stop();
            activeConnection.current = null;
            if (mounted.current) {
              setConnection(null);
              setError(t.dropped);
            }
          }
        };
        liveConnection.pc.addEventListener(
          "connectionstatechange",
          onConnectionState,
        );
        setConnection(liveConnection);
        onRoom({
          live_started_at: room?.live_started_at ?? new Date().toISOString(),
          live_ended_at: null,
        });
        onConnectionState();
        next = null;
      } catch {
        next?.stop();
        if (mounted.current && !controller.signal.aborted)
          setError(t.serviceError);
      } finally {
        if (broadcastAbort.current === controller) broadcastAbort.current = null;
      }
    });
  }

  function end() {
    if (!window.confirm(t.confirmEnd)) return;
    startBusy(async () => {
      activeConnection.current?.stop();
      activeConnection.current = null;
      setConnection(null);
      try {
        const result = await endLive(sessionId);
        if (!mounted.current) return;
        if (result.error) {
          setError(translateServerText(result.error, locale));
          return;
        }
        const endedAt = new Date().toISOString();
        onRoom({
          live_started_at: room?.live_started_at ?? endedAt,
          live_ended_at: endedAt,
        });
      } catch {
        if (mounted.current) setError(t.endError);
      }
    });
  }

  const broadcasting = live && connection !== null;
  const serverRoomLive = isLiveRoomActive(room);

  return (
    <Stage
      status={
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            {serverRoomLive ? (
              <button
                type="button"
                onClick={end}
                disabled={busy}
                className="btn-secondary"
              >
                {busy ? t.ending : t.end}
              </button>
            ) : !media ? (
              <button
                type="button"
                onClick={camera}
                disabled={cameraBusy}
                className="btn-secondary"
              >
                {cameraBusy ? t.connecting : t.turnOnCamera}
              </button>
            ) : broadcasting ? (
              <button
                type="button"
                onClick={end}
                disabled={busy}
                className="btn-secondary"
              >
                {busy ? t.ending : t.end}
              </button>
            ) : (
              <button
                type="button"
                onClick={goLive}
                disabled={busy || !canStart}
                className="btn-primary"
              >
                {busy ? t.connecting : live ? t.reconnect : t.goLive}
              </button>
            )}
            <span className="text-sm text-muted">
              {serverRoomLive && !broadcasting
                ? t.endRetryMessage
                : broadcasting
                  ? t.broadcasting
                : !canStart
                  ? t.window
                  : media
                    ? t.framing
                    : t.membersSee}
            </span>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {translateServerText(error, locale)}
            </p>
          )}
        </div>
      }
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="size-full object-cover -scale-x-100"
      />
      {!media && (
        <p className="absolute inset-0 grid place-items-center text-sm text-white/70">
          {t.cameraOff}
        </p>
      )}
      {broadcasting && <LiveBadge />}
    </Stage>
  );
}

function Viewer({
  sessionId,
  live,
  ended,
  playbackUrl,
}: {
  sessionId: string;
  live: boolean;
  ended: boolean;
  playbackUrl: string | null;
}) {
  const t = useT().calendar.live;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const checkedIn = useRef(false);
  const isPlaying = live && Boolean(playbackUrl) && playing;

  useEffect(() => {
    checkedIn.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!live || !playbackUrl) {
      if (videoRef.current) videoRef.current.srcObject = null;
      return;
    }

    const playbackVideo = videoRef.current;
    let current: Connection | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let attempt = 0;
    let connecting = false;
    let disposed = false;

    const clearPlayback = () => {
      if (videoRef.current) videoRef.current.srcObject = null;
      setPlaying(false);
    };

    const stopCurrent = () => {
      controller?.abort();
      controller = null;
      current?.stop();
      current = null;
    };

    const retry = (delay: number) => {
      if (disposed) return;
      attempt += 1;
      connecting = false;
      if (retryTimer) clearTimeout(retryTimer);
      stopCurrent();
      clearPlayback();
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      if (disposed || connecting) return;
      connecting = true;
      const thisAttempt = ++attempt;
      const thisController = new AbortController();
      controller = thisController;
      try {
        const next = await play(playbackUrl, (stream) => {
          if (disposed || thisAttempt !== attempt) return;
          if (videoRef.current && videoRef.current.srcObject !== stream)
            videoRef.current.srcObject = stream;
          if (videoRef.current) void videoRef.current.play().catch(() => {});
        }, { signal: thisController.signal });
        connecting = false;
        if (disposed || thisAttempt !== attempt) {
          next.stop();
          return;
        }
        current = next;
        const handleState = () => {
          if (current !== next || disposed) return;
          if (
            next.pc.connectionState === "failed" ||
            next.pc.connectionState === "disconnected"
          )
            retry(3000);
        };
        next.pc.addEventListener("connectionstatechange", handleState);
        handleState();
      } catch (error) {
        connecting = false;
        if (disposed || thisAttempt !== attempt) return;
        retry(error instanceof NotLiveYet ? 3000 : 5000);
      }
    };

    void connect();
    return () => {
      disposed = true;
      attempt += 1;
      if (retryTimer) clearTimeout(retryTimer);
      stopCurrent();
      if (playbackVideo) playbackVideo.srcObject = null;
    };
  }, [live, playbackUrl, sessionId]);

  function onPlaying() {
    if (!videoRef.current?.srcObject) return;
    setPlaying(true);
    if (!checkedIn.current) {
      checkedIn.current = true;
      void checkIn(sessionId).catch(() => {});
    }
  }

  return (
    <Stage
      status={
        live && (
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            className="btn-secondary px-3 py-2 text-sm"
          >
            {muted ? t.soundOn : t.mute}
          </button>
        )
      }
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        onPlaying={onPlaying}
        className="size-full object-contain"
      />
      {isPlaying && <LiveBadge />}
      {!isPlaying && (
        <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white/80">
          {live ? t.connectingVideo : ended ? t.ended : t.waiting}
        </p>
      )}
    </Stage>
  );
}

export function LiveChat({
  sessionId,
  me,
  coachId,
  canChat,
  names,
  initialChat,
  live,
  privateSession = false,
}: LiveChatProps) {
  const t = useT().calendar.live;
  const locale = useLocale();
  const [messages, setMessages] = useState(initialChat);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  const mounted = useRef(false);
  const currentSession = useRef(sessionId);

  const add = useCallback((message: LiveChatMessage, forSession: string) => {
    if (!mounted.current || currentSession.current !== forSession) return;
    revision.current += 1;
    setMessages((current) => mergeLiveMessages(current, [message]));
  }, []);

  useEffect(() => {
    mounted.current = true;
    currentSession.current = sessionId;
    const supabase = createBrowserSupabase();
    let active = true;
    const refreshMessages = async () => {
      const requestedRevision = revision.current;
      const { data, error: loadError } = await supabase
        .from("live_chat_messages")
        .select("id, session_id, sender_id, body, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(LIVE_CHAT_HISTORY);
      if (
        !active ||
        loadError ||
        !data ||
        !isLiveSnapshotCurrent(requestedRevision, revision.current)
      )
        return;
      revision.current += 1;
      setMessages(mergeLiveMessages([], (data as LiveChatMessage[]).reverse()));
    };
    let fallback: ReturnType<typeof setInterval> | null = setInterval(
      () => void refreshMessages(),
      15_000,
    );
    const startFallback = () => {
      if (!fallback)
        fallback = setInterval(() => void refreshMessages(), 15_000);
    };
    const stopFallback = () => {
      if (fallback) clearInterval(fallback);
      fallback = null;
    };

    const channel = supabase
      .channel(`live-chat-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_chat_messages",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (!active) return;
          const message = payload.new as LiveChatMessage;
          if (message?.id) add(message, sessionId);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "live_chat_messages" },
        () => {
          if (!active) return;
          // DELETE payloads can contain only the primary key. Refresh through RLS and scope the
          // read to this room rather than treating an unscoped event as one of its messages.
          revision.current += 1;
          void refreshMessages();
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          stopFallback();
          void refreshMessages();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          startFallback();
        }
      });
    const onFocus = () => void refreshMessages();
    window.addEventListener("focus", onFocus);
    void refreshMessages();
    return () => {
      active = false;
      mounted.current = false;
      if (fallback) clearInterval(fallback);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [sessionId, add]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  function send() {
    const body = draft.trim();
    if (!body || pending) return;
    const sendToSession = sessionId;
    setError(null);
    startTransition(async () => {
      try {
        const result = await postLiveChat(sendToSession, body);
        if (!mounted.current || currentSession.current !== sendToSession) return;
        if (result.error) {
          setError(translateServerText(result.error, locale));
          return;
        }
        setDraft("");
        if (result.message) add(result.message, sendToSession);
      } catch {
        if (mounted.current && currentSession.current === sendToSession)
          setError(t.chatActionError);
      }
    });
  }

  function remove(id: string) {
    const removeFromSession = sessionId;
    startTransition(async () => {
      try {
        const result = await deleteLiveChat(id);
        if (!mounted.current || currentSession.current !== removeFromSession) return;
        if (result.error) {
          setError(translateServerText(result.error, locale));
          return;
        }
        revision.current += 1;
        setMessages((current) => current.filter((message) => message.id !== id));
      } catch {
        if (mounted.current && currentSession.current === removeFromSession)
          setError(t.chatActionError);
      }
    });
  }

  return (
    <div className="flex max-h-[32rem] flex-col rounded-lg border border-border bg-surface lg:max-h-none">
      <p className="border-b border-border px-4 py-3 font-semibold">{t.chat}</p>
      <div
        ref={listRef}
        className="flex min-h-48 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-muted">
            {privateSession
              ? live
                ? t.private.sayHi
                : t.private.chatOpens
              : live
                ? t.sayHi
                : t.chatOpens}
          </p>
        ) : (
          messages.map((message) => (
            <p key={message.id} className="group break-words">
              <span className="font-semibold">
                {message.sender_id === me
                  ? t.you
                  : (names[message.sender_id] ?? t.aMember)}
                {message.sender_id === coachId && t.coachTag}:
              </span>{" "}
              {message.body}
              {(message.sender_id === me || me === coachId) && (
                <button
                  type="button"
                  onClick={() => remove(message.id)}
                  className="ml-2 cursor-pointer text-xs text-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                >
                  {t.remove}
                </button>
              )}
            </p>
          ))
        )}
      </div>
      {canChat && (
        <form
          className="space-y-1 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label htmlFor="live-chat" className="sr-only">
            {t.chatMessage}
          </label>
          <div className="flex gap-2">
            <input
              id="live-chat"
              value={draft}
              maxLength={LIVE_CHAT_MAX}
              disabled={!live}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                live
                  ? t.sendPlaceholder
                  : privateSession
                    ? t.private.chatOpensShort
                    : t.chatOpensShort
              }
              className="field-input min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={!live || pending || !draft.trim()}
              className="btn-primary px-3"
            >
              {t.send}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {translateServerText(error, locale)}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
