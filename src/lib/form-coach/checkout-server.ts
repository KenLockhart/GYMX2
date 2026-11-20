import "server-only";

import { createHash, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/supabase/env";
import {
  FORM_COACH_FEATURE_KEY,
  FeaturePricingRevisionSchema,
  type FeatureBillingModel,
  type FeaturePayer,
} from "@/lib/form-coach/types";

const MAX_CREATE_AGE_MS = 23 * 60 * 60 * 1000;
const SESSION_LIST_LIMIT = 100;

type Raw = Record<string, unknown>;

function record(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Raw
    : null;
}

function firstRecord(value: unknown): Raw | null {
  return record(Array.isArray(value) ? value[0] : value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integer(value: unknown): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) ? parsed : null;
}

export type SafeCheckoutOffer = Readonly<{
  priceKey: string;
  amountCents: number;
  currency: string;
  interval: "month" | "year" | null;
  creditsPerPack: number | null;
}>;

export type FormCoachPricingSnapshot = Readonly<{
  featureKey: typeof FORM_COACH_FEATURE_KEY;
  revision: number;
  status: "disabled" | "pricing_pending" | "live";
  payer: FeaturePayer;
  billingModel: FeatureBillingModel | null;
  displayName: string;
  description: string;
  marketingCopy: string;
  offers: readonly SafeCheckoutOffer[];
}>;

type InternalCheckoutOffer = SafeCheckoutOffer & Readonly<{
  stripeProductId: string | null;
  stripePriceId: string | null;
}>;

type InternalPricingSnapshot = Omit<FormCoachPricingSnapshot, "offers"> & Readonly<{
  offers: readonly InternalCheckoutOffer[];
}>;

export type FormCoachBillingSummary = Readonly<{
  sourceKind: string;
  state: string;
  validThrough: string | null;
  remainingCredits: number | null;
}>;

export type FormCoachPaymentHistory = Readonly<{
  kind: "subscription" | "pack" | "trial";
  status: "paid" | "trial" | "pending" | "refunded" | "review";
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  recordedAt: string;
}>;

export type FormCoachBillingPageData = Readonly<{
  pricing: FormCoachPricingSnapshot | null;
  billing: readonly FormCoachBillingSummary[];
  history: readonly FormCoachPaymentHistory[];
  canManageBilling: boolean;
  checkoutEnabled: boolean;
  readError: boolean;
  returnState: "none" | "processing" | "confirmed" | "expired" | "unavailable";
}>;

export function isFormCoachCheckoutEnabled(): boolean {
  return process.env.FORM_COACH_CHECKOUT_ENABLED === "true";
}

/**
 * Stripe return URLs are server-owned. In production only the GymX2 canonical
 * origins are allowed; local non-production runs may return to loopback.
 */
export function formCoachReturnUrl(siteUrl: string, query = ""): string | null {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  const productionHost = host === "gymx2.com" || host === "www.gymx2.com";
  const localHost = process.env.NODE_ENV !== "production"
    && (host === "localhost" || host === "127.0.0.1");
  if (!productionHost && !localHost) return null;
  if (productionHost && parsed.protocol !== "https:") return null;
  if (localHost && parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const url = new URL("/billing/form-coach", parsed.origin);
  if (query) url.search = query.startsWith("?") ? query : `?${query}`;
  return url.toString();
}

export function isStripeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com";
  } catch {
    return false;
  }
}

export function isStripePortalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "billing.stripe.com";
  } catch {
    return false;
  }
}

async function readPricingRevision(revision: number): Promise<InternalPricingSnapshot | null> {
  const db = createAdminClient();
  if (revision === null || revision <= 0) return null;

  const [{ data: rawRevision, error: revisionError }, { data: rawOptions, error: optionsError }] = await Promise.all([
    db.from("feature_pricing_revisions")
      .select("feature_key,revision,status,payer,billing_model,currency,display_name,description,marketing_copy,trial_days,trial_assessments")
      .eq("feature_key", FORM_COACH_FEATURE_KEY)
      .eq("revision", revision)
      .maybeSingle(),
    db.from("feature_pricing_options")
      .select("price_key,amount_cents,currency,interval,credits_per_pack,stripe_product_id,stripe_price_id")
      .eq("feature_key", FORM_COACH_FEATURE_KEY)
      .eq("revision", revision)
      .order("price_key", { ascending: true })
      .limit(101),
  ]);
  if (revisionError || optionsError || !rawRevision || !Array.isArray(rawOptions) || rawOptions.length > 100) return null;

  const revisionRow = record(rawRevision);
  if (!revisionRow) return null;
  const parsed = FeaturePricingRevisionSchema.safeParse({
    featureKey: revisionRow.feature_key,
    revision,
    status: revisionRow.status,
    payer: revisionRow.payer,
    billingModel: revisionRow.billing_model,
    currency: revisionRow.currency,
    displayName: revisionRow.display_name,
    description: revisionRow.description,
    marketingCopy: revisionRow.marketing_copy,
    trialDays: revisionRow.trial_days,
    trialAssessments: revisionRow.trial_assessments,
    priceOptions: rawOptions.map((raw) => {
      const option = record(raw) ?? {};
      return {
        priceKey: option.price_key,
        amountCents: integer(option.amount_cents),
        currency: option.currency,
        stripeProductId: option.stripe_product_id,
        stripePriceId: option.stripe_price_id,
        interval: option.interval,
        creditsPerPack: option.credits_per_pack === null ? null : integer(option.credits_per_pack),
      };
    }),
  });
  if (!parsed.success || parsed.data.featureKey !== FORM_COACH_FEATURE_KEY) return null;
  return {
    featureKey: FORM_COACH_FEATURE_KEY,
    revision: parsed.data.revision,
    status: parsed.data.status,
    payer: parsed.data.payer,
    billingModel: parsed.data.billingModel,
    displayName: parsed.data.displayName,
    description: parsed.data.description,
    marketingCopy: parsed.data.marketingCopy,
    offers: parsed.data.priceOptions.map(({ priceKey, amountCents, currency, interval, creditsPerPack, stripeProductId, stripePriceId }) => ({
      priceKey,
      amountCents,
      currency,
      interval,
      creditsPerPack,
      stripeProductId,
      stripePriceId,
    })),
  };
}

async function readCurrentPricing(): Promise<InternalPricingSnapshot | null> {
  const db = createAdminClient();
  const { data: current, error } = await db
    .from("feature_pricing_current")
    .select("revision")
    .eq("feature_key", FORM_COACH_FEATURE_KEY)
    .maybeSingle();
  const revision = error || !current ? null : integer(record(current)?.revision);
  return revision === null ? null : readPricingRevision(revision);
}

type CheckoutReservation = Readonly<{
  id: string;
  request_id: string;
  idempotency_key: string;
  feature_key: string;
  config_revision: number;
  payer_role: string;
  payer_id: string;
  price_key: string;
  stripe_product_id: string;
  stripe_price_id: string;
  unit_amount_cents: number;
  currency: string;
  pack_quantity: number;
  credits_per_pack: number | null;
  quoted_credits: number;
  total_amount_cents: number;
  state: string;
  stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  expires_at: string;
  created_at: string;
}>;

type CustomerAttempt = Readonly<{
  id: string;
  feature_key: string;
  payer_id: string;
  request_id: string;
  request_digest: string;
  idempotency_key: string;
  state: string;
  stripe_customer_id: string | null;
  state_revision: number;
  created_at: string;
}>;

