"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getCurrentAccount, requireAccount, requireAuthenticatedAccount, requireCoach } from "@/lib/auth";
import { createArmoryCheckout, guestLivePreviewCheckoutBlocked } from "@/lib/armory-checkout";
import { notifyOrderShipped } from "@/lib/notify";
import { refundPurchase } from "@/lib/refunds";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ActionState, CheckoutState } from "@/lib/types";
import { guestPurchaseRequestSchema, idSchema, purchaseRequestSchema, shipOrderSchema } from "@/lib/validation";
import { getLocale } from "@/i18n/server";

// Sends a coach to Stripe to set up (or finish setting up) the account their sales are paid into.
export async function startPayoutSetup(): Promise<ActionState> {
  const { profile, email } = await requireCoach();
  if (!isStripeConfigured()) return { error: "Payments aren't switched on yet. Please check back soon." };

  const stripe = getStripe();
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("payout_accounts")
    .select("stripe_account_id")
    .eq("coach_id", profile.id)
    .maybeSingle();

  let accountId = existing?.stripe_account_id as string | undefined;
  let url: string;
  try {
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { product_description: "Fitness ebooks and programs sold on GYMX2" },
        metadata: { coach_id: profile.id },
      });
      accountId = account.id;
      const { error } = await admin
        .from("payout_accounts")
        .insert({ coach_id: profile.id, stripe_account_id: accountId });
      if (error) throw error;
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${getSiteUrl()}/armory/payouts?setup=again`,
      return_url: `${getSiteUrl()}/armory/payouts?setup=done`,
    });
    url = link.url;
  } catch (error) {
    console.error(error);
    return { error: "We couldn't reach Stripe. Please try again." };
  }
  redirect(url);
}

// Opens the coach's own Stripe dashboard, where they see payouts and bank details.
export async function openPayoutDashboard(): Promise<ActionState> {
  const { profile } = await requireCoach();
  const { data } = await createAdminClient()
    .from("payout_accounts")
    .select("stripe_account_id")
    .eq("coach_id", profile.id)
    .maybeSingle();
  if (!data) return { error: "Set up payouts first." };

  let url: string;
  try {
    url = (await getStripe().accounts.createLoginLink(data.stripe_account_id as string)).url;
  } catch (error) {
    console.error(error);
    return { error: "We couldn't open Stripe. Finish setting up payouts first, then try again." };
  }
  redirect(url);
}

// Opens checkout for an item. With a publishable key set, the payment form is shown inside the item
// page (the buyer never leaves gymx2.com); otherwise the buyer is sent to Stripe's checkout page.
export async function buyArmoryItem(_: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const { profile, email } = await requireAuthenticatedAccount();
  const request = purchaseRequestSchema.safeParse({
    item_id: formData.get("item_id"),
    size: formData.get("size") ?? "",
  });
  if (!request.success) return { error: "Choose an item." };
  const result = await createArmoryCheckout({
    itemId: request.data.item_id,
    size: request.data.size,
    email,
    profile,
    embedded: true,
    locale: profile.locale,
  });
  if ("error" in result) return { error: result.error };
  if ("clientSecret" in result) return { clientSecret: result.clientSecret };
  redirect(result.url);
}

export async function startGuestArmoryCheckout(_: CheckoutState, formData: FormData): Promise<CheckoutState> {
  if (await getCurrentAccount()) {
    return { error: "Use the signed-in checkout button to keep this order in your purchase history." };
  }
  if (guestLivePreviewCheckoutBlocked()) {
    return { error: "Guest checkout is disabled in this preview environment." };
  }
  const request = guestPurchaseRequestSchema.safeParse({
    item_id: formData.get("item_id"),
    size: formData.get("size") ?? "",
    email: formData.get("email"),
  });
  if (!request.success) return { error: "Enter a valid email address and choose any required size." };
  const result = await createArmoryCheckout({
    itemId: request.data.item_id,
    size: request.data.size,
    email: request.data.email,
    profile: null,
    embedded: false,
    locale: await getLocale(),
  });
  if ("error" in result) return { error: result.error };
  if ("clientSecret" in result) return { error: "We couldn't start checkout. Please try again." };
  redirect(result.url);
}

// The seller (or an admin, for GYMX2's own gear) marks an order shipped, with an optional tracking number.
export async function markOrderShipped(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAccount();
  const parsed = shipOrderSchema.safeParse({
    purchase_id: formData.get("purchase_id"),
    tracking: formData.get("tracking") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_order_shipped", {
    target_purchase_id: parsed.data.purchase_id,
    tracking: parsed.data.tracking,
  });
  if (error) return { error: "We couldn't update that order. Please try again." };

  const purchaseId = parsed.data.purchase_id;
  after(() => notifyOrderShipped(purchaseId));
  revalidatePath("/armory/sales");
  return { message: "Marked as shipped. We emailed the buyer." };
}

// The seller, or any admin, refunds an order in full.
export async function refundOrder(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireAccount();
  const purchaseId = idSchema.safeParse(formData.get("purchase_id"));
  if (!purchaseId.success) return { error: "Choose an order." };

  // Row security shows sellers their own sales and admins every sale.
  const supabase = await createClient();
  const { data: purchase } = await supabase
    .from("purchases")
    .select("id, seller_id, member_id")
    .eq("id", purchaseId.data)
    .maybeSingle();
  if (!purchase || (purchase.seller_id !== profile.id && profile.role !== "admin")) {
    return { error: "We couldn't find that order." };
  }

  const result = await refundPurchase(purchase.id as string, profile.id);
  if ("error" in result) return { error: result.error };

  revalidatePath("/armory/sales");
  return { message: "Refunded. We emailed the buyer." };
}
