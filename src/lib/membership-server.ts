import "server-only";
import { after } from "next/server";
import type Stripe from "stripe";
import { recordAffiliateCommissions } from "@/lib/affiliate-server";
import { loadRecipient, sendEmail } from "@/lib/email";
import { membershipChangeEmail } from "@/lib/email-templates";
import {
  MEMBERSHIP_FEE_PERCENT,
  hasAccess,
  hasEnded,
  membershipFeeCents,
} from "@/lib/memberships";
import { refreshPayoutAccount } from "@/lib/purchases";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";

// Everything here uses the server key and runs only from trusted server code.

export type Plan = {
  id: string;
  coach_id: string;
  name: string;
  description: string;
  price_cents: number;
  trial_days: number;
  active: boolean;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
};

// Creates the Stripe product for a plan, and a new monthly price whenever the amount changes.
// Existing subscribers stay on the price they signed up at.
export async function syncPlanWithStripe(plan: Plan, coachName: string) {
  const stripe = getStripe();
  let productId = plan.stripe_product_id;
  const name = `${plan.name} with ${coachName}`.slice(0, 120);
  if (productId) {
    await stripe.products.update(productId, { name, active: plan.active });
  } else {
    productId = (
      await stripe.products.create({
        name,
        metadata: { plan_id: plan.id, coach_id: plan.coach_id },
      })
    ).id;
  }

  let priceId = plan.stripe_price_id;
  const current = priceId ? await stripe.prices.retrieve(priceId) : null;
  if (!current || current.unit_amount !== plan.price_cents) {
    priceId = (
      await stripe.prices.create({
        product: productId,
        currency: "usd",
        unit_amount: plan.price_cents,
        recurring: { interval: "month" },
        metadata: { plan_id: plan.id },
      })
    ).id;
    if (current) await stripe.prices.update(current.id, { active: false });
  }

  await createAdminClient()
    .from("coach_plans")
    .update({
      stripe_product_id: productId,
      stripe_price_id: priceId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", plan.id);
  return priceId;
}

// Opens Stripe's checkout for a plan, shown inside the coach's page.
export async function startMembershipCheckout(
  member: { id: string; email: string },
  planId: string,
) {
  const db = createAdminClient();
  const { data: plan } = await db
    .from("coach_plans")
    .select("*")
    .eq("id", planId)
    .eq("active", true)
    .maybeSingle<Plan>();
  if (!plan?.stripe_price_id)
    return { error: "That plan isn't available right now." };
  if (plan.coach_id === member.id) return { error: "This is your own plan." };
  const { data: block } = await db
    .from("coach_blocks")
    .select("coach_id")
    .eq("member_id", member.id)
    .eq("coach_id", plan.coach_id)
    .maybeSingle();
  if (block) return { error: "You blocked this coach. Unblock them to join." };

  const { data: existing } = await db
    .from("subscriptions")
    .select("status")
    .eq("member_id", member.id)
    .eq("coach_id", plan.coach_id);
  if ((existing ?? []).some((row) => hasAccess(row.status as string))) {
    return {
      error:
        "You already have a membership with this coach. Manage it in My purchases.",
    };
  }

  const { data: account } = await db
    .from("payout_accounts")
    .select("stripe_account_id, charges_enabled")
    .eq("coach_id", plan.coach_id)
    .maybeSingle();
  let ready = Boolean(account?.charges_enabled);
  if (account && !ready)
    ready = (
      await refreshPayoutAccount(
        plan.coach_id,
        account.stripe_account_id as string,
      )
    ).charges_enabled;
  if (!account || !ready)
    return { error: "This coach hasn't finished setting up payments yet." };

  const metadata = {
    member_id: member.id,
    coach_id: plan.coach_id,
    plan_id: plan.id,
    kind: "membership",
  };
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    ui_mode: "embedded",
    customer_email: member.email || undefined,
    client_reference_id: member.id,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    subscription_data: {
      application_fee_percent: MEMBERSHIP_FEE_PERCENT,
      transfer_data: { destination: account.stripe_account_id as string },
      ...(plan.trial_days > 0 ? { trial_period_days: plan.trial_days } : {}),
      metadata,
    },
    metadata,
    return_url: `${getSiteUrl()}/coaches/${plan.coach_id}?membership=done&session_id={CHECKOUT_SESSION_ID}`,
  });
  if (!session.client_secret)
    return { error: "We couldn't start checkout. Please try again." };
  return { clientSecret: session.client_secret };
}

function periodEnd(subscription: Stripe.Subscription) {
  const end = subscription.items.data[0]?.current_period_end;
  return end ? new Date(end * 1000).toISOString() : null;
}

