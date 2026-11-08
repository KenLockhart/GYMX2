"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { isPillar } from "@/lib/achievements";
import { syncProgressQuietly } from "@/lib/achievements-data";
import { fileExtension } from "@/lib/armory";
import { requireAccount } from "@/lib/auth";
import { MAX_PHOTO_BYTES, PHOTO_POSES, PHOTO_TYPES } from "@/lib/photos";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MAX_HABITS, isEditableDay, parseMeasure } from "@/lib/tracking";
import type { ActionState } from "@/lib/types";
import { idSchema } from "@/lib/validation";

async function trackingAccount() {
  const account = await requireAccount();
  if (account.profile.role === "admin") throw new Error("Admins don't track.");
  return account;
}

function done(message?: string): ActionState {
  revalidatePath("/track");
  return message ? { message } : {};
}

export async function addHabit(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await trackingAccount();
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 60);
  const pillar = formData.get("pillar");
  if (!name) return { error: "Name the habit." };
  if (!isPillar(pillar)) return { error: "Choose Mind, Body or Spirit." };

  const supabase = await createClient();
  const { count } = await supabase
    .from("habits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .eq("active", true);
  if ((count ?? 0) >= MAX_HABITS)
    return {
      error: `Keep it to ${MAX_HABITS} habits. Remove one to add another.`,
    };

  const { error } = await supabase
    .from("habits")
    .insert({ user_id: profile.id, name, pillar });
  if (error) return { error: "We couldn't add that habit. Please try again." };
  return done();
}

export async function removeHabit(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await trackingAccount();
  const id = idSchema.safeParse(formData.get("habit_id"));
  if (!id.success) return { error: "Choose a habit." };
  const supabase = await createClient();
  // Hidden rather than deleted, so past check-ins still count toward streaks and badges.
  const { error } = await supabase
    .from("habits")
    .update({ active: false })
    .eq("id", id.data);
  if (error)
    return { error: "We couldn't remove that habit. Please try again." };
  return done();
}

// Checks a habit off (or un-checks it) for one of the last seven days.
export async function setHabitDone(
  habitId: string,
  day: string,
  isDone: boolean,
): Promise<{ error?: string }> {
  const { profile } = await trackingAccount();
  if (!idSchema.safeParse(habitId).success || !isEditableDay(day))
    return { error: "You can only update the last 7 days." };

  const supabase = await createClient();
  const { error } = isDone
    ? await supabase
        .from("habit_logs")
        .insert({ habit_id: habitId, user_id: profile.id, day })
    : await supabase
        .from("habit_logs")
        .delete()
        .eq("habit_id", habitId)
        .eq("day", day);
  // 23505: already checked off, which is fine.
  if (error && error.code !== "23505")
    return { error: "We couldn't save that. Please try again." };

  if (isDone) after(() => syncProgressQuietly(profile));
  revalidatePath("/track");
  return {};
}

