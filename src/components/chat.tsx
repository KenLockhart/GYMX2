"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { markConversationRead, sendMessage } from "@/app/(app)/messages/actions";
import { createBrowserSupabase } from "@/lib/supabase/client";
import type { Message } from "@/lib/types";

const subscribe = () => () => {};

function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

function formatTime(iso: string, isClient: boolean) {
  const timeZone = isClient ? undefined : "UTC";
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString("en-US", {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

export function Chat({
  me,
  other,
  pair,
  initialMessages,
  canSend,
}: {
  me: string;
  other: { id: string; display_name: string };
  pair: { coach_id: string; member_id: string };
  initialMessages: Message[];
  canSend: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const isClient = useIsClient();

  function addMessage(message: Message) {
    setMessages((current) =>
      current.some((existing) => existing.id === message.id) ? current : [...current, message],
    );
  }

  // New messages arrive live. Row security means only this conversation's messages are delivered.
  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`messages-${pair.coach_id}-${pair.member_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `coach_id=eq.${pair.coach_id}`,
        },
        (payload) => {
          const message = payload.new as Message;
          if (!message?.id || message.member_id !== pair.member_id) return;
          if (payload.eventType === "UPDATE") {
            // The other person read our messages, so "Seen" can appear.
            setMessages((current) => current.map((existing) => (existing.id === message.id ? message : existing)));
            return;
          }
          if (payload.eventType !== "INSERT") return;
          addMessage(message);
          if (message.sender_id !== me) void markConversationRead(other.id);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [pair.coach_id, pair.member_id, me, other.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setError(null);
    startSending(async () => {
      const result = await sendMessage(other.id, body);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDraft("");
      if (result.message) addMessage(result.message);
    });
  }

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <div className="flex max-h-[60vh] min-h-64 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-muted">No messages yet. Say hello to {other.display_name}.</p>
        ) : (
          messages.map((message) => {
            const mine = message.sender_id === me;
            return (
              <div key={message.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <p
                  className={`max-w-[85%] whitespace-pre-line break-words rounded-2xl px-4 py-2 sm:max-w-[70%] ${
                    mine ? "bg-accent text-accent-foreground" : "bg-surface-raised"
                  }`}
                >
                  {message.body}
                </p>
                <span className="mt-1 text-xs text-muted">
                  {formatTime(message.created_at, isClient)}
                  {mine && message.read_at && " · Seen"}
                </span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {canSend ? (
        <form
          className="space-y-2 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label className="sr-only" htmlFor="message-body">
            Message {other.display_name}
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="message-body"
              rows={2}
              maxLength={4000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter adds a new line.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={`Message ${other.display_name}`}
              className="field-input flex-1 resize-none"
            />
            <button type="submit" disabled={sending || !draft.trim()} className="btn-primary">
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <p className="text-xs text-muted">GYMX2 admins may review conversations to keep everyone safe.</p>
        </form>
      ) : (
        <p className="border-t border-border p-4 text-sm text-muted">
          You&apos;re no longer connected with {other.display_name}, so you can read past messages but
          not send new ones.
        </p>
      )}
    </div>
  );
}