type CustomerReservation = Readonly<{
  outcome: string;
  attemptId: string | null;
  customerId: string | null;
  stateRevision: number | null;
}>;

type CheckoutReservationResult = Readonly<{
  outcome: string;
  reservationId: string | null;
  requestId: string;
  expiresAt: string | null;
}>;

export type FormCoachCheckoutStore = Readonly<{
  reserveCustomer(input: { payerId: string; requestId: string; digest: string }): Promise<CustomerReservation>;
  readCustomerAttempt(attemptId: string): Promise<CustomerAttempt | null>;
  advanceCustomer(input: {
    attemptId: string;
    expectedStateRevision: number;
    nextState: "unknown" | "bound" | "verified";
    providerCustomerId: string | null;
  }): Promise<string>;
  reserveCheckout(input: {
    payerId: string;
    revision: number;
    priceKey: string;
    quantity: number;
    requestId: string;
  }): Promise<CheckoutReservationResult>;
  readUnresolvedCheckout(payerId: string): Promise<CheckoutReservation | null>;
  readCheckoutReservation(reservationId: string): Promise<CheckoutReservation | null>;
  markCheckoutUnknown(reservationId: string): Promise<boolean>;
  bindCheckout(input: {
    reservationId: string;
    sessionId: string;
    customerId: string;
    subscriptionId: string | null;
  }): Promise<string>;
  reconcileExpiredCheckout(input: {
    requestId: string;
    reservationId: string;
    sessionId: string;
    customerId: string;
    sessionStatus: string;
    paymentStatus: string;
    mode: string;
    metadata: Stripe.Metadata;
    priceId: string;
    quantity: number;
    evidenceDigest: string;
  }): Promise<string>;
  readVerifiedCustomer(payerId: string): Promise<{ customerId: string; attemptId: string } | null>;
}>;

type CustomerProvider = Pick<Stripe, "customers">;
type CheckoutProvider = Pick<Stripe, "checkout">;

export type FormCoachCheckoutDependencies = Readonly<{
  enabled: boolean;
  pricing: () => Promise<InternalPricingSnapshot | null>;
  pricingRevision: (revision: number) => Promise<InternalPricingSnapshot | null>;
  store: FormCoachCheckoutStore;
  stripe: Pick<Stripe, "customers" | "checkout">;
  now: () => Date;
  siteUrl: string;
}>;

export type FormCoachCheckoutResult =
  | Readonly<{ kind: "redirect"; url: string }>
  | Readonly<{ kind: "status"; status: "coming_soon" | "unavailable" | "invalid" | "pending" | "expired" | "already_active" | "account_deleting" }>;

function parseCustomerAttempt(value: unknown): CustomerAttempt | null {
  const row = record(value);
  if (!row) return null;
  const id = text(row.id);
  const featureKey = text(row.feature_key);
  const payerId = text(row.payer_id);
  const requestId = text(row.request_id);
  const requestDigest = text(row.request_digest);
  const idempotencyKey = text(row.idempotency_key);
  const state = text(row.state);
  const customerId = row.stripe_customer_id === null ? null : text(row.stripe_customer_id);
  const stateRevision = integer(row.state_revision);
  const createdAt = text(row.created_at);
  if (!id || !featureKey || !payerId || !requestId || !requestDigest || !idempotencyKey || !state
    || (customerId === null && row.stripe_customer_id !== null) || stateRevision === null || !createdAt) return null;
  return {
    id,
    feature_key: featureKey,
    payer_id: payerId,
    request_id: requestId,
    request_digest: requestDigest,
    idempotency_key: idempotencyKey,
    state,
    stripe_customer_id: customerId,
    state_revision: stateRevision,
    created_at: createdAt,
  };
}

function parseCheckoutReservation(value: unknown): CheckoutReservation | null {
  const row = record(value);
  if (!row) return null;
  const id = text(row.id);
  const requestId = text(row.request_id);
  const idempotencyKey = text(row.idempotency_key);
  const featureKey = text(row.feature_key);
  const revision = integer(row.config_revision);
  const payerRole = text(row.payer_role);
  const payerId = text(row.payer_id);
  const priceKey = text(row.price_key);
  const productId = text(row.stripe_product_id);
  const priceId = text(row.stripe_price_id);
  const unitAmount = integer(row.unit_amount_cents);
  const currency = text(row.currency);
  const quantity = integer(row.pack_quantity);
  const creditsPerPack = row.credits_per_pack === null ? null : integer(row.credits_per_pack);
  const quotedCredits = integer(row.quoted_credits);
  const totalAmount = integer(row.total_amount_cents);
  const state = text(row.state);
  const sessionId = row.stripe_checkout_session_id === null ? null : text(row.stripe_checkout_session_id);
  const customerId = row.stripe_customer_id === null ? null : text(row.stripe_customer_id);
  const subscriptionId = row.stripe_subscription_id === null ? null : text(row.stripe_subscription_id);
  const expiresAt = text(row.expires_at);
  const createdAt = text(row.created_at);
  if (!id || !requestId || !idempotencyKey || !featureKey || revision === null || !payerRole || !payerId
    || !priceKey || !productId || !priceId || unitAmount === null || !currency || quantity === null
    || (creditsPerPack === null && row.credits_per_pack !== null) || quotedCredits === null || totalAmount === null
    || !state || (sessionId === null && row.stripe_checkout_session_id !== null)
    || (customerId === null && row.stripe_customer_id !== null) || (subscriptionId === null && row.stripe_subscription_id !== null)
    || !expiresAt || !createdAt) return null;
  return {
    id, request_id: requestId, idempotency_key: idempotencyKey, feature_key: featureKey,
    config_revision: revision, payer_role: payerRole, payer_id: payerId, price_key: priceKey,
    stripe_product_id: productId, stripe_price_id: priceId, unit_amount_cents: unitAmount, currency,
    pack_quantity: quantity, credits_per_pack: creditsPerPack, quoted_credits: quotedCredits,
    total_amount_cents: totalAmount, state, stripe_checkout_session_id: sessionId,
    stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, expires_at: expiresAt, created_at: createdAt,
  };
}

