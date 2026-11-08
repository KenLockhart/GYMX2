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
import { LIVE_CHAT_MAX, type LiveRoom as Room } from "@/lib/live";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { NotLiveYet, play, publish, type Connection } from "@/lib/webrtc";

type Props = {
  sessionId: string;
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

const isLive = (room: Room) =>
  Boolean(room?.live_started_at && !room.live_ended_at);

export function LiveRoom(props: Props) {
  const [room, setRoom] = useState<Room>(props.initialRoom);
  const [playbackUrl, setPlaybackUrl] = useState(props.playbackUrl);

  // Coach going live or ending shows up for everyone straight away.
  useEffect(() => {
    const supabase = createBrowserSupabase();
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
          const next = payload.new as {
            live_started_at: string | null;
            live_ended_at: string | null;
            playback_url?: string;
          };
          if (!next || !("live_started_at" in next)) return;
          setRoom({
            live_started_at: next.live_started_at,
            live_ended_at: next.live_ended_at,
          });
          if (next.playback_url) setPlaybackUrl(next.playback_url);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [props.sessionId]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      {props.mode === "coach" ? (
        <Broadcaster
          sessionId={props.sessionId}
          live={isLive(room)}
          canStart={props.canStart}
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
      <LiveChat {...props} live={isLive(room)} />
    </div>
  );
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
  return (
    <span className="absolute left-3 top-3 rounded bg-danger px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
      Live
    </span>
  );
}

function Broadcaster({
  sessionId,
  live,
  canStart,
  onRoom,
}: {
  sessionId: string;
  live: boolean;
  canStart: boolean;
  onRoom: (room: Room) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [media, setMedia] = useState<MediaStream | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = media;
  }, [media]);

  useEffect(
    () => () => {
      connection?.stop();
    },
    [connection],
  );
  useEffect(
    () => () => {
      media?.getTracks().forEach((track) => track.stop());
    },
    [media],
  );

  async function camera() {
    setError(null);
    try {
      setMedia(
        await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
          },
          audio: { echoCancellation: true, noiseSuppression: true },
        }),
      );
    } catch {
      setError(
        "We couldn't use your camera and microphone. Allow access in your browser and try again.",
      );
    }
  }

  function goLive() {
    if (!media) return;
    setError(null);
    startBusy(async () => {
      const prepared = await prepareBroadcast(sessionId);
      if (!prepared.ingestUrl)
        return setError(prepared.error ?? "We couldn't go live.");
      try {
        const next = await publish(prepared.ingestUrl, media);
        next.pc.addEventListener("connectionstatechange", () => {
          if (next.pc.connectionState === "failed")
            setError("Your connection dropped. Press Go live to reconnect.");
        });
        setConnection(next);
        const marked = await markLive(sessionId);
        if (marked.error) return setError(marked.error);
        onRoom({
          live_started_at: new Date().toISOString(),
          live_ended_at: null,
        });
      } catch {
        setError(
          "We couldn't connect to the live video service. Check your internet and try again.",
        );
      }
    });
  }

  function end() {
    if (!window.confirm("End the live session for everyone?")) return;
    startBusy(async () => {
      connection?.stop();
      setConnection(null);
      await endLive(sessionId);
      onRoom({
        live_started_at: new Date().toISOString(),
        live_ended_at: new Date().toISOString(),
      });
    });
  }

  const broadcasting = live && connection !== null;

  return (
    <Stage
      status={
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            {!media ? (
              <button
                type="button"
                onClick={camera}
                disabled={!canStart}
                className="btn-secondary"
              >
                Turn on camera
              </button>
            ) : broadcasting ? (
              <button
                type="button"
                onClick={end}
                disabled={busy}
                className="btn-secondary"
              >
                {busy ? "Ending..." : "End live session"}
              </button>
            ) : (
              <button
                type="button"
                onClick={goLive}
                disabled={busy || !canStart}
                className="btn-primary"
              >
                {busy ? "Connecting..." : live ? "Reconnect" : "Go live"}
              </button>
            )}
            <span className="text-sm text-muted">
              {broadcasting
                ? "You're live. Invited members are watching here."
                : !canStart
                  ? "You can go live from 30 minutes before the start until an hour after the end."
                  : media
                    ? "Check your framing, then go live. Members get an email when you start."
                    : "Members see and hear you; they don't go on camera."}
            </span>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
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
          Camera is off
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const checkedIn = useRef(false);

  useEffect(() => {
    if (!live || !playbackUrl) return;
    let current: Connection | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const connect = async () => {
      try {
        current = await play(playbackUrl, (stream) => {
          if (videoRef.current && videoRef.current.srcObject !== stream)
            videoRef.current.srcObject = stream;
          setPlaying(true);
          if (!checkedIn.current) {
            checkedIn.current = true;
            void checkIn(sessionId);
          }
        });
        current.pc.addEventListener("connectionstatechange", () => {
          const state = current?.pc.connectionState;
          if (!cancelled && (state === "failed" || state === "disconnected"))
            retry();
        });
      } catch (error) {
        if (!cancelled) retry(error instanceof NotLiveYet ? 3000 : 5000);
      }
    };
    const retry = (delay = 3000) => {
      current?.stop();
      current = null;
      setPlaying(false);
      clearTimeout(timer);
      timer = setTimeout(() => void connect(), delay);
    };
    void connect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      current?.stop();
      setPlaying(false);
    };
  }, [live, playbackUrl, sessionId]);

  return (
    <Stage
      status={
        live && (
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            className="btn-secondary px-3 py-2 text-sm"
          >
            {muted ? "Turn sound on" : "Mute"}
          </button>
        )
      }
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="size-full object-contain"
      />
      {live && playing && <LiveBadge />}
      {!(live && playing) && (
        <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white/80">
          {live
            ? "Connecting to the live video..."
            : ended
              ? "This live session has ended."
              : "Waiting for your coach to go live. This page updates on its own."}
        </p>
      )}
    </Stage>
  );
}

function LiveChat({
  sessionId,
  me,
  coachId,
  canChat,
  names,
  initialChat,
  live,
}: Props & { live: boolean }) {
  const [messages, setMessages] = useState(initialChat);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);

  const add = useCallback((message: LiveChatMessage) => {
    setMessages((current) =>
      current.some((existing) => existing.id === message.id)
        ? current
        : [...current, message],
    );
  }, []);

  useEffect(() => {
    const supabase = createBrowserSupabase();
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
          const message = payload.new as LiveChatMessage;
          if (message?.id) add(message);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "live_chat_messages" },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (id)
            setMessages((current) =>
              current.filter((message) => message.id !== id),
            );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId, add]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  function send() {
    const body = draft.trim();
    if (!body || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await postLiveChat(sessionId, body);
      if (result.error) return setError(result.error);
      setDraft("");
      if (result.message) add(result.message);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteLiveChat(id);
      if (result.error) return setError(result.error);
      setMessages((current) => current.filter((message) => message.id !== id));
    });
  }

  return (
    <div className="flex max-h-[32rem] flex-col rounded-lg border border-border bg-surface lg:max-h-none">
      <p className="border-b border-border px-4 py-3 font-semibold">
        Live chat
      </p>
      <div
        ref={listRef}
        className="flex min-h-48 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-muted">
            {live
              ? "Say hi to the group."
              : "Chat opens when the session goes live."}
          </p>
        ) : (
          messages.map((message) => (
            <p key={message.id} className="group break-words">
              <span className="font-semibold">
                {message.sender_id === me
                  ? "You"
                  : (names[message.sender_id] ?? "A member")}
                {message.sender_id === coachId && " (coach)"}:
              </span>{" "}
              {message.body}
              {(message.sender_id === me || me === coachId) && (
                <button
                  type="button"
                  onClick={() => remove(message.id)}
                  className="ml-2 cursor-pointer text-xs text-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                >
                  Remove
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
            Chat message
          </label>
          <div className="flex gap-2">
            <input
              id="live-chat"
              value={draft}
              maxLength={LIVE_CHAT_MAX}
              disabled={!live}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={live ? "Send a message" : "Chat opens when live"}
              className="field-input min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={!live || pending || !draft.trim()}
              className="btn-primary px-3"
            >
              Send
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
