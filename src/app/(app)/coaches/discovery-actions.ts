"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

// Saving and passing are private to the member (row security), and only coaches can be saved.
async function setFlag(
  table: "coach_favorites" | "coach_passes",
  coachId: string,
  on: boolean,
) {
  const { profile } = await requireAccount();
  if (profile.role !== "member")
    return { error: "Saving coaches is for members." };
  const id = idSchema.safeParse(coachId);
  if (!id.success) return { error: "Coach not found." };
  const supabase = await createClient();
  const { error } = on
    ? await supabase
        .from(table)
        .upsert(
          { member_id: profile.id, coach_id: id.data },
          { onConflict: "member_id,coach_id", ignoreDuplicates: true },
        )
    : await supabase
        .from(table)
        .delete()
        .eq("member_id", profile.id)
        .eq("coach_id", id.data);
  if (error) return { error: "That didn't work. Please try again." };
  revalidatePath("/coaches");
  return {};
}

export async function setSaved(
  coachId: string,
  saved: boolean,
): Promise<{ error?: string }> {
  return setFlag("coach_favorites", coachId, saved);
}

export async function setPassed(
  coachId: string,
  passed: boolean,
): Promise<{ error?: string }> {
  return setFlag("coach_passes", coachId, passed);
}
