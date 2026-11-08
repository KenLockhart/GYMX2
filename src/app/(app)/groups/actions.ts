"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccount } from "@/lib/auth";
import { GROUP_POST_MAX, type GroupPost } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

const postSchema = z.object({
  coach_id: idSchema,
  body: z
    .string()
    .trim()
    .min(1, "Write something first")
    .max(GROUP_POST_MAX, `Keep posts under ${GROUP_POST_MAX} characters`),
});

export async function postGroupMessage(
  coachId: string,
  body: string,
): Promise<{ error?: string; post?: GroupPost }> {
  const { profile } = await requireAccount();
  const parsed = postSchema.safeParse({ coach_id: coachId, body });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("group_messages")
    .insert({
      coach_id: parsed.data.coach_id,
      sender_id: profile.id,
      body: parsed.data.body,
    })
    .select("id, coach_id, sender_id, body, created_at")
    .single<GroupPost>();
  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Only this coach and their members can post here."
          : "We couldn't post that. Please try again.",
    };
  }
  revalidatePath("/groups");
  return { post: data };
}

export async function deleteGroupMessage(
  postId: string,
): Promise<{ error?: string }> {
  await requireAccount();
  const id = idSchema.safeParse(postId);
  if (!id.success) return { error: "That post wasn't found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("group_messages")
    .delete()
    .eq("id", id.data)
    .select("id");
  if (error || !data?.length) return { error: "You can't remove that post." };
  revalidatePath("/groups");
  return {};
}
