"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAccount } from "@/lib/auth";
import { GOAL_VALUES } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

const answersSchema = z.object({
  goals: z.array(z.enum(GOAL_VALUES)).min(1, "Pick at least one goal").max(10),
  experience: z.enum(["new", "some", "experienced"], {
    error: "Pick your experience",
  }),
  focus: z.enum(["mind", "body", "spirit"], { error: "Pick your main focus" }),
});

function readAnswers(formData: FormData) {
  return answersSchema.safeParse({
    goals: [...new Set(formData.getAll("goals"))],
    experience: formData.get("experience") ?? undefined,
    focus: formData.get("focus") ?? undefined,
  });
}

// First time through: save, then show matching coaches.
export async function saveOnboarding(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  const parsed = readAnswers(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      ...parsed.data,
      onboarded_at: profile.onboarded_at ?? new Date().toISOString(),
    })
    .eq("id", profile.id);
  if (error)
    return { error: "We couldn't save your answers. Please try again." };
  revalidatePath("/", "layout");
  redirect("/welcome/matches");
}

// From the profile page: save and stay.
export async function updateGoals(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  const parsed = readAnswers(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      ...parsed.data,
      onboarded_at: profile.onboarded_at ?? new Date().toISOString(),
    })
    .eq("id", profile.id);
  if (error) return { error: "We couldn't save your goals. Please try again." };
  revalidatePath("/", "layout");
  return { message: "Goals saved." };
}

export async function skipOnboarding() {
  const { profile } = await requireAccount();
  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", profile.id);
  redirect("/dashboard");
}

const specialtiesSchema = z.array(z.enum(GOAL_VALUES)).max(10);

export async function updateSpecialties(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  if (profile.role !== "coach")
    return { error: "Only coaches have specialties." };
  const parsed = specialtiesSchema.safeParse([
    ...new Set(formData.getAll("specialties")),
  ]);
  if (!parsed.success) return { error: "Pick from the list." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ specialties: parsed.data })
    .eq("id", profile.id);
  if (error)
    return { error: "We couldn't save your specialties. Please try again." };
  revalidatePath("/", "layout");
  return {
    message:
      "Specialties saved. Members with these goals will see you suggested.",
  };
}
