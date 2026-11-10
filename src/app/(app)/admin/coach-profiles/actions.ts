"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

const reviewSchema = z.object({
  coachId: idSchema,
  approve: z.boolean(),
  note: z.string().trim().max(1000),
});

// Approving publishes exactly the draft the admin reviewed; the database checks admin rights.
export async function reviewCoachProfile(
  input: unknown,
): Promise<{ error?: string }> {
  await requireAdmin();
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { error: "Something's missing." };
  if (!parsed.data.approve && !parsed.data.note)
    return { error: "Tell the coach what to change." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_coach_profile", {
    target_coach_id: parsed.data.coachId,
    approve: parsed.data.approve,
    note: parsed.data.note,
  });
  if (error)
    return {
      error: error.code === "P0001" ? `${error.message}.` : "That didn't work.",
    };
  revalidatePath("/admin/coach-profiles");
  revalidatePath(`/coaches/${parsed.data.coachId}`);
  return {};
}

export async function unpublishCoachProfile(
  coachId: string,
): Promise<{ error?: string }> {
  await requireAdmin();
  const id = idSchema.safeParse(coachId);
  if (!id.success) return { error: "Coach not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("unpublish_coach_profile", {
    target_coach_id: id.data,
  });
  if (error) return { error: "That didn't work." };
  revalidatePath("/admin/coach-profiles");
  revalidatePath(`/coaches/${id.data}`);
  return {};
}
