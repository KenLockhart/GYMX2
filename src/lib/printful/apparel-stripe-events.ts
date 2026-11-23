import "server-only";
import type Stripe from "stripe";

type RpcClient = Readonly<{
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}>;

type StripeEventLike = Readonly<{
  id: string;
  type: string;
  livemode: boolean;
  data: { object: unknown };
}>;

type StripeLike = Pick<Stripe, "accounts" | "checkout" | "paymentIntents" | "charges" | "balanceTransactions" | "disputes">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export function parseStripeShippingAddress(session: Record<string, unknown>, email: string): Record<string, string> | null {
  const collected = isRecord(session.collected_information) ? session.collected_information : null;
  const shipping = collected && isRecord(collected.shipping_details)
    ? collected.shipping_details
    : isRecord(session.shipping_details) ? session.shipping_details : null;
  const address = shipping && isRecord(shipping.address) ? shipping.address : null;
  if (!shipping || !address) return null;
  const name = typeof shipping.name === "string" ? shipping.name.trim() : "";
  const address1 = typeof address.line1 === "string" ? address.line1.trim() : "";
  const city = typeof address.city === "string" ? address.city.trim() : "";
  const stateCode = typeof address.state === "string" ? address.state.trim().toUpperCase() : "";
  const countryCode = typeof address.country === "string" ? address.country.trim().toUpperCase() : "";
  const zip = typeof address.postal_code === "string" ? address.postal_code.trim().toUpperCase() : "";
  const address2 = typeof address.line2 === "string" ? address.line2.trim() : "";
  if (!name || !address1 || !city || !/^[A-Z]{2}$/.test(stateCode) || countryCode !== "US" ||
    !/^[A-Z0-9 -]{3,20}$/.test(zip)) return null;
  return {
    name, address1, address2, city, stateCode, countryCode, zip,
    phone: typeof shipping.phone === "string" ? shipping.phone.trim() : "",
    email,
  };
}

export function stripeNetRevenueFromTrustedFacts(input: Readonly<{
  livemode: boolean;
  amountCents: unknown;
  amountTaxCents: unknown;
  currency: unknown;
  expectedPaymentIntentId: unknown;
  paymentIntentStatus: unknown;
  paymentIntentId: unknown;
  paymentIntentAmountReceived: unknown;
  paymentIntentCurrency: unknown;
  paymentIntentLivemode: unknown;
  chargePaid: unknown;
  chargeCaptured: unknown;
  chargeDisputed: unknown;
  chargePaymentIntentId: unknown;
  expectedChargeId: unknown;
  chargeId: unknown;
  chargeAmount: unknown;
  chargeAmountRefunded: unknown;
  chargeCurrency: unknown;
  chargeLivemode: unknown;
  chargeBalanceAmount: unknown;
  chargeBalanceFee: unknown;
  chargeBalanceNet: unknown;
  chargeBalanceCurrency: unknown;
  chargeBalanceSource: unknown;
}>): number | null {
  const amount = positiveInteger(input.amountCents);
  const tax = Number.isSafeInteger(input.amountTaxCents) && Number(input.amountTaxCents) >= 0
    ? Number(input.amountTaxCents) : null;
  const received = positiveInteger(input.paymentIntentAmountReceived);
  const chargeAmount = positiveInteger(input.chargeAmount);
  const balanceAmount = positiveInteger(input.chargeBalanceAmount);
  const fee = Number.isSafeInteger(input.chargeBalanceFee) && Number(input.chargeBalanceFee) >= 0
    ? Number(input.chargeBalanceFee) : null;
  const net = Number.isSafeInteger(input.chargeBalanceNet) && Number(input.chargeBalanceNet) >= 0
    ? Number(input.chargeBalanceNet) : null;
  if (!input.livemode || input.currency !== "usd" || input.paymentIntentCurrency !== "usd" ||
    input.paymentIntentLivemode !== true || input.paymentIntentStatus !== "succeeded" ||
    input.paymentIntentId !== input.expectedPaymentIntentId ||
    input.chargePaid !== true || input.chargeCaptured !== true || input.chargeDisputed !== false ||
    input.chargePaymentIntentId !== input.expectedPaymentIntentId || input.chargeId !== input.expectedChargeId ||
    input.chargeBalanceSource !== input.expectedChargeId ||
    input.chargeCurrency !== "usd" || input.chargeLivemode !== true ||
    input.chargeBalanceCurrency !== "usd" || !amount || received !== amount || chargeAmount !== amount ||
    tax === null || tax > amount || balanceAmount !== amount || fee === null || net === null || net !== amount - fee ||
    input.chargeAmountRefunded !== 0) return null;
  const netOfFeesAndTax = net - tax;
  return netOfFeesAndTax >= 0 ? netOfFeesAndTax : null;
}

