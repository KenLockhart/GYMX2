import "server-only";
import { after } from "next/server";
import type Stripe from "stripe";
import { recordAffiliateCommissions } from "@/lib/affiliate-server";
import { sendEmail } from "@/lib/email";
import { guestArmoryOrderEmail } from "@/lib/email-templates";
import {
  createGuestArmoryToken,
  GUEST_ARMORY_TOKEN_TTL_SECONDS,
} from "@/lib/guest-armory-token";
import { bindArmoryCheckoutSession } from "@/lib/armory-checkout-binding";
import { isArmoryChargeRefunded } from "@/lib/armory-commerce-core";
import { notifyNewSale } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import { getStripe } from "@/lib/stripe";
import { recordLegacyPhysicalPaidResolution } from "@/lib/printful/legacy-paid-resolution";

type CheckoutIntent = {
  id: string;
  item_id: string;
  member_id: string | null;
  buyer_was_guest: boolean;
  guest_email: string | null;
  seller_id: string;
  item_title: string;
  item_kind: "paid" | "product";
  item_category: string;
  locale: "en" | "es";
  price_cents: number;
  shipping_cents: number;
  stripe_session_id: string | null;
  status: string;
  stripe_payment_intent_id?: string | null;
  file_path?: string | null;
  file_name?: string | null;
};

type PaidSession = {
  session: Stripe.Checkout.Session;
  paymentIntent: Stripe.PaymentIntent;
  refundedCharge: Stripe.Charge | null;
};

function paymentIntentId(session: Stripe.Checkout.Session) {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
}

async function retrieveCurrentPaidSession(
  sessionId: string,
  intent: CheckoutIntent,
): Promise<PaidSession | null> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
  const intentId = session.metadata?.armory_checkout_intent_id;
  const expectedTotal = intent.price_cents + (intent.item_kind === "product" ? intent.shipping_cents : 0);
  if (
    session.id !== sessionId ||
    session.metadata?.kind !== "armory_purchase" ||
    intentId !== intent.id ||
    session.mode !== "payment" ||
    session.payment_status !== "paid" ||
    session.currency?.toLowerCase() !== "usd" ||
    session.amount_total !== expectedTotal ||
    (session.shipping_cost?.amount_total ?? 0) !==
      (intent.item_kind === "product" ? intent.shipping_cents : 0)
  ) {
    return null;
  }

  if (intent.buyer_was_guest) {
    const email = (session.customer_details?.email ?? session.customer_email ?? "")
      .trim()
      .toLowerCase();
    if (!intent.guest_email || email !== intent.guest_email) return null;
  }

  if (intent.item_kind === "product") {
    const shipping = session.collected_information?.shipping_details;
    if (!shipping?.name || !shipping.address?.line1 || !shipping.address.country) {
      return null;
    }
  }

  const piId = paymentIntentId(session);
  if (!piId) return null;
  const paymentIntent =
    typeof session.payment_intent === "string"
      ? await stripe.paymentIntents.retrieve(piId)
      : session.payment_intent;
  if (
    !paymentIntent ||
    paymentIntent.status !== "succeeded" ||
    paymentIntent.currency.toLowerCase() !== "usd" ||
    paymentIntent.amount !== expectedTotal ||
    paymentIntent.metadata.kind !== "armory_purchase" ||
    paymentIntent.metadata.armory_checkout_intent_id !== intent.id
  ) {
    return null;
  }

  const { data: charges } = await stripe.charges.list({
    payment_intent: paymentIntent.id,
    limit: 100,
  });
  const refundedCharge =
    charges.find((charge) =>
      isArmoryChargeRefunded({
        refunded: charge.refunded,
        amountRefunded: charge.amount_refunded,
      }),
    ) ?? null;
  return { session, paymentIntent, refundedCharge };
}

async function recordRefundMarker(paymentIntentId: string, chargeId: string) {
  const { error } = await createAdminClient().rpc("mark_armory_payment_refunded", {
    target_payment_intent_id: paymentIntentId,
    target_charge_id: chargeId,
  });
  return !error;
}

