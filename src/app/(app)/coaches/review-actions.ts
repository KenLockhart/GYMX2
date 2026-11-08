"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccount, requireAdmin } from "@/lib/auth";
import { REVIEW_MAX } from "@/lib/public-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { idSchema } from "@/lib/validation";

const reviewSchema = z.object({
  coach_id: idSchema,
  rating: z.coerce.number().int().min(1, "Pick a star rating").max(5),
  body: z.string().trim().max(REVIEW_MAX),
});

async function refreshCoach(coachId: string) {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("public_slug")
    .eq("id", coachId)
    .maybeSingle();
  revalidatePath(`/coaches/${coachId}`);
  if (data?.public_slug) revalidatePath(`/c/${data.public_slug}`);
}

export async function saveReview(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  if (profile.role !== "member")
    return { error: "Only members can review coaches." };
  const parsed = reviewSchema.safeParse({
    coach_id: formData.get("coach_id"),
    rating: formData.get("rating") ?? 0,
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("coach_reviews")
    .select("id")
    .eq("coach_id", parsed.data.coach_id)
    .eq("member_id", profile.id)
    .maybeSingle();
  const { error } = existing
    ? await supabase
        .from("coach_reviews")
        .update({
          rating: parsed.data.rating,
          body: parsed.data.body,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
    : await supabase
        .from("coach_reviews")
        .insert({ ...parsed.data, member_id: profile.id });
  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Join this coach before reviewing them."
          : "We couldn't save your review.",
    };
  }
  await refreshCoach(parsed.data.coach_id);
  return {
    message: existing ? "Review updated." : "Thanks! Your review is posted.",
  };
}

export async function deleteReview(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  const coachId = idSchema.safeParse(formData.get("coach_id"));
  if (!coachId.success) return { error: "That review wasn't found." };
  const supabase = await createClient();
  await supabase
    .from("coach_reviews")
    .delete()
    .eq("coach_id", coachId.data)
    .eq("member_id", profile.id);
  await refreshCoach(coachId.data);
  return { message: "Review removed." };
}

export async function setReviewHidden(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const id = idSchema.safeParse(formData.get("review_id"));
  if (!id.success) return { error: "That review wasn't found." };
  const hidden = formData.get("hidden") === "true";
  const db = createAdminClient();
  const { data } = await db
    .from("coach_reviews")
    .update({ hidden })
    .eq("id", id.data)
    .select("coach_id")
    .maybeSingle();
  if (data) await refreshCoach(data.coach_id as string);
  revalidatePath("/admin/reviews");
  return { message: hidden ? "Hidden from public pages." : "Visible again." };
}
