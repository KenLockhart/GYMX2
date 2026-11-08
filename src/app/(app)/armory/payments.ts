"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { MIN_PAID_PRICE_CENTS, platformFeeCents } from "@/lib/armory";
import { requireAccount, requireCoach } from "@/lib/auth";
import { notifyOrderShipped } from "@/lib/notify";
import { refreshPayoutAccount } from "@/lib/purchases";
import { getStripe, isStripeConfigured, stripePublishableKey } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ActionState, ArmoryItem, CheckoutState } from "@/lib/types";
import { purchaseRequestSchema, shipOrderSchema } from "@/lib/validation";

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
  const { profile, email } = await requireAccount();
  const request = purchaseRequestSchema.safeParse({
    item_id: formData.get("item_id"),
    size: formData.get("size") ?? "",
  });
  if (!request.success) return { error: "Choose an item." };
  if (!isStripeConfigured()) return { error: "Payments aren't switched on yet. Please check back soon." };

  // Row security decides whether this person may see, and so buy, the item.
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("armory_items")
    .select("id, coach_id, kind, title, price_cents, sizes, shipping_cents")
    .eq("id", request.data.item_id)
    .maybeSingle();
  const sellable = item as (Pick<
    ArmoryItem,
    "id" | "coach_id" | "kind" | "title" | "price_cents" | "sizes" | "shipping_cents"
  >) | null;
  if (
    !sellable ||
    (sellable.kind !== "paid" && sellable.kind !== "product") ||
    !sellable.price_cents ||
    sellable.price_cents < MIN_PAID_PRICE_CENTS
  ) {
    return { error: "This item can't be bought right now." };
  }
  if (sellable.coach_id === profile.id) return { error: "This is your own item." };
  const isGear = sellable.kind === "product";

  // Gear with sizes needs one of them. Digital files are bought once; gear can be ordered again.
  let size: string | null = null;
  if (isGear && sellable.sizes.length > 0) {
    size = sellable.sizes.find((option) => option === request.data.size) ?? null;
    if (!size) return { error: "Choose a size." };
  }
  if (!isGear) {
    const { data: owned } = await supabase
      .from("purchases")
      .select("id")
      .eq("item_id", sellable.id)
      .eq("member_id", profile.id)
      .limit(1);
    if (owned?.length) return { error: "You already own this. Use the Download button." };
  }

  // A coach's sale goes to their Stripe account with GYMX2's fee kept back.
  // GYMX2's own items (added by an admin) are paid to GYMX2 in full.
  // Members can't read admin profiles, so the seller's role is looked up with the server key.
  const { data: seller } = await createAdminClient()
    .from("profiles")
    .select("role")
    .eq("id", sellable.coach_id)
    .maybeSingle();
  const isPlatformItem = seller?.role === "admin";
  let destination: string | null = null;
  if (!isPlatformItem) {
    const { data: account } = await createAdminClient()
      .from("payout_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("coach_id", sellable.coach_id)
      .maybeSingle();
    let ready = Boolean(account?.charges_enabled);
    if (account && !ready) {
      ready = (await refreshPayoutAccount(sellable.coach_id, account.stripe_account_id as string)).charges_enabled;
    }
    if (!account || !ready) return { error: "This coach hasn't finished setting up payments yet." };
    destination = account.stripe_account_id as string;
  }

  // The fee is taken from the item price only. The seller keeps the shipping fee to cover postage.
  const shipping = isGear ? sellable.shipping_cents : 0;
  const fee = isPlatformItem ? 0 : platformFeeCents(sellable.price_cents);
  const site = getSiteUrl();
  const embedded = Boolean(stripePublishableKey());
  const returnUrl = `${site}/armory/${sellable.id}?purchase=done&session_id={CHECKOUT_SESSION_ID}`;
  let url: string | null;
  let clientSecret: string | null;
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      ...(embedded
        ? { ui_mode: "embedded" as const, return_url: returnUrl }
        : { success_url: returnUrl, cancel_url: `${site}/armory/${sellable.id}` }),
      customer_email: email || undefined,
      client_reference_id: profile.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: sellable.price_cents,
            product_data: { name: size ? `${sellable.title} (size ${size})` : sellable.title },
          },
        },
      ],
      ...(isGear
        ? {
            shipping_address_collection: { allowed_countries: ["US"] },
            shipping_options: [
              {
                shipping_rate_data: {
                  type: "fixed_amount",
                  display_name: shipping > 0 ? "Standard shipping" : "Free shipping",
                  fixed_amount: { amount: shipping, currency: "usd" },
                },
              },
            ],
          }
        : {}),
      payment_intent_data: destination
        ? { application_fee_amount: fee, transfer_data: { destination } }
        : undefined,
      metadata: {
        item_id: sellable.id,
        member_id: profile.id,
        seller_id: sellable.coach_id,
        item_title: sellable.title.slice(0, 120),
        kind: sellable.kind,
        size: size ?? "",
        // What GYMX2 keeps: the 10% fee on a coach sale, or everything on GYMX2's own items.
        fee_cents: String(isPlatformItem ? sellable.price_cents + shipping : fee),
      },
    });
    url = session.url;
    clientSecret = session.client_secret;
  } catch (error) {
    console.error(error);
    return { error: "We couldn't start checkout. Please try again." };
  }
  if (embedded && clientSecret) return { clientSecret };
  if (!url) return { error: "We couldn't start checkout. Please try again." };
  redirect(url);
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