export async function recordArmoryCheckoutPurchase(
  eventSession: Stripe.Checkout.Session,
) {
  if (eventSession.payment_status !== "paid") return true;
  const intentId = eventSession.metadata?.armory_checkout_intent_id;
  if (
    eventSession.metadata?.kind !== "armory_purchase" ||
    !intentId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intentId)
  ) {
    return false;
  }

  const admin = createAdminClient();
  const { data: intent, error: intentError } = await admin
    .from("armory_checkout_intents")
    .select("id, item_id, member_id, buyer_was_guest, guest_email, seller_id, item_title, item_kind, item_category, locale, price_cents, shipping_cents, stripe_session_id, status")
    .eq("id", intentId)
    .maybeSingle<CheckoutIntent>();
  if (
    intentError ||
    !intent ||
    (intent.stripe_session_id !== null && intent.stripe_session_id !== eventSession.id) ||
    (intent.buyer_was_guest && (!intent.guest_email || intent.member_id)) ||
    (!intent.buyer_was_guest && intent.guest_email !== null)
  ) {
    return false;
  }

  const current = await retrieveCurrentPaidSession(eventSession.id, intent).catch(() => null);
  if (!current) return false;
  if (intent.item_kind === "product") {
    const { data: priorPurchase, error: priorPurchaseError } = await admin
      .from("purchases")
      .select("id")
      .eq("stripe_session_id", current.session.id)
      .maybeSingle();
    if (priorPurchaseError) return false;
    if (priorPurchase) return true;

    const resolution = await recordLegacyPhysicalPaidResolution(admin, {
      sessionId: current.session.id,
      paymentIntentId: current.paymentIntent.id,
      amountCents: current.session.amount_total,
      currency: current.session.currency,
      paymentStatus: current.session.payment_status,
      checkoutIntentId: intent.id,
    });
    if (resolution === "recorded") return true;
    if (resolution === "failed") return false;
  }
  if (!(await bindArmoryCheckoutSession(intent.id, current.session.id))) return false;
  if (current.refundedCharge) {
    const marked = await recordRefundMarker(
      current.paymentIntent.id,
      current.refundedCharge.id,
    );
    if (!marked) return false;
  }

  const shipping = current.session.collected_information?.shipping_details ?? null;
  const { data: saved, error } = await admin
    .rpc("record_armory_checkout_purchase", {
      target_intent_id: intent.id,
      target_session_id: current.session.id,
      target_payment_intent_id: current.paymentIntent.id,
      target_amount_cents: current.session.amount_total ?? 0,
      target_shipping_cents: current.session.shipping_cost?.amount_total ?? 0,
      target_currency: current.session.currency ?? "",
      target_guest_email: intent.buyer_was_guest ? intent.guest_email : null,
      target_shipping_name: shipping?.name ?? null,
      target_shipping_address: shipping?.address ?? null,
    })
    .maybeSingle<{ purchase_id: string; inserted: boolean; refunded: boolean }>();
  if (error || !saved?.purchase_id) return false;

  if (saved.inserted && !saved.refunded) {
    after(async () => {
      await notifyNewSale(saved.purchase_id);
      await recordAffiliateCommissions(saved.purchase_id);
    });
  }
  if (intent.buyer_was_guest && !saved.refunded) {
    // The signed webhook must fail if the receipt/download email fails. Stripe can retry the
    // event; the purchase RPC is idempotent and the confirmation claim is retryable.
    if (!(await sendGuestArmoryOrderConfirmation(saved.purchase_id))) return false;
  }
  return true;
}

export async function confirmArmoryCheckoutSession(
  sessionId: string,
  memberId: string,
) {
  const admin = createAdminClient();
  const stripeSession = await getStripe().checkout.sessions.retrieve(sessionId);
  if (stripeSession.metadata?.kind !== "armory_purchase") return false;
  const intentId = stripeSession.metadata.armory_checkout_intent_id;
  if (!intentId) return false;
  const { data: intent } = await admin
    .from("armory_checkout_intents")
    .select("member_id, stripe_session_id")
    .eq("id", intentId)
    .maybeSingle<{ member_id: string | null; stripe_session_id: string | null }>();
  if (intent?.member_id !== memberId || intent.stripe_session_id !== sessionId) {
    return false;
  }
  return recordArmoryCheckoutPurchase(stripeSession);
}