export async function retrievePrintfulStripeSettlementFacts(input: Readonly<{
  stripe: StripeLike;
  paymentIntentId: string;
  amountCents: number;
  amountTaxCents: number | null;
  currency: string;
  livemode: boolean;
}>): Promise<Readonly<{ verifiedPaid: boolean; netRevenueCents: number | null; refundOrDispute: boolean }>> {
  let paymentIntent: Stripe.PaymentIntent;
  let charge: Stripe.Charge | null = null;
  let balanceTransaction: Stripe.BalanceTransaction | null = null;
  try {
    paymentIntent = await input.stripe.paymentIntents.retrieve(input.paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
    if (typeof paymentIntent.latest_charge === "string") {
      charge = await input.stripe.charges.retrieve(paymentIntent.latest_charge, { expand: ["balance_transaction"] });
    } else if (paymentIntent.latest_charge) {
      charge = paymentIntent.latest_charge as Stripe.Charge;
    }
    if (charge && typeof charge.balance_transaction === "string") {
      balanceTransaction = await input.stripe.balanceTransactions.retrieve(charge.balance_transaction);
    } else if (charge?.balance_transaction) {
      balanceTransaction = charge.balance_transaction as Stripe.BalanceTransaction;
    }
  } catch {
    return { verifiedPaid: false, netRevenueCents: null, refundOrDispute: false };
  }
  const paymentVerified = paymentIntent.id === input.paymentIntentId && paymentIntent.status === "succeeded" &&
    paymentIntent.amount_received === input.amountCents && paymentIntent.currency === "usd" && paymentIntent.livemode === true;
  if (!paymentVerified) return { verifiedPaid: false, netRevenueCents: null, refundOrDispute: false };
  if (!charge) return { verifiedPaid: true, netRevenueCents: null, refundOrDispute: false };
  const chargePaymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : isRecord(charge.payment_intent) && typeof charge.payment_intent.id === "string" ? charge.payment_intent.id : null;
  const refundOrDispute = charge.amount_refunded > 0 || charge.disputed === true;
  const verifiedPaid = chargePaymentIntentId === input.paymentIntentId && charge.paid === true && charge.captured === true;
  if (!verifiedPaid || !balanceTransaction) return { verifiedPaid, netRevenueCents: null, refundOrDispute };
  const netRevenueCents = stripeNetRevenueFromTrustedFacts({
    livemode: input.livemode,
    amountCents: input.amountCents,
    amountTaxCents: input.amountTaxCents,
    currency: input.currency,
    expectedPaymentIntentId: input.paymentIntentId,
    paymentIntentStatus: paymentIntent.status,
    paymentIntentId: paymentIntent.id,
    paymentIntentAmountReceived: paymentIntent.amount_received,
    paymentIntentCurrency: paymentIntent.currency,
    paymentIntentLivemode: paymentIntent.livemode,
    chargePaid: charge.paid,
    chargeCaptured: charge.captured,
    chargeDisputed: charge.disputed,
    chargePaymentIntentId,
    expectedChargeId: charge.id,
    chargeId: charge.id,
    chargeAmount: charge.amount,
    chargeAmountRefunded: charge.amount_refunded,
    chargeCurrency: charge.currency,
    chargeLivemode: charge.livemode,
    chargeBalanceAmount: balanceTransaction.amount,
    chargeBalanceFee: balanceTransaction.fee,
    chargeBalanceNet: balanceTransaction.net,
    chargeBalanceCurrency: balanceTransaction.currency,
    chargeBalanceSource: balanceTransaction.source,
  });
  return { verifiedPaid, netRevenueCents, refundOrDispute };
}

export type ApparelStripeEventResult = "not_apparel" | "handled" | "retry";

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  return isRecord(value) && typeof value.id === "string" ? value.id : null;
}

/**
 * Persist refund/dispute risk before generic refund handling. Stripe's signed
 * event is corroborated by current Charge, PaymentIntent, and Checkout Session
 * reads; the RPC can store a pending hold even before the paid webhook binds PI.
 */
