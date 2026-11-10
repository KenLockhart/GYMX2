"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  deleteVideo,
  setVideoVisibility,
  updateVideoDetails,
} from "@/app/(app)/library/actions";
import { formatDuration } from "@/lib/format";
import {
  type LibraryCard,
  libraryRows,
  searchVideos,
  VIDEO_CATEGORIES,
  VIDEO_VISIBILITY,
} from "@/lib/video-library";

const STATUS_LABEL = {
  uploading: "Waiting for upload",
  processing: "Processing",
  failed: "Upload failed",
  ready: "",
} as const;

type Viewer = { id: string; role: string };

export function VideoLibrary({
  videos,
  viewer,
}: {
  videos: LibraryCard[];
  viewer: Viewer;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<LibraryCard | null>(null);
  const isCoach = viewer.role === "coach";
  const showCoach = !isCoach && new Set(videos.map((v) => v.coachId)).size > 1;
  const rows = useMemo(
    () => libraryRows(searchVideos(videos, query)),
    [videos, query],
  );
  const found = rows.reduce(
    (n, r) => (r.key === "new" ? n : n + r.videos.length),
    0,
  );

  return (
    <div className="space-y-8">
      {videos.length > 4 && (
        <div className="max-w-md">
          <label htmlFor="video-search" className="sr-only">
            Search videos
          </label>
          <input
            id="video-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              showCoach
                ? "Search by title, category or coach"
                : "Search by title or category"
            }
            className="field-input"
          />
        </div>
      )}
      {query && (
        <p className="text-sm text-muted" aria-live="polite">
          {found} {found === 1 ? "video" : "videos"}
        </p>
      )}
      {rows.length === 0 && query ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-center text-muted">
          No videos match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        rows.map((row) => (
          <Row
            key={row.key}
            title={row.title}
            videos={row.videos}
            viewer={viewer}
            showCoach={showCoach}
            onEdit={setEditing}
          />
        ))
      )}
      {editing && (
        <EditDialog video={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function Row({
  title,
  videos,
  viewer,
  showCoach,
  onEdit,
}: {
  title: string;
  videos: LibraryCard[];
  viewer: Viewer;
  showCoach: boolean;
  onEdit: (video: LibraryCard) => void;
}) {
  const track = useRef<HTMLUListElement>(null);
  const scroll = (direction: 1 | -1) =>
    track.current?.scrollBy({
      left: direction * track.current.clientWidth * 0.85,
      behavior: "smooth",
    });
  const headingId = `row-${title.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <h2 id={headingId} className="text-2xl sm:text-3xl">
          {title}{" "}
          <span className="text-base font-normal text-muted">
            ({videos.length})
          </span>
        </h2>
        {videos.length > 3 && (
          <div className="hidden gap-1 sm:flex">
            {([-1, 1] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => scroll(d)}
                aria-label={
                  d < 0 ? `Scroll ${title} back` : `Scroll ${title} forward`
                }
                className="grid size-9 place-items-center rounded-full border border-border text-muted hover:border-accent hover:text-accent"
              >
                {d < 0 ? "‹" : "›"}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul
        ref={track}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:mx-0 sm:scroll-px-0 sm:px-0"
      >
        {videos.map((video) => (
          <li
            key={video.id}
            className="w-[72vw] max-w-72 shrink-0 snap-start sm:w-72"
          >
            <VideoCard
              video={video}
              viewer={viewer}
              showCoach={showCoach}
              onEdit={onEdit}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Thumbnail({ video }: { video: LibraryCard }) {
  const [failed, setFailed] = useState(false);
  const duration = formatDuration(video.durationSeconds);
  const ready = video.status === "ready";
  return (
    <div className="relative aspect-video overflow-hidden bg-surface-raised">
      {ready && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived, access-checked link
        <img
          src={`/api/videos/${video.id}/thumbnail`}
          alt=""
          loading="lazy"
          // An image that fails before the page is interactive never fires onError, so check on mount.
          ref={(img) => {
            if (img?.complete && img.naturalWidth === 0) setFailed(true);
          }}
          onError={() => setFailed(true)}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none"
        />
      ) : (
        <div
          aria-hidden
          className="grid size-full place-items-center"
          style={{
            background:
              "radial-gradient(90% 80% at 80% 10%, rgba(200,241,53,0.18), transparent 60%), linear-gradient(160deg,#20241d,#0d0f0c)",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-10 text-accent/60"
            fill="currentColor"
          >
            <path d="M8 5.5v13l11-6.5-11-6.5Z" />
          </svg>
        </div>
      )}
      {!ready && (
        <span className="absolute inset-x-0 bottom-0 bg-background/85 px-3 py-1.5 text-xs text-muted">
          {STATUS_LABEL[video.status]}
        </span>
      )}
      {ready && duration && (
        <span className="absolute bottom-2 right-2 rounded bg-background/85 px-1.5 py-0.5 text-xs font-semibold tabular-nums">
          {duration}
        </span>
      )}
      {video.visibility === "private" && (
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-xs">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="size-3"
          >
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Private
        </span>
      )}
    </div>
  );
}

function VideoCard({
  video,
  viewer,
  showCoach,
  onEdit,
}: {
  video: LibraryCard;
  viewer: Viewer;
  showCoach: boolean;
  onEdit: (video: LibraryCard) => void;
}) {
  const ready = video.status === "ready";
  const isOwner = video.coachId === viewer.id;
  const canManage = isOwner || viewer.role === "admin";
  const duration = formatDuration(video.durationSeconds);
  const meta = [showCoach && video.coachName, video.category, duration]
    .filter(Boolean)
    .join(" • ");

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-accent/60">
      {ready ? (
        <Link href={`/library/${video.id}`} aria-label={`Watch ${video.title}`}>
          <Thumbnail video={video} />
        </Link>
      ) : (
        <Thumbnail video={video} />
      )}
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold [font-family:var(--font-inter)] normal-case">
            {ready ? (
              <Link href={`/library/${video.id}`} className="hover:text-accent">
                {video.title}
              </Link>
            ) : (
              video.title
            )}
          </h3>
          <p className="mt-0.5 truncate text-sm text-muted">{meta}</p>
          {isOwner && (
            <p className="mt-1 text-xs text-muted">
              {video.visibility === "private"
                ? "Only you"
                : "Members who join you"}
            </p>
          )}
        </div>
        {canManage && (
          <CardMenu video={video} isOwner={isOwner} onEdit={onEdit} />
        )}
      </div>
    </article>
  );
}

function CardMenu({
  video,
  isOwner,
  onEdit,
}: {
  video: LibraryCard;
  isOwner: boolean;
  onEdit: (video: LibraryCard) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") {
          setOpen(false);
          button.current?.focus();
        }
      } else if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function run(task: () => Promise<{ error?: string }>) {
    setOpen(false);
    setError(null);
    start(async () => {
      const result = await task();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  const item =
    "block w-full px-4 py-2.5 text-left text-sm hover:bg-surface-raised";

  return (
    <div ref={box} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Options for ${video.title}`}
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        className="-mr-1 grid size-8 place-items-center rounded-full text-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="currentColor"
          className="size-5"
        >
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-20 mb-1 w-52 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl"
        >
          {isOwner && (
            <>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onEdit(video);
                }}
              >
                Edit details
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() =>
                  run(() =>
                    setVideoVisibility(
                      video.id,
                      video.visibility === "private" ? "members" : "private",
                    ),
                  )
                }
              >
                {video.visibility === "private"
                  ? "Show to members"
                  : "Make private"}
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className={`${item} text-danger`}
            onClick={() => {
              if (
                !window.confirm(
                  `Delete "${video.title}"? This can't be undone.`,
                )
              )
                return;
              const form = new FormData();
              form.set("video_id", video.id);
              run(() => deleteVideo({}, form));
            }}
          >
            Delete
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-danger bg-surface p-2 text-xs text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function EditDialog({
  video,
  onClose,
}: {
  video: LibraryCard;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="edit-video-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-0 text-foreground backdrop:bg-black/70"
    >
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const result = await updateVideoDetails(video.id, {
              title: String(data.get("title") ?? ""),
              description: String(data.get("description") ?? ""),
              category: String(data.get("category") ?? ""),
              visibility: String(data.get("visibility") ?? ""),
            });
            if (result.error) return setError(result.error);
            dialog.current?.close();
            router.refresh();
          });
        }}
      >
        <h2 id="edit-video-title" className="text-3xl">
          Edit video
        </h2>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Title</span>
          <input
            name="title"
            defaultValue={video.title}
            maxLength={120}
            required
            className="field-input"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Description</span>
          <textarea
            name="description"
            defaultValue={video.description}
            rows={3}
            maxLength={2000}
            className="field-input"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Category</span>
            <select
              name="category"
              defaultValue={video.category}
              className="field-input"
            >
              {VIDEO_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Who can watch</span>
            <select
              name="visibility"
              defaultValue={video.visibility}
              className="field-input"
            >
              {Object.entries(VIDEO_VISIBILITY).map(([value, label]) => (
                <option key={value} value={value}>
                  {value === "members"
                    ? "Members who join me"
                    : `Only me (${label.toLowerCase()})`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted">
          Private videos stay out of your members&apos; library. Members you
          assign one to in a Task can still watch it.
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