export async function updateArmoryCheckoutStatus(
  sessionId: string,
  status: "expired" | "failed",
) {
  const { error } = await createAdminClient()
    .from("armory_checkout_intents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("stripe_session_id", sessionId)
    .eq("status", "pending");
  return !error;
}

export async function verifyGuestArmoryPurchasePayment(input: {
  purchaseId: string;
  sessionId: string;
  itemId: string;
}) {
  const order = await loadVerifiedGuestOrder(input.purchaseId, {
    sessionId: input.sessionId,
    itemId: input.itemId,
    requireDownload: true,
  });
  if (!order?.intent.file_path || !order.intent.file_name) return null;
  return {
    email: order.intent.guest_email!,
    filePath: order.intent.file_path,
    fileName: order.intent.file_name,
  };
}

type GuestPurchaseRow = {
  id: string;
  item_id: string | null;
  member_id: string | null;
  stripe_session_id: string;
  checkout_intent_id: string | null;
  amount_cents: number;
  currency: string;
  refunded_at: string | null;
  size: string | null;
  item_title: string;
};

async function loadVerifiedGuestOrder(
  purchaseId: string,
  options: { sessionId?: string; itemId?: string; requireDownload: boolean },
) {
  const admin = createAdminClient();
  let query = admin
    .from("purchases")
    .select("id, item_id, member_id, stripe_session_id, checkout_intent_id, amount_cents, currency, refunded_at, size, item_title")
    .eq("id", purchaseId);
  if (options.sessionId) query = query.eq("stripe_session_id", options.sessionId);
  const { data: purchase } = await query.maybeSingle<GuestPurchaseRow>();
  if (
    !purchase ||
    purchase.member_id !== null ||
    !purchase.checkout_intent_id ||
    purchase.refunded_at ||
    purchase.currency.toLowerCase() !== "usd"
  ) {
    return null;
  }

  const { data: intent } = await admin
    .from("armory_checkout_intents")
    .select("id, item_id, member_id, buyer_was_guest, guest_email, seller_id, item_title, item_kind, item_category, locale, price_cents, shipping_cents, stripe_session_id, stripe_payment_intent_id, file_path, file_name, status")
    .eq("id", purchase.checkout_intent_id)
    .maybeSingle<CheckoutIntent>();
  if (
    !intent ||
    intent.status !== "paid" ||
    !intent.buyer_was_guest ||
    intent.member_id !== null ||
    !intent.guest_email ||
    (purchase.item_id !== null && intent.item_id !== purchase.item_id) ||
    (options.itemId && intent.item_id !== options.itemId) ||
    intent.stripe_session_id !== purchase.stripe_session_id ||
    !intent.stripe_payment_intent_id ||
    (options.requireDownload && (!intent.file_path || !intent.file_name))
  ) {
    return null;
  }

  const { data: refundMarker, error: refundMarkerError } = await admin
    .from("armory_payment_refunds")
    .select("stripe_payment_intent_id")
    .eq("stripe_payment_intent_id", intent.stripe_payment_intent_id)
    .maybeSingle();
  if (refundMarkerError || refundMarker) return null;

  const current = await retrieveCurrentPaidSession(purchase.stripe_session_id, intent).catch(() => null);
  if (
    !current ||
    current.paymentIntent.id !== intent.stripe_payment_intent_id ||
    current.session.amount_total !== purchase.amount_cents
  ) {
    return null;
  }
  if (current.refundedCharge) {
    await recordRefundMarker(current.paymentIntent.id, current.refundedCharge.id);
    return null;
  }
  return { purchase, intent };
}

export async function sendGuestArmoryOrderConfirmation(purchaseId: string) {
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_armory_guest_confirmation",
    { target_purchase_id: purchaseId },
  );
  if (claimError) return false;
  if (!claimed) {
    const { data: purchase, error: purchaseError } = await admin
      .from("purchases")
      .select("checkout_intent_id")
      .eq("id", purchaseId)
      .maybeSingle<{ checkout_intent_id: string | null }>();
    if (purchaseError || !purchase?.checkout_intent_id) return false;
    const { data: intent, error: intentError } = await admin
      .from("armory_checkout_intents")
      .select("guest_confirmation_sent_at")
      .eq("id", purchase.checkout_intent_id)
      .maybeSingle<{ guest_confirmation_sent_at: string | null }>();
    return !intentError && Boolean(intent?.guest_confirmation_sent_at);
  }

  let sent = false;
  try {
    const order = await loadVerifiedGuestOrder(purchaseId, { requireDownload: false });
    if (!order) throw new Error("Guest order is not eligible for confirmation");
    let downloadUrl: string | null = null;
    if (order.intent.file_path && order.intent.file_name) {
      const secret = process.env.GUEST_ARMORY_DOWNLOAD_SECRET;
      if (!secret || secret.length < 32) throw new Error("Guest download signing is unavailable");
      const token = createGuestArmoryToken(
        {
          purchaseId: order.purchase.id,
          sessionId: order.purchase.stripe_session_id,
          itemId: order.intent.item_id,
        },
        secret,
        Math.floor(Date.now() / 1000),
        GUEST_ARMORY_TOKEN_TTL_SECONDS,
      );
      downloadUrl = `${getSiteUrl()}/armory/claim#token=${encodeURIComponent(token)}`;
    }
    sent = await sendEmail(
      order.intent.guest_email!,
      guestArmoryOrderEmail({
        locale: order.intent.locale,
        siteUrl: getSiteUrl(),
        itemTitle: order.purchase.item_title,
        amountCents: order.purchase.amount_cents,
        size: order.purchase.size,
        downloadUrl,
      }),
    );
  } catch {
    sent = false;
  }
  const { error: finishError } = await admin.rpc("finish_armory_guest_confirmation", {
    target_purchase_id: purchaseId,
    sent,
  });
  return sent && !finishError;
}
