"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { unreadNotificationCount } from "@/app/(app)/notifications/actions";
import { createBrowserSupabase } from "@/lib/supabase/client";

// The bell in the menu. The count updates live: row security means only the signed-in person's
// own notifications are delivered.
export function NotificationBell({
  me,
  initialCount,
}: {
  me: string;
  initialCount: number;
}) {
  const [count, setCount] = useState(initialCount);
  const pathname = usePathname();

  // A fresh count from the server whenever the page changes (for example after reading some).
  const [lastCount, setLastCount] = useState(initialCount);
  if (lastCount !== initialCount) {
    setLastCount(initialCount);
    setCount(initialCount);
  }

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const refresh = () =>
      void unreadNotificationCount()
        .then(setCount)
        .catch(() => undefined);
    const channel = supabase
      .channel(`notifications-${me}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${me}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [me]);

  const active = pathname === "/notifications";
  return (
    <Link
      href="/notifications"
      aria-current={active ? "page" : undefined}
      className={`relative grid size-10 place-items-center rounded-full hover:bg-surface-raised ${
        active ? "text-accent" : "text-foreground/85 hover:text-foreground"
      }`}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <span className="sr-only">
        Notifications{count > 0 && `, ${count} unread`}
      </span>
      {count > 0 && (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-bold leading-5 text-accent-foreground"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