function createCheckoutStore(): FormCoachCheckoutStore {
  const db = createAdminClient();
  return {
    async reserveCustomer(input) {
      const { data, error } = await db.rpc("reserve_feature_customer_create", {
        p_payer_id: input.payerId,
        p_request_id: input.requestId,
        p_request_digest: input.digest,
      });
      if (error) throw new Error("Customer reservation is unavailable");
      const row = firstRecord(data);
      const outcome = text(row?.outcome);
      if (!outcome) throw new Error("Customer reservation returned an invalid result");
      const attemptId = row?.attempt_id === null ? null : text(row?.attempt_id);
      const customerId = row?.customer_id === null ? null : text(row?.customer_id);
      const stateRevision = row?.state_revision === null ? null : integer(row?.state_revision);
      if ((attemptId === null && row?.attempt_id !== null) || (customerId === null && row?.customer_id !== null)
        || (stateRevision === null && row?.state_revision !== null)) throw new Error("Customer reservation returned an invalid result");
      return { outcome, attemptId, customerId, stateRevision };
    },
    async readCustomerAttempt(attemptId) {
      const { data, error } = await db.from("feature_customer_create_attempts")
        .select("id,feature_key,payer_id,request_id,request_digest,idempotency_key,state,stripe_customer_id,state_revision,created_at")
        .eq("id", attemptId).maybeSingle();
      if (error) throw new Error("Customer reconciliation is unavailable");
      return parseCustomerAttempt(data);
    },
    async advanceCustomer(input) {
      const { data, error } = await db.rpc("advance_feature_customer_create", {
        p_attempt_id: input.attemptId,
        p_expected_state_revision: input.expectedStateRevision,
        p_next_state: input.nextState,
        p_provider_customer_id: input.providerCustomerId,
      });
      if (error) throw new Error("Customer state could not be recorded");
      const outcome = text(data);
      if (!outcome) throw new Error("Customer state returned an invalid result");
      return outcome;
    },
    async reserveCheckout(input) {
      const { data, error } = await db.rpc("reserve_feature_checkout", {
        p_feature_key: FORM_COACH_FEATURE_KEY,
        p_payer_id: input.payerId,
        p_config_revision: input.revision,
        p_price_key: input.priceKey,
        p_pack_quantity: input.quantity,
        p_request_id: input.requestId,
      });
      if (error) throw new Error("Checkout reservation is unavailable");
      const row = firstRecord(data);
      const outcome = text(row?.outcome);
      const requestId = text(row?.request_id);
      if (!outcome || !requestId) throw new Error("Checkout reservation returned an invalid result");
      const reservationId = row?.reservation_id === null ? null : text(row?.reservation_id);
      const expiresAt = row?.expires_at === null ? null : text(row?.expires_at);
      if ((reservationId === null && row?.reservation_id !== null) || (expiresAt === null && row?.expires_at !== null)) {
        throw new Error("Checkout reservation returned an invalid result");
      }
      return { outcome, reservationId, requestId, expiresAt };
    },
    async readUnresolvedCheckout(payerId) {
      const { data, error } = await db.from("feature_checkout_reservations")
        .select("id,request_id,idempotency_key,feature_key,config_revision,payer_role,payer_id,price_key,stripe_product_id,stripe_price_id,unit_amount_cents,currency,pack_quantity,credits_per_pack,quoted_credits,total_amount_cents,state,stripe_checkout_session_id,stripe_customer_id,stripe_subscription_id,expires_at,created_at")
        .eq("feature_key", FORM_COACH_FEATURE_KEY)
        .eq("payer_id", payerId)
        .in("state", ["reserved", "unknown", "bound", "cancel_required"])
        .limit(2);
      if (error || !Array.isArray(data)) throw new Error("Checkout reconciliation is unavailable");
      if (data.length > 1) throw new Error("Checkout reconciliation found conflicting reservations");
      return parseCheckoutReservation(data[0] ?? null);
    },
    async readCheckoutReservation(reservationId) {
      const { data, error } = await db.from("feature_checkout_reservations")
        .select("id,request_id,idempotency_key,feature_key,config_revision,payer_role,payer_id,price_key,stripe_product_id,stripe_price_id,unit_amount_cents,currency,pack_quantity,credits_per_pack,quoted_credits,total_amount_cents,state,stripe_checkout_session_id,stripe_customer_id,stripe_subscription_id,expires_at,created_at")
        .eq("id", reservationId).eq("feature_key", FORM_COACH_FEATURE_KEY).maybeSingle();
      if (error) throw new Error("Checkout reconciliation is unavailable");
      return parseCheckoutReservation(data);
    },
    async markCheckoutUnknown(reservationId) {
      const { data, error } = await db.rpc("mark_feature_checkout_unknown", { p_reservation_id: reservationId });
      if (error) return false;
      return data === "unknown" || data === "already_unknown";
    },
    async bindCheckout(input) {
      const { data, error } = await db.rpc("bind_feature_checkout_session", {
        p_reservation_id: input.reservationId,
        p_session_id: input.sessionId,
        p_customer_id: input.customerId,
        p_subscription_id: input.subscriptionId,
      });
      if (error) throw new Error("Checkout session binding is unavailable");
      const outcome = text(data);
      if (!outcome) throw new Error("Checkout binding returned an invalid result");
      return outcome;
    },
    async reconcileExpiredCheckout(input) {
      const { data, error } = await db.rpc("record_form_coach_checkout_expired_session", {
        p_request_id: input.requestId,
        p_reservation_id: input.reservationId,
        p_session_id: input.sessionId,
        p_customer_id: input.customerId,
        p_session_status: input.sessionStatus,
        p_payment_status: input.paymentStatus,
        p_mode: input.mode,
        p_metadata: input.metadata,
        p_price_id: input.priceId,
        p_quantity: input.quantity,
        p_evidence_digest: input.evidenceDigest,
      });
      if (error) throw new Error("Expired Checkout reconciliation is unavailable");
      const outcome = text(data);
      if (!outcome) throw new Error("Expired Checkout reconciliation returned an invalid result");
      return outcome;
    },
    async readVerifiedCustomer(payerId) {
      const { data: mapping, error: mappingError } = await db.from("feature_payer_customer_mappings")
        .select("feature_key,payer_id,stripe_customer_id,create_attempt_id")
        .eq("feature_key", FORM_COACH_FEATURE_KEY).eq("payer_id", payerId).maybeSingle();
      if (mappingError || !mapping) return null;
      const mapped = record(mapping);
      const customerId = text(mapped?.stripe_customer_id);
      const attemptId = text(mapped?.create_attempt_id);
      if (mapped?.feature_key !== FORM_COACH_FEATURE_KEY || mapped?.payer_id !== payerId || !customerId || !attemptId) return null;
      const { data: attempt, error: attemptError } = await db.from("feature_customer_create_attempts")
        .select("feature_key,payer_id,state,stripe_customer_id")
        .eq("id", attemptId).maybeSingle();
      const attemptRow = record(attempt);
      if (attemptError || attemptRow?.feature_key !== FORM_COACH_FEATURE_KEY || attemptRow?.payer_id !== payerId
        || attemptRow?.state !== "verified" || attemptRow?.stripe_customer_id !== customerId) return null;
      const { data: providerObject, error: objectError } = await db.from("feature_provider_objects")
        .select("feature_key,object_type,object_id,payer_id")
        .eq("feature_key", FORM_COACH_FEATURE_KEY).eq("object_type", "customer").eq("object_id", customerId).maybeSingle();
      const providerRow = record(providerObject);
      if (objectError || providerRow?.feature_key !== FORM_COACH_FEATURE_KEY || providerRow?.object_type !== "customer"
        || providerRow?.object_id !== customerId || providerRow?.payer_id !== payerId) return null;
      return { customerId, attemptId };
    },
  };
}

function customerDigest(payerId: string): string {
  return createHash("sha256").update(JSON.stringify({ feature: FORM_COACH_FEATURE_KEY, payerId, operation: "dedicated_customer" })).digest("hex");
}

function customerMetadata(input: { payerId: string; attemptId: string }): Stripe.MetadataParam {
  return {
    feature_namespace: FORM_COACH_FEATURE_KEY,
    feature_key: FORM_COACH_FEATURE_KEY,
    payer_id: input.payerId,
    customer_create_attempt_id: input.attemptId,
  };
}

function customerMatches(value: Stripe.Customer | Stripe.DeletedCustomer, input: { payerId: string; attemptId: string }): value is Stripe.Customer {
  if ("deleted" in value && value.deleted) return false;
  return value.metadata?.feature_namespace === FORM_COACH_FEATURE_KEY
    && value.metadata?.feature_key === FORM_COACH_FEATURE_KEY
    && value.metadata?.payer_id === input.payerId
    && value.metadata?.customer_create_attempt_id === input.attemptId;
}

