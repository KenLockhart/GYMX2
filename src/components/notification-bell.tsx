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

  return (
    <Link
      href="/notifications"
      aria-current={pathname === "/notifications" ? "page" : undefined}
      className="inline-flex items-center gap-1.5 hover:text-accent"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <span className="sr-only">Notifications</span>
      {count > 0 && (
        <span className="rounded-full bg-accent px-1.5 text-xs font-bold text-accent-foreground">
          {count > 99 ? "99+" : count}
          <span className="sr-only"> unread</span>
        </span>
      )}
    </Link>
  );
}
