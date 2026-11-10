"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccount } from "@/lib/auth";
import { NOTIFICATION_SETTINGS } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

// Row security limits all of these to the signed-in person's own notifications, and the
// database only lets read_at change.

export async function unreadNotificationCount(): Promise<number> {
  const { profile } = await requireAccount();
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", profile.id)
    .is("read_at", null);
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { profile } = await requireAccount();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("recipient_id", profile.id)
    .is("read_at", null);
}

export async function markAllNotificationsRead(): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", profile.id)
    .is("read_at", null);
  if (error) return { error: "That didn't work. Please try again." };
  revalidatePath("/notifications");
  return {};
}

const settingTypes = NOTIFICATION_SETTINGS.map((s) => s.type) as [
  (typeof NOTIFICATION_SETTINGS)[number]["type"],
  ...(typeof NOTIFICATION_SETTINGS)[number]["type"][],
];

const settingsSchema = z
  .array(
    z.object({
      type: z.enum(settingTypes),
      inApp: z.boolean(),
      push: z.boolean(),
      email: z.boolean(),
    }),
  )
  .max(settingTypes.length);

export async function saveNotificationSettings(
  input: unknown,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Those settings didn't look right." };
  const supabase = await createClient();
  const { error } = await supabase.from("notification_settings").upsert(
    parsed.data.map((setting) => ({
      user_id: profile.id,
      type: setting.type,
      // Direct messages don't appear in the notification center.
      in_app: setting.type === "message" ? true : setting.inApp,
      push: setting.push,
      email: setting.email,
    })),
    { onConflict: "user_id,type" },
  );
  if (error) return { error: "We couldn't save your settings." };
  revalidatePath("/profile");
  return {};
}
