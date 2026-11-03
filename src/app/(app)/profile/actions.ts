"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { profileSchema } from "@/lib/validation";

export async function updateProfile(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireAccount();

  const parsed = profileSchema.safeParse({
    display_name: formData.get("display_name") ?? "",
    bio: formData.get("bio") ?? "",
    // Only members can ask to become coaches.
    coach_requested: profile.role === "member" && formData.get("coach_requested") === "on",
    instagram_url: formData.get("instagram_url") ?? "",
    tiktok_url: formData.get("tiktok_url") ?? "",
    youtube_url: formData.get("youtube_url") ?? "",
    x_url: formData.get("x_url") ?? "",
    website_url: formData.get("website_url") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", profile.id);
  if (error) return { error: "We couldn't save your profile. Please try again." };

  revalidatePath("/", "layout");
  return { message: "Profile saved." };
}
