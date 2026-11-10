"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccount } from "@/lib/auth";
import { COACH_REPORT_REASONS } from "@/lib/reviews";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

const reportSchema = z.object({
  reason: z.enum(
    COACH_REPORT_REASONS.map((r) => r.value) as [string, ...string[]],
  ),
  details: z.string().trim().max(1000, "Keep details to 1,000 characters."),
});

// Reports go to GYMX2's admins. The coach never sees who reported them.
export async function reportCoach(
  coachId: string,
  input: { reason: string; details: string },
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse(coachId);
  const parsed = reportSchema.safeParse(input);
  if (!id.success || id.data === profile.id)
    return { error: "Coach not found." };
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("coach_reports").insert({
    reporter_id: profile.id,
    coach_id: id.data,
    reason: parsed.data.reason,
    details: parsed.data.details,
  });
  if (error && error.code !== "23505")
    return { error: "We couldn't send your report. Please try again." };
  revalidatePath("/admin/reports");
  return {};
}

// Blocking hides the coach from discovery and stops joins and intros. It's private: the coach
// isn't told and can't see it.
export async function blockCoach(coachId: string): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  if (profile.role !== "member")
    return { error: "Only members can block coaches." };
  const id = idSchema.safeParse(coachId);
  if (!id.success) return { error: "Coach not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("block_coach", {
    target_coach_id: id.data,
  });
  if (error)
    return {
      error: error.message.includes("Leave this coach")
        ? "Leave this coach first (from their profile), then block them."
        : "We couldn't block this coach. Please try again.",
    };
  revalidatePath("/coaches");
  revalidatePath(`/coaches/${id.data}`);
  revalidatePath("/calendar");
  return {};
}

export async function unblockCoach(
  coachId: string,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse(coachId);
  if (!id.success) return { error: "Coach not found." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("coach_blocks")
    .delete()
    .eq("member_id", profile.id)
    .eq("coach_id", id.data);
  if (error)
    return { error: "We couldn't unblock this coach. Please try again." };
  revalidatePath("/coaches");
  revalidatePath(`/coaches/${id.data}`);
  return {};
}
