"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

// The database checks the caller is an admin; these only tidy up the input.
export async function decideReviewReport(
  reportId: string,
  decision: "hidden" | "dismissed",
): Promise<{ error?: string }> {
  await requireAdmin();
  const id = idSchema.safeParse(reportId);
  if (!id.success) return { error: "Report not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("handle_review_report", {
    target_report_id: id.data,
    decision,
  });
  if (error) return { error: "That didn't work. Please try again." };
  revalidatePath("/admin/reports");
  revalidatePath("/admin/reviews");
  return {};
}

export async function decideCoachReport(
  reportId: string,
  decision: "actioned" | "dismissed",
  note: string,
): Promise<{ error?: string }> {
  await requireAdmin();
  const id = idSchema.safeParse(reportId);
  if (!id.success) return { error: "Report not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("handle_coach_report", {
    target_report_id: id.data,
    decision,
    note: String(note ?? "").slice(0, 1000),
  });
  if (error) return { error: "That didn't work. Please try again." };
  revalidatePath("/admin/reports");
  return {};
}
