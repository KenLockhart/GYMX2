"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  deleteAccount,
  deletionBlocker,
  passwordMatches,
} from "@/lib/account-deletion";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { profileSchema } from "@/lib/validation";

export async function updateProfile(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();

  const parsed = profileSchema.safeParse({
    display_name: formData.get("display_name") ?? "",
    bio: formData.get("bio") ?? "",
    // Only members can ask to become coaches.
    coach_requested:
      profile.role === "member" && formData.get("coach_requested") === "on",
    instagram_url: formData.get("instagram_url") ?? "",
    tiktok_url: formData.get("tiktok_url") ?? "",
    youtube_url: formData.get("youtube_url") ?? "",
    x_url: formData.get("x_url") ?? "",
    website_url: formData.get("website_url") ?? "",
    email_updates: formData.get("email_updates") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update(parsed.data)
    .eq("id", profile.id);
  if (error)
    return { error: "We couldn't save your profile. Please try again." };

  revalidatePath("/", "layout");
  return { message: "Profile saved." };
}

// Deletes the signed-in person's account after they confirm with their password.
export async function deleteMyAccount(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile, email } = await requireAccount();
  const confirmation = String(formData.get("confirm") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // DELETE, or ELIMINAR on the Spanish screen.
  if (confirmation !== "DELETE" && confirmation !== "ELIMINAR")
    return { error: "Type DELETE in capital letters to confirm." };
  if (!password) return { error: "Enter your password." };

  const blocker = await deletionBlocker(profile);
  if (blocker) return { error: blocker };
  if (!(await passwordMatches(email, password)))
    return { error: "That password isn't right." };

  // Sign out here first so the browser forgets the session, then remove everything.
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const deleted = await deleteAccount({
    id: profile.id,
    email,
    name: profile.display_name,
  });
  if (!deleted) {
    return {
      error:
        "We couldn't delete your account. Please email support@gymx2.com and we'll do it for you.",
    };
  }
  redirect("/account-deleted");
}
