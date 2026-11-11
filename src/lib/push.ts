import "server-only";
import webpush from "web-push";
import { isLocale, type Locale } from "@/i18n/config";
import { translate } from "@/i18n/phrases";
import { createAdminClient } from "@/lib/supabase/admin";

// Text for a push. A plain string is sent as it is (someone's own words). { text, vars } is
// GYMX2's English wording, sent in each person's own language with {placeholders} filled in.
export type PushText =
  string | { text: string; vars?: Record<string, string | number> };

export type PushMessage = {
  title: PushText;
  body: PushText;
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
    const [{ data }, { data: people }] = await Promise.all([
      db
        .from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh, auth")
        .in("user_id", ids),
      db.from("profiles").select("id, locale").in("id", ids),
    ]);
    const localeOf = new Map(
      (people ?? []).map((person) => [
        person.id as string,
        (isLocale(person.locale) ? person.locale : "en") as Locale,
      ]),
    );
    const say = (text: PushText, locale: Locale) =>
      typeof text === "string" ? text : translate(text.text, locale, text.vars);
    const payloads = new Map<Locale, string>();
    const payloadFor = (locale: Locale) => {
      if (!payloads.has(locale))
        payloads.set(
          locale,
          JSON.stringify({
            title: trim(say(message.title, locale), 80),
            body: trim(say(message.body, locale), 160),
            url: message.url.startsWith("/") ? message.url : "/dashboard",
            tag: message.tag,
          }),
        );
      return payloads.get(locale)!;
    };
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
            payloadFor(localeOf.get(row.user_id as string) ?? "en"),
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
