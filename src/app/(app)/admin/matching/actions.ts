"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { validWeights } from "@/lib/matching";
import { createClient } from "@/lib/supabase/server";

export async function saveMatchWeights(
  weights: Record<string, unknown>,
): Promise<{ error?: string }> {
  const { profile } = await requireAdmin();
  if (!weights || typeof weights !== "object" || !validWeights(weights))
    return { error: "Use whole numbers that add up to 100." };
  const supabase = await createClient();
  // Row security: only admins can change the weights.
  const { data, error } = await supabase
    .from("match_settings")
    .update({
      weights,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true)
    .select("id");
  if (error || !data?.length) return { error: "We couldn't save the weights." };
  revalidatePath("/admin/matching");
  revalidatePath("/coaches");
  return {};
}
