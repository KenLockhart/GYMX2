import type { Metadata } from "next";
import { NotificationList } from "@/components/notification-list";
import { requireAccount } from "@/lib/auth";
import { loadAuthors } from "@/lib/community-server";
import type { NotificationDTO } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { profile } = await requireAccount();
  const supabase = await createClient();
  // Row security: only the signed-in person's own notifications.
  const { data } = await supabase
    .from("notifications")
    .select("id, type, actor_id, count, link, read_at, updated_at")
    .eq("recipient_id", profile.id)
    .order("updated_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as {
    id: string;
    type: NotificationDTO["type"];
    actor_id: string | null;
    count: number;
    link: string;
    read_at: string | null;
    updated_at: string;
  }[];
  const actors = await loadAuthors(
    rows.flatMap((row) => (row.actor_id ? [row.actor_id] : [])),
  );
  const notifications: NotificationDTO[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    actorName: (row.actor_id && actors.get(row.actor_id)?.name) || "Someone",
    count: row.count,
    link: row.link,
    read: Boolean(row.read_at),
    updatedAt: row.updated_at,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-5xl">Notifications</h1>
        <p className="mt-2 text-muted">
          Likes, comments, replies and announcements from the community. Choose
          what you get in Profile, Notifications.
        </p>
      </div>
      <NotificationList initial={notifications} />
    </div>
  );
}
