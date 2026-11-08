import "server-only";
import type { Email } from "@/lib/email-templates";
import { createAdminClient } from "@/lib/supabase/admin";

const FROM = "GYMX2 <no-reply@gymx2.com>";

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

// Sends one email through Resend. Never throws: a failed email must not undo the order,
// message or session that triggered it.
export async function sendEmail(to: string, email: Email) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject: email.subject, html: email.html, text: email.text }),
    });
    if (!response.ok) {
      console.error(`Email "${email.subject}" failed with ${response.status}: ${await response.text()}`);
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
    admin.from("profiles").select("display_name, email_updates").eq("id", userId).maybeSingle(),
  ]);
  const email = user?.user?.email;
  if (!email || !profile) return null;
  return {
    email,
    name: profile.display_name as string,
    wantsUpdates: profile.email_updates !== false,
  };
}