function customerIdFromSession(session: Stripe.Checkout.Session): string | null {
  if (typeof session.customer === "string") return session.customer;
  if (session.customer && typeof session.customer === "object") return session.customer.id;
  return null;
}

function sessionMatchesReservation(session: Stripe.Checkout.Session, row: CheckoutReservation): boolean {
  const metadata = session.metadata;
  const lineItems = session.line_items?.data;
  const lineItem = lineItems?.[0];
  const price = lineItem?.price;
  const product = price && typeof price.product === "string"
    ? price.product
    : price?.product && typeof price.product === "object" ? price.product.id : null;
  const expectedMode = row.credits_per_pack === null ? "subscription" : "payment";
  const expectedPriceType = expectedMode === "subscription" ? "recurring" : "one_time";
  const total = row.total_amount_cents;
  return session.id === row.stripe_checkout_session_id
    && metadata !== null
    && Object.keys(metadata).length === 8
    && metadata.feature_namespace === FORM_COACH_FEATURE_KEY
    && metadata.feature_key === FORM_COACH_FEATURE_KEY
    && metadata.reservation_id === row.id
    && metadata.request_id === row.request_id
    && metadata.payer_id === row.payer_id
    && metadata.config_revision === String(row.config_revision)
    && metadata.price_key === row.price_key
    && metadata.pack_quantity === String(row.pack_quantity)
    && session.mode === expectedMode
    && customerIdFromSession(session) === row.stripe_customer_id
    && session.client_reference_id === row.payer_id
    && session.currency === row.currency.toLowerCase()
    && session.amount_subtotal === total
    && session.amount_total === total
    && session.allow_promotion_codes === false
    && (session.discounts?.length ?? 0) === 0
    && session.automatic_tax?.enabled === false
    && session.total_details?.amount_discount === 0
    && session.total_details.amount_tax === 0
    && (session.total_details.amount_shipping ?? 0) === 0
    && Array.isArray(lineItems)
    && session.line_items?.has_more === false
    && lineItems.length === 1
    && lineItem !== undefined
    && price !== null && price !== undefined
    && price.id === row.stripe_price_id
    && product === row.stripe_product_id
    && price.unit_amount === row.unit_amount_cents
    && price.currency === row.currency.toLowerCase()
    && price.type === expectedPriceType
    && lineItem.quantity === row.pack_quantity
    && lineItem.currency === row.currency.toLowerCase()
    && lineItem.amount_subtotal === total
    && lineItem.amount_discount === 0
    && lineItem.amount_tax === 0
    && lineItem.amount_total === total;
}

async function retrieveOwnedSession(
  stripe: CheckoutProvider,
  row: CheckoutReservation,
): Promise<Stripe.Checkout.Session | null> {
  if (!row.stripe_checkout_session_id) return null;
  const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id, {
    expand: ["line_items.data.price.product"],
  });
  return sessionMatchesReservation(session, row) ? session : null;
}

async function reconcileListedSession(
  stripe: CheckoutProvider,
  row: CheckoutReservation,
  customerId: string,
): Promise<Stripe.Checkout.Session | null> {
  const createdAt = Date.parse(row.created_at);
  if (!Number.isFinite(createdAt)) return null;
  const createdGte = Math.floor(createdAt / 1000);
  const matches: Stripe.Checkout.Session[] = [];
  for (const status of ["open", "complete", "expired"] as const) {
    const page = await stripe.checkout.sessions.list({
      customer: customerId,
      created: { gte: createdGte },
      status,
      limit: SESSION_LIST_LIMIT,
    });
    if (page.has_more) return null;
    for (const session of page.data) {
      if (session.metadata?.reservation_id === row.id
        && session.metadata?.request_id === row.request_id
        && session.metadata?.feature_namespace === FORM_COACH_FEATURE_KEY) matches.push(session);
    }
  }
  if (matches.length !== 1) return null;
  const current = await stripe.checkout.sessions.retrieve(matches[0]!.id, {
    expand: ["line_items.data.price.product"],
  });
  return sessionMatchesReservation(current, {
    ...row,
    stripe_checkout_session_id: current.id,
    stripe_customer_id: customerId,
  }) ? current : null;
}

async function ensureOwnedCustomer(
  input: { payerId: string },
  dependencies: { store: FormCoachCheckoutStore; stripe: CustomerProvider; now: Date },
): Promise<{ customerId: string; attemptId: string } | null> {
  const requested = await dependencies.store.reserveCustomer({
    payerId: input.payerId,
    requestId: randomUUID(),
    digest: customerDigest(input.payerId),
  });
  if (["blocked_deletion", "legacy_customer_ambiguous"].includes(requested.outcome) || !requested.attemptId) return null;
  const attempt = await dependencies.store.readCustomerAttempt(requested.attemptId);
  if (!attempt || attempt.id !== requested.attemptId || attempt.feature_key !== FORM_COACH_FEATURE_KEY
    || attempt.payer_id !== input.payerId || !/^form-coach-customer:[0-9a-f-]{36}$/.test(attempt.idempotency_key)) return null;

  const exactIdentity = { payerId: input.payerId, attemptId: attempt.id };
  const verifyCurrent = async (customerId: string): Promise<boolean> => {
    const customer = await dependencies.stripe.customers.retrieve(customerId);
    if (!customerMatches(customer, exactIdentity)) return false;
    if (attempt.state === "verified") return true;
    const bound = attempt.stripe_customer_id === customer.id && attempt.state === "bound";
    if (!bound) return false;
    const state = await dependencies.store.advanceCustomer({
      attemptId: attempt.id,
      expectedStateRevision: attempt.state_revision,
      nextState: "verified",
      providerCustomerId: customer.id,
    });
    return state === "verified";
  };

  if (attempt.state === "verified" || attempt.state === "bound") {
    if (!attempt.stripe_customer_id) return null;
    return await verifyCurrent(attempt.stripe_customer_id)
      ? { customerId: attempt.stripe_customer_id, attemptId: attempt.id }
      : null;
  }
  if (attempt.state !== "reserved" && attempt.state !== "unknown") return null;

  const query = `metadata['feature_namespace']:'form_coach' AND metadata['customer_create_attempt_id']:'${attempt.id}'`;
  let searchFailed = false;
  try {
    const found = await dependencies.stripe.customers.search({ query, limit: 10 });
    if (found.has_more || found.data.length > 1) return null;
    if (found.data.length === 1) {
      const candidate = found.data[0]!;
      if (!customerMatches(candidate, exactIdentity)) return null;
      const bound = await dependencies.store.advanceCustomer({
        attemptId: attempt.id,
        expectedStateRevision: attempt.state_revision,
        nextState: "bound",
        providerCustomerId: candidate.id,
      });
      if (bound !== "bound") return null;
      const latest = await dependencies.stripe.customers.retrieve(candidate.id);
      if (!customerMatches(latest, exactIdentity)) return null;
      const verified = await dependencies.store.advanceCustomer({
        attemptId: attempt.id,
        expectedStateRevision: attempt.state_revision + 1,
        nextState: "verified",
        providerCustomerId: candidate.id,
      });
      return verified === "verified" ? { customerId: candidate.id, attemptId: attempt.id } : null;
    }
  } catch {
    searchFailed = true;
  }

  const createdAt = Date.parse(attempt.created_at);
  const age = Number.isFinite(createdAt) ? dependencies.now.getTime() - createdAt : Infinity;
  if (age < 0 || age >= MAX_CREATE_AGE_MS) return null;
  // Search can lag and is not a read-after-write API. A retry is safe only with
  // the persisted idempotency key while Stripe's guaranteed window is open.
  if (searchFailed && age >= MAX_CREATE_AGE_MS) return null;
  const created = await dependencies.stripe.customers.create({
    metadata: customerMetadata(exactIdentity),
  }, { idempotencyKey: attempt.idempotency_key });
  if (!created.id) return null;
  const bound = await dependencies.store.advanceCustomer({
    attemptId: attempt.id,
    expectedStateRevision: attempt.state_revision,
    nextState: "bound",
    providerCustomerId: created.id,
  });
  if (bound !== "bound") return null;
  const current = await dependencies.stripe.customers.retrieve(created.id);
  if (!customerMatches(current, exactIdentity)) return null;
  const verified = await dependencies.store.advanceCustomer({
    attemptId: attempt.id,
    expectedStateRevision: attempt.state_revision + 1,
    nextState: "verified",
    providerCustomerId: created.id,
  });
  return verified === "verified" ? { customerId: created.id, attemptId: attempt.id } : null;
}

