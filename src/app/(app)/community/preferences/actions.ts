"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth";
import { compactWeights, preferencesSchema } from "@/lib/feed-prefs";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

// Every change here only re-orders or drops posts the database already lets the person see
// (public.community_feed). Nothing in it can unlock a post.

export async function savePreferences(
  input: unknown,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const prefs = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("feed_preferences").upsert(
    {
      user_id: profile.id,
      mode: prefs.mode,
      sort: prefs.sort,
      topic_weights: compactWeights(prefs.weights),
      preferred_coaches: [...new Set(prefs.preferredCoaches)],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { error: "We couldn't save your preferences." };
  revalidatePath("/community");
  return {};
}

// Back to the standard GYMX2 feed. Follows and mutes are kept; they're managed below.
export async function resetPreferences(): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const supabase = await createClient();
  const { error } = await supabase
    .from("feed_preferences")
    .delete()
    .eq("user_id", profile.id);
  if (error) return { error: "We couldn't reset your feed." };
  revalidatePath("/community");
  return {};
}

async function person(id: string) {
  const { profile } = await requireAccount();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success || parsed.data === profile.id) return null;
  return { me: profile.id, them: parsed.data };
}

export async function setFollow(
  userId: string,
  on: boolean,
): Promise<{ error?: string }> {
  const ids = await person(userId);
  if (!ids) return { error: "You can't follow that person." };
  const supabase = await createClient();
  const { error } = on
    ? await supabase
        .from("follows")
        .upsert(
          { follower_id: ids.me, followed_id: ids.them },
          { onConflict: "follower_id,followed_id", ignoreDuplicates: true },
        )
    : await supabase
        .from("follows")
        .delete()
        .eq("follower_id", ids.me)
        .eq("followed_id", ids.them);
  if (error) return { error: "That didn't work. Please try again." };
  revalidatePath("/community/preferences");
  return {};
}

export async function setMute(
  userId: string,
  on: boolean,
): Promise<{ error?: string }> {
  const ids = await person(userId);
  if (!ids) return { error: "You can't mute that person." };
  const supabase = await createClient();
  const { error } = on
    ? await supabase
        .from("mutes")
        .upsert(
          { user_id: ids.me, muted_id: ids.them },
          { onConflict: "user_id,muted_id", ignoreDuplicates: true },
        )
    : await supabase
        .from("mutes")
        .delete()
        .eq("user_id", ids.me)
        .eq("muted_id", ids.them);
  if (error) return { error: "That didn't work. Please try again." };
  revalidatePath("/community");
  return {};
}

export async function setHidden(
  postId: string,
  hidden: boolean,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse(postId);
  if (!id.success) return { error: "That post wasn't found." };
  const supabase = await createClient();
  if (hidden) {
    // Row security: you can only hide a post you can see.
    const { data: post } = await supabase
      .from("posts")
      .select("id")
      .eq("id", id.data)
      .maybeSingle();
    if (!post) return { error: "That post wasn't found." };
  }
  const { error } = hidden
    ? await supabase
        .from("hidden_posts")
        .upsert(
          { user_id: profile.id, post_id: id.data },
          { onConflict: "user_id,post_id", ignoreDuplicates: true },
        )
    : await supabase
        .from("hidden_posts")
        .delete()
        .eq("user_id", profile.id)
        .eq("post_id", id.data);
  if (error) return { error: "That didn't work. Please try again." };
  revalidatePath("/community");
  return {};
}
