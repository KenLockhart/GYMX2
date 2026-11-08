"use server";

import { redirect } from "next/navigation";
import { MIN_PAID_PRICE_CENTS, platformFeeCents } from "@/lib/armory";
import { requireAccount, requireCoach } from "@/lib/auth";
import { refreshPayoutAccount } from "@/lib/purchases";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ActionState, ArmoryItem } from "@/lib/types";
import { idSchema } from "@/lib/validation";

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

export async function buyArmoryItem(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, email } = await requireAccount();
  const itemId = idSchema.safeParse(formData.get("item_id"));
  if (!itemId.success) return { error: "Choose an item." };
  if (!isStripeConfigured()) return { error: "Payments aren't switched on yet. Please check back soon." };

  // Row security decides whether this person may see, and so buy, the item.
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("armory_items")
    .select("id, coach_id, kind, title, price_cents, seller:profiles!coach_id(role)")
    .eq("id", itemId.data)
    .maybeSingle();
  const paidItem = item as (Pick<ArmoryItem, "id" | "coach_id" | "kind" | "title" | "price_cents"> & {
    seller: { role: string } | null;
  }) | null;
  if (!paidItem || paidItem.kind !== "paid" || !paidItem.price_cents || paidItem.price_cents < MIN_PAID_PRICE_CENTS) {
    return { error: "This item can't be bought right now." };
  }
  if (paidItem.coach_id === profile.id) return { error: "This is your own item." };

  const { data: owned } = await supabase
    .from("purchases")
    .select("id")
    .eq("item_id", paidItem.id)
    .eq("member_id", profile.id)
    .limit(1);
  if (owned?.length) return { error: "You already own this. Use the Download button." };

  // A coach's sale goes to their Stripe account with GYMX2's fee kept back.
  // GYMX2's own items (added by an admin) are paid to GYMX2 in full.
  const isPlatformItem = paidItem.seller?.role === "admin";
  let destination: string | null = null;
  if (!isPlatformItem) {
    const { data: account } = await createAdminClient()
      .from("payout_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("coach_id", paidItem.coach_id)
      .maybeSingle();
    let ready = Boolean(account?.charges_enabled);
    if (account && !ready) {
      ready = (await refreshPayoutAccount(paidItem.coach_id, account.stripe_account_id as string)).charges_enabled;
    }
    if (!account || !ready) return { error: "This coach hasn't finished setting up payments yet." };
    destination = account.stripe_account_id as string;
  }

  const fee = isPlatformItem ? 0 : platformFeeCents(paidItem.price_cents);
  const site = getSiteUrl();
  let url: string | null;
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: email || undefined,
      client_reference_id: profile.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: paidItem.price_cents,
            product_data: { name: paidItem.title },
          },
        },
      ],
      payment_intent_data: destination
        ? { application_fee_amount: fee, transfer_data: { destination } }
        : undefined,
      metadata: {
        item_id: paidItem.id,
        member_id: profile.id,
        seller_id: paidItem.coach_id,
        item_title: paidItem.title.slice(0, 120),
        fee_cents: String(isPlatformItem ? paidItem.price_cents : fee),
      },
      success_url: `${site}/armory/${paidItem.id}?purchase=done&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/armory/${paidItem.id}`,
    });
    url = session.url;
  } catch (error) {
    console.error(error);
    return { error: "We couldn't start checkout. Please try again." };
  }
  if (!url) return { error: "We couldn't start checkout. Please try again." };
  redirect(url);
}