async function verifyMappedCustomer(
  payerId: string,
  store: FormCoachCheckoutStore,
  stripe: CustomerProvider,
): Promise<{ customerId: string; attemptId: string } | null> {
  const mapped = await store.readVerifiedCustomer(payerId);
  if (!mapped) return null;
  const customer = await stripe.customers.retrieve(mapped.customerId);
  return customerMatches(customer, { payerId, attemptId: mapped.attemptId })
    ? mapped
    : null;
}

function reservationMatchesQuote(
  row: CheckoutReservation,
  input: { payerId: string; role: string; reservationRequestId: string; pricing: InternalPricingSnapshot; offer: InternalCheckoutOffer; quantity: number },
): boolean {
  const expectedCredits = (input.offer.creditsPerPack ?? 0) * input.quantity;
  return row.feature_key === FORM_COACH_FEATURE_KEY
    && row.payer_id === input.payerId
    && row.payer_role === input.role
    && row.config_revision === input.pricing.revision
    && row.price_key === input.offer.priceKey
    && row.unit_amount_cents === input.offer.amountCents
    && row.currency === input.offer.currency
    && row.pack_quantity === input.quantity
    && row.credits_per_pack === input.offer.creditsPerPack
    && row.quoted_credits === expectedCredits
    && row.total_amount_cents === input.offer.amountCents * input.quantity
    && row.request_id === input.reservationRequestId
    && row.idempotency_key === `form-coach:${row.request_id}`
    && row.stripe_product_id === input.offer.stripeProductId
    && row.stripe_price_id === input.offer.stripePriceId;
}

function frozenReservationPricing(
  row: CheckoutReservation,
  historical: InternalPricingSnapshot | null,
): InternalPricingSnapshot | null {
  const payer = row.payer_role === "coach" || row.payer_role === "member" ? row.payer_role : null;
  const billingModel = row.credits_per_pack === null ? "subscription" : "per_assessment";
  const expectedTotal = row.unit_amount_cents * row.pack_quantity;
  const expectedCredits = (row.credits_per_pack ?? 0) * row.pack_quantity;
  if (!historical || historical.status !== "live" || historical.featureKey !== FORM_COACH_FEATURE_KEY
    || historical.revision !== row.config_revision || historical.payer !== payer
    || historical.billingModel !== billingModel || row.feature_key !== FORM_COACH_FEATURE_KEY || !payer
    || !Number.isSafeInteger(row.config_revision) || row.config_revision <= 0
    || !/^[a-f0-9-]{36}$/i.test(row.request_id) || row.idempotency_key !== `form-coach:${row.request_id}`
    || !/^[a-z][a-z0-9_]{0,39}$/.test(row.price_key) || !row.stripe_product_id || !row.stripe_price_id
    || !Number.isSafeInteger(row.unit_amount_cents) || row.unit_amount_cents <= 0
    || !/^[A-Z]{3}$/.test(row.currency) || !Number.isSafeInteger(row.pack_quantity) || row.pack_quantity < 1 || row.pack_quantity > 100
    || (row.credits_per_pack !== null && (!Number.isSafeInteger(row.credits_per_pack) || row.credits_per_pack <= 0))
    || !Number.isSafeInteger(expectedTotal) || row.total_amount_cents !== expectedTotal
    || !Number.isSafeInteger(expectedCredits) || row.quoted_credits !== expectedCredits
    || !Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.expires_at))) return null;
  const offer = historical.offers.find((item) => item.priceKey === row.price_key);
  if (!offer || offer.amountCents !== row.unit_amount_cents || offer.currency !== row.currency
    || offer.creditsPerPack !== row.credits_per_pack || offer.stripeProductId !== row.stripe_product_id
    || offer.stripePriceId !== row.stripe_price_id
    || (billingModel === "subscription" && offer.interval === null)
    || (billingModel === "per_assessment" && offer.interval !== null)) return null;
  return { ...historical, offers: [offer] };
}

function authorizeFrozenQuoteForCreate(
  frozen: InternalPricingSnapshot,
  current: InternalPricingSnapshot | null,
): InternalPricingSnapshot | null {
  if (!current || current.status !== "live" || current.featureKey !== FORM_COACH_FEATURE_KEY) return null;
  return frozen;
}

function selectionMatchesFrozenQuote(
  input: Readonly<{ payerRole: string; priceKey: string; quantity: number }>,
  row: CheckoutReservation,
): boolean {
  return input.payerRole === row.payer_role
    && input.priceKey === row.price_key
    && input.quantity === row.pack_quantity;
}

async function reconcileFrozenCheckoutWithoutStartingAnother(
  row: CheckoutReservation,
  payerId: string,
  selectionMatches: boolean,
  dependencies: FormCoachCheckoutDependencies,
): Promise<FormCoachCheckoutResult | null> {
  if (row.state === "cancel_required") return { kind: "status", status: "account_deleting" };
  if (row.payer_id !== payerId) return { kind: "status", status: "pending" };
  if (!row.stripe_checkout_session_id && row.state === "reserved") return null;
  if (!row.stripe_checkout_session_id && row.state !== "unknown") return { kind: "status", status: "pending" };

  try {
    const ownedCustomer = await verifyMappedCustomer(payerId, dependencies.store, dependencies.stripe);
    if (!ownedCustomer || (row.stripe_customer_id && ownedCustomer.customerId !== row.stripe_customer_id)) {
      return { kind: "status", status: "pending" };
    }

    let session: Stripe.Checkout.Session | null = null;
    let effectiveRow = row;
    if (row.stripe_checkout_session_id) {
      effectiveRow = { ...row, stripe_customer_id: ownedCustomer.customerId };
      session = await retrieveOwnedSession(dependencies.stripe, effectiveRow);
      if (session && !row.stripe_customer_id) {
        const boundState = await dependencies.store.bindCheckout({
          reservationId: row.id,
          sessionId: session.id,
          customerId: ownedCustomer.customerId,
          subscriptionId: typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null,
        });
        if (boundState === "cancel_required") return { kind: "status", status: "account_deleting" };
      }
    } else if (row.state === "unknown") {
      session = await reconcileListedSession(dependencies.stripe, row, ownedCustomer.customerId);
      if (session) {
        const boundState = await dependencies.store.bindCheckout({
          reservationId: row.id,
          sessionId: session.id,
          customerId: ownedCustomer.customerId,
          subscriptionId: typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null,
        });
        if (boundState === "cancel_required") return { kind: "status", status: "account_deleting" };
        effectiveRow = { ...row, stripe_checkout_session_id: session.id, stripe_customer_id: ownedCustomer.customerId };
      }
    }

    if (!session) return row.stripe_checkout_session_id ? { kind: "status", status: "pending" } : null;
    if (session.status === "expired" && await recordExpiredCheckoutSession(dependencies.store, effectiveRow, session)) {
      return { kind: "status", status: "expired" };
    }
    if (session.status === "open" && isStripeCheckoutUrl(session.url) && selectionMatches) {
      return { kind: "redirect", url: session.url };
    }
    return { kind: "status", status: "pending" };
  } catch {
    // A changed selection never starts a replacement charge. Provider or
    // reconciliation uncertainty remains pending for a later retry.
    return { kind: "status", status: "pending" };
  }
}

