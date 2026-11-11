import "server-only";
import { catalogEntry } from "@/lib/email-catalog";
import {
  customizeEmail,
  type Email,
  type EmailCopy,
} from "@/lib/email-templates";
import type { Locale } from "@/i18n/config";
import { createAdminClient } from "@/lib/supabase/admin";

const FROM = "GYMX2 <no-reply@gymx2.com>";

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export type StoredEmailCopy = EmailCopy & {
  key: string;
  enabled: boolean;
  updated_at: string;
};

// Admins' wording for the automatic emails, cached briefly so a burst of emails reads it once.
let copyCache: { at: number; rows: Map<string, StoredEmailCopy> } | null = null;

export async function loadEmailCopy(fresh = false) {
  if (!fresh && copyCache && Date.now() - copyCache.at < 60_000)
    return copyCache.rows;
  const { data, error } = await createAdminClient()
    .from("email_copy")
    .select(
      "key, subject, heading, intro, button_label, note, enabled, updated_at",
    );
  // If the wording can't be read, the default wording still goes out.
  const rows = new Map(
    ((error ? [] : data) ?? []).map((row) => [
      row.key as string,
      row as StoredEmailCopy,
    ]),
  );
  copyCache = { at: Date.now(), rows };
  return rows;
}

export function forgetEmailCopy() {
  copyCache = null;
}

// Sends one email through Resend. Never throws: a failed email must not undo the order,
// message or session that triggered it. Admins' wording is applied here, and optional
// emails they turned off are skipped.
export async function sendEmail(to: string, original: Email) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  let email = original;
  if (original.key) {
    const copy = (await loadEmailCopy().catch(() => null))?.get(original.key);
    if (copy && !copy.enabled && catalogEntry(original.key)?.optional)
      return false;
    // Admins write custom wording in English, so Spanish emails keep the translated default.
    if (original.locale !== "es") email = customizeEmail(original, copy);
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    if (!response.ok) {
      console.error(
        `Email "${email.subject}" failed with ${response.status}: ${await response.text()}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

// The sign-in email of a person, and whether they want optional updates (messages and sessions).
export async function loadRecipient(userId: string) {
  const admin = createAdminClient();
  const [{ data: user }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin
      .from("profiles")
      .select("display_name, email_updates, locale")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  const email = user?.user?.email;
  if (!email || !profile) return null;
  return {
    email,
    name: profile.display_name as string,
    wantsUpdates: profile.email_updates !== false,
    locale: (profile.locale === "es" ? "es" : "en") as Locale,
  };
}