// Saves a subscription's latest state from Stripe and gives or removes access to the coach.
export async function syncSubscription(subscription: Stripe.Subscription) {
  const { member_id, coach_id, plan_id } = subscription.metadata ?? {};
  if (!member_id || !coach_id) return;
  const db = createAdminClient();

  const { data: plan } = plan_id
    ? await db
        .from("coach_plans")
        .select("name, price_cents")
        .eq("id", plan_id)
        .maybeSingle()
    : { data: null };
  const { data: before } = await db
    .from("subscriptions")
    .select("status")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();

  const price =
    subscription.items.data[0]?.price?.unit_amount ?? plan?.price_cents ?? 0;
  const { error } = await db.from("subscriptions").upsert(
    {
      member_id,
      coach_id,
      plan_id: plan_id || null,
      plan_name: ((plan?.name as string | undefined) ?? "Membership").slice(
        0,
        60,
      ),
      price_cents: price,
      stripe_subscription_id: subscription.id,
      stripe_customer_id:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      status: subscription.status,
      current_period_end: periodEnd(subscription),
      trial_end: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
  if (error) throw error;

  // Access: members with a live membership are joined to the coach. When it ends, members of a
  // subscribers-only coach lose access; with free joining, they stay on as free members.
  if (hasAccess(subscription.status)) {
    const { error: joinError } = await db
      .from("coach_members")
      .insert({ coach_id, member_id });
    if (joinError && joinError.code !== "23505") throw joinError;
  } else if (hasEnded(subscription.status)) {
    const { data: coach } = await db
      .from("profiles")
      .select("join_mode")
      .eq("id", coach_id)
      .maybeSingle();
    if (coach?.join_mode === "paid") {
      await db
        .from("coach_members")
        .delete()
        .eq("coach_id", coach_id)
        .eq("member_id", member_id);
    }
  }

  // Tell the coach when someone starts or ends a membership.
  const wasLive = before ? hasAccess(before.status as string) : false;
  const change =
    !wasLive && hasAccess(subscription.status)
      ? "started"
      : wasLive && hasEnded(subscription.status)
        ? "ended"
        : null;
  if (change) {
    after(async () => {
      try {
        const [coach, member] = await Promise.all([
          loadRecipient(coach_id),
          loadRecipient(member_id),
        ]);
        if (!coach) return;
        await sendEmail(
          coach.email,
          membershipChangeEmail({
            siteUrl: getSiteUrl(),
            change,
            memberName: member?.name ?? "A member",
            planName: (plan?.name as string | undefined) ?? "your plan",
            priceCents: price,
            trial: subscription.status === "trialing",
          }),
        );
      } catch (emailError) {
        console.error(emailError);
      }
    });
  }
}

export async function syncSubscriptionById(subscriptionId: string) {
  await syncSubscription(
    await getStripe().subscriptions.retrieve(subscriptionId),
  );
}

// When a member comes back from checkout, update straight away instead of waiting for the webhook.
export async function confirmMembershipCheckout(
  sessionId: string,
  memberId: string,
) {
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (
      session.metadata?.member_id !== memberId ||
      typeof session.subscription !== "string"
    )
      return false;
    await syncSubscriptionById(session.subscription);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

// Each paid membership invoice is kept as a purchase, so Sales, refunds, the leaderboard and
// affiliate commissions cover memberships too. Free-trial invoices ($0) are skipped.
export async function recordMembershipInvoice(invoice: Stripe.Invoice) {
  const details = invoice.parent?.subscription_details;
  const metadata = details?.metadata ?? {};
  if (
    !details ||
    invoice.amount_paid <= 0 ||
    !metadata.member_id ||
    !metadata.coach_id
  )
    return true;

  const db = createAdminClient();
  const { data: plan } = metadata.plan_id
    ? await db
        .from("coach_plans")
        .select("name")
        .eq("id", metadata.plan_id)
        .maybeSingle()
    : { data: null };
  const { data: inserted, error } = await db
    .from("purchases")
    .upsert(
      {
        kind: "membership",
        item_id: null,
        member_id: metadata.member_id,
        seller_id: metadata.coach_id,
        item_title:
          `${(plan?.name as string | undefined) ?? "Coach"} membership`.slice(
            0,
            120,
          ),
        amount_cents: invoice.amount_paid,
        fee_cents: membershipFeeCents(invoice.amount_paid),
        currency: invoice.currency,
        stripe_session_id: invoice.id,
        fulfillment_status: "not_needed",
      },
      { onConflict: "stripe_session_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    console.error(error);
    return false;
  }
  const purchaseId = inserted?.[0]?.id as string | undefined;
  if (purchaseId) after(() => recordAffiliateCommissions(purchaseId));
  return true;
}

// The payment behind a membership invoice, for refunds.
export async function invoicePaymentIntent(invoiceId: string) {
  const payments = await getStripe().invoicePayments.list({
    invoice: invoiceId,
    limit: 1,
  });
  const intent = payments.data[0]?.payment?.payment_intent;
  return typeof intent === "string" ? intent : (intent?.id ?? null);
}

// The membership invoice a payment belongs to, for refunds made in the Stripe dashboard.
export async function invoiceForPaymentIntent(paymentIntentId: string) {
  const payments = await getStripe().invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    limit: 1,
  });
  const invoice = payments.data[0]?.invoice;
  return typeof invoice === "string" ? invoice : (invoice?.id ?? null);
}

// Stops every live membership a person has, as a member or as a coach, straight away.
// Used when an account is deleted.
export async function cancelAllMemberships(userId: string) {
  const { data } = await createAdminClient()
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .or(`member_id.eq.${userId},coach_id.eq.${userId}`);
  for (const row of data ?? []) {
    if (hasEnded(row.status as string)) continue;
    await getStripe().subscriptions.cancel(
      row.stripe_subscription_id as string,
    );
  }
}
