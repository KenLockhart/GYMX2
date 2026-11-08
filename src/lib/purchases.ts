import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

// Saves a completed Checkout payment. Safe to call more than once for the same session:
// the webhook and the buyer's return to the site may both report it.
export async function recordPurchase(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return false;
  const { item_id, member_id, seller_id, item_title, fee_cents } = session.metadata ?? {};
  if (!item_id || !member_id || !item_title) return false;

  const { error } = await createAdminClient()
    .from("purchases")
    .upsert(
      {
        item_id,
        member_id,
        seller_id: seller_id || null,
        item_title,
        amount_cents: session.amount_total ?? 0,
        fee_cents: Number(fee_cents ?? 0),
        currency: session.currency ?? "usd",
        stripe_session_id: session.id,
      },
      { onConflict: "stripe_session_id", ignoreDuplicates: true },
    );
  if (error) {
    console.error(error);
    return false;
  }
  return true;
}

// When the buyer comes back from Stripe, check the payment straight away rather than wait for the webhook.
export async function confirmCheckoutSession(sessionId: string, memberId: string) {
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.member_id !== memberId) return false;
    return await recordPurchase(session);
  } catch (error) {
    console.error(error);
    return false;
  }
}

// Refreshes whether a coach's Stripe account can take payments and receive payouts.
export async function refreshPayoutAccount(coachId: string, stripeAccountId: string) {
  const account = await getStripe().accounts.retrieve(stripeAccountId);
  const status = {
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
  };
  await createAdminClient().from("payout_accounts").update(status).eq("coach_id", coachId);
  return status;
}
