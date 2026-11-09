"use client";

import { ReportButton } from "@/components/report-button";
import { useEffect, useState, useTransition } from "react";
import {
  addComment,
  commentAuthors,
  deleteComment,
  updateComment,
} from "@/app/(app)/community/actions";
import { COMMENT_MAX, timeAgo, type CommentDTO } from "@/lib/community";
import { createBrowserSupabase } from "@/lib/supabase/client";

type Row = {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  removed_at: string | null;
};

function CommentBox({
  postId,
  parentId,
  placeholder,
  onAdded,
  autoFocus = false,
}: {
  postId: string;
  parentId: string | null;
  placeholder: string;
  onAdded: (comment: CommentDTO) => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        setError(null);
        start(async () => {
          const result = await addComment({ postId, parentId, body });
          if (result.error || !result.comment)
            return setError(result.error ?? "That didn't post.");
          setBody("");
          onAdded(result.comment);
        });
      }}
      className="space-y-1"
    >
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`comment-${parentId ?? postId}`}>
          {placeholder}
        </label>
        <input
          id={`comment-${parentId ?? postId}`}
          value={body}
          maxLength={COMMENT_MAX}
          autoFocus={autoFocus}
          onChange={(event) => setBody(event.target.value)}
          placeholder={placeholder}
          className="field-input min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="btn-primary px-3"
        >
          {pending ? "..." : parentId ? "Reply" : "Comment"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function CommentItem({
  comment,
  replies,
  onChange,
  onRemove,
  onReply,
}: {
  comment: CommentDTO;
  replies?: React.ReactNode;
  onChange: (comment: CommentDTO) => void;
  onRemove: (id: string) => void;
  onReply?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li id={`comment-${comment.id}`} className="scroll-mt-24 space-y-2">
      <div className="rounded-lg bg-surface-raised px-3 py-2 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{comment.author.name}</span>
          {comment.author.role === "coach" && (
            <span className="rounded bg-accent px-1 text-[10px] font-bold uppercase text-accent-foreground">
              Coach
            </span>
          )}
          <span className="text-xs text-muted">
            {timeAgo(comment.createdAt)}
            {comment.editedAt && " · edited"}
          </span>
        </p>
        {editing ? (
          <div className="mt-1 flex gap-2">
            <label className="sr-only" htmlFor={`edit-comment-${comment.id}`}>
              Edit comment
            </label>
            <input
              id={`edit-comment-${comment.id}`}
              value={draft}
              maxLength={COMMENT_MAX}
              onChange={(event) => setDraft(event.target.value)}
              className="field-input min-w-0 flex-1 py-1.5"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await updateComment(comment.id, draft);
                  if (result.error) return setError(result.error);
                  onChange({
                    ...comment,
                    body: draft.trim(),
                    editedAt: new Date().toISOString(),
                  });
                  setEditing(false);
                })
              }
              className="btn-primary px-3 py-1.5 text-sm"
            >
              Save
            </button>
          </div>
        ) : (
          <p className="whitespace-pre-line break-words">{comment.body}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-3 px-3 text-xs text-muted">
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            className="cursor-pointer hover:text-foreground"
          >
            Reply
          </button>
        )}
        {comment.mine && !editing && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="cursor-pointer hover:text-foreground"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Delete this comment?")) return;
                start(async () => {
                  const result = await deleteComment(comment.id);
                  if (result.error) return setError(result.error);
                  onRemove(comment.id);
                });
              }}
              className="cursor-pointer hover:text-danger"
            >
              Delete
            </button>
          </>
        )}
        {!comment.mine && (
          <ReportButton
            commentId={comment.id}
            label={`comment by ${comment.author.name}`}
          />
        )}
        {error && <span className="text-danger">{error}</span>}
      </div>
      {replies}
    </li>
  );
}

export function CommentThread({
  postId,
  initialComments,
}: {
  postId: string;
  initialComments: CommentDTO[];
}) {
  const [comments, setComments] = useState(initialComments);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  function upsert(comment: CommentDTO) {
    setComments((current) =>
      current.some((item) => item.id === comment.id)
        ? current.map((item) => (item.id === comment.id ? comment : item))
        : [...current, comment],
    );
  }
  function remove(id: string) {
    setComments((current) =>
      current.filter((item) => item.id !== id && item.parentId !== id),
    );
  }

  // New, edited and removed comments from others appear without a refresh.
  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`comments-${postId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "post_comments",
          filter: `post_id=eq.${postId}`,
        },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string }).id;
            if (id) remove(id);
            return;
          }
          const row = payload.new as Row;
          if (row.removed_at) return remove(row.id);
          const names = await commentAuthors([row.author_id]);
          setComments((current) => {
            const existing = current.find((item) => item.id === row.id);
            const next: CommentDTO = {
              id: row.id,
              postId: row.post_id,
              parentId: row.parent_id,
              body: row.body,
              author: names[row.author_id] ??
                existing?.author ?? {
                  id: row.author_id,
                  name: "A member",
                  role: "member",
                },
              createdAt: row.created_at,
              editedAt: row.edited_at,
              mine: existing?.mine ?? false,
            };
            return existing
              ? current.map((item) => (item.id === row.id ? next : item))
              : [...current, next];
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [postId]);

  const topLevel = comments.filter((comment) => !comment.parentId);

  return (
    <section
      id="comments"
      aria-labelledby="comments-heading"
      className="scroll-mt-24 space-y-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="comments-heading" className="text-xl">
        Comments
      </h2>
      <CommentBox
        postId={postId}
        parentId={null}
        placeholder="Add a comment"
        onAdded={upsert}
      />
      {topLevel.length === 0 ? (
        <p className="text-sm text-muted">
          No comments yet. Start the conversation.
        </p>
      ) : (
        <ul className="space-y-4">
          {topLevel.map((comment) => {
            const replies = comments.filter(
              (item) => item.parentId === comment.id,
            );
            return (
              <CommentItem
                key={comment.id}
                comment={comment}
                onChange={upsert}
                onRemove={remove}
                onReply={() =>
                  setReplyingTo(replyingTo === comment.id ? null : comment.id)
                }
                replies={
                  (replies.length > 0 || replyingTo === comment.id) && (
                    <ul className="ml-6 space-y-3 border-l border-border pl-3">
                      {replies.map((reply) => (
                        <CommentItem
                          key={reply.id}
                          comment={reply}
                          onChange={upsert}
                          onRemove={remove}
                        />
                      ))}
                      {replyingTo === comment.id && (
                        <li>
                          <CommentBox
                            postId={postId}
                            parentId={comment.id}
                            placeholder={`Reply to ${comment.author.name}`}
                            autoFocus
                            onAdded={(reply) => {
                              upsert(reply);
                              setReplyingTo(null);
                            }}
                          />
                        </li>
                      )}
                    </ul>
                  )
                }
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
