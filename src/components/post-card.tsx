"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deletePost,
  removePost,
  toggleLike,
  updatePost,
} from "@/app/(app)/community/actions";
import {
  setFollow,
  setHidden,
  setMute,
} from "@/app/(app)/community/preferences/actions";
import { PillarTag } from "@/components/game-parts";
import { ReportButton } from "@/components/report-button";
import {
  audienceLabel,
  kindLabel,
  kindsFor,
  POST_BODY_MAX,
  timeAgo,
  type PostDTO,
} from "@/lib/community";
import { T, useTr } from "@/i18n/t";
import { useLocale } from "@/i18n/client";

function PhotoGrid({ photos }: { photos: PostDTO["photos"] }) {
  const tr = useTr();
  if (photos.length === 0) return null;
  const single = photos.length === 1;
  return (
    <div
      className={`grid gap-1 overflow-hidden rounded-lg ${single ? "" : "grid-cols-2"}`}
    >
      {photos.map((photo, index) => (
        <a
          key={photo.url}
          href={photo.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`block bg-surface-raised ${!single && photos.length === 3 && index === 0 ? "col-span-2" : ""}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage links */}
          <img
            src={photo.url}
            alt={tr("Photo {p0} of {length}", {
              p0: index + 1,
              length: photos.length,
            })}
            width={photo.width ?? undefined}
            height={photo.height ?? undefined}
            loading="lazy"
            className={`w-full object-cover ${single ? "max-h-[32rem]" : "aspect-square"}`}
          />
        </a>
      ))}
    </div>
  );
}

function Video({ video }: { video: NonNullable<PostDTO["video"]> }) {
  const tr = useTr();
  if (video.status !== "ready" || !video.url) {
    return (
      <p className="rounded-lg bg-surface-raised p-6 text-center text-sm text-muted">
        {video.status === "failed"
          ? tr("This video couldn't be processed.")
          : tr("The video is still processing. Check back in a minute.")}
      </p>
    );
  }
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
      <iframe
        src={video.url}
        title={tr("Post video")}
        loading="lazy"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 size-full border-0"
      />
    </div>
  );
}

export function PostCard({
  post: initial,
  viewerRole,
  onDeleted,
  onMuted,
  onDismissChange,
  linkToPost = true,
}: {
  post: PostDTO;
  viewerRole: string;
  onDeleted?: (id: string) => void;
  // Lets the feed drop the muted person's other posts.
  onMuted?: (authorId: string, postId: string) => void;
  // Hidden or muted (true), or brought back with Undo (false).
  onDismissChange?: (postId: string, dismissed: boolean) => void;
  linkToPost?: boolean;
}) {
  const locale = useLocale();
  const tr = useTr();
  const router = useRouter();
  const [post, setPost] = useState(initial);
  const [dismissed, setDismissed] = useState<"hidden" | "muted" | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ body: post.body, kind: post.kind });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announcement = post.kind === "announcement";

  const [liking, startLike] = useTransition();
  function like() {
    // Show the change at once; the server's count wins when it answers.
    const wasLiked = post.likedByMe;
    setPost((current) => ({
      ...current,
      likedByMe: !wasLiked,
      likeCount: Math.max(0, current.likeCount + (wasLiked ? -1 : 1)),
    }));
    startLike(async () => {
      const result = await toggleLike(post.id);
      if (result.error || result.liked === undefined) {
        setPost((current) => ({
          ...current,
          likedByMe: wasLiked,
          likeCount: initial.likeCount,
        }));
        setError(result.error ?? tr("That didn't work."));
        return;
      }
      setPost((current) => ({
        ...current,
        likedByMe: result.liked!,
        likeCount: result.count ?? current.likeCount,
      }));
    });
  }

  function follow() {
    const next = !post.followingAuthor;
    setPost((current) => ({ ...current, followingAuthor: next }));
    start(async () => {
      const result = await setFollow(post.author.id, next);
      if (result.error) {
        setPost((current) => ({ ...current, followingAuthor: !next }));
        setError(result.error);
      }
    });
  }

  function dismiss(how: "hidden" | "muted", undo = false) {
    setError(null);
    start(async () => {
      const result =
        how === "hidden"
          ? await setHidden(post.id, !undo)
          : await setMute(post.author.id, !undo);
      if (result.error) return setError(result.error);
      setDismissed(undo ? null : how);
      onDismissChange?.(post.id, !undo);
      if (how === "muted" && !undo) onMuted?.(post.author.id, post.id);
      // Bring back the person's other posts.
      if (how === "muted" && undo) router.refresh();
    });
  }

  if (dismissed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
        <span>
          {dismissed === "hidden"
            ? tr("Post hidden. You won't see it in your feed.")
            : tr("You muted {name}. Their posts won't show in your feed.", {
                name: post.author.name,
              })}
        </span>
        <button
          type="button"
          onClick={() => dismiss(dismissed, true)}
          disabled={pending}
          className="shrink-0 cursor-pointer font-semibold text-foreground hover:text-accent"
        >
          <T>Undo</T>
        </button>
      </div>
    );
  }

  function moderate() {
    const reason = window.prompt(
      tr(
        "Remove this post from your community? Add a short reason for the author (optional).",
      ),
    );
    if (reason === null) return;
    setError(null);
    start(async () => {
      const result = await removePost(post.id, reason);
      if (result.error) return setError(result.error);
      onDeleted?.(post.id);
    });
  }

  function save() {
    setError(null);
    start(async () => {
      const result = await updatePost({ id: post.id, ...draft });
      if (result.error) return setError(result.error);
      setPost({ ...post, ...draft, editedAt: new Date().toISOString() });
      setEditing(false);
    });
  }

  function remove() {
    if (
      !window.confirm(
        tr(
          "Delete this post for everyone? Its photos and video are deleted too.",
        ),
      )
    )
      return;
    start(async () => {
      const result = await deletePost(post.id);
      if (result.error) return setError(result.error);
      onDeleted?.(post.id);
    });
  }

  return (
    <article
      className={`space-y-3 rounded-lg border bg-surface p-4 ${announcement ? "border-accent" : "border-border"}`}
      aria-label={tr("{p0} by {name}", {
        p0: kindLabel(post.kind),
        name: post.author.name,
      })}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{post.author.name}</span>
            {!post.mine && (
              <button
                type="button"
                onClick={follow}
                disabled={pending}
                aria-pressed={post.followingAuthor}
                className={`cursor-pointer text-xs font-semibold hover:text-foreground ${post.followingAuthor ? "text-muted" : "text-accent"}`}
              >
                {post.followingAuthor ? tr("Following") : tr("Follow")}
              </button>
            )}
            {post.author.role === "coach" && (
              <span className="rounded bg-accent px-1.5 text-[10px] font-bold uppercase text-accent-foreground">
                <T>Coach</T>
              </span>
            )}
            <span className="rounded border border-border px-1.5 text-xs text-muted">
              <T>{kindLabel(post.kind)}</T>
            </span>
            <PillarTag pillar={post.pillar} />
          </p>
          <p className="text-xs text-muted">
            {linkToPost ? (
              <Link
                href={`/community/post/${post.id}`}
                className="hover:underline"
              >
                <time dateTime={post.createdAt}>
                  {timeAgo(post.createdAt, undefined, locale)}
                </time>
              </Link>
            ) : (
              <time dateTime={post.createdAt}>
                {timeAgo(post.createdAt, undefined, locale)}
              </time>
            )}{" "}
            ·{" "}
            {post.audience === "coach_community" && post.coach ? (
              <Link
                href={`/groups/${post.coach.id}`}
                className="hover:underline"
              >
                <T>{audienceLabel(post)}</T>
              </Link>
            ) : (
              audienceLabel(post)
            )}
            {post.editedAt && " · edited"}
          </p>
        </div>
        {!post.mine && (
          <div className="flex shrink-0 gap-3 text-xs">
            <button
              type="button"
              onClick={() => dismiss("hidden")}
              disabled={pending}
              className="cursor-pointer text-muted hover:text-foreground"
            >
              <T>Hide</T>
            </button>
            {post.canRemove && (
              <button
                type="button"
                onClick={moderate}
                disabled={pending}
                className="cursor-pointer text-muted hover:text-danger"
              >
                <T>Remove</T>
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss("muted")}
              disabled={pending}
              aria-label={tr("Mute {name}", { name: post.author.name })}
              className="cursor-pointer text-muted hover:text-foreground"
            >
              <T>Mute</T>
            </button>
          </div>
        )}
        {post.mine && !editing && (
          <div className="flex shrink-0 gap-3 text-xs">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="cursor-pointer text-muted hover:text-foreground"
            >
              <T>Edit</T>
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="cursor-pointer text-muted hover:text-danger"
            >
              <T>Delete</T>
            </button>
          </div>
        )}
      </header>

      {editing ? (
        <div className="space-y-2">
          <label className="sr-only" htmlFor={`edit-${post.id}`}>
            <T>Edit post</T>
          </label>
          <textarea
            id={`edit-${post.id}`}
            rows={4}
            maxLength={POST_BODY_MAX}
            value={draft.body}
            onChange={(event) =>
              setDraft({ ...draft, body: event.target.value })
            }
            className="field-input"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={tr("Post type")}
              value={draft.kind}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  kind: event.target.value as PostDTO["kind"],
                })
              }
              className="field-input w-auto py-2 text-sm"
            >
              {kindsFor(viewerRole).map((kind) => (
                <option key={kind.value} value={kind.value}>
                  <T>{kind.label}</T>
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="btn-primary px-3 py-2 text-sm"
            >
              {pending ? tr("Saving...") : tr("Save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft({ body: post.body, kind: post.kind });
              }}
              className="btn-secondary px-3 py-2 text-sm"
            >
              <T>Cancel</T>
            </button>
          </div>
        </div>
      ) : (
        post.body && (
          <p className="whitespace-pre-line break-words">{post.body}</p>
        )
      )}

      <PhotoGrid photos={post.photos} />
      {post.video && <Video video={post.video} />}

      <footer className="flex flex-wrap items-center gap-4 border-t border-border pt-3 text-sm text-muted">
        <button
          type="button"
          onClick={like}
          disabled={liking}
          aria-pressed={post.likedByMe}
          className={`cursor-pointer font-semibold hover:text-foreground ${post.likedByMe ? "text-accent" : ""}`}
        >
          {post.likedByMe ? tr("♥ Liked") : tr("♡ Like")}
          <span className="ml-1.5 font-normal text-muted">
            {post.likeCount}
          </span>
        </button>
        {linkToPost ? (
          <Link
            href={`/community/post/${post.id}#comments`}
            className="font-semibold hover:text-foreground"
          >
            <T>Comment</T>
            <span className="ml-1.5 font-normal text-muted">
              {post.commentCount}
            </span>
          </Link>
        ) : (
          <a href="#comments" className="font-semibold hover:text-foreground">
            <T>Comment</T>
            <span className="ml-1.5 font-normal text-muted">
              {post.commentCount}
            </span>
          </a>
        )}
        {!post.mine && (
          <span className="ml-auto">
            <ReportButton
              postId={post.id}
              label={tr("post by {name}", { name: post.author.name })}
            />
          </span>
        )}
      </footer>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {tr(error)}
        </p>
      )}
    </article>
  );
}
