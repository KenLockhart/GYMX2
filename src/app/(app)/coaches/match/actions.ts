"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import { answersSchema } from "@/lib/match-questions";
import { createClient } from "@/lib/supabase/server";

// Saves progress as the member goes, and marks the questionnaire done at the end. Row security keeps
// answers private to the member; only members can save them.
export async function saveMatchAnswers(
  answers: unknown,
  complete: boolean,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  if (profile.role !== "member")
    return { error: "The questionnaire is for members." };
  const parsed = answersSchema.safeParse(answers);
  if (!parsed.success)
    return { error: "One of those answers didn't look right." };
  const supabase = await createClient();
  const row = {
    member_id: profile.id,
    answers: parsed.data,
    updated_at: new Date().toISOString(),
    ...(complete ? { completed_at: new Date().toISOString() } : {}),
  };
  const { error } = await supabase
    .from("member_match_preferences")
    .upsert(row, { onConflict: "member_id" });
  if (error)
    return { error: "We couldn't save your answers. Please try again." };
  revalidatePath("/coaches/match");
  revalidatePath("/coaches");
  return {};
}

export async function deleteMatchAnswers(): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const supabase = await createClient();
  const { error } = await supabase
    .from("member_match_preferences")
    .delete()
    .eq("member_id", profile.id);
  if (error) return { error: "That didn't work. Please try again." };
  revalidatePath("/coaches/match");
  revalidatePath("/coaches");
  return {};
}
