"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  deleteGroupMessage,
  postGroupMessage,
} from "@/app/(app)/groups/actions";
import { createBrowserSupabase } from "@/lib/supabase/client";
import type { GroupPost } from "@/lib/groups";

const subscribe = () => () => {};
const useIsClient = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

function formatTime(iso: string, isClient: boolean) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString("en-US", {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    timeZone: isClient ? undefined : "UTC",
  });
}

export function GroupChat({
  me,
  coachId,
  names,
  initialPosts,
  canPost,
  flagged = {},
}: {
  me: string;
  coachId: string;
  names: Record<string, string>;
  initialPosts: GroupPost[];
  canPost: boolean;
  flagged?: Record<string, string>;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const isClient = useIsClient();
  const router = useRouter();
  const isCoach = me === coachId;

  function addPost(post: GroupPost) {
    setPosts((current) =>
      current.some((existing) => existing.id === post.id)
        ? current
        : [...current, post],
    );
  }

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`group-${coachId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `coach_id=eq.${coachId}`,
        },
        (payload) => {
          const post = payload.new as GroupPost;
          if (!post?.id) return;
          addPost(post);
          // Someone new joined the coach since the page loaded: fetch fresh names.
          if (!names[post.sender_id]) router.refresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "group_messages" },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (id)
            setPosts((current) => current.filter((post) => post.id !== id));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [coachId, names, router]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [posts.length]);

  function send() {
    const body = draft.trim();
    if (!body || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await postGroupMessage(coachId, body);
      if (result.error) return setError(result.error);
      setDraft("");
      if (result.post) addPost(result.post);
    });
  }

  function remove(id: string) {
    if (!window.confirm("Remove this post for everyone?")) return;
    startTransition(async () => {
      const result = await deleteGroupMessage(id);
      if (result.error) return setError(result.error);
      setPosts((current) => current.filter((post) => post.id !== id));
    });
  }

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <div
        className="flex max-h-[65vh] min-h-72 flex-col gap-4 overflow-y-auto p-4"
        aria-live="polite"
      >
        {posts.length === 0 ? (
          <p className="m-auto text-sm text-muted">
            No posts yet. Start the conversation.
          </p>
        ) : (
          posts.map((post) => {
            const mine = post.sender_id === me;
            const fromCoach = post.sender_id === coachId;
            return (
              <div
                key={post.id}
                className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <span className="mb-1 text-xs font-semibold">
                  {mine ? "You" : (names[post.sender_id] ?? "A former member")}
                  {fromCoach && (
                    <span className="ml-1.5 rounded bg-accent px-1 text-[10px] uppercase text-accent-foreground">
                      Coach
                    </span>
                  )}
                </span>
                <p
                  className={`max-w-[85%] whitespace-pre-line break-words rounded-2xl px-4 py-2 sm:max-w-[70%] ${
                    mine
                      ? "bg-accent text-accent-foreground"
                      : "bg-surface-raised"
                  } ${flagged[post.id] ? "ring-2 ring-danger" : ""}`}
                >
                  {post.body}
                </p>
                <span className="mt-1 flex gap-2 text-xs text-muted">
                  {formatTime(post.created_at, isClient)}
                  {flagged[post.id] && (
                    <span className="text-danger">
                      Flagged: {flagged[post.id]}
                    </span>
                  )}
                  {(mine || isCoach) && (
                    <button
                      type="button"
                      onClick={() => remove(post.id)}
                      className="cursor-pointer hover:text-danger"
                    >
                      Remove
                    </button>
                  )}
                </span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {canPost ? (
        <form
          className="space-y-2 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label className="sr-only" htmlFor="group-body">
            Post to the group
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="group-body"
              rows={2}
              maxLength={2000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Post to the group"
              className="field-input flex-1 resize-none"
            />
            <button
              type="submit"
              disabled={pending || !draft.trim()}
              className="btn-primary"
            >
              {pending ? "Posting..." : "Post"}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <p className="text-xs text-muted">
            Everyone in this group can read posts. GYMX2 admins may review
            groups to keep everyone safe.
          </p>
        </form>
      ) : (
        <p className="border-t border-border p-4 text-sm text-muted">
          Admins can read groups but not post in them.
        </p>
      )}
    </div>
  );
}