export async function saveBodyLog(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await trackingAccount();
  const day = String(formData.get("day") ?? "");
  if (!isEditableDay(day)) return { error: "You can log the last 7 days." };
  const weight = parseMeasure(formData.get("weight_lb"));
  const bodyFat = parseMeasure(formData.get("body_fat_pct"));
  const waist = parseMeasure(formData.get("waist_in"));
  if ([weight, bodyFat, waist].some((value) => Number.isNaN(value))) {
    return { error: "Use numbers with up to one decimal, like 182.4." };
  }
  if (weight !== null && (weight < 50 || weight > 800))
    return { error: "Enter a weight between 50 and 800 lb." };
  if (bodyFat !== null && (bodyFat < 2 || bodyFat > 70))
    return { error: "Enter body fat between 2% and 70%." };
  if (waist !== null && (waist < 15 || waist > 80))
    return { error: "Enter a waist between 15 and 80 inches." };

  const supabase = await createClient();
  if (weight === null && bodyFat === null && waist === null) {
    await supabase
      .from("body_logs")
      .delete()
      .eq("user_id", profile.id)
      .eq("day", day);
    return done("Cleared.");
  }
  const { error } = await supabase
    .from("body_logs")
    .upsert(
      {
        user_id: profile.id,
        day,
        weight_lb: weight,
        body_fat_pct: bodyFat,
        waist_in: waist,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" },
    );
  if (error) return { error: "We couldn't save that. Please try again." };
  return done("Saved.");
}

function wholeNumber(value: FormDataEntryValue | null, max: number) {
  const text = typeof value === "string" ? value.trim().replace(/,/g, "") : "";
  if (text === "") return null;
  if (!/^\d+$/.test(text) || Number(text) > max) return Number.NaN;
  return Number(text);
}

export async function saveNutritionLog(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await trackingAccount();
  const day = String(formData.get("day") ?? "");
  if (!isEditableDay(day)) return { error: "You can log the last 7 days." };
  const protein = wholeNumber(formData.get("protein_g"), 1000);
  const calories = wholeNumber(formData.get("calories"), 20000);
  const water = wholeNumber(formData.get("water_glasses"), 50);
  if ([protein, calories, water].some((value) => Number.isNaN(value))) {
    return { error: "Use whole numbers, like 150." };
  }
  const notes = String(formData.get("notes") ?? "")
    .trim()
    .slice(0, 500);

  const supabase = await createClient();
  const { error } = await supabase
    .from("nutrition_logs")
    .upsert(
      {
        user_id: profile.id,
        day,
        protein_g: protein,
        calories,
        water_glasses: water,
        notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,day" },
    );
  if (error) return { error: "We couldn't save that. Please try again." };
  return done("Saved.");
}

export async function saveTrackingSettings(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await trackingAccount();
  const protein = wholeNumber(formData.get("protein_target_g"), 1000);
  const calories = wholeNumber(formData.get("calorie_target"), 20000);
  if (Number.isNaN(protein) || Number.isNaN(calories))
    return { error: "Use whole numbers for your targets." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      share_tracking: formData.get("share_tracking") === "on",
      protein_target_g: protein,
      calorie_target: calories,
    })
    .eq("id", profile.id);
  if (error)
    return { error: "We couldn't save your settings. Please try again." };
  revalidatePath("/", "layout");
  return done("Saved.");
}

// Progress photos upload straight from the browser to private storage, using a one-time link.
export async function prepareProgressPhoto(input: {
  fileName: string;
  size: number;
}): Promise<{ error?: string; path?: string; token?: string }> {
  const { profile } = await trackingAccount();
  const extension = fileExtension(input.fileName);
  if (!(extension in PHOTO_TYPES)) return { error: "Use a JPG, PNG or WebP photo." };
  if (input.size > MAX_PHOTO_BYTES) return { error: "Photos can be up to 10 MB." };
  const path = `${profile.id}/${randomUUID()}.${extension}`;
  const { data, error } = await createAdminClient().storage.from("progress-photos").createSignedUploadUrl(path);
  if (error || !data) return { error: "We couldn't start the upload. Please try again." };
  return { path: data.path, token: data.token };
}

export async function saveProgressPhoto(input: { path: string; pose: string; day: string }): Promise<{ error?: string }> {
  const { profile } = await trackingAccount();
  if (!PHOTO_POSES.some((pose) => pose.value === input.pose)) return { error: "Choose front, side, back or other." };
  if (!isEditableDay(input.day)) return { error: "You can add photos for the last 7 days." };
  if (!input.path.startsWith(`${profile.id}/`)) return { error: "That upload didn't work. Please try again." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("progress_photos")
    .insert({ user_id: profile.id, path: input.path, pose: input.pose, day: input.day });
  if (error) return { error: "We couldn't save that photo. Please try again." };
  revalidatePath("/track");
  return {};
}

export async function deleteProgressPhoto(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await trackingAccount();
  const id = idSchema.safeParse(formData.get("photo_id"));
  if (!id.success) return { error: "Choose a photo." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("progress_photos")
    .delete()
    .eq("id", id.data)
    .eq("user_id", profile.id)
    .select("path")
    .maybeSingle();
  if (!data) return { error: "We couldn't delete that photo." };
  await createAdminClient().storage.from("progress-photos").remove([data.path as string]);
  return done("Deleted.");
}
