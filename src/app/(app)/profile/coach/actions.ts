"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireCoach } from "@/lib/auth";
import {
  coachDraftSchema,
  profileCompletion,
  profileWarnings,
  readDraft,
} from "@/lib/coach-draft";
import { PHOTO_BUCKET } from "@/lib/coach-profile-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const PHOTO_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// Autosave. Row security limits the write to the coach's own draft, and only the content columns
// can be written; review status is changed only by the database functions.
export async function saveCoachDraft(
  input: unknown,
): Promise<{ error?: string; savedAt?: string }> {
  const { profile } = await requireCoach();
  const parsed = coachDraftSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: `${issue.path.join(" › ") || "Profile"}: ${issue.message}`,
    };
  }
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("coach_profile_drafts")
    .select("coach_id")
    .eq("coach_id", profile.id)
    .maybeSingle();
  const { error } = existing
    ? await supabase
        .from("coach_profile_drafts")
        .update({ data: parsed.data })
        .eq("coach_id", profile.id)
    : await supabase
        .from("coach_profile_drafts")
        .insert({ coach_id: profile.id, data: parsed.data });
  if (error) return { error: "We couldn't save. Check your connection." };
  return { savedAt: new Date().toISOString() };
}

export async function prepareCoachPhoto(file: {
  name: string;
  size: number;
}): Promise<{ error?: string; path?: string; token?: string }> {
  const { profile } = await requireCoach();
  const extension =
    String(file?.name ?? "")
      .split(".")
      .pop()
      ?.toLowerCase() ?? "";
  if (!(extension in PHOTO_TYPES))
    return { error: "Use a JPG, PNG or WebP photo." };
  if (!(file.size > 0) || file.size > MAX_PHOTO_BYTES)
    return { error: "Photos can be up to 5 MB." };
  const { data, error } = await createAdminClient()
    .storage.from(PHOTO_BUCKET)
    .createSignedUploadUrl(`${profile.id}/${randomUUID()}.${extension}`);
  if (error || !data) return { error: "We couldn't start the upload." };
  return { path: data.path, token: data.token };
}

// Points the draft at an uploaded photo (or removes it). The file must be the coach's own upload.
export async function setCoachPhoto(
  path: string | null,
): Promise<{ error?: string; url?: string | null }> {
  const { profile } = await requireCoach();
  const admin = createAdminClient();
  if (path !== null) {
    if (
      typeof path !== "string" ||
      !new RegExp(`^${profile.id}/[0-9a-f-]{36}\\.(jpg|jpeg|png|webp)$`).test(
        path,
      )
    )
      return { error: "That photo upload didn't work." };
    const { data: files } = await admin.storage
      .from(PHOTO_BUCKET)
      .list(profile.id, { search: path.split("/")[1] });
    if (!files?.some((file) => `${profile.id}/${file.name}` === path))
      return { error: "The photo didn't finish uploading. Please try again." };
  }
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("coach_profile_drafts")
    .select("coach_id")
    .eq("coach_id", profile.id)
    .maybeSingle();
  const { error } = existing
    ? await supabase
        .from("coach_profile_drafts")
        .update({ photo_path: path })
        .eq("coach_id", profile.id)
    : await supabase
        .from("coach_profile_drafts")
        .insert({ coach_id: profile.id, data: {}, photo_path: path });
  if (error) return { error: "We couldn't save the photo." };
  if (!path) return { url: null };
  const { data } = await admin.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return { url: data?.signedUrl ?? null };
}

export async function submitCoachProfile(): Promise<{ error?: string }> {
  const { profile } = await requireCoach();
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_profile_drafts")
    .select("data, photo_path")
    .eq("coach_id", profile.id)
    .maybeSingle();
  if (!data) return { error: "Fill in your profile first." };
  const draft = readDraft(data.data);
  const completion = profileCompletion(draft, Boolean(data.photo_path));
  if (!completion.ready)
    return {
      error: `Still needed: ${completion.missingRequired.map((c) => c.label.toLowerCase()).join(", ")}.`,
    };
  const warnings = profileWarnings(draft);
  if (warnings.length) return { error: warnings.join(" ") };
  const { error } = await supabase.rpc("submit_coach_profile");
  if (error)
    return {
      error:
        error.code === "P0001"
          ? `${error.message}.`
          : "We couldn't submit. Please try again.",
    };
  revalidatePath("/profile/coach");
  revalidatePath("/admin/coach-profiles");
  return {};
}

export async function unpublishMyProfile(): Promise<{ error?: string }> {
  const { profile } = await requireCoach();
  const supabase = await createClient();
  const { error } = await supabase.rpc("unpublish_coach_profile", {
    target_coach_id: profile.id,
  });
  if (error) return { error: "We couldn't take your profile down." };
  revalidatePath("/profile/coach");
  revalidatePath(`/coaches/${profile.id}`);
  return {};
}
