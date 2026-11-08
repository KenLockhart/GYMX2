import "server-only";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Checks with Stripe whether an affiliate's account can receive money, and saves the answer.
export async function refreshAffiliatePayouts(
  userId: string,
  accountId: string,
) {
  const account = await getStripe().accounts.retrieve(accountId);
  const enabled = Boolean(
    account.capabilities?.transfers === "active" && account.payouts_enabled,
  );
  await createAdminClient()
    .from("affiliates")
    .update({ payouts_enabled: enabled })
    .eq("user_id", userId);
  return enabled;
}