async function replayFrozenReservation(
  unresolved: CheckoutReservation,
  input: Readonly<{ payerId: string; payerRole: string; email: string; displayName: string; priceKey: string; quantity: number; requestId: string }>,
  dependencies: FormCoachCheckoutDependencies,
): Promise<FormCoachCheckoutResult> {
  if (unresolved.state === "cancel_required") return { kind: "status", status: "account_deleting" };
  if (unresolved.state === "paid") return { kind: "status", status: "already_active" };
  if (unresolved.state === "expired") return { kind: "status", status: "expired" };
  if (unresolved.state !== "reserved" && unresolved.state !== "unknown" && unresolved.state !== "bound") {
    return { kind: "status", status: "pending" };
  }
  if (unresolved.payer_id !== input.payerId) return { kind: "status", status: "unavailable" };
  const selectionMatches = selectionMatchesFrozenQuote(input, unresolved);
  const recovered = await reconcileFrozenCheckoutWithoutStartingAnother(
    unresolved, input.payerId, selectionMatches, dependencies,
  );
  if (recovered) return recovered;
  if (!selectionMatches) return { kind: "status", status: "pending" };
  let currentPricing: InternalPricingSnapshot | null;
  try {
    currentPricing = await dependencies.pricing();
  } catch {
    currentPricing = null;
  }
  if (!currentPricing || currentPricing.status !== "live" || currentPricing.featureKey !== FORM_COACH_FEATURE_KEY) {
    return { kind: "status", status: "pending" };
  }
  let historicalPricing: InternalPricingSnapshot | null;
  try {
    historicalPricing = await dependencies.pricingRevision(unresolved.config_revision);
  } catch {
    historicalPricing = null;
  }
  const frozenPricing = frozenReservationPricing(unresolved, historicalPricing);
  if (!frozenPricing) return { kind: "status", status: "pending" };
  const authorizedPricing = authorizeFrozenQuoteForCreate(frozenPricing, currentPricing);
  if (!authorizedPricing) return { kind: "status", status: "pending" };
  const frozenStore: FormCoachCheckoutStore = {
    ...dependencies.store,
    reserveCheckout: async () => ({
      outcome: "existing",
      reservationId: unresolved.id,
      requestId: unresolved.request_id,
      expiresAt: unresolved.expires_at,
    }),
    readCheckoutReservation: async (reservationId) => reservationId === unresolved.id ? unresolved : null,
  };
  const result = await createNewFormCoachCheckout({
    ...input,
    payerRole: unresolved.payer_role,
    requestId: unresolved.request_id,
    priceKey: unresolved.price_key,
    quantity: unresolved.pack_quantity,
  }, {
    ...dependencies,
    pricing: async () => authorizedPricing,
    store: frozenStore,
  });
  return result;
}

function paymentMode(model: FeatureBillingModel): "payment" | "subscription" {
  return model === "subscription" ? "subscription" : "payment";
}

async function recordExpiredCheckoutSession(
  store: FormCoachCheckoutStore,
  row: CheckoutReservation,
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  if (session.status !== "expired" || session.payment_status !== "unpaid" || !row.stripe_customer_id) return false;
  const lineItem = session.line_items?.data[0];
  const metadata = session.metadata;
  if (!lineItem?.price?.id || typeof lineItem.quantity !== "number" || !metadata) return false;
  const evidence = {
    sessionId: session.id,
    customerId: row.stripe_customer_id,
    sessionStatus: session.status,
    paymentStatus: session.payment_status,
    mode: session.mode,
    metadata,
    priceId: lineItem.price.id,
    quantity: lineItem.quantity,
  };
  const evidenceDigest = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  try {
    const outcome = await store.reconcileExpiredCheckout({
      requestId: row.request_id,
      reservationId: row.id,
      sessionId: session.id,
      customerId: row.stripe_customer_id,
      sessionStatus: session.status,
      paymentStatus: session.payment_status,
      mode: session.mode,
      metadata,
      priceId: lineItem.price.id,
      quantity: lineItem.quantity,
      evidenceDigest,
    });
    return outcome === "expired" || outcome === "already_expired";
  } catch {
    return false;
  }
}

async function retrieveAndValidateSession(
  stripe: CheckoutProvider,
  row: CheckoutReservation,
  store: FormCoachCheckoutStore,
): Promise<{ kind: "open"; url: string } | { kind: "expired" } | null> {
  const session = await retrieveOwnedSession(stripe, row);
  if (!session) return null;
  if (session.status === "open" && isStripeCheckoutUrl(session.url)) return { kind: "open", url: session.url };
  if (session.status === "expired" && await recordExpiredCheckoutSession(store, row, session)) return { kind: "expired" };
  return null;
}

export async function createFormCoachCheckout(
  input: Readonly<{ payerId: string; payerRole: string; email: string; displayName: string; priceKey: string; quantity: number; requestId: string }>,
  dependencies: FormCoachCheckoutDependencies,
): Promise<FormCoachCheckoutResult> {
  if (!dependencies.enabled) return { kind: "status", status: "coming_soon" };
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) return { kind: "status", status: "invalid" };

  let unresolved: CheckoutReservation | null;
  try {
    unresolved = await dependencies.store.readUnresolvedCheckout(input.payerId);
  } catch {
    return { kind: "status", status: "unavailable" };
  }
  if (unresolved) {
    return replayFrozenReservation(unresolved, input, dependencies);
  }
  return createNewFormCoachCheckout(input, dependencies);
}

