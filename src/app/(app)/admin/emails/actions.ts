"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { catalogEntry } from "@/lib/email-catalog";
import { forgetEmailCopy, loadEmailCopy, sendEmail } from "@/lib/email";
import { customizeEmail } from "@/lib/email-templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import type { ActionState } from "@/lib/types";

const copySchema = z.object({
  subject: z.string().trim().max(150, "Keep the subject under 150 characters"),
  heading: z.string().trim().max(150, "Keep the heading under 150 characters"),
  intro: z.string().trim().max(2000, "Keep the message under 2,000 characters"),
  button_label: z
    .string()
    .trim()
    .max(60, "Keep the button under 60 characters"),
  note: z.string().trim().max(2000, "Keep the note under 2,000 characters"),
});

function read(formData: FormData) {
  return copySchema.safeParse({
    subject: formData.get("subject") ?? "",
    heading: formData.get("heading") ?? "",
    intro: formData.get("intro") ?? "",
    button_label: formData.get("button_label") ?? "",
    note: formData.get("note") ?? "",
  });
}

export async function saveEmailCopy(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAdmin();
  const entry = catalogEntry(String(formData.get("key") ?? ""));
  if (!entry) return { error: "That email wasn't found." };
  const parsed = read(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const enabled = entry.optional ? formData.get("enabled") === "on" : true;

  const db = createAdminClient();
  const empty = Object.values(parsed.data).every((value) => !value) && enabled;
  const { error } = empty
    ? await db.from("email_copy").delete().eq("key", entry.key)
    : await db.from("email_copy").upsert({
        key: entry.key,
        ...parsed.data,
        enabled,
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      });
  if (error) return { error: "We couldn't save that. Please try again." };
  forgetEmailCopy();
  revalidatePath("/admin/emails");
  revalidatePath(`/admin/emails/${entry.key}`);
  return {
    message: empty
      ? "Back to the default wording."
      : enabled
        ? "Saved. New emails use this wording."
        : "Saved. This email is turned off.",
  };
}

export async function resetEmailCopy(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const entry = catalogEntry(String(formData.get("key") ?? ""));
  if (!entry) return { error: "That email wasn't found." };
  await createAdminClient().from("email_copy").delete().eq("key", entry.key);
  forgetEmailCopy();
  revalidatePath("/admin/emails");
  revalidatePath(`/admin/emails/${entry.key}`);
  return { message: "Back to the default wording." };
}

// Sends the sample with the saved wording to the admin who asked, even if the email is off.
export async function sendTestEmail(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { email } = await requireAdmin();
  const entry = catalogEntry(String(formData.get("key") ?? ""));
  if (!entry) return { error: "That email wasn't found." };
  const copy = (await loadEmailCopy(true)).get(entry.key);
  const sample = customizeEmail(entry.sample(getSiteUrl()), copy);
  // Strip the key so sendEmail sends it as-is (wording already applied, and "off" doesn't block tests).
  const ok = await sendEmail(email, {
    subject: `[Test] ${sample.subject}`,
    html: sample.html,
    text: sample.text,
  });
  return ok
    ? { message: `Test sent to ${email}. It uses example details.` }
    : { error: "The test email didn't send." };
}
