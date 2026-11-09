import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { accountDeletedEmail } from "@/lib/email-templates";
import { cancelAllMemberships } from "@/lib/membership-server";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { deleteVideo, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl, getSupabaseEnv } from "@/lib/supabase/env";
import type { UserRole } from "@/lib/types";

// Who may delete their own account here. Admins hand over first; coaches with sales email support,
// because buyers' downloads and the coach's payouts need settling by a person.
export async function deletionBlocker(person: { id: string; role: UserRole }) {
  if (person.role === "admin") {
    return "Admins can't delete their own account. Ask another admin to change your role to member first.";
  }
  if (person.role === "coach") {
    const { count } = await createAdminClient()
      .from("purchases")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", person.id);
    if ((count ?? 0) > 0) {
      return "You've sold items in the Armory, so we close coach accounts by hand to settle your buyers and payouts. Email support@gymx2.com and we'll take care of it.";
    }
  }
  if (person.role === "coach") {
    const { count: subscribers } = await createAdminClient()
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("coach_id", person.id)
      .in("status", ["trialing", "active", "past_due"]);
    if ((subscribers ?? 0) > 0) {
      return "You have members on paid plans. Email support@gymx2.com so we can wind their memberships down before closing your account.";
    }
  }
  // Affiliates with commissions still owed are paid out first, by a person.
  const { count: owed } = await createAdminClient()
    .from("commissions")
    .select("id", { count: "exact", head: true })
    .eq("affiliate_id", person.id)
    .eq("status", "pending");
  if ((owed ?? 0) > 0) {
    return "You have affiliate commissions that haven't been paid yet. Email support@gymx2.com and we'll settle them and close your account.";
  }
  return null;
}

// Checks the password without touching the browser's sign-in, as a guard against someone
// deleting an account from a computer left signed in.
export async function passwordMatches(email: string, password: string) {
  const { url, publishableKey } = getSupabaseEnv();
  const client = createSupabaseClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) await client.auth.signOut({ scope: "local" });
  return !error;
}

async function removeStoredFiles(userId: string) {
  const storage = createAdminClient().storage;
  for (const bucket of ["armory-files", "armory-images", "progress-photos"]) {
    const { data } = await storage.from(bucket).list(userId, { limit: 1000 });
    const paths = (data ?? []).map((file) => `${userId}/${file.name}`);
    if (paths.length) await storage.from(bucket).remove(paths);
  }
}

// Community photos sit one folder deeper (<person>/<upload>/<n>.jpg), and message photos too.
async function removeCommunityFiles(userId: string) {
  const admin = createAdminClient();
  const { data: media } = await admin
    .from("post_media")
    .select("path, posts!inner(author_id)")
    .eq("posts.author_id", userId)
    .not("path", "is", null);
  const { data: attachments } = await admin
    .from("message_attachments")
    .select("path, messages!inner(sender_id)")
    .eq("messages.sender_id", userId);
  const paths = [...(media ?? []), ...(attachments ?? [])].map(
    (row) => row.path as string,
  );
  for (let start = 0; start < paths.length; start += 500) {
    await admin.storage
      .from("community-media")
      .remove(paths.slice(start, start + 500));
  }
}

async function removeVideos(userId: string) {
  if (!isStreamConfigured()) return;
  const admin = createAdminClient();
  const [{ data }, { data: postVideos }] = await Promise.all([
    admin.from("videos").select("cloudflare_uid").eq("coach_id", userId),
    admin
      .from("post_media")
      .select("video_uid, posts!inner(author_id)")
      .eq("posts.author_id", userId)
      .not("video_uid", "is", null),
  ]);
  for (const video of data ?? [])
    await deleteVideo(video.cloudflare_uid as string);
  for (const video of postVideos ?? [])
    await deleteVideo(video.video_uid as string);
}

async function removePayoutAccount(userId: string) {
  if (!isStripeConfigured()) return;
  const { data } = await createAdminClient()
    .from("payout_accounts")
    .select("stripe_account_id")
    .eq("coach_id", userId)
    .maybeSingle();
  if (data?.stripe_account_id)
    await getStripe().accounts.del(data.stripe_account_id as string);
}

// Deletes the person and everything that belongs to them. Files and videos outside the database
// go first, each on a best-effort basis, so a hiccup at Cloudflare or Stripe never leaves an
// account half-deleted. Orders they bought stay, without their name.
export async function deleteAccount(person: {
  id: string;
  email: string;
  name: string;
}) {
  for (const [label, step] of [
    ["files", () => removeStoredFiles(person.id)],
    ["community files", () => removeCommunityFiles(person.id)],
    ["videos", () => removeVideos(person.id)],
    ["memberships", () => cancelAllMemberships(person.id)],
    ["payout account", () => removePayoutAccount(person.id)],
  ] as const) {
    try {
      await step();
    } catch (error) {
      console.error(`Account deletion: removing ${label} failed`, error);
    }
  }

  const { error } = await createAdminClient().auth.admin.deleteUser(person.id);
  if (error) {
    console.error(error);
    return false;
  }

  await sendEmail(
    person.email,
    accountDeletedEmail({ siteUrl: getSiteUrl(), name: person.name }),
  );
  return true;
}