async function createNewFormCoachCheckout(
  input: Readonly<{ payerId: string; payerRole: string; email: string; displayName: string; priceKey: string; quantity: number; requestId: string }>,
  dependencies: FormCoachCheckoutDependencies,
): Promise<FormCoachCheckoutResult> {
  if (!dependencies.enabled) return { kind: "status", status: "coming_soon" };
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId) || !/^[a-z][a-z0-9_]{0,39}$/.test(input.priceKey)
    || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) {
    return { kind: "status", status: "invalid" };
  }
  const pricing = await dependencies.pricing();
  if (!pricing || pricing.status !== "live" || !pricing.billingModel || pricing.payer !== input.payerRole) {
    return { kind: "status", status: "unavailable" };
  }
  const offer = pricing.offers.find((entry) => entry.priceKey === input.priceKey);
  if (!offer || !Number.isSafeInteger(offer.amountCents) || offer.amountCents <= 0
    || !Number.isSafeInteger(offer.amountCents * input.quantity)
    || !offer.stripeProductId || !offer.stripePriceId
    || (pricing.billingModel === "subscription" && input.quantity !== 1)
    || (pricing.billingModel === "subscription" && (!offer.interval || offer.creditsPerPack !== null))
    || (pricing.billingModel === "per_assessment" && (offer.interval !== null || !offer.creditsPerPack))) {
    return { kind: "status", status: "invalid" };
  }
  const cancelUrl = formCoachReturnUrl(dependencies.siteUrl, "?checkout=cancelled");
  if (!cancelUrl) return { kind: "status", status: "unavailable" };

  const reserved = await dependencies.store.reserveCheckout({
    payerId: input.payerId,
    revision: pricing.revision,
    priceKey: input.priceKey,
    quantity: input.quantity,
    requestId: input.requestId,
  });
  if (reserved.outcome === "account_deleting" || reserved.outcome === "blocked_deletion") {
    return { kind: "status", status: "account_deleting" };
  }
  if (["subscription_exists", "pending_reconciliation"].includes(reserved.outcome) && !reserved.reservationId) {
    return { kind: "status", status: "already_active" };
  }
  if (!["reserved", "existing", "pending_reconciliation"].includes(reserved.outcome) || !reserved.reservationId) {
    return { kind: "status", status: "unavailable" };
  }
  const row = await dependencies.store.readCheckoutReservation(reserved.reservationId);
  if (!row || row.request_id !== reserved.requestId) {
    return { kind: "status", status: "unavailable" };
  }
  if (reserved.outcome === "pending_reconciliation") {
    return replayFrozenReservation(row, input, dependencies);
  }
  if (!reservationMatchesQuote(row, {
    payerId: input.payerId,
    role: input.payerRole,
    reservationRequestId: reserved.requestId,
    pricing,
    offer,
    quantity: input.quantity,
  })) {
    return { kind: "status", status: "unavailable" };
  }
  const successUrl = formCoachReturnUrl(dependencies.siteUrl, `?checkout=returned&request_id=${row.request_id}`);
  if (!successUrl) return { kind: "status", status: "unavailable" };
  if (row.stripe_checkout_session_id) {
    if (!row.stripe_customer_id) return { kind: "status", status: "pending" };
    try {
      const ownedCustomer = await verifyMappedCustomer(input.payerId, dependencies.store, dependencies.stripe);
      if (!ownedCustomer || ownedCustomer.customerId !== row.stripe_customer_id) return { kind: "status", status: "pending" };
    } catch {
      return { kind: "status", status: "pending" };
    }
    const existingSession = await retrieveAndValidateSession(dependencies.stripe, row, dependencies.store);
    if (existingSession?.kind === "open") return { kind: "redirect", url: existingSession.url };
    return { kind: "status", status: existingSession?.kind === "expired" ? "expired" : "pending" };
  }
  if (!["reserved", "unknown"].includes(row.state)) return { kind: "status", status: "pending" };

  let customer: { customerId: string; attemptId: string } | null = null;
  try {
    customer = row.stripe_customer_id
      ? await verifyMappedCustomer(input.payerId, dependencies.store, dependencies.stripe)
      : await ensureOwnedCustomer({ payerId: input.payerId }, {
        store: dependencies.store,
        stripe: dependencies.stripe,
        now: dependencies.now(),
      });
  } catch {
    customer = null;
  }
  if (!customer || (row.stripe_customer_id && customer.customerId !== row.stripe_customer_id)) {
    await dependencies.store.markCheckoutUnknown(row.id);
    return { kind: "status", status: "pending" };
  }

  const createdAt = Date.parse(row.created_at);
  const age = Number.isFinite(createdAt) ? dependencies.now().getTime() - createdAt : Infinity;
  if (age < 0) return { kind: "status", status: "pending" };
  let prior: Stripe.Checkout.Session | null = null;
  if (row.state === "unknown") {
    try {
      prior = await reconcileListedSession(dependencies.stripe, row, customer.customerId);
    } catch {
      prior = null;
    }
  }
  if (prior) {
    const state = await dependencies.store.bindCheckout({
      reservationId: row.id,
      sessionId: prior.id,
      customerId: customer.customerId,
      subscriptionId: typeof prior.subscription === "string" ? prior.subscription : prior.subscription?.id ?? null,
    });
    if (state === "cancel_required") return { kind: "status", status: "account_deleting" };
    const bound = { ...row, stripe_checkout_session_id: prior.id, stripe_customer_id: customer.customerId };
    const validated = await retrieveAndValidateSession(dependencies.stripe, bound, dependencies.store);
    if (validated?.kind === "open") return { kind: "redirect", url: validated.url };
    return { kind: "status", status: validated?.kind === "expired" ? "expired" : "pending" };
  }

  // The SQL expiry is a local reservation deadline, not evidence that a Stripe
  // Session expired. Reconcile first; without a matching current Session, do not
  // create after the reservation deadline or beyond Stripe's idempotency window.
  if (age >= MAX_CREATE_AGE_MS || Date.parse(row.expires_at) <= dependencies.now().getTime()) {
    await dependencies.store.markCheckoutUnknown(row.id);
    return { kind: "status", status: "pending" };
  }

  let created: Stripe.Checkout.Session;
  try {
    created = await dependencies.stripe.checkout.sessions.create({
      mode: paymentMode(pricing.billingModel),
      customer: customer.customerId,
      client_reference_id: input.payerId,
      line_items: [{ price: offer.stripePriceId, quantity: input.quantity }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: false,
      metadata: {
        feature_namespace: FORM_COACH_FEATURE_KEY,
        feature_key: FORM_COACH_FEATURE_KEY,
        payer_id: input.payerId,
        reservation_id: row.id,
        request_id: row.request_id,
        config_revision: String(row.config_revision),
        price_key: row.price_key,
        pack_quantity: String(row.pack_quantity),
      },
      ...(pricing.billingModel === "subscription" ? {
        subscription_data: {
          metadata: {
            feature_namespace: FORM_COACH_FEATURE_KEY,
            feature_key: FORM_COACH_FEATURE_KEY,
            payer_id: input.payerId,
            reservation_id: row.id,
            request_id: row.request_id,
            config_revision: String(row.config_revision),
            price_key: row.price_key,
          },
        },
      } : {}),
    }, { idempotencyKey: row.idempotency_key });
  } catch {
    await dependencies.store.markCheckoutUnknown(row.id);
    return { kind: "status", status: "pending" };
  }
  if (!created.id) {
    await dependencies.store.markCheckoutUnknown(row.id);
    return { kind: "status", status: "pending" };
  }
  let boundState: string;
  try {
    boundState = await dependencies.store.bindCheckout({
      reservationId: row.id,
      sessionId: created.id,
      customerId: customer.customerId,
      subscriptionId: typeof created.subscription === "string" ? created.subscription : created.subscription?.id ?? null,
    });
  } catch {
    await dependencies.store.markCheckoutUnknown(row.id);
    return { kind: "status", status: "pending" };
  }
  if (boundState === "cancel_required") return { kind: "status", status: "account_deleting" };
  const boundRow: CheckoutReservation = {
    ...row,
    stripe_checkout_session_id: created.id,
    stripe_customer_id: customer.customerId,
    stripe_subscription_id: typeof created.subscription === "string" ? created.subscription : created.subscription?.id ?? null,
  };
  const validated = await retrieveAndValidateSession(dependencies.stripe, boundRow, dependencies.store);
  if (validated?.kind === "open") return { kind: "redirect", url: validated.url };
  return { kind: "status", status: validated?.kind === "expired" ? "expired" : "pending" };
}

