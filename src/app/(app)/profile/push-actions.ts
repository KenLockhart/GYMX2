"use server";

import { z } from "zod";
import { requireAccount } from "@/lib/auth";
import { sendPush } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";

const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  device: z.string().max(120).default(""),
});

export async function savePushSubscription(
  input: unknown,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success)
    return {
      error: "Your browser sent something we didn't expect. Please try again.",
    };

  const supabase = await createClient();
  // A device that changes hands (shared iPad, new login) moves to whoever turned it on last.
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint);
  const { error } = await supabase.from("push_subscriptions").insert({
    user_id: profile.id,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    device: parsed.data.device,
  });
  if (error) {
    // Still registered to someone else on this device: clear it with the server key, then retry.
    if (error.code === "23505") {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      await createAdminClient()
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", parsed.data.endpoint);
      const retry = await supabase.from("push_subscriptions").insert({
        user_id: profile.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        device: parsed.data.device,
      });
      if (!retry.error) return {};
    }
    return { error: "We couldn't turn on notifications. Please try again." };
  }
  return {};
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await requireAccount();
  if (typeof endpoint !== "string" || endpoint.length > 1000) return;
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

export async function sendTestPush(): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const sent = await sendPush([profile.id], {
    title: { text: "GYMX2 notifications are on" },
    body: {
      text: "You'll hear about messages, group posts, live sessions and new program days here.",
    },
    url: "/dashboard",
    tag: "test",
  });
  return sent
    ? {}
    : { error: "No device got it. Turn notifications off and on again." };
}
