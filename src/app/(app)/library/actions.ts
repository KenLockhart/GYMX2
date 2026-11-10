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

  const { data: stored, error: lookupError } = await createAdminClient()
    .from("videos")
    .select("cloudflare_uid")
    .eq("id", videoId.data)
    .maybeSingle();
  // Without the Cloudflare id, deleting the row would leave the video in Cloudflare for good.
  if (lookupError)
    return { error: "We couldn't delete that video. Please try again." };

  // The database decides who may delete, so nothing is removed from Cloudflare unless this succeeds.
  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("videos")
    .delete()
    .eq("id", videoId.data)
    .select("id");

  // Tasks keep their video, so the database refuses to delete one that a Task still uses.
  if (error?.code === "23503")
    return { error: await videoInUseMessage(videoId.data) };
  if (error)
    return { error: "We couldn't delete that video. Please try again." };
  if (!deleted?.length) return { error: "We couldn't find that video." };

  if (stored && isStreamConfigured()) {
    try {
      await deleteStreamVideo(stored.cloudflare_uid);
    } catch (cause) {
      console.error(cause);
    }
  }

  revalidatePath("/library");
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
