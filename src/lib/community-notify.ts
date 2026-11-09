import "server-only";
import { sendPush } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";

export type NotificationType =
  "like" | "comment" | "reply" | "announcement" | "progress_reply" | "removed";

// Defaults when a person hasn't changed their settings (Stage 2 design).
const DEFAULT_PUSH: Record<NotificationType, boolean> = {
  like: false,
  comment: true,
  reply: true,
  announcement: true,
  progress_reply: true,
  removed: false,
};

type Event = {
  recipients: string[];
  type: NotificationType;
  actorId: string;
  actorName: string;
  postId?: string;
  commentId?: string;
  link: string;
  // Unread notifications with the same key collapse into one ("Jordan and 3 others liked your post").
  groupKey: string;
  title: string;
  body: string;
};

// Writes in-app notifications and sends push where each person allows it. Never notifies the
// person who acted. Never throws: a failed notification must not undo a like or comment.
export async function notifyCommunity(event: Event) {
  const recipients = [...new Set(event.recipients)].filter(
    (id) => id && id !== event.actorId,
  );
  if (recipients.length === 0) return;
  const db = createAdminClient();
  try {
    const { data: settings } = await db
      .from("notification_settings")
      .select("user_id, in_app, push")
      .eq("type", event.type)
      .in("user_id", recipients);
    const chosen = new Map(
      (settings ?? []).map((row) => [row.user_id as string, row]),
    );
    const inApp = recipients.filter((id) => chosen.get(id)?.in_app ?? true);
    const push = recipients.filter(
      (id) => chosen.get(id)?.push ?? DEFAULT_PUSH[event.type],
    );

    if (inApp.length) {
      const { data: unread } = await db
        .from("notifications")
        .select("id, recipient_id, count")
        .eq("group_key", event.groupKey)
        .is("read_at", null)
        .in("recipient_id", inApp);
      const existing = new Map(
        (unread ?? []).map((row) => [row.recipient_id as string, row]),
      );
      const now = new Date().toISOString();
      await Promise.all(
        inApp.map((recipient) => {
          const row = existing.get(recipient);
          return row
            ? db
                .from("notifications")
                .update({
                  count: (row.count as number) + 1,
                  actor_id: event.actorId,
                  updated_at: now,
                })
                .eq("id", row.id)
            : db.from("notifications").insert({
                recipient_id: recipient,
                type: event.type,
                actor_id: event.actorId,
                post_id: event.postId ?? null,
                comment_id: event.commentId ?? null,
                link: event.link,
                group_key: event.groupKey,
              });
        }),
      );
    }
    if (push.length) {
      await sendPush(push, {
        title: event.title,
        body: event.body,
        url: event.link,
        tag: event.groupKey,
      });
    }
  } catch (error) {
    console.error("Community notification failed", error);
  }
}

// Everyone in a coach's community, for announcements.
export async function communityMembers(coachId: string) {
  const { data } = await createAdminClient()
    .from("coach_members")
    .select("member_id")
    .eq("coach_id", coachId);
  return (data ?? []).map((row) => row.member_id as string);
}
