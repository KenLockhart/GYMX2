"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import { deleteVideo as deleteStreamVideo, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { idSchema } from "@/lib/validation";

export async function deleteVideo(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAccount();
  const videoId = idSchema.safeParse(formData.get("video_id"));
  if (!videoId.success) return { error: "Choose a video." };

  const { data: stored, error: lookupError } = await createAdminClient()
    .from("videos")
    .select("cloudflare_uid")
    .eq("id", videoId.data)
    .maybeSingle();
  // Without the Cloudflare id, deleting the row would leave the video in Cloudflare for good.
  if (lookupError) return { error: "We couldn't delete that video. Please try again." };

  // The database decides who may delete, so nothing is removed from Cloudflare unless this succeeds.
  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("videos")
    .delete()
    .eq("id", videoId.data)
    .select("id");

  if (error) {
    return {
      error:
        error.code === "23503"
          ? "This video is used by a Task. Delete the Task first."
          : "We couldn't delete that video. Please try again.",
    };
  }
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
