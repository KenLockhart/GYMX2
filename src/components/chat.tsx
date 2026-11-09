"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  markConversationRead,
  messagePhotos,
  prepareMessagePhotos,
  sendMessage,
} from "@/app/(app)/messages/actions";
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from "@/lib/community";
import { createBrowserSupabase } from "@/lib/supabase/client";
import type { Message } from "@/lib/types";

const subscribe = () => () => {};
const MAX_PHOTOS = 4;
const extensionOf = (name: string) =>
  name.split(".").pop()?.toLowerCase() ?? "";

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
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const isClient = useIsClient();

  function addMessage(message: Message) {
    setMessages((current) =>
      current.some((existing) => existing.id === message.id)
        ? current
        : [...current, message],
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
            setMessages((current) =>
              current.map((existing) =>
                existing.id === message.id ? message : existing,
              ),
            );
            return;
          }
          if (payload.eventType !== "INSERT") return;
          addMessage(message);
          if (message.sender_id !== me) {
            void markConversationRead(other.id);
            // Photos are saved with the message, so they're there by the time it arrives.
            void messagePhotos([message.id]).then((found) => {
              const urls = found[message.id];
              if (urls)
                setMessages((current) =>
                  current.map((existing) =>
                    existing.id === message.id
                      ? { ...existing, photos: urls }
                      : existing,
                  ),
                );
            });
          }
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

  function pickPhotos(list: FileList | null) {
    setError(null);
    const files = [...(list ?? [])];
    if (photos.length + files.length > MAX_PHOTOS)
      return setError(`Up to ${MAX_PHOTOS} photos per message.`);
    for (const file of files) {
      if (!(extensionOf(file.name) in PHOTO_TYPES))
        return setError("Use JPG, PNG or WebP photos.");
      if (file.size > MAX_PHOTO_BYTES)
        return setError("Each photo can be up to 10 MB.");
    }
    setPhotos([
      ...photos,
      ...files.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  }

  function send() {
    const body = draft.trim();
    if ((!body && photos.length === 0) || sending) return;
    setError(null);
    startSending(async () => {
      let paths: string[] = [];
      if (photos.length) {
        const prepared = await prepareMessagePhotos(
          photos.map(({ file }) => ({ name: file.name, size: file.size })),
        );
        if (!prepared.uploads)
          return setError(prepared.error ?? "We couldn't start the upload.");
        const storage = createBrowserSupabase().storage.from("community-media");
        for (const [index, { file }] of photos.entries()) {
          const target = prepared.uploads[index];
          const { error: uploadError } = await storage.uploadToSignedUrl(
            target.path,
            target.token,
            file,
            {
              contentType: PHOTO_TYPES[extensionOf(file.name)],
            },
          );
          if (uploadError)
            return setError(
              "A photo didn't upload. Check your connection and try again.",
            );
        }
        paths = prepared.uploads.map((upload) => upload.path);
      }
      const result = await sendMessage(other.id, body, paths);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDraft("");
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setPhotos([]);
      if (result.message) addMessage(result.message);
    });
  }

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <div
        className="flex max-h-[60vh] min-h-64 flex-col gap-3 overflow-y-auto p-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-muted">
            No messages yet. Say hello to {other.display_name}.
          </p>
        ) : (
          messages.map((message) => {
            const mine = message.sender_id === me;
            return (
              <div
                key={message.id}
                className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                {message.photos && message.photos.length > 0 && (
                  <div
                    className={`mb-1 flex max-w-[85%] flex-wrap gap-1 sm:max-w-[70%] ${mine ? "justify-end" : ""}`}
                  >
                    {message.photos.map((url, index) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage link */}
                        <img
                          src={url}
                          alt={`Photo ${index + 1} from ${mine ? "you" : other.display_name}`}
                          className="max-h-60 rounded-xl object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
                {message.body && (
                  <p
                    className={`max-w-[85%] whitespace-pre-line break-words rounded-2xl px-4 py-2 sm:max-w-[70%] ${
                      mine
                        ? "bg-accent text-accent-foreground"
                        : "bg-surface-raised"
                    }`}
                  >
                    {message.body}
                  </p>
                )}
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
          {photos.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {photos.map((photo, index) => (
                <li key={photo.preview} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
                  <img
                    src={photo.preview}
                    alt={`Photo ${index + 1} to send`}
                    className="size-16 rounded object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(photo.preview);
                      setPhotos(photos.filter((item) => item !== photo));
                    }}
                    disabled={sending}
                    aria-label={`Remove photo ${index + 1}`}
                    className="absolute -right-1 -top-1 grid size-6 cursor-pointer place-items-center rounded-full bg-background text-xs shadow"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={photoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(event) => {
              pickPhotos(event.target.files);
              event.target.value = "";
            }}
          />
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => photoInput.current?.click()}
              disabled={sending || photos.length >= MAX_PHOTOS}
              aria-label="Add photos"
              className="btn-secondary px-3"
            >
              Photo
            </button>
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
            <button
              type="submit"
              disabled={sending || (!draft.trim() && photos.length === 0)}
              className="btn-primary"
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <p className="text-xs text-muted">
            GYMX2 admins may review conversations to keep everyone safe.
          </p>
        </form>
      ) : (
        <p className="border-t border-border p-4 text-sm text-muted">
          You&apos;re no longer connected with {other.display_name}, so you can
          read past messages but not send new ones.
        </p>
      )}
    </div>
  );
}
