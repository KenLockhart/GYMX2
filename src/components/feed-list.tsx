"use client";

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
  const [posts, setPosts] = useState(initialPosts);
  const [more, setMore] = useState(initialMore);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A new post (or a refresh) brings a new first page: start over from it.
  const [firstPage, setFirstPage] = useState(initialPosts);
  if (firstPage !== initialPosts) {
    setFirstPage(initialPosts);
    setPosts(initialPosts);
    setMore(initialMore);
  }

  function loadMore() {
    setError(null);
    start(async () => {
      try {
        const next = await loadMorePosts(posts.length, coachId);
        setPosts((current) => [
          ...current,
          ...next.posts.filter(
            (post) => !current.some((item) => item.id === post.id),
          ),
        ]);
        setMore(next.more);
      } catch {
        setError("We couldn't load more posts. Please try again.");
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
        />
      ))}
      {more && (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="btn-secondary w-full"
        >
          {pending ? "Loading..." : "Show more posts"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