export async function handlePrintfulApparelRiskEvent(
  event: StripeEventLike,
  dependencies: Readonly<{
    stripe: StripeLike;
    admin: RpcClient;
    expectedStripeAccountId: string;
  }>,
): Promise<ApparelStripeEventResult> {
  const isRefund = event.type === "charge.refunded";
  const isDispute = event.type.startsWith("charge.dispute.");
  if (!isRefund && !isDispute) return "not_apparel";
  const object = isRecord(event.data.object) ? event.data.object : null;
  if (!object) return "retry";
  const disputeId = isDispute && typeof object.id === "string" ? object.id : null;
  let chargeId = isRefund ? stripeObjectId(object.id) : stripeObjectId(object.charge);
  if (!chargeId && isDispute) chargeId = stripeObjectId(object.charge);
  if (!chargeId || !/^ch_[A-Za-z0-9_]{8,240}$/.test(chargeId)) return "not_apparel";

  let charge: Stripe.Charge;
  try {
    charge = await dependencies.stripe.charges.retrieve(chargeId);
  } catch {
    return "retry";
  }
  if (charge.id !== chargeId) return "retry";
  const paymentIntentId = stripeObjectId(charge.payment_intent);
  if (!paymentIntentId || !/^pi_[A-Za-z0-9_]{8,240}$/.test(paymentIntentId)) return "not_apparel";

  let paymentIntent: Stripe.PaymentIntent;
  let dispute: Stripe.Dispute | null = null;
  try {
    paymentIntent = await dependencies.stripe.paymentIntents.retrieve(paymentIntentId);
    if (isDispute && disputeId) dispute = await dependencies.stripe.disputes.retrieve(disputeId);
  } catch {
    return "retry";
  }
  if (paymentIntent.id !== paymentIntentId) return "retry";
  const metadata = paymentIntent.metadata;
  if (metadata?.kind !== "printful_apparel_purchase") return "not_apparel";
  const orderId = metadata.printful_apparel_order_id;
  if (!orderId || !ORDER_ID_PATTERN.test(orderId)) return "retry";
  if (isRefund && (!Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded <= 0)) return "retry";
  if (isDispute && (!dispute || dispute.id !== disputeId || stripeObjectId(dispute.charge) !== chargeId)) return "retry";

  let account: Stripe.Account;
  let sessions: Stripe.ApiList<Stripe.Checkout.Session>;
  try {
    account = await dependencies.stripe.accounts.retrieve();
    if (!dependencies.expectedStripeAccountId || account.id !== dependencies.expectedStripeAccountId) return "retry";
    sessions = await dependencies.stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 2 });
  } catch {
    return "retry";
  }
  if (!Array.isArray(sessions.data) || sessions.data.length !== 1) return "retry";
  const session = sessions.data[0];
  const sessionPaymentIntentId = stripeObjectId(session.payment_intent);
  if (!/^cs_[A-Za-z0-9_]{8,240}$/.test(session.id) || session.mode !== "payment" ||
    session.metadata?.kind !== "printful_apparel_purchase" || session.metadata.printful_apparel_order_id !== orderId ||
    sessionPaymentIntentId !== paymentIntentId || session.livemode !== true || event.livemode !== true ||
    paymentIntent.livemode !== true || charge.livemode !== true || isDispute && dispute?.livemode !== true) return "retry";

  const { data, error } = await dependencies.admin.rpc("hold_printful_apparel_refund", {
    target_order_id: orderId,
    target_session_id: session.id,
    target_payment_intent_id: paymentIntentId,
    target_event_id: event.id,
    target_risk_type: isRefund ? "refund" : "dispute",
  });
  return !error && data === true ? "handled" : "retry";
}

