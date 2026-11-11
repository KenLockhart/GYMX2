"use client";

import { useTr } from "@/i18n/t";

import { useState, useTransition } from "react";
import { loadMorePosts } from "@/app/(app)/community/actions";
import { PostCard } from "@/components/post-card";
import type { PostDTO } from "@/lib/community";

export function FeedList({
  initialPosts,
  initialMore,
  viewerRole,
  coachId = null,
  emptyText,
}: {
  initialPosts: PostDTO[];
  initialMore: boolean;
  viewerRole: string;
  coachId?: string | null;
  emptyText: string;
}) {
  const tr = useTr();
  const [posts, setPosts] = useState(initialPosts);
  const [more, setMore] = useState(initialMore);
  // Hidden or muted cards stay on screen (with Undo) but are gone from the server's feed, so
  // they don't count when asking for the next page; otherwise a post would be skipped.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A new post (or a refresh) brings a new first page: start over from it.
  const [firstPage, setFirstPage] = useState(initialPosts);
  if (firstPage !== initialPosts) {
    setFirstPage(initialPosts);
    setPosts(initialPosts);
    setMore(initialMore);
    setDismissed(new Set());
  }

  function loadMore() {
    setError(null);
    start(async () => {
      try {
        const next = await loadMorePosts(
          Math.max(0, posts.length - dismissed.size),
          coachId,
        );
        setPosts((current) => [
          ...current,
          ...next.posts.filter(
            (post) => !current.some((item) => item.id === post.id),
          ),
        ]);
        setMore(next.more);
      } catch {
        setError(tr("We couldn't load more posts. Please try again."));
      }
    });
  }

  if (posts.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-center text-muted">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          viewerRole={viewerRole}
          onDeleted={(id) =>
            setPosts((current) => current.filter((item) => item.id !== id))
          }
          onDismissChange={(id, isDismissed) =>
            setDismissed((current) => {
              const next = new Set(current);
              if (isDismissed) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          onMuted={(authorId, keepId) =>
            setPosts((current) =>
              current.filter(
                (item) => item.id === keepId || item.author.id !== authorId,
              ),
            )
          }
        />
      ))}
      {more && (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="btn-secondary w-full"
        >
          {pending ? tr("Loading...") : tr("Show more posts")}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {tr(error)}
        </p>
      )}
    </div>
  );
}