export async function loadFormCoachBillingPage(profileId: string): Promise<FormCoachBillingPageData> {
  const pricingPromise = readCurrentPricing().catch(() => null);
  const userDbPromise = createClient();
  let billing: FormCoachBillingSummary[] = [];
  let history: FormCoachPaymentHistory[] = [];
  let readError = false;
  try {
    const userDb = await userDbPromise;
    const [summaryResult, historyResult] = await Promise.all([
      userDb.from("feature_my_billing_summary")
        .select("source_kind,state,valid_through,remaining_credits")
        .eq("feature_key", FORM_COACH_FEATURE_KEY)
        .order("valid_through", { ascending: false, nullsFirst: false })
        .limit(50),
      userDb.from("feature_my_invoice_history")
        .select("kind,status,amount_due_cents,amount_paid_cents,currency,recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(50),
    ]);
    if (summaryResult.error || historyResult.error) readError = true;
    if (!summaryResult.error && Array.isArray(summaryResult.data)) {
      billing = summaryResult.data.flatMap((raw) => {
        const row = record(raw);
        const sourceKind = text(row?.source_kind);
        const state = text(row?.state);
        const validThrough = row?.valid_through === null ? null : text(row?.valid_through);
        const remainingCredits = row?.remaining_credits === null ? null : integer(row?.remaining_credits);
        return sourceKind && state && (validThrough !== null || row?.valid_through === null)
          && (remainingCredits !== null || row?.remaining_credits === null)
          ? [{ sourceKind, state, validThrough, remainingCredits }]
          : [];
      });
    }
    if (!historyResult.error && Array.isArray(historyResult.data)) {
      history = historyResult.data.flatMap((raw) => {
        const row = record(raw);
        const kind = text(row?.kind);
        const status = text(row?.status);
        const amountDueCents = integer(row?.amount_due_cents);
        const amountPaidCents = integer(row?.amount_paid_cents);
        const currency = text(row?.currency);
        const recordedAt = text(row?.recorded_at);
        return (kind === "subscription" || kind === "pack" || kind === "trial")
          && (status === "paid" || status === "trial" || status === "pending" || status === "refunded" || status === "review")
          && amountDueCents !== null && amountPaidCents !== null && currency && recordedAt
          ? [{ kind, status, amountDueCents, amountPaidCents, currency, recordedAt }]
          : [];
      });
    }
  } catch {
    readError = true;
  }
  let canManageBilling = false;
  try {
    const mapping = await createCheckoutStore().readVerifiedCustomer(profileId);
    canManageBilling = Boolean(mapping && isStripeConfigured());
  } catch {
    // Billing history remains readable even if the portal binding check is down.
  }
  const internalPricing = await pricingPromise;
  const pricing: FormCoachPricingSnapshot | null = internalPricing
    ? {
      featureKey: internalPricing.featureKey,
      revision: internalPricing.revision,
      status: internalPricing.status,
      payer: internalPricing.payer,
      billingModel: internalPricing.billingModel,
      displayName: internalPricing.displayName,
      description: internalPricing.description,
      marketingCopy: internalPricing.marketingCopy,
      offers: internalPricing.offers.map((offer) => ({
        priceKey: offer.priceKey,
        amountCents: offer.amountCents,
        currency: offer.currency,
        interval: offer.interval,
        creditsPerPack: offer.creditsPerPack,
      })),
    }
    : null;
  const liveOffer = Boolean(pricing?.status === "live" && pricing.offers.length > 0);
  return {
    pricing,
    billing,
    history,
    canManageBilling,
    checkoutEnabled: isFormCoachCheckoutEnabled() && isStripeConfigured() && liveOffer,
    readError,
    returnState: "none",
  };
}

type CheckoutReturnTestPorts = Readonly<{
  lookupReservation: (profileId: string, requestId: string) => Promise<unknown>;
  store: FormCoachCheckoutStore;
  stripeConfigured: () => boolean;
  stripe: Stripe;
}>;

export async function reconcileFormCoachCheckoutReturn(
  profileId: string,
  requestId: string | null,
  testPorts?: CheckoutReturnTestPorts,
): Promise<FormCoachBillingPageData["returnState"]> {
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return "none";
  try {
    let data: unknown;
    let store: FormCoachCheckoutStore;
    if (testPorts) {
      data = await testPorts.lookupReservation(profileId, requestId);
      store = testPorts.store;
    } else {
      const db = createAdminClient();
      const result = await db.from("feature_checkout_reservations")
        .select("id,request_id,idempotency_key,feature_key,config_revision,payer_role,payer_id,price_key,stripe_product_id,stripe_price_id,unit_amount_cents,currency,pack_quantity,credits_per_pack,quoted_credits,total_amount_cents,state,stripe_checkout_session_id,stripe_customer_id,stripe_subscription_id,expires_at,created_at")
        .eq("feature_key", FORM_COACH_FEATURE_KEY).eq("payer_id", profileId).eq("request_id", requestId).maybeSingle();
      if (result.error || !result.data) return "unavailable";
      data = result.data;
      store = createCheckoutStore();
    }
    if (!data) return "unavailable";
    const row = parseCheckoutReservation(data);
    if (!row || row.payer_id !== profileId || row.request_id !== requestId
      || !row.stripe_checkout_session_id || !row.stripe_customer_id) return "unavailable";
    if (testPorts ? !testPorts.stripeConfigured() : !isStripeConfigured()) return "processing";
    const stripe = testPorts?.stripe ?? getStripe();
    const ownedCustomer = await verifyMappedCustomer(profileId, store, stripe);
    if (!ownedCustomer || ownedCustomer.customerId !== row.stripe_customer_id) return "unavailable";
    const session = await retrieveOwnedSession(stripe, row);
    if (!session) return "unavailable";
    if (session.status === "expired") {
      return await recordExpiredCheckoutSession(store, row, session) ? "expired" : "unavailable";
    }
    // This opaque request UUID locates a reservation owned by this profile.
    // The server resolves its Stripe Session ID privately; the return URL never
    // grants access or carries provider identifiers.
    return "processing";
  } catch {
    return "processing";
  }
}

export async function startFormCoachCheckoutForAccount(input: {
  profile: { id: string; role: string; display_name: string };
  email: string;
  priceKey: string;
  quantity: number;
  requestId: string;
}): Promise<FormCoachCheckoutResult> {
  const enabled = isFormCoachCheckoutEnabled();
  if (!enabled) return { kind: "status", status: "coming_soon" };
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    return { kind: "status", status: "unavailable" };
  }
  return createFormCoachCheckout({
    payerId: input.profile.id,
    payerRole: input.profile.role,
    email: input.email,
    displayName: input.profile.display_name,
    priceKey: input.priceKey,
    quantity: input.quantity,
    requestId: input.requestId,
  }, {
    enabled,
    pricing: readCurrentPricing,
    pricingRevision: readPricingRevision,
    store: createCheckoutStore(),
    stripe,
    now: () => new Date(),
    siteUrl: getSiteUrl(),
  });
}
