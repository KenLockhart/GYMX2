"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccount, requireAdmin } from "@/lib/auth";
import { REVIEW_MAX } from "@/lib/public-pages";
import { REVIEW_CATEGORIES, REVIEW_REPORT_REASONS } from "@/lib/reviews";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { idSchema } from "@/lib/validation";

// Category ratings are optional: blank means "not rated".
const categoryRating = z
  .union([z.literal(""), z.coerce.number().int().min(1).max(5)])
  .transform((value) => (value === "" ? null : value));

const reviewSchema = z.object({
  coach_id: idSchema,
  rating: z.coerce.number().int().min(1, "Pick a star rating").max(5),
  body: z.string().trim().max(REVIEW_MAX),
  rating_communication: categoryRating,
  rating_knowledge: categoryRating,
  rating_motivation: categoryRating,
  rating_results: categoryRating,
  rating_value: categoryRating,
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
    ...Object.fromEntries(
      REVIEW_CATEGORIES.map((c) => [c.column, formData.get(c.column) ?? ""]),
    ),
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
          rating_communication: parsed.data.rating_communication,
          rating_knowledge: parsed.data.rating_knowledge,
          rating_motivation: parsed.data.rating_motivation,
          rating_results: parsed.data.rating_results,
          rating_value: parsed.data.rating_value,
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

// The coach's public reply to a review. An empty reply removes it.
export async function replyToReview(
  reviewId: string,
  reply: string,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  if (profile.role !== "coach") return { error: "Only the coach can reply." };
  const id = idSchema.safeParse(reviewId);
  const text = z
    .string()
    .trim()
    .max(1000, "Keep your reply to 1,000 characters.")
    .safeParse(reply ?? "");
  if (!id.success) return { error: "That review wasn't found." };
  if (!text.success) return { error: text.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reply_to_review", {
    target_review_id: id.data,
    reply_text: text.data,
  });
  if (error) return { error: "We couldn't save your reply. Please try again." };
  await refreshCoach(profile.id);
  revalidatePath("/profile/coach/reviews");
  return {};
}

const reportSchema = z.object({
  reason: z.enum(
    REVIEW_REPORT_REASONS.map((r) => r.value) as [string, ...string[]],
  ),
  details: z.string().trim().max(1000, "Keep details to 1,000 characters."),
});

// Anyone who can see a review (except its writer) can report it to GYMX2's admins.
export async function reportReview(
  reviewId: string,
  input: { reason: string; details: string },
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse(reviewId);
  const parsed = reportSchema.safeParse(input);
  if (!id.success) return { error: "That review wasn't found." };
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("review_reports").insert({
    reporter_id: profile.id,
    review_id: id.data,
    reason: parsed.data.reason,
    details: parsed.data.details,
  });
  // Already reported and still open counts as done.
  if (error && error.code !== "23505")
    return {
      error:
        error.code === "42501"
          ? "You can't report this review."
          : "We couldn't send your report. Please try again.",
    };
  revalidatePath("/admin/reports");
  return {};
}
