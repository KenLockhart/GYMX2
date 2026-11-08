import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

export type PushMessage = {
  title: string;
  body: string;
  url: string; // a path on GYMX2 to open when tapped
  tag?: string; // a newer push with the same tag replaces the older one
};

let configured: boolean | null = null;

export function isPushConfigured() {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  configured = Boolean(publicKey && privateKey);
  if (configured)
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:support@gymx2.com",
      publicKey!,
      privateKey!,
    );
  return configured;
}

const trim = (text: string, length: number) => {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > length ? `${oneLine.slice(0, length - 1)}…` : oneLine;
};

// Sends to every device these people turned notifications on for. Devices the browser has
// retired are forgotten. Never throws: a missed push must not break what triggered it.
export async function sendPush(userIds: string[], message: PushMessage) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0 || !isPushConfigured()) return 0;
  const db = createAdminClient();
  try {
    const { data } = await db
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", ids);
    const payload = JSON.stringify({
      title: trim(message.title, 80),
      body: trim(message.body, 160),
      url: message.url.startsWith("/") ? message.url : "/dashboard",
      tag: message.tag,
    });
    let sent = 0;
    const gone: string[] = [];
    await Promise.all(
      (data ?? []).map(async (row) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: row.endpoint as string,
              keys: { p256dh: row.p256dh as string, auth: row.auth as string },
            },
            payload,
            { TTL: 60 * 60 * 12, urgency: "normal" },
          );
          sent += 1;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(row.id as string);
          else console.error("Push failed", status ?? error);
        }
      }),
    );
    if (gone.length)
      await db.from("push_subscriptions").delete().in("id", gone);
    return sent;
  } catch (error) {
    console.error("Push failed", error);
    return 0;
  }
}
