"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { idSchema } from "@/lib/validation";

export async function joinCoach(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireAccount();
  const coachId = idSchema.safeParse(formData.get("coach_id"));
  if (!coachId.success) return { error: "Choose a coach." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("coach_members")
    .insert({ coach_id: coachId.data, member_id: profile.id });

  // Pressing Join twice shouldn't look like a failure.
  if (error && error.code !== "23505") {
    return { error: "We couldn't join that coach. Please try again." };
  }

  revalidatePath("/", "layout");
  return {};
}

export async function leaveCoach(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireAccount();
  const coachId = idSchema.safeParse(formData.get("coach_id"));
  if (!coachId.success) return { error: "Choose a coach." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("coach_members")
    .delete()
    .eq("coach_id", coachId.data)
    .eq("member_id", profile.id);
  if (error) return { error: "We couldn't leave that coach. Please try again." };

  revalidatePath("/", "layout");
  return {};
}
