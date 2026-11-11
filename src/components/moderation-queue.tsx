"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  clearPostFlag,
  dismissReports,
  removeComment,
  removePost,
} from "@/app/(app)/community/actions";
import { timeAgo } from "@/lib/community";
import { T, useTr } from "@/i18n/t";
import { useLocale } from "@/i18n/client";

export type QueueItem = {
  key: string;
  kind: "post" | "comment";
  targetId: string;
  postId: string;
  authorName: string;
  body: string;
  photos: string[];
  where: string;
  createdAt: string;
  alreadyRemoved: boolean;
  summary: string;
  details: string[];
  autoFlag: string | null;
  // Flagged automatically and not reported: a reviewer can clear the flag.
  canClearFlag: boolean;
  reportIds: string[];
  reportedAt: string;
};

function Item({
  item,
  onDone,
}: {
  item: QueueItem;
  onDone: (key: string, outcome: string) => void;
}) {
  const tr = useTr();
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove() {
    const reason = window.prompt(
      item.kind === "post"
        ? tr(
            "Remove this post for everyone? Add a short reason for the author (optional).",
          )
        : tr(
            "Remove this comment for everyone? Add a short reason for the author (optional).",
          ),
    );
    if (reason === null) return;
    setError(null);
    start(async () => {
      const result =
        item.kind === "post"
          ? await removePost(item.targetId, reason)
          : await removeComment(item.targetId, reason);
      if (result.error) return setError(result.error);
      onDone(item.key, "Removed");
    });
  }

  function clearFlag() {
    setError(null);
    start(async () => {
      const result = await clearPostFlag(item.targetId);
      if (result.error) return setError(result.error);
      onDone(item.key, "Looks fine");
    });
  }

  function dismiss() {
    setError(null);
    start(async () => {
      const result = await dismissReports(item.reportIds);
      if (result.error) return setError(result.error);
      onDone(item.key, "Kept");
    });
  }

  return (
    <li className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-danger">
          <T>{item.summary}</T>
        </p>
        <p className="text-xs text-muted">
          {tr("reported {when}", {
            when: timeAgo(item.reportedAt, undefined, locale),
          })}
        </p>
      </div>
      <div className="rounded border border-border bg-surface-raised p-3">
        <p className="text-xs text-muted">
          {item.kind === "post" ? tr("Post by") : tr("Comment by")}{" "}
          <span className="font-semibold text-foreground">
            {item.authorName}
          </span>{" "}
          · {item.where} · {timeAgo(item.createdAt, undefined, locale)}
          {item.alreadyRemoved && <T>{" · already removed"}</T>}
        </p>
        {item.body && (
          <p className="mt-2 whitespace-pre-line break-words">{item.body}</p>
        )}
        {item.photos.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {item.photos.map((url, index) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage link */}
                <img
                  src={url}
                  alt={tr("Photo {p0}", { p0: index + 1 })}
                  className="size-24 rounded object-cover"
                />
              </a>
            ))}
          </div>
        )}
      </div>
      {item.autoFlag && (
        <p className="text-xs text-muted">
          {tr("Automatic flag: {flag}", { flag: tr(item.autoFlag) })}
        </p>
      )}
      {item.details.length > 0 && (
        <ul className="space-y-1 text-sm">
          {item.details.map((detail, index) => (
            <li
              key={index}
              className="border-l-2 border-border pl-2 text-muted"
            >
              {detail}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!item.alreadyRemoved && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="btn-primary px-3 py-1.5 text-sm"
          >
            {item.kind === "post" ? tr("Remove post") : tr("Remove comment")}
          </button>
        )}
        {item.canClearFlag && (
          <button
            type="button"
            onClick={clearFlag}
            disabled={pending}
            className="btn-secondary px-3 py-1.5 text-sm"
          >
            <T>Looks fine</T>
          </button>
        )}
        {item.reportIds.length > 0 && (
          <button
            type="button"
            onClick={dismiss}
            disabled={pending}
            className="btn-secondary px-3 py-1.5 text-sm"
          >
            {item.alreadyRemoved
              ? tr("Close reports")
              : tr("Keep it (dismiss)")}
          </button>
        )}
        <Link
          href={`/community/post/${item.postId}`}
          className="text-link ml-auto text-sm"
        >
          <T>Open post</T>
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {tr(error)}
        </p>
      )}
    </li>
  );
}

export function ModerationQueue({
  title,
  empty,
  hint,
  items: initial,
}: {
  title: string;
  empty: string;
  hint?: string;
  items: QueueItem[];
}) {
  const tr = useTr();
  const [items, setItems] = useState(initial);
  const [handled, setHandled] = useState<{ key: string; text: string }[]>([]);

  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-3xl">
        {title} <span className="text-muted">({items.length})</span>
      </h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      {handled.length > 0 && (
        <p role="status" className="text-sm text-accent">
          {handled[handled.length - 1].text}
        </p>
      )}
      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-muted">
          {empty}
        </p>
      ) : (
        <ol className="space-y-4">
          {items.map((item) => (
            <Item
              key={item.key}
              item={item}
              onDone={(key, outcome) => {
                setItems((current) =>
                  current.filter((existing) => existing.key !== key),
                );
                setHandled((current) => [
                  ...current,
                  {
                    key,
                    text: tr(
                      item.kind === "post"
                        ? "{outcome}: post by {name}."
                        : "{outcome}: comment by {name}.",
                      { outcome: tr(outcome), name: item.authorName },
                    ),
                  },
                ]);
              }}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
