"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/(app)/notifications/actions";
import { useLocale, useT } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";
import { translateServerText } from "@/i18n/server-text";
import { timeAgo } from "@/lib/community";
import {
  groupByDay,
  safeLink,
  type NotificationDTO,
} from "@/lib/notifications";

// The sentence for a notification, in the viewer's language.
function describe(n: NotificationDTO, t: Messages["notificationsPage"]) {
  const who = `${n.actorName}${t.others(n.count)}`;
  switch (n.type) {
    case "announcement":
      return t.announcement(n.actorName, n.count);
    case "removed":
      return t.removed;
    case "like":
      return t.like(n.actorName, t.others(n.count));
    default:
      return t[n.type](who);
  }
}

const subscribe = () => () => {};

export function NotificationList({ initial }: { initial: NotificationDTO[] }) {
  const t = useT().notificationsPage;
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Day labels depend on the viewer's time zone, so they're drawn in the browser.
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const unread = items.filter((item) => !item.read).length;

  function open(item: NotificationDTO) {
    setItems((current) =>
      current.map((n) => (n.id === item.id ? { ...n, read: true } : n)),
    );
    void markNotificationRead(item.id).finally(() => router.refresh());
    router.push(safeLink(item.link));
  }

  function readAll() {
    setError(null);
    start(async () => {
      const result = await markAllNotificationsRead();
      if (result.error) return setError(result.error);
      setItems((current) => current.map((n) => ({ ...n, read: true })));
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-center text-muted">
        {t.nothing}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {unread === 0 ? t.allCaughtUp : t.unread(unread)}
        </p>
        <button
          type="button"
          onClick={readAll}
          disabled={pending || unread === 0}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          {t.markAllRead}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {translateServerText(error, locale)}
        </p>
      )}
      {(isClient
        ? groupByDay(items, new Date(), {
            today: t.today,
            yesterday: t.yesterday,
            locale,
          })
        : [{ label: t.recent, items }]
      ).map((group) => (
        <section key={group.label} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {group.label}
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="flex w-full cursor-pointer items-start gap-3 p-4 text-left hover:bg-surface-raised"
                >
                  <span
                    aria-hidden
                    className={`mt-2 size-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-accent"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={item.read ? "" : "font-semibold"}>
                      {describe(item, t)}
                    </span>
                    <span className="block text-xs text-muted">
                      {timeAgo(item.updatedAt, undefined, locale)}
                      {!item.read && (
                        <span className="sr-only">{t.unreadTag}</span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
