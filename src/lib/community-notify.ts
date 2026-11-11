import "server-only";
import { loadRecipient, sendEmail } from "@/lib/email";
import { communityEmail } from "@/lib/email-templates";
import { NOTIFICATION_SETTINGS } from "@/lib/notifications";
import { type PushText, sendPush } from "@/lib/push";
import { getSiteUrl } from "@/lib/supabase/env";
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
  title: PushText;
  body: PushText;
  // The comment, announcement or removal reason, for the email.
  snippet?: string;
};

const DEFAULT_EMAIL = Object.fromEntries(
  NOTIFICATION_SETTINGS.map((setting) => [setting.type, setting.defaultEmail]),
) as Record<string, boolean>;

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
      .select("user_id, in_app, push, email")
      .eq("type", event.type)
      .in("user_id", recipients);
    const chosen = new Map(
      (settings ?? []).map((row) => [row.user_id as string, row]),
    );
    const inApp = recipients.filter((id) => chosen.get(id)?.in_app ?? true);
    const push = recipients.filter(
      (id) => chosen.get(id)?.push ?? DEFAULT_PUSH[event.type],
    );

    const email = recipients.filter(
      (id) => chosen.get(id)?.email ?? DEFAULT_EMAIL[event.type] ?? false,
    );

    // Unread notifications with this key, for collapsing repeats and for not emailing them again.
    const { data: unread } =
      inApp.length || email.length
        ? await db
            .from("notifications")
            .select("id, recipient_id, count")
            .eq("group_key", event.groupKey)
            .is("read_at", null)
            .in("recipient_id", [...new Set([...inApp, ...email])])
        : { data: [] };
    const alreadyUnread = new Set(
      (unread ?? []).map((row) => row.recipient_id as string),
    );

    if (inApp.length) {
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
    // Email once per group: a fifth like on a post nobody has looked at yet doesn't email again.
    const emailNow = email.filter((id) => !alreadyUnread.has(id));
    if (emailNow.length) {
      const siteUrl = getSiteUrl();
      await Promise.all(
        emailNow.map(async (id) => {
          const recipient = await loadRecipient(id);
          // The account-wide "Email me" switch in Profile still wins.
          if (!recipient?.wantsUpdates) return;
          await sendEmail(
            recipient.email,
            communityEmail({
              locale: recipient.locale,
              siteUrl,
              type: event.type === "removed" ? "removed" : event.type,
              actorName: event.actorName,
              snippet: event.snippet ?? "",
              link: event.link,
            }),
          );
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
