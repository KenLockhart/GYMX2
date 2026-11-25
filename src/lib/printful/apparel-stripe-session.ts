import type Stripe from "stripe";

export type ApparelStripeSessionSnapshot = Readonly<{
  status: string;
  sessionId: string | null;
  expiresAt: string;
  email: string;
  priceCents: number;
  productTitle: string;
  variantLabel: string;
}>;

type StripeSessionClient = Readonly<{
  checkout: Readonly<{
    sessions: Readonly<{
      create(params: Stripe.Checkout.SessionCreateParams, options: { idempotencyKey: string }): Promise<Stripe.Checkout.Session>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
    }>;
  }>;
}>;

export type ApparelStripeSessionResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; reason: "session_unavailable" | "session_expired" };

function validSnapshot(value: ApparelStripeSessionSnapshot): boolean {
  const expiry = Date.parse(value.expiresAt);
  return Number.isFinite(expiry) && Number.isSafeInteger(value.priceCents) && value.priceCents >= 100 &&
    value.priceCents <= 10_000_000 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) &&
    value.productTitle.length > 0 && value.productTitle.length <= 120 &&
    value.variantLabel.length > 0 && value.variantLabel.length <= 200;
}

/** Stable Stripe parameters make an unknown create outcome recoverable using the same key. */
export async function createOrRecoverPrintfulApparelStripeSession(input: Readonly<{
  stripe: StripeSessionClient;
  snapshot: ApparelStripeSessionSnapshot;
  orderId: string;
  statusToken: string;
  siteUrl: string;
  bind(sessionId: string): Promise<boolean>;
  now?: () => number;
}>): Promise<ApparelStripeSessionResult> {
  const { snapshot, orderId, statusToken } = input;
  if (!validSnapshot(snapshot) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId) ||
    !/^[A-Za-z0-9_-]{43}$/.test(statusToken) || !/^https:\/\//i.test(input.siteUrl)) {
    return { ok: false, reason: "session_unavailable" };
  }

  if (snapshot.sessionId) {
    let existing: Stripe.Checkout.Session;
    try {
      existing = await input.stripe.checkout.sessions.retrieve(snapshot.sessionId);
    } catch {
      return { ok: false, reason: "session_unavailable" };
    }
    if (existing.id !== snapshot.sessionId || existing.status !== "open" || !existing.url) {
      return { ok: false, reason: "session_expired" };
    }
    return { ok: true, sessionId: existing.id, url: existing.url };
  }

  if (snapshot.status !== "quoted" || Date.parse(snapshot.expiresAt) <= (input.now ?? Date.now)()) {
    return { ok: false, reason: "session_expired" };
  }
  const expiresAt = Math.floor(Date.parse(snapshot.expiresAt) / 1000);
  const sessionUrl = `${input.siteUrl}/armory/apparel/order/${orderId}?claim=${encodeURIComponent(statusToken)}&session_id={CHECKOUT_SESSION_ID}`;
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: snapshot.email,
    client_reference_id: orderId,
    expires_at: expiresAt,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: snapshot.priceCents,
        product_data: { name: `${snapshot.productTitle} · ${snapshot.variantLabel}` },
      },
    }],
    shipping_address_collection: { allowed_countries: ["US"] },
    shipping_options: [{ shipping_rate_data: {
      type: "fixed_amount",
      fixed_amount: { amount: 0, currency: "usd" },
      display_name: "Free shipping",
    } }],
    success_url: sessionUrl,
    cancel_url: `${input.siteUrl}/armory/apparel?cancelled=1`,
    metadata: { kind: "printful_apparel_purchase", printful_apparel_order_id: orderId },
    payment_intent_data: { metadata: { kind: "printful_apparel_purchase", printful_apparel_order_id: orderId } },
  };

  let created: Stripe.Checkout.Session;
  try {
    created = await input.stripe.checkout.sessions.create(params, { idempotencyKey: `printful-apparel-checkout-${orderId}` });
  } catch {
    // The provider may have created a session before the response was lost. Leave the
    // intent recoverable; a duplicate submit uses this identical parameter set and key.
    return { ok: false, reason: "session_unavailable" };
  }
  if (!created.id || !created.url) return { ok: false, reason: "session_unavailable" };
  let bound = false;
  try {
    bound = await input.bind(created.id);
  } catch {
    return { ok: false, reason: "session_unavailable" };
  }
  if (!bound) return { ok: false, reason: "session_unavailable" };
  return { ok: true, sessionId: created.id, url: created.url };
}