export async function handlePrintfulApparelStripeEvent(
  event: StripeEventLike,
  dependencies: Readonly<{
    stripe: StripeLike;
    admin: RpcClient;
    expectedStripeAccountId: string;
  }>,
): Promise<ApparelStripeEventResult> {
  if (![
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
  ].includes(event.type)) return "not_apparel";
  const eventSession = isRecord(event.data.object) ? event.data.object : null;
  if (!eventSession || !isRecord(eventSession.metadata) || eventSession.metadata.kind !== "printful_apparel_purchase") {
    return "not_apparel";
  }
  const orderId = eventSession.metadata.printful_apparel_order_id;
  const sessionId = eventSession.id;
  if (typeof orderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId) ||
    typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]{8,240}$/.test(sessionId) ||
    !dependencies.expectedStripeAccountId) return "retry";

  let account: Stripe.Account;
  let session: Stripe.Checkout.Session;
  try {
    account = await dependencies.stripe.accounts.retrieve();
    if (account.id !== dependencies.expectedStripeAccountId) return "retry";
    session = await dependencies.stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
  } catch {
    return "retry";
  }
  if (session.id !== sessionId || session.mode !== "payment" || session.metadata?.kind !== "printful_apparel_purchase" ||
    session.metadata.printful_apparel_order_id !== orderId || session.livemode !== event.livemode) return "retry";

  if (session.status === "expired" && session.payment_status !== "paid") {
    const { data, error } = await dependencies.admin.rpc("expire_printful_apparel_checkout", {
      target_order_id: orderId,
      target_session_id: sessionId,
    });
    return !error && data === true ? "handled" : "retry";
  }
  if (session.status !== "complete" || session.payment_status !== "paid") return "handled";

  const amountCents = positiveInteger(session.amount_total);
  const currency = typeof session.currency === "string" ? session.currency.toLowerCase() : "";
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : isRecord(session.payment_intent) && typeof session.payment_intent.id === "string" ? session.payment_intent.id : null;
  const emailValue = session.customer_details?.email ?? session.customer_email;
  const email = typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "";
  if (!amountCents || currency !== "usd" || !paymentIntentId || !/^pi_[A-Za-z0-9_]{8,240}$/.test(paymentIntentId) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "retry";
  const address = parseStripeShippingAddress(session as unknown as Record<string, unknown>, email);

  let netRevenueCents: number | null = null;
  let paymentIntent: Stripe.PaymentIntent | null = null;
  let charge: Stripe.Charge | null = null;
  let balanceTransaction: Stripe.BalanceTransaction | null = null;
  try {
    paymentIntent = typeof session.payment_intent === "object" && session.payment_intent !== null
      ? session.payment_intent as Stripe.PaymentIntent
      : await dependencies.stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
    if (typeof paymentIntent.latest_charge === "string") {
      charge = await dependencies.stripe.charges.retrieve(paymentIntent.latest_charge, { expand: ["balance_transaction"] });
    } else if (paymentIntent.latest_charge) {
      charge = paymentIntent.latest_charge as Stripe.Charge;
    }
    if (charge && typeof charge.balance_transaction === "string") {
      balanceTransaction = await dependencies.stripe.balanceTransactions.retrieve(charge.balance_transaction);
    } else if (charge?.balance_transaction) {
      balanceTransaction = charge.balance_transaction as Stripe.BalanceTransaction;
    }
    if (paymentIntent && charge && balanceTransaction) {
      const chargePaymentIntentId = typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : isRecord(charge.payment_intent) && typeof charge.payment_intent.id === "string" ? charge.payment_intent.id : null;
      netRevenueCents = stripeNetRevenueFromTrustedFacts({
        livemode: session.livemode,
        amountCents,
        amountTaxCents: session.total_details?.amount_tax,
        currency,
        expectedPaymentIntentId: paymentIntentId,
        paymentIntentStatus: paymentIntent.status,
        paymentIntentId: paymentIntent.id,
        paymentIntentAmountReceived: paymentIntent.amount_received,
        paymentIntentCurrency: paymentIntent.currency,
        paymentIntentLivemode: paymentIntent.livemode,
        chargePaid: charge.paid,
        chargeCaptured: charge.captured,
        chargeDisputed: charge.disputed,
        chargePaymentIntentId,
        expectedChargeId: charge.id,
        chargeId: charge.id,
        chargeAmount: charge.amount,
        chargeAmountRefunded: charge.amount_refunded,
        chargeCurrency: charge.currency,
        chargeLivemode: charge.livemode,
        chargeBalanceAmount: balanceTransaction.amount,
        chargeBalanceFee: balanceTransaction.fee,
        chargeBalanceNet: balanceTransaction.net,
        chargeBalanceCurrency: balanceTransaction.currency,
        chargeBalanceSource: balanceTransaction.source,
      });
    }
  } catch {
    netRevenueCents = null;
  }

  const { data, error } = await dependencies.admin.rpc("record_printful_apparel_paid", {
    target_order_id: orderId,
    target_session_id: sessionId,
    target_payment_intent_id: paymentIntentId,
    target_event_id: event.id,
    target_paid_cents: amountCents,
    target_net_revenue_cents: netRevenueCents,
    target_currency: currency,
    target_guest_email: email,
    target_stripe_address: address,
    target_livemode: session.livemode,
  });
  if (error || typeof data !== "string" || ["not_found", "payment_conflict", "payment_mismatch", "invalid_state"].includes(data)) {
    return "retry";
  }
  if (netRevenueCents !== null) {
    const netResult = await dependencies.admin.rpc("record_printful_apparel_stripe_net", {
      target_order_id: orderId,
      target_payment_intent_id: paymentIntentId,
      target_paid_cents: amountCents,
      target_net_revenue_cents: netRevenueCents,
      target_currency: currency,
      target_livemode: session.livemode,
    });
    if (netResult.error || typeof netResult.data !== "string" || ["payment_mismatch", "net_conflict", "invalid_net_facts"].includes(netResult.data)) {
      return "retry";
    }
  }
  return "handled";
}
