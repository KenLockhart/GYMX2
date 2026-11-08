"use server";

import { revalidatePath } from "next/cache";
import { requireCoach } from "@/lib/auth";
import { isValidSlug } from "@/lib/public-pages";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

export async function savePublicPage(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireCoach();
  const slug = String(formData.get("public_slug") ?? "")
    .trim()
    .toLowerCase();
  const on = formData.get("public_page") === "on";
  if (!isValidSlug(slug)) {
    return {
      error:
        "Use 3 to 40 lowercase letters, numbers and single dashes, like ken-lockhart.",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ public_slug: slug, public_page: on })
    .eq("id", profile.id);
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Another coach already has that address. Try another."
          : "We couldn't save that.",
    };
  }
  revalidatePath("/profile");
  if (profile.public_slug) revalidatePath(`/c/${profile.public_slug}`);
  revalidatePath(`/c/${slug}`);
  revalidatePath("/sitemap.xml");
  return {
    message: on
      ? `Your page is live at gymx2.com/c/${slug}`
      : "Saved. Your page is off.",
  };
}
