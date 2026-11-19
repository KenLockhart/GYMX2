"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import {
  deleteVideo as deleteStreamVideo,
  isStreamConfigured,
} from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { videoInUseError } from "@/lib/format";
import {
  DAILY_CONTENT_VIDEO_DELETE_BLOCKED,
  DAILY_FUEL_VIDEO_DELETE_BLOCKED,
} from "@/lib/daily-content";
import { idSchema, videoSchema } from "@/lib/validation";

async function videoInUseMessage(videoId: string) {
  const { count } = await createAdminClient()
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("video_id", videoId);
  return videoInUseError(count ?? 0);
}

export async function deleteVideo(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAccount();
  const videoId = idSchema.safeParse(formData.get("video_id"));
  if (!videoId.success) return { error: "Choose a video." };
  if (!isStreamConfigured())
    return { error: "We couldn't delete that video. Please try again." };

  // Reserve under the same videos-row lock used by Daily Content publication and
  // assignment/bookmark writes before making the provider request.
  const supabase = await createClient();
  const { data: reserved, error: reservationError } = await supabase.rpc(
    "reserve_daily_content_video_delete",
    { target_video_id: videoId.data },
  );
  if (reservationError) {
    if (reservationError.code === "23503") {
      if (/Daily Content|saved by a member/i.test(reservationError.message))
        return { error: DAILY_CONTENT_VIDEO_DELETE_BLOCKED };
      if (/Daily Fuel/i.test(reservationError.message))
        return { error: DAILY_FUEL_VIDEO_DELETE_BLOCKED };
      if (/Task/i.test(reservationError.message))
        return { error: await videoInUseMessage(videoId.data) };
    }
    return { error: "We couldn't delete that video. Please try again." };
  }
  if (reserved !== true)
    return { error: "We couldn't delete that video. Please try again." };

  const { data: stored, error: lookupError } = await createAdminClient()
    .from("videos")
    .select("cloudflare_uid")
    .eq("id", videoId.data)
    .maybeSingle();
  // Without the Cloudflare id, deleting the row would leave the video in Cloudflare for good.
  // Keep the reservation on failure so a later retry can finish safely.
  if (lookupError || !stored?.cloudflare_uid)
    return { error: "We couldn't delete that video. Please try again." };

  try {
    // deleteVideo treats a provider 404 as success so DB deletion can be retried
    // after a previous provider success and later database failure.
    await deleteStreamVideo(stored.cloudflare_uid);
  } catch {
    return { error: "We couldn't delete that video. Please try again." };
  }

  const { data: deleted, error } = await supabase
    .from("videos")
    .delete()
    .eq("id", videoId.data)
    .select("id");
  if (error?.code === "23503") {
    if (/Daily Content|saved by a member/i.test(error.message))
      return { error: DAILY_CONTENT_VIDEO_DELETE_BLOCKED };
    if (/Daily Fuel/i.test(error.message))
      return { error: DAILY_FUEL_VIDEO_DELETE_BLOCKED };
    if (/Task/i.test(error.message))
      return { error: await videoInUseMessage(videoId.data) };
  }
  if (error) return { error: "We couldn't delete that video. Please try again." };
  if (!deleted?.length) return { error: "We couldn't find that video." };

  revalidatePath("/library");
  revalidatePath("/library/saved");
  revalidatePath("/dashboard");
  revalidatePath("/library/daily-content");
  revalidatePath("/admin/daily-content");
  return {};
}

// Title, description, category and who can watch. Row security limits this to the video's coach.
export async function updateVideoDetails(
  videoId: string,
  input: {
    title: string;
    description: string;
    category: string;
    visibility: string;
  },
): Promise<{ error?: string }> {
  await requireAccount();
  const id = idSchema.safeParse(videoId);
  if (!id.success) return { error: "We couldn't find that video." };
  const parsed = videoSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("videos")
    .update(parsed.data)
    .eq("id", id.data)
    .select("id");
  if (error) return { error: "We couldn't save that. Please try again." };
  if (!data?.length) return { error: "Only the video's coach can change it." };
  revalidatePath("/library");
  return {};
}

export async function setVideoVisibility(
  videoId: string,
  visibility: "members" | "private",
): Promise<{ error?: string }> {
  await requireAccount();
  const id = idSchema.safeParse(videoId);
  if (!id.success || (visibility !== "members" && visibility !== "private"))
    return { error: "We couldn't find that video." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("videos")
    .update({ visibility })
    .eq("id", id.data)
    .select("id");
  if (error) return { error: "We couldn't save that. Please try again." };
  if (!data?.length) return { error: "Only the video's coach can change it." };
  revalidatePath("/library");
  return {};
}
