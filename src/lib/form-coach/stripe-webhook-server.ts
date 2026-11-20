import "server-only";

import { createHash, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeTestMode } from "@/lib/stripe";
import {
  recordFormCoachBillingConflict,
  recordFormCoachInvoiceSnapshot,
  resolveFormCoachBillingConflicts,
} from "./billing-lifecycle-server";

const FEATURE_KEY = "form_coach" as const;
const MAX_PROVIDER_ROWS = 100;

type Raw = Record<string, unknown>;

export type FormCoachWebhookReservation = Readonly<{
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
  trial_days: number;
  billing_interval: "month" | "year" | null;
  state: string;
  stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}>;

export type FormCoachWebhookSubscription = Readonly<{
  stripe_subscription_id: string;
  feature_key: string;
  payer_role: string;
  payer_id: string;
  config_revision: number;
  price_key: string;
  stripe_customer_id: string;
  status: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  state_revision: number;
  contract_version: number;
  stripe_product_id: string;
  stripe_price_id: string;
  amount_cents: number;
  currency: string;
  billing_interval: "month" | "year";
}>;

export type FormCoachWebhookInvoiceAlias = Readonly<{
  invoice_id: string;
  payer_id: string;
  subscription_id: string;
  state_revision: number;
}>;

export type FormCoachWebhookInvoiceHead = Readonly<{
  invoiceId: string;
  subscriptionId: string;
  payerId: string;
  contractVersion: number;
  status: string;
  currency: string;
  amountDueCents: number;
  amountPaidCents: number;
  periodStartEpoch: number;
  periodEndEpoch: number;
  paymentIntentId: string | null;
  chargeId: string | null;
  trialClaimId: string | null;
  lastEventId: string;
  stateRevision: number;
}>;

export type FormCoachPackReceipt = Readonly<{
  receiptId: string;
  requestId: string;
  payerId: string;
  customerId: string;
  paymentIntentId: string;
  amountCents: number;
  packQuantity: number;
  creditsPerPack: number;
  currency: string;
}>;

export type FormCoachWebhookStore = Readonly<{
  classify(metadata: Stripe.Metadata | null, objectId: string): Promise<string | null>;
  readReservation(input: { requestId?: string; sessionId?: string; subscriptionId?: string }): Promise<FormCoachWebhookReservation | null>;
  readVerifiedCustomer(payerId: string): Promise<{ customerId: string; attemptId: string } | null>;
  bindSession(input: { reservationId: string; sessionId: string; customerId: string; subscriptionId: string | null }): Promise<string>;
  applyCheckoutPayment(input: {
    eventId: string; eventType: string; eventMetadata: Stripe.Metadata; sessionId: string; paymentObjectId: string;
    paymentIntentId: string | null; priceId: string; amountCents: number; currency: string; quantity: number;
  }): Promise<string>;
  reconcileExpiredSession(input: {
    requestId: string; reservationId: string; sessionId: string; customerId: string; status: string;
    paymentStatus: string; mode: string; metadata: Stripe.Metadata; priceId: string; quantity: number; digest: string;
  }): Promise<string>;
  hasTerminalBinding(input: { sessionId?: string; subscriptionId?: string }): Promise<boolean>;
  readSubscription(subscriptionId: string): Promise<FormCoachWebhookSubscription | null>;
  readInvoiceRevision(invoiceId: string): Promise<number>;
  readInvoiceHead(input: { invoiceId: string; subscriptionId: string; payerId: string; contractVersion: number }): Promise<FormCoachWebhookInvoiceHead | null>;
  readInvoiceAlias(kind: "invoice" | "payment_intent" | "charge", objectId: string): Promise<FormCoachWebhookInvoiceAlias | null>;
  readPackReceipt(input: { paymentIntentId: string | null; chargeId: string | null }): Promise<FormCoachPackReceipt | null>;
  recordPackRefund(input: {
    eventId: string; eventType: "charge.refunded" | "refund.updated"; refundId: string; receiptId: string;
    payerId: string; customerId: string; paymentIntentId: string; chargeId: string; amountCents: number;
    currency: string; refundedPackQuantity: number; outcome: "applied" | "manual_review";
    reviewReason: "partial_or_ambiguous_amount" | "provider_inventory_incomplete" | null; identityDigest: string;
    observedRefundTotalCents: number; observationDigest: string; observedAt: string;
  }): Promise<string>;
  readTrialRegistration(subscriptionId: string): Promise<{ requestId: string; reservationId: string; sessionId: string; customerId: string; invoiceId: string; trialDays: number; trialStart: string; trialEnd: string } | null>;
  readTrialClaim(subscriptionId: string, invoiceId: string): Promise<string | null>;
  registerTrial(input: Readonly<Record<string, unknown>>): Promise<string>;
  recordTrialTerminal(input: Readonly<Record<string, unknown>>): Promise<string>;
  applySubscriptionState(input: { eventId: string; eventType: string; subscriptionId: string; expectedRevision: number; status: string; periodEnd: string; cancelAtPeriodEnd: boolean }): Promise<string>;
  recordRefund(input: { eventId: string; eventType: string; digest: string; refundId: string; invoiceId: string; paymentIntentId: string | null; chargeId: string | null; payerId: string; amount: number; currency: string; expectedInvoiceRevision: number }): Promise<string>;
  recordConflict(input: { eventId: string; eventType: string; objectId: string; reservationId?: string | null; payerId?: string | null; kind: "payment_after_terminal" | "subscription_after_terminal" | "terminal_identity_mismatch" | "provider_state_conflict"; digest: string }): Promise<string>;
  resolveConflicts(input: {
    requestId: string; payerId: string; resourceKind: "checkout_session" | "subscription" | "invoice"; resourceId: string;
    expectedRevision: number | null; observedAt: string;
    evidence: Readonly<Record<string, string | number | null>>; evidenceDigest: string;
  }): Promise<string>;
  recordInvoiceSnapshot(evidence: Parameters<typeof recordFormCoachInvoiceSnapshot>[0]): Promise<string>;
}>;

export type FormCoachWebhookDependencies = Readonly<{
  stripe: Stripe;
  store: FormCoachWebhookStore;
}>;

const relevantEventTypes = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.finalized",
  "invoice.voided",
  "charge.refunded",
  "refund.updated",
]);

function record(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Raw
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  return string(record(value)?.id);
}

function metadataOf(value: unknown): Stripe.Metadata | null {
  const candidate = record(record(value)?.metadata);
  if (!candidate || Object.values(candidate).some((entry) => typeof entry !== "string")) return null;
  return candidate as Stripe.Metadata;
}

function invoiceSubscription(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (!parent || parent.type !== "subscription_details" || !parent.subscription_details) return null;
  return idOf(parent.subscription_details.subscription);
}

function eventObject(event: Stripe.Event): Raw {
  return record(event.data.object) ?? {};
}

function relevantIds(event: Stripe.Event): string[] {
  const object = eventObject(event);
  const parent = record(object.parent);
  const subscriptionDetails = record(parent?.subscription_details);
  const ids = [
    string(object.id),
    idOf(object.subscription),
    idOf(object.customer),
    idOf(object.invoice),
    idOf(object.payment_intent),
    idOf(object.charge),
    idOf(subscriptionDetails?.subscription),
  ];
  return [...new Set(ids.filter((value): value is string => value !== null))];
}

function eventMetadata(event: Stripe.Event): Stripe.Metadata | null {
  const object = eventObject(event);
  const parent = record(object.parent);
  const details = record(parent?.subscription_details);
  const detailsMetadata = record(details?.metadata);
  if (detailsMetadata && Object.values(detailsMetadata).every((value) => typeof value === "string")) {
    return detailsMetadata as Stripe.Metadata;
  }
  return metadataOf(object);
}

function explicitlyFormCoach(event: Stripe.Event): boolean {
  const metadata = eventMetadata(event);
  return metadata?.feature_namespace === FEATURE_KEY || metadata?.feature_key === FEATURE_KEY;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashRawIdSet(ids: readonly string[]): string {
  return createHash("sha256").update([...new Set(ids)].sort().join("\n")).digest("hex");
}

function deterministicSnapshotRequestId(eventId: string, snapshotDigest: string, expectedRevision: number): string {
  const bytes = createHash("sha256")
    .update(`form-coach-invoice-snapshot:${eventId}:${snapshotDigest}:${expectedRevision}`)
    .digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function asIso(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function expectedSessionMetadata(row: FormCoachWebhookReservation): Stripe.Metadata {
  return {
    feature_namespace: FEATURE_KEY,
    feature_key: FEATURE_KEY,
    payer_id: row.payer_id,
    reservation_id: row.id,
    request_id: row.request_id,
    config_revision: String(row.config_revision),
    price_key: row.price_key,
    pack_quantity: String(row.pack_quantity),
  };
}

function exactMetadata(actual: Stripe.Metadata | null, expected: Stripe.Metadata): boolean {
  if (!actual) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

function customerMatches(value: Stripe.Customer | Stripe.DeletedCustomer, row: FormCoachWebhookReservation, attemptId: string): value is Stripe.Customer {
  return !("deleted" in value && value.deleted)
    && value.metadata?.feature_namespace === FEATURE_KEY
    && value.metadata?.feature_key === FEATURE_KEY
    && value.metadata?.payer_id === row.payer_id
    && value.metadata?.customer_create_attempt_id === attemptId;
}

function subscriptionMetadataMatches(subscription: Stripe.Subscription, row: FormCoachWebhookReservation): boolean {
  const expected = expectedSessionMetadata(row);
  delete expected.pack_quantity;
  return exactMetadata(subscription.metadata, expected);
}

function priceProductId(price: Stripe.Price): string | null {
  return idOf(price.product);
}

function priceMatchesReservation(price: Stripe.Price | null, row: FormCoachWebhookReservation): boolean {
  if (!price || price.id !== row.stripe_price_id || priceProductId(price) !== row.stripe_product_id
    || price.unit_amount !== row.unit_amount_cents || price.currency.toUpperCase() !== row.currency) return false;
  if (row.credits_per_pack === null) {
    return row.billing_interval !== null && price.recurring?.interval === row.billing_interval;
  }
  return row.billing_interval === null && price.recurring === null;
}

function subscriptionMatchesReservationPrice(subscription: Stripe.Subscription, row: FormCoachWebhookReservation): boolean {
  if (subscription.items.has_more || subscription.items.data.length !== 1) return false;
  const item = subscription.items.data[0];
  return Boolean(item && item.quantity === row.pack_quantity && priceMatchesReservation(item.price, row));
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): number | null {
  if (subscription.items.has_more || subscription.items.data.length !== 1) return null;
  return subscription.items.data[0]?.current_period_end ?? null;
}

function paymentIntentIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const payments = invoice.payments?.data ?? [];
  if (invoice.payments?.has_more || payments.length > 1) return null;
  const payment = payments[0]?.payment;
  return payment?.type === "payment_intent" ? idOf(payment.payment_intent) : null;
}

function chargeIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const payments = invoice.payments?.data ?? [];
  if (invoice.payments?.has_more || payments.length > 1) return null;
  const payment = payments[0]?.payment;
  return payment?.type === "charge" ? idOf(payment.charge) : null;
}

async function createStore(): Promise<FormCoachWebhookStore> {
  const db = createAdminClient();
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error("Form Coach billing reconciliation is unavailable");
    return data;
  }
  async function readInvoiceRevision(invoiceId: string): Promise<number> {
    const { data, error } = await db.from("feature_subscription_invoice_current")
      .select("state_revision").eq("invoice_id", invoiceId).maybeSingle();
    const row = record(data);
    if (error) throw new Error("Invoice revision could not be read");
    if (!row) return 0;
    if (typeof row.state_revision !== "number" || !Number.isSafeInteger(row.state_revision)) throw new Error("Invoice revision is invalid");
    return row.state_revision;
  }
  async function readInvoiceHead(input: {
    invoiceId: string; subscriptionId: string; payerId: string; contractVersion: number;
  }): Promise<FormCoachWebhookInvoiceHead | null> {
    const value = await rpc("service_read_form_coach_invoice_current_head", {
      p_invoice_id: input.invoiceId,
      p_subscription_id: input.subscriptionId,
      p_payer_id: input.payerId,
      p_contract_version: input.contractVersion,
    });
    const row = record(value);
    if (!row || row.invoice_id !== input.invoiceId || row.subscription_id !== input.subscriptionId
      || row.payer_id !== input.payerId || row.contract_version !== input.contractVersion
      || typeof row.status !== "string" || typeof row.currency !== "string"
      || typeof row.last_event_id !== "string" || row.last_event_id.length === 0) return null;
    const amountDueCents = number(row.amount_due_cents);
    const amountPaidCents = number(row.amount_paid_cents);
    const periodStartEpoch = number(row.period_start_epoch);
    const periodEndEpoch = number(row.period_end_epoch);
    const stateRevision = number(row.state_revision);
    if (amountDueCents === null || amountPaidCents === null || periodStartEpoch === null
      || periodEndEpoch === null || stateRevision === null || stateRevision < 1) return null;
    const nullableId = (candidate: unknown) => candidate === null ? null : string(candidate);
    const paymentIntentId = nullableId(row.payment_intent_id);
    const chargeId = nullableId(row.charge_id);
    const trialClaimId = nullableId(row.trial_claim_id);
    if ((row.payment_intent_id !== null && paymentIntentId === null)
      || (row.charge_id !== null && chargeId === null)
      || (row.trial_claim_id !== null && trialClaimId === null)) return null;
    return {
      invoiceId: input.invoiceId,
      subscriptionId: input.subscriptionId,
      payerId: input.payerId,
      contractVersion: input.contractVersion,
      status: row.status,
      currency: row.currency,
      amountDueCents,
      amountPaidCents,
      periodStartEpoch,
      periodEndEpoch,
      paymentIntentId,
      chargeId,
      trialClaimId,
      lastEventId: row.last_event_id,
      stateRevision,
    };
  }
  async function readReservation(filter: { requestId?: string; sessionId?: string; subscriptionId?: string }): Promise<FormCoachWebhookReservation | null> {
    let query = db.from("feature_checkout_reservations")
      .select("id,request_id,idempotency_key,feature_key,config_revision,payer_role,payer_id,price_key,stripe_product_id,stripe_price_id,unit_amount_cents,currency,pack_quantity,credits_per_pack,quoted_credits,total_amount_cents,trial_days,state,stripe_checkout_session_id,stripe_customer_id,stripe_subscription_id");
    if (filter.requestId) query = query.eq("request_id", filter.requestId);
    else if (filter.sessionId) query = query.eq("stripe_checkout_session_id", filter.sessionId);
    else if (filter.subscriptionId) query = query.eq("stripe_subscription_id", filter.subscriptionId);
    else return null;
    const { data, error } = await query.eq("feature_key", FEATURE_KEY).maybeSingle();
    if (error) throw new Error("Checkout binding could not be read");
    const row = record(data);
    if (!row || typeof row.id !== "string" || typeof row.request_id !== "string"
      || typeof row.payer_id !== "string" || typeof row.payer_role !== "string"
      || typeof row.feature_key !== "string" || typeof row.price_key !== "string"
      || typeof row.stripe_product_id !== "string" || typeof row.stripe_price_id !== "string"
      || typeof row.currency !== "string" || typeof row.state !== "string"
      || !Number.isSafeInteger(row.config_revision) || !Number.isSafeInteger(row.unit_amount_cents)
      || !Number.isSafeInteger(row.pack_quantity) || !Number.isSafeInteger(row.quoted_credits)
      || !Number.isSafeInteger(row.total_amount_cents) || !Number.isSafeInteger(row.trial_days)) return null;
    const { data: option, error: optionError } = await db.from("feature_pricing_options")
      .select("interval,stripe_price_id,stripe_product_id,amount_cents,currency")
      .eq("feature_key", FEATURE_KEY).eq("revision", row.config_revision).eq("price_key", row.price_key).maybeSingle();
    const optionRow = record(option);
    if (optionError) throw new Error("Checkout price contract could not be read");
    if (!optionRow || optionRow.stripe_price_id !== row.stripe_price_id || optionRow.stripe_product_id !== row.stripe_product_id
      || optionRow.amount_cents !== row.unit_amount_cents || optionRow.currency !== row.currency
      || (optionRow.interval !== null && optionRow.interval !== "month" && optionRow.interval !== "year")) return null;
    return {
      id: row.id,
      request_id: row.request_id,
      idempotency_key: string(row.idempotency_key) ?? "",
      feature_key: row.feature_key,
      config_revision: row.config_revision as number,
      payer_role: row.payer_role,
      payer_id: row.payer_id,
      price_key: row.price_key,
      stripe_product_id: row.stripe_product_id,
      stripe_price_id: row.stripe_price_id,
      unit_amount_cents: row.unit_amount_cents as number,
      currency: row.currency,
      pack_quantity: row.pack_quantity as number,
      credits_per_pack: row.credits_per_pack === null ? null : number(row.credits_per_pack),
      quoted_credits: row.quoted_credits as number,
      total_amount_cents: row.total_amount_cents as number,
      trial_days: row.trial_days as number,
      billing_interval: optionRow.interval as "month" | "year" | null,
      state: row.state,
      stripe_checkout_session_id: string(row.stripe_checkout_session_id),
      stripe_customer_id: string(row.stripe_customer_id),
      stripe_subscription_id: string(row.stripe_subscription_id),
    };
  }

  return {
    async classify(metadata, objectId) {
      const value = await rpc("feature_stripe_namespace", {
        p_metadata: metadata ?? {},
        p_object_id: objectId,
      });
      return typeof value === "string" ? value : null;
    },
    readReservation,
    readInvoiceRevision,
    readInvoiceHead,
    async readVerifiedCustomer(payerId) {
      const { data: mapping, error: mappingError } = await db.from("feature_payer_customer_mappings")
        .select("feature_key,payer_id,stripe_customer_id,create_attempt_id")
        .eq("feature_key", FEATURE_KEY).eq("payer_id", payerId).maybeSingle();
      const mappingRow = record(mapping);
      if (mappingError) throw new Error("Customer ownership could not be read");
      if (mappingRow?.feature_key !== FEATURE_KEY || mappingRow.payer_id !== payerId
        || typeof mappingRow.stripe_customer_id !== "string" || typeof mappingRow.create_attempt_id !== "string") return null;
      const { data: attempt, error: attemptError } = await db.from("feature_customer_create_attempts")
        .select("feature_key,payer_id,state,stripe_customer_id")
        .eq("id", mappingRow.create_attempt_id).maybeSingle();
      const attemptRow = record(attempt);
      if (attemptError) throw new Error("Customer ownership could not be verified");
      if (attemptRow?.feature_key !== FEATURE_KEY || attemptRow.payer_id !== payerId || attemptRow.state !== "verified"
        || attemptRow.stripe_customer_id !== mappingRow.stripe_customer_id) return null;
      const { data: provider, error: providerError } = await db.from("feature_provider_objects")
        .select("feature_key,object_type,object_id,payer_id")
        .eq("feature_key", FEATURE_KEY).eq("object_type", "customer").eq("object_id", mappingRow.stripe_customer_id).maybeSingle();
      const providerRow = record(provider);
      if (providerError) throw new Error("Customer ownership could not be verified");
      if (providerRow?.feature_key !== FEATURE_KEY || providerRow.object_type !== "customer"
        || providerRow.object_id !== mappingRow.stripe_customer_id || providerRow.payer_id !== payerId) return null;
      return { customerId: mappingRow.stripe_customer_id, attemptId: mappingRow.create_attempt_id };
    },
    async bindSession(input) {
      const value = await rpc("bind_feature_checkout_session", {
        p_reservation_id: input.reservationId,
        p_session_id: input.sessionId,
        p_customer_id: input.customerId,
        p_subscription_id: input.subscriptionId,
      });
      if (typeof value !== "string") throw new Error("Checkout session binding returned an invalid result");
      return value;
    },
    async applyCheckoutPayment(input) {
      const value = await rpc("apply_feature_checkout_payment", {
        p_event_id: input.eventId,
        p_event_type: input.eventType,
        p_event_metadata: input.eventMetadata,
        p_session_id: input.sessionId,
        p_payment_object_id: input.paymentObjectId,
        p_payment_intent_id: input.paymentIntentId,
        p_price_id: input.priceId,
        p_amount_cents: input.amountCents,
        p_currency: input.currency,
        p_quantity: input.quantity,
      });
      if (typeof value !== "string") throw new Error("Checkout payment returned an invalid result");
      return value;
    },
    async reconcileExpiredSession(input) {
      const value = await rpc("record_form_coach_checkout_expired_session", {
        p_request_id: input.requestId,
        p_reservation_id: input.reservationId,
        p_session_id: input.sessionId,
        p_customer_id: input.customerId,
        p_session_status: input.status,
        p_payment_status: input.paymentStatus,
        p_mode: input.mode,
        p_metadata: input.metadata,
        p_price_id: input.priceId,
        p_quantity: input.quantity,
        p_evidence_digest: input.digest,
      });
      if (typeof value !== "string") throw new Error("Checkout terminal result was invalid");
      return value;
    },
    async hasTerminalBinding(input) {
      const { data, error } = await db.rpc("service_has_form_coach_trial_terminal_binding", {
        p_session_id: input.sessionId ?? null,
        p_subscription_id: input.subscriptionId ?? null,
      });
      if (error || typeof data !== "boolean") throw new Error("Terminal binding could not be read");
      return data;
    },
    async readSubscription(subscriptionId) {
      const { data: raw, error } = await db.from("feature_subscriptions")
        .select("stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,stripe_customer_id,status,current_period_end,cancel_at_period_end,state_revision")
        .eq("stripe_subscription_id", subscriptionId).eq("feature_key", FEATURE_KEY).maybeSingle();
      const row = record(raw);
      if (error) throw new Error("Subscription binding could not be read");
      if (!row || typeof row.payer_id !== "string" || typeof row.payer_role !== "string"
        || typeof row.config_revision !== "number" || typeof row.price_key !== "string"
        || typeof row.stripe_customer_id !== "string" || typeof row.status !== "string"
        || typeof row.current_period_end !== "string" || typeof row.cancel_at_period_end !== "boolean"
        || typeof row.state_revision !== "number") return null;
      const { data: pointer, error: pointerError } = await db.from("feature_subscription_contract_current")
        .select("feature_key,contract_version").eq("stripe_subscription_id", subscriptionId).maybeSingle();
      const pointerRow = record(pointer);
      if (pointerError) throw new Error("Subscription pricing contract could not be read");
      if (pointerRow?.feature_key !== FEATURE_KEY || typeof pointerRow.contract_version !== "number") return null;
      const { data: contract, error: contractError } = await db.from("feature_subscription_contract_versions")
        .select("stripe_product_id,stripe_price_id,amount_cents,currency,billing_interval")
        .eq("stripe_subscription_id", subscriptionId).eq("contract_version", pointerRow.contract_version).maybeSingle();
      const contractRow = record(contract);
      if (contractError) throw new Error("Subscription pricing contract could not be read");
      if (typeof contractRow?.stripe_product_id !== "string" || typeof contractRow.stripe_price_id !== "string"
        || typeof contractRow.amount_cents !== "number" || typeof contractRow.currency !== "string"
        || (contractRow.billing_interval !== "month" && contractRow.billing_interval !== "year")) return null;
      return {
        stripe_subscription_id: subscriptionId,
        feature_key: FEATURE_KEY,
        payer_role: row.payer_role,
        payer_id: row.payer_id,
        config_revision: row.config_revision,
        price_key: row.price_key,
        stripe_customer_id: row.stripe_customer_id,
        status: row.status,
        current_period_end: row.current_period_end,
        cancel_at_period_end: row.cancel_at_period_end,
        state_revision: row.state_revision,
        contract_version: pointerRow.contract_version,
        stripe_product_id: contractRow.stripe_product_id,
        stripe_price_id: contractRow.stripe_price_id,
        amount_cents: contractRow.amount_cents,
        currency: contractRow.currency,
        billing_interval: contractRow.billing_interval,
      };
    },
    async readInvoiceAlias(kind, objectId) {
      const { data, error } = await db.from("feature_billing_provider_aliases")
        .select("invoice_id,payer_id,subscription_id").eq("feature_key", FEATURE_KEY)
        .eq("object_kind", kind).eq("object_id", objectId).maybeSingle();
      const row = record(data);
      if (error) throw new Error("Invoice provider binding could not be read");
      if (typeof row?.invoice_id !== "string" || typeof row.payer_id !== "string" || typeof row.subscription_id !== "string") return null;
      const revision = await readInvoiceRevision(row.invoice_id);
      return { invoice_id: row.invoice_id, payer_id: row.payer_id, subscription_id: row.subscription_id, state_revision: revision };
    },
    async readPackReceipt(input) {
      let query = db.from("feature_payment_receipts")
        .select("id,feature_key,request_id,reservation_id,payer_id,payment_intent_id,payment_object_id,pack_quantity,credits_per_pack,amount_cents,currency,disposition");
      if (input.paymentIntentId) query = query.eq("payment_intent_id", input.paymentIntentId);
      else if (input.chargeId) query = query.eq("payment_object_id", input.chargeId);
      else return null;
      const { data, error } = await query.eq("feature_key", FEATURE_KEY).maybeSingle();
      const row = record(data);
      if (error) throw new Error("Pack payment binding could not be read");
      if (!row || typeof row.id !== "string" || typeof row.request_id !== "string"
        || typeof row.reservation_id !== "string" || typeof row.payer_id !== "string"
        || typeof row.payment_intent_id !== "string" || typeof row.payment_object_id !== "string"
        || !Number.isSafeInteger(row.pack_quantity) || !Number.isSafeInteger(row.credits_per_pack)
        || !Number.isSafeInteger(row.amount_cents) || typeof row.currency !== "string" || row.disposition !== "applied") return null;
      if (input.paymentIntentId && row.payment_intent_id !== input.paymentIntentId) return null;
      const reservationRow = await readReservation({ requestId: row.request_id });
      if (!reservationRow || reservationRow.id !== row.reservation_id || reservationRow.payer_id !== row.payer_id
        || reservationRow.credits_per_pack === null || reservationRow.stripe_customer_id === null
        || reservationRow.stripe_price_id.length === 0) return null;
      return {
        receiptId: row.id,
        requestId: row.request_id,
        payerId: row.payer_id,
        customerId: reservationRow.stripe_customer_id,
        paymentIntentId: row.payment_intent_id,
        amountCents: row.amount_cents as number,
        packQuantity: row.pack_quantity as number,
        creditsPerPack: row.credits_per_pack as number,
        currency: row.currency,
      };
    },
    async recordPackRefund(input) {
      const value = await rpc("service_record_form_coach_pack_refund_event", {
        p_event_id: input.eventId,
        p_event_type: input.eventType,
        p_refund_id: input.refundId,
        p_receipt_id: input.receiptId,
        p_payer_id: input.payerId,
        p_customer_id: input.customerId,
        p_payment_intent_id: input.paymentIntentId,
        p_charge_id: input.chargeId,
        p_amount_cents: input.amountCents,
        p_currency: input.currency,
        p_refunded_pack_quantity: input.refundedPackQuantity,
        p_outcome: input.outcome,
        p_review_reason: input.reviewReason,
        p_identity_digest: input.identityDigest,
        p_observed_refund_total_cents: input.observedRefundTotalCents,
        p_observation_digest: input.observationDigest,
        p_observed_at: input.observedAt,
      });
      if (typeof value !== "string") throw new Error("Pack refund evidence returned an invalid result");
      return value;
    },
    async readTrialRegistration(subscriptionId) {
      const { data, error } = await db.rpc("service_read_form_coach_trial_registration", {
        p_subscription_id: subscriptionId,
      });
      const row = record(data);
      if (error) throw new Error("Trial registration could not be read");
      if (typeof row?.request_id !== "string" || typeof row.reservation_id !== "string"
        || typeof row.stripe_checkout_session_id !== "string" || typeof row.stripe_customer_id !== "string"
        || typeof row.stripe_invoice_id !== "string" || typeof row.trial_days !== "number"
        || typeof row.trial_start !== "string" || typeof row.trial_end !== "string") return null;
      return {
        requestId: row.request_id,
        reservationId: row.reservation_id,
        sessionId: row.stripe_checkout_session_id,
        customerId: row.stripe_customer_id,
        invoiceId: row.stripe_invoice_id,
        trialDays: row.trial_days,
        trialStart: row.trial_start,
        trialEnd: row.trial_end,
      };
    },
    async readTrialClaim(subscriptionId, invoiceId) {
      const { data, error } = await db.from("feature_trial_claims")
        .select("id").eq("feature_key", FEATURE_KEY).eq("trial_kind", "trial_days")
        .eq("stripe_subscription_id", subscriptionId).eq("source_id", subscriptionId)
        .eq("source_kind", "subscription").maybeSingle();
      if (error) throw new Error("Trial claim could not be read");
      const row = record(data);
      if (typeof row?.id === "string") return row.id;
      const { data: invoiceClaim, error: invoiceError } = await db.from("feature_trial_claims")
        .select("id").eq("feature_key", FEATURE_KEY).eq("trial_kind", "trial_days")
        .eq("stripe_subscription_id", subscriptionId).eq("source_id", invoiceId)
        .eq("source_kind", "subscription_invoice").maybeSingle();
      const invoiceRow = record(invoiceClaim);
      if (invoiceError) throw new Error("Trial claim could not be read");
      return typeof invoiceRow?.id === "string" ? invoiceRow.id : null;
    },
    async registerTrial(input) {
      const value = await rpc("service_register_form_coach_trial_checkout", input);
      if (typeof value !== "string") throw new Error("Trial registration returned an invalid result");
      return value;
    },
    async recordTrialTerminal(input) {
      const value = await rpc("service_record_form_coach_trial_terminal", input);
      if (typeof value !== "string") throw new Error("Trial terminal evidence returned an invalid result");
      return value;
    },
    async applySubscriptionState(input) {
      const value = await rpc("apply_feature_subscription_state_cas", {
        p_event_id: input.eventId,
        p_event_type: input.eventType,
        p_subscription_id: input.subscriptionId,
        p_expected_revision: input.expectedRevision,
        p_current_status: input.status,
        p_current_period_end: input.periodEnd,
        p_cancel_at_period_end: input.cancelAtPeriodEnd,
      });
      if (typeof value !== "string") throw new Error("Subscription reconciliation returned an invalid result");
      return value;
    },
    async recordRefund(input) {
      const value = await rpc("record_feature_subscription_refund", {
        p_event_id: input.eventId,
        p_event_type: input.eventType,
        p_identity_digest: input.digest,
        p_refund_id: input.refundId,
        p_invoice_id: input.invoiceId,
        p_payment_intent_id: input.paymentIntentId,
        p_charge_id: input.chargeId,
        p_payer_id: input.payerId,
        p_amount_cents: input.amount,
        p_currency: input.currency,
        p_expected_invoice_revision: input.expectedInvoiceRevision,
      });
      if (typeof value !== "string") throw new Error("Refund reconciliation returned an invalid result");
      return value;
    },
    async recordConflict(input) {
      return await recordFormCoachBillingConflict({
        eventId: input.eventId,
        eventType: input.eventType,
        objectId: input.objectId,
        reservationId: input.reservationId ?? null,
        payerId: input.payerId ?? null,
        conflictKind: input.kind,
        identityDigest: input.digest,
      });
    },
    async resolveConflicts(input) {
      return await resolveFormCoachBillingConflicts(input);
    },
    async recordInvoiceSnapshot(evidence) {
      return await recordFormCoachInvoiceSnapshot(evidence);
    },
  };
}

function subscriptionCustomer(subscription: Stripe.Subscription): string | null {
  return idOf(subscription.customer);
}

function sessionCustomer(session: Stripe.Checkout.Session): string | null {
  return idOf(session.customer);
}

function metadataMatchesSubscription(subscription: Stripe.Subscription, row: FormCoachWebhookReservation): boolean {
  return subscriptionMetadataMatches(subscription, row);
}

function validateSessionLineItems(
  session: Stripe.Checkout.Session,
  items: Stripe.ApiList<Stripe.LineItem>,
  row: FormCoachWebhookReservation,
): boolean {
  if (items.has_more || items.data.length !== 1) return false;
  const line = items.data[0];
  const expectedSubtotal = row.trial_days > 0 ? 0 : row.total_amount_cents;
  if (!line || line.quantity !== row.pack_quantity || !priceMatchesReservation(line.price, row)
    || line.amount_subtotal !== expectedSubtotal || line.amount_discount !== 0 || line.amount_tax !== 0) return false;
  const expectedMode = row.credits_per_pack === null ? "subscription" : "payment";
  const sessionTotal = row.trial_days > 0 ? 0 : row.total_amount_cents;
  return session.mode === expectedMode
    && session.status !== null
    && exactMetadata(session.metadata, expectedSessionMetadata(row))
    && session.amount_subtotal === expectedSubtotal
    && session.amount_total === sessionTotal
    && session.currency?.toUpperCase() === row.currency
    && (session.total_details?.amount_discount ?? 0) === 0
    && (session.total_details?.amount_tax ?? 0) === 0;
}

function validateTrialSessionLine(
  session: Stripe.Checkout.Session,
  line: Stripe.LineItem,
  row: FormCoachWebhookReservation,
): boolean {
  return session.mode === "subscription" && session.status === "complete"
    && session.payment_status === "no_payment_required" && session.amount_subtotal === 0 && session.amount_total === 0
    && exactMetadata(session.metadata, expectedSessionMetadata(row))
    && line.quantity === row.pack_quantity && priceMatchesReservation(line.price, row)
    && line.amount_subtotal === 0 && line.amount_discount === 0 && line.amount_tax === 0
    && line.currency.toUpperCase() === row.currency;
}

async function verifyMappedCustomer(
  stripe: Stripe,
  store: FormCoachWebhookStore,
  row: FormCoachWebhookReservation,
): Promise<boolean> {
  const mapped = await store.readVerifiedCustomer(row.payer_id);
  if (!mapped || mapped.customerId !== row.stripe_customer_id) return false;
  const customer = await stripe.customers.retrieve(mapped.customerId);
  return customerMatches(customer, row, mapped.attemptId);
}

async function reservationWithVerifiedCustomer(
  stripe: Stripe,
  store: FormCoachWebhookStore,
  row: FormCoachWebhookReservation,
): Promise<FormCoachWebhookReservation | null> {
  const mapped = await store.readVerifiedCustomer(row.payer_id);
  if (!mapped || (row.stripe_customer_id !== null && row.stripe_customer_id !== mapped.customerId)) return null;
  const customer = await stripe.customers.retrieve(mapped.customerId);
  if (!customerMatches(customer, row, mapped.attemptId)) return null;
  return row.stripe_customer_id === mapped.customerId ? row : { ...row, stripe_customer_id: mapped.customerId };
}

async function recordConflict(
  store: FormCoachWebhookStore,
  event: Stripe.Event,
  objectId: string,
  kind: "payment_after_terminal" | "subscription_after_terminal" | "terminal_identity_mismatch" | "provider_state_conflict",
  reservation: FormCoachWebhookReservation | null = null,
): Promise<void> {
  const result = await store.recordConflict({
    eventId: event.id,
    eventType: event.type,
    objectId,
    reservationId: reservation?.id ?? null,
    payerId: reservation?.payer_id ?? null,
    kind,
    digest: hash({ id: event.id, type: event.type, object: eventObject(event) }),
  });
  if (result !== "recorded" && result !== "already_recorded") {
    throw new Error("Billing contradiction requires retry or review");
  }
}

async function getReservationForSession(
  store: FormCoachWebhookStore,
  session: Stripe.Checkout.Session,
): Promise<FormCoachWebhookReservation | null> {
  const requestId = session.metadata?.request_id;
  if (requestId && /^[0-9a-f-]{36}$/i.test(requestId)) {
    const row = await store.readReservation({ requestId });
    if (row) return row;
  }
  return await store.readReservation({ sessionId: session.id });
}

async function verifySession(
  stripe: Stripe,
  store: FormCoachWebhookStore,
  sessionId: string,
): Promise<{ session: Stripe.Checkout.Session; row: FormCoachWebhookReservation; line: Stripe.LineItem } | null> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const storedRow = await getReservationForSession(store, session);
  if (!storedRow || storedRow.feature_key !== FEATURE_KEY || !storedRow.idempotency_key.startsWith("form-coach:")) return null;
  // For an early zero-payment trial event the immutable customer mapping may be
  // verified before the reservation has been bound to a Checkout session. Use
  // that server-owned mapping as the only source for hydration; never trust the
  // webhook's customer field to establish ownership.
  const row = await reservationWithVerifiedCustomer(stripe, store, storedRow);
  if (!row
    || (row.stripe_checkout_session_id !== null && row.stripe_checkout_session_id !== session.id)
    || !sessionCustomer(session) || sessionCustomer(session) !== row.stripe_customer_id) return null;
  const items = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: MAX_PROVIDER_ROWS,
    expand: ["data.price.product"],
  });
  if (!validateSessionLineItems(session, items, row)) return null;
  const line = items.data[0];
  if (!line) return null;
  return { session, row, line };
}

async function verifiedTrialSessionForSubscription(
  stripe: Stripe,
  store: FormCoachWebhookStore,
  reservation: FormCoachWebhookReservation,
  subscriptionId: string,
  preferredSessionId?: string | null,
): Promise<{ session: Stripe.Checkout.Session; row: FormCoachWebhookReservation; line: Stripe.LineItem }> {
  const sessionIds: string[] = [];
  if (preferredSessionId) {
    sessionIds.push(preferredSessionId);
  } else if (reservation.stripe_checkout_session_id) {
    sessionIds.push(reservation.stripe_checkout_session_id);
  } else {
    const sessions = await stripe.checkout.sessions.list({ subscription: subscriptionId, limit: MAX_PROVIDER_ROWS });
    if (sessions.has_more) throw new Error("Trial Checkout session inventory is incomplete");
    sessionIds.push(...sessions.data
      .filter((session) => idOf(session.subscription) === subscriptionId
        && session.metadata?.feature_key === FEATURE_KEY
        && session.metadata?.feature_namespace === FEATURE_KEY
        && session.metadata?.request_id === reservation.request_id)
      .map((session) => session.id));
  }
  const verified: Array<{ session: Stripe.Checkout.Session; row: FormCoachWebhookReservation; line: Stripe.LineItem }> = [];
  for (const sessionId of [...new Set(sessionIds)]) {
    const candidate = await verifySession(stripe, store, sessionId);
    if (candidate && candidate.row.id === reservation.id && candidate.row.trial_days > 0
      && idOf(candidate.session.subscription) === subscriptionId) verified.push(candidate);
  }
  if (verified.length !== 1) throw new Error("Exact trial Checkout session is not uniquely verifiable");
  return verified[0] as { session: Stripe.Checkout.Session; row: FormCoachWebhookReservation; line: Stripe.LineItem };
}

async function paidSubscriptionCheckoutPaymentIntent(
  stripe: Stripe,
  reservation: FormCoachWebhookReservation,
  subscriptionId: string,
  customerId: string,
  checkoutInvoiceId: string | null,
): Promise<string | null> {
  if (!checkoutInvoiceId) return null;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price.product"] });
  if (subscription.id !== subscriptionId || subscriptionCustomer(subscription) !== customerId
    || !metadataMatchesSubscription(subscription, reservation)) return null;
  const invoiceId = checkoutInvoiceId;
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ["payments.data.payment.payment_intent", "payments.data.payment.charge"],
  });
  const lines = await stripe.invoices.listLineItems(invoiceId, { limit: MAX_PROVIDER_ROWS });
  if (invoice.id !== invoiceId || invoiceSubscription(invoice) !== subscriptionId
    || idOf(invoice.customer) !== customerId || invoice.billing_reason !== "subscription_create"
    || invoice.status !== "paid" || invoice.amount_due !== reservation.total_amount_cents
    || invoice.amount_paid !== reservation.total_amount_cents || invoice.currency.toUpperCase() !== reservation.currency
    || lines.has_more || lines.data.length !== 1 || invoice.payments?.has_more) return null;
  const line = lines.data[0];
  if (!line || idOf(line.subscription) !== subscriptionId || line.quantity !== reservation.pack_quantity
    || line.amount !== reservation.total_amount_cents || (line.discount_amounts?.length ?? 0) !== 0
    || (line.taxes?.length ?? 0) !== 0 || (line.pretax_credit_amounts?.length ?? 0) !== 0
    || line.currency.toUpperCase() !== reservation.currency) return null;
  const priceId = line.pricing?.price_details?.price;
  const productId = line.pricing?.price_details?.product;
  if (priceId !== reservation.stripe_price_id || productId !== reservation.stripe_product_id) return null;
  const price = await stripe.prices.retrieve(priceId);
  if (!priceMatchesReservation(price, reservation)) return null;
  const paymentIntentId = paymentIntentIdFromInvoice(invoice);
  if (!paymentIntentId) return null;
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.id !== paymentIntentId || idOf(intent.customer) !== customerId || intent.status !== "succeeded"
    || intent.amount_received !== reservation.total_amount_cents || intent.currency.toUpperCase() !== reservation.currency) return null;
  return paymentIntentId;
}

type ProviderBillingInventory = Readonly<{
  invoiceCount: number;
  outstandingInvoiceCount: number;
  paymentIntentCount: number;
  activePaymentIntentCount: number;
  chargeCount: number;
  chargeInventoryDigest: string;
  chargeIdsDigest: string;
  invoicePaymentCount: number;
  invoicePaymentInventoryDigest: string;
  invoiceInventoryDigest: string;
  paymentIntentInventoryDigest: string;
  invoiceIdsDigest: string;
  paymentIntentIdsDigest: string;
}>;

async function readProviderBillingInventory(
  stripe: Stripe,
  subscriptionId: string,
  customerId: string,
): Promise<ProviderBillingInventory> {
  const invoices: Stripe.Invoice[] = [];
  let invoicePage: Stripe.ApiList<Stripe.Invoice>;
  let invoiceCursor: string | undefined;
  let invoicePages = 0;
  do {
    invoicePage = await stripe.invoices.list({
      subscription: subscriptionId,
      limit: MAX_PROVIDER_ROWS,
      ...(invoiceCursor ? { starting_after: invoiceCursor } : {}),
    });
    invoices.push(...invoicePage.data);
    invoiceCursor = invoicePage.data.at(-1)?.id;
    invoicePages += 1;
    if (invoicePage.has_more && (!invoiceCursor || invoicePages >= 20)) {
      throw new Error("Subscription invoice inventory is incomplete");
    }
  } while (invoicePage.has_more);

  const paymentIntents = new Map<string, Stripe.PaymentIntent>();
  const charges = new Map<string, Stripe.Charge>();
  const invoicePayments: Array<{ invoiceId: string; id: string; status: string; kind: string; objectId: string }> = [];
  let activeInvoicePaymentCount = 0;
  for (const invoice of invoices) {
    if (invoiceSubscription(invoice) !== subscriptionId || idOf(invoice.customer) !== customerId) {
      throw new Error("Subscription invoice inventory identity is incomplete");
    }
    let paymentCursor: string | undefined;
    let paymentPages = 0;
    let paymentPage: Stripe.ApiList<Stripe.InvoicePayment>;
    do {
      paymentPage = await stripe.invoicePayments.list({
        invoice: invoice.id,
        limit: MAX_PROVIDER_ROWS,
        expand: ["data.payment.payment_intent"],
        ...(paymentCursor ? { starting_after: paymentCursor } : {}),
      });
      for (const payment of paymentPage.data) {
        const kind = payment.payment.type;
        const objectId = kind === "payment_intent"
          ? idOf(payment.payment.payment_intent)
          : kind === "charge" ? idOf(payment.payment.charge) : null;
        if (!objectId || (kind !== "payment_intent" && kind !== "charge")) {
          throw new Error("Subscription invoice payment inventory has an unsupported object");
        }
        invoicePayments.push({ invoiceId: invoice.id, id: payment.id, status: payment.status, kind, objectId });
        if (payment.status === "open") activeInvoicePaymentCount += 1;
        if (kind === "payment_intent" && !paymentIntents.has(objectId)) {
          const intent = await stripe.paymentIntents.retrieve(objectId);
          if (intent.id !== objectId || idOf(intent.customer) !== customerId) {
            throw new Error("Subscription PaymentIntent inventory identity is incomplete");
          }
          paymentIntents.set(objectId, intent);
        }
        if (kind === "charge" && !charges.has(objectId)) {
          const charge = await stripe.charges.retrieve(objectId);
          if (charge.id !== objectId || idOf(charge.customer) !== customerId) {
            throw new Error("Subscription charge inventory identity is incomplete");
          }
          charges.set(objectId, charge);
          if (!charge.paid) activeInvoicePaymentCount += 1;
        }
      }
      paymentCursor = paymentPage.data.at(-1)?.id;
      paymentPages += 1;
      if (paymentPage.has_more && (!paymentCursor || paymentPages >= 20)) {
        throw new Error("Subscription invoice payment inventory is incomplete");
      }
    } while (paymentPage.has_more);
  }

  const activeStatuses = new Set([
    "requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture",
  ]);
  const invoiceEvidence = invoices.map((invoice) => ({
    id: invoice.id,
    status: invoice.status,
    currency: invoice.currency,
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const invoiceIdsDigest = hashRawIdSet(invoiceEvidence.map((invoice) => invoice.id));
  const paymentIntentEvidence = [...paymentIntents.values()].map((intent) => ({
    id: intent.id,
    status: intent.status,
    currency: intent.currency,
    amount: intent.amount,
    amountReceived: intent.amount_received,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const paymentIntentIdsDigest = hashRawIdSet(paymentIntentEvidence.map((intent) => intent.id));
  const chargeEvidence = [...charges.values()].map((charge) => ({
    id: charge.id,
    paid: charge.paid,
    status: charge.status,
    currency: charge.currency,
    amount: charge.amount,
    amountRefunded: charge.amount_refunded,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const chargeIdsDigest = hashRawIdSet(chargeEvidence.map((charge) => charge.id));
  const invoicePaymentEvidence = invoicePayments.sort((a, b) => a.id.localeCompare(b.id));
  return {
    invoiceCount: invoices.length,
    outstandingInvoiceCount: invoices.filter((invoice) => invoice.status !== "paid" && invoice.status !== "void").length,
    paymentIntentCount: paymentIntents.size,
    activePaymentIntentCount: [...paymentIntents.values()].filter((intent) => activeStatuses.has(intent.status)).length + activeInvoicePaymentCount,
    chargeCount: charges.size,
    chargeInventoryDigest: hash(chargeEvidence),
    chargeIdsDigest,
    invoicePaymentCount: invoicePaymentEvidence.length,
    invoicePaymentInventoryDigest: hash(invoicePaymentEvidence),
    invoiceIdsDigest,
    paymentIntentIdsDigest,
    invoiceInventoryDigest: hash(invoiceEvidence),
    paymentIntentInventoryDigest: hash(paymentIntentEvidence),
  };
}

async function resolveFreshCheckoutConflict(
  stripe: Stripe,
  store: FormCoachWebhookStore,
  reservation: FormCoachWebhookReservation,
  sessionId: string,
): Promise<void> {
  const verified = await verifySession(stripe, store, sessionId);
  if (!verified || verified.row.id !== reservation.id) return;
  const session = verified.session;
  const customerId = sessionCustomer(session);
  if (!customerId || session.amount_total === null || !session.currency) return;
  let paymentIntentId: string | null = null;
  let paymentIntentStatus: string | null = null;
  let paymentIntentAmountReceived: number | null = null;
  let paymentIntentCurrency: string | null = null;
  if (session.status === "complete" && session.payment_status === "paid" && session.mode === "payment") {
    paymentIntentId = idOf(session.payment_intent);
    if (!paymentIntentId) return;
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.id !== paymentIntentId || idOf(paymentIntent.customer) !== customerId) return;
    paymentIntentStatus = paymentIntent.status;
    paymentIntentAmountReceived = paymentIntent.amount_received;
    paymentIntentCurrency = paymentIntent.currency.toUpperCase();
  } else if (session.status !== "expired" || session.payment_status !== "unpaid") {
    return;
  }
  const evidence = {
    reservationId: reservation.id,
    customerId,
    mode: session.mode,
    status: session.status,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total,
    currency: session.currency.toUpperCase(),
    paymentIntentId,
    paymentIntentStatus,
    paymentIntentAmountReceived,
    paymentIntentCurrency,
    subscriptionId: idOf(session.subscription),
    outstandingInvoiceCount: 0,
    activePaymentIntentCount: 0,
  } satisfies Readonly<Record<string, string | number | null>>;
  const observedAt = new Date().toISOString();
  const result = await store.resolveConflicts({
    requestId: randomUUID(),
    payerId: reservation.payer_id,
    resourceKind: "checkout_session",
    resourceId: session.id,
    expectedRevision: null,
    observedAt,
    evidence,
    evidenceDigest: hash(evidence),
  });
  if (!["recorded", "already_resolved", "not_found", "incomplete", "identity_mismatch", "conflict"].includes(result)) {
    throw new Error("Checkout conflict evidence requires retry or review");
  }
}

async function handleCheckoutSession(event: Stripe.Event, deps: FormCoachWebhookDependencies): Promise<void> {
  const eventObjectId = string(eventObject(event).id);
  if (!eventObjectId) throw new Error("Checkout event has no session identity");
  const verified = await verifySession(deps.stripe, deps.store, eventObjectId);
  const row = verified?.row ?? await deps.store.readReservation({ sessionId: eventObjectId });
  if (!verified || !row) {
    await recordConflict(deps.store, event, eventObjectId, "terminal_identity_mismatch", row);
    return;
  }
  const session = verified.session;
  const customerId = sessionCustomer(session);
  const subscriptionId = idOf(session.subscription);
  if (!customerId) {
    await recordConflict(deps.store, event, session.id, "terminal_identity_mismatch", row);
    return;
  }
  if (await deps.store.hasTerminalBinding({ sessionId: session.id, ...(subscriptionId ? { subscriptionId } : {}) })) {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await recordConflict(deps.store, event, session.id, "payment_after_terminal", row);
      await resolveFreshCheckoutConflict(deps.stripe, deps.store, row, session.id);
    }
    return;
  }
  const binding = await deps.store.bindSession({
    reservationId: row.id,
    sessionId: session.id,
    customerId,
    subscriptionId,
  });
  if (!(["bound", "paid", "cancel_required", "unknown"].includes(binding))) {
    throw new Error("Checkout session could not be bound to its reservation");
  }
  if (binding === "cancel_required") {
    await recordConflict(deps.store, event, session.id, "subscription_after_terminal", row);
    return;
  }
  if (session.status === "expired" && session.payment_status === "unpaid") {
    const result = await deps.store.reconcileExpiredSession({
      requestId: row.request_id,
      reservationId: row.id,
      sessionId: session.id,
      customerId,
      status: session.status,
      paymentStatus: session.payment_status,
      mode: session.mode ?? "",
      metadata: session.metadata ?? {},
      priceId: verified.line.price?.id ?? "",
      quantity: verified.line.quantity ?? 0,
      digest: hash({ id: event.id, type: event.type, session: { id: session.id, status: session.status, payment_status: session.payment_status, metadata: session.metadata, amount_total: session.amount_total } }),
    });
    if (!["expired", "already_expired", "not_terminal", "not_found", "binding_mismatch", "payment_exists", "subscription_conflict"].includes(result)) {
      throw new Error("Expired checkout reconciliation requires retry or review");
    }
    return;
  }
  if (row.trial_days > 0) {
    if (session.payment_status !== "no_payment_required" || session.amount_total !== 0 || session.mode !== "subscription") {
      await recordConflict(deps.store, event, session.id, "provider_state_conflict", row);
      return;
    }
    if (!subscriptionId) throw new Error("Trial Checkout has no subscription binding");
    const registered = await registerTimeTrialFromCheckout(event, deps, row, subscriptionId, session.id);
    if (!["registered", "already_registered", "blocked_deletion"].includes(registered)) {
      throw new Error("Verified trial Checkout could not be registered");
    }
    return;
  }
  if (session.status !== "complete" || session.payment_status !== "paid") return;
  let paymentIntent = idOf(session.payment_intent);
  if (row.credits_per_pack === null) {
    paymentIntent = subscriptionId
      ? await paidSubscriptionCheckoutPaymentIntent(deps.stripe, row, subscriptionId, customerId, idOf(session.invoice))
      : null;
    if (!paymentIntent) {
      await recordConflict(deps.store, event, session.id, "provider_state_conflict", row);
      return;
    }
  }
  const result = await deps.store.applyCheckoutPayment({
    eventId: event.id,
    eventType: event.type,
    eventMetadata: event.data.object && "metadata" in event.data.object && event.data.object.metadata
      ? event.data.object.metadata as Stripe.Metadata : {},
    sessionId: session.id,
    paymentObjectId: paymentIntent ?? session.id,
    paymentIntentId: paymentIntent,
    priceId: verified.line.price?.id ?? "",
    amountCents: session.amount_total ?? -1,
    currency: session.currency?.toUpperCase() ?? "",
    quantity: verified.line.quantity ?? 0,
  });
  if (!["applied", "already_applied", "duplicate_event", "blocked_deletion"].includes(result)) {
    throw new Error("Checkout payment reconciliation requires retry or review");
  }
}

async function verifySubscription(
  stripe: Stripe,
  row: FormCoachWebhookSubscription,
  reservation: FormCoachWebhookReservation,
): Promise<Stripe.Subscription | null> {
  const current = await stripe.subscriptions.retrieve(row.stripe_subscription_id, {
    expand: ["items.data.price.product"],
  });
  if (current.id !== row.stripe_subscription_id || subscriptionCustomer(current) !== row.stripe_customer_id
    || !metadataMatchesSubscription(current, reservation) || current.items.has_more || current.items.data.length !== 1) return null;
  const item = current.items.data[0];
  if (!item || item.quantity !== 1 || item.price.id !== row.stripe_price_id
    || priceProductId(item.price) !== row.stripe_product_id || item.price.unit_amount !== row.amount_cents
    || item.price.currency.toUpperCase() !== row.currency || item.price.recurring?.interval !== row.billing_interval) return null;
  return current;
}

async function handleSubscription(event: Stripe.Event, deps: FormCoachWebhookDependencies): Promise<void> {
  const subscriptionId = string(eventObject(event).id);
  if (!subscriptionId) throw new Error("Subscription event has no identity");
  let row = await deps.store.readSubscription(subscriptionId);
  let reservation = await deps.store.readReservation({ subscriptionId });
  let recoveredSubscription: Stripe.Subscription | null = null;
  if (!reservation || !row) {
    const recovered = await findTrialReservationForSubscription(deps.stripe, deps.store, subscriptionId);
    if (recovered) {
      reservation = recovered.reservation;
      recoveredSubscription = recovered.subscription;
    }
  }
  if (reservation?.trial_days && !row) {
    const registered = await registerTimeTrialForCurrentSubscription(
      event, deps, reservation, subscriptionId, reservation.stripe_checkout_session_id, recoveredSubscription ?? undefined,
    );
    if (!["registered", "already_registered", "blocked_deletion"].includes(registered)) {
      throw new Error("Verified trial subscription could not be registered");
    }
    row = await deps.store.readSubscription(subscriptionId);
  }
  if (!row || !reservation) {
    // Checkout and invoice webhooks may arrive in either order. Retry until the exact
    // reservation/receipt/trial registration has established its immutable mapping.
    throw new Error("Subscription binding is not ready for reconciliation");
  }
  const terminal = await deps.store.hasTerminalBinding({ subscriptionId });
  const current = await verifySubscription(deps.stripe, row, reservation);
  if (!current) {
    await recordConflict(deps.store, event, subscriptionId, "terminal_identity_mismatch", reservation);
    return;
  }
  if (terminal) {
    if (current.status !== "canceled" && current.status !== "incomplete_expired") {
      await recordConflict(deps.store, event, subscriptionId, "subscription_after_terminal", reservation);
      return;
    }
    const customerId = subscriptionCustomer(current);
    if (!customerId) return;
    const inventory = await readProviderBillingInventory(deps.stripe, subscriptionId, customerId);
    const evidence = {
      customerId,
      status: current.status,
      expectedRevision: row.state_revision,
      invoiceCount: inventory.invoiceCount,
      outstandingInvoiceCount: inventory.outstandingInvoiceCount,
      paymentIntentCount: inventory.paymentIntentCount,
      activePaymentIntentCount: inventory.activePaymentIntentCount,
      chargeCount: inventory.chargeCount,
      chargeIdsDigest: inventory.chargeIdsDigest,
      invoicePaymentCount: inventory.invoicePaymentCount,
      invoicePaymentInventoryDigest: inventory.invoicePaymentInventoryDigest,
      invoiceIdsDigest: inventory.invoiceIdsDigest,
      paymentIntentIdsDigest: inventory.paymentIntentIdsDigest,
      chargeInventoryDigest: inventory.chargeInventoryDigest,
      invoiceInventoryDigest: inventory.invoiceInventoryDigest,
      paymentIntentInventoryDigest: inventory.paymentIntentInventoryDigest,
    } satisfies Readonly<Record<string, string | number | null>>;
    const observedAt = new Date().toISOString();
    const result = await deps.store.resolveConflicts({
      requestId: randomUUID(),
      payerId: row.payer_id,
      resourceKind: "subscription",
      resourceId: subscriptionId,
      expectedRevision: row.state_revision,
      observedAt,
      evidence,
      evidenceDigest: hash(evidence),
    });
    if (result === "stale" || result === "retryable_account_serialization") {
      throw new Error("Subscription terminal evidence requires retry");
    }
    return;
  }
  const periodEnd = asIso(subscriptionPeriodEnd(current));
  if (!periodEnd) throw new Error("Subscription period is not valid");
  const result = await deps.store.applySubscriptionState({
    eventId: event.id,
    eventType: event.type,
    subscriptionId,
    expectedRevision: row.state_revision,
    status: current.status,
    periodEnd,
    cancelAtPeriodEnd: current.cancel_at_period_end,
  });
  if (!["applied", "blocked_deletion", "duplicate_event", "stale_revision"].includes(result)) {
    throw new Error("Subscription reconciliation requires retry or review");
  }
  if (result === "stale_revision") throw new Error("Subscription reconciliation requires a fresh provider observation");
  if (current.status === "canceled" || current.status === "incomplete_expired") {
    const expectedTerminalRevision = result === "applied" || result === "blocked_deletion"
      ? row.state_revision + 1
      : row.state_revision;
    await maybeRecordTrialTerminal(event, deps, current, reservation, expectedTerminalRevision);
  }
}

function trialSessionDigest(session: Stripe.Checkout.Session, line: Stripe.LineItem): string {
  return hash({
    id: session.id,
    status: session.status,
    payment_status: session.payment_status,
    mode: session.mode,
    customer: sessionCustomer(session),
    subscription: idOf(session.subscription),
    currency: session.currency,
    amount_subtotal: session.amount_subtotal,
    amount_total: session.amount_total,
    metadata: session.metadata,
    price: line.price?.id,
    product: line.price ? priceProductId(line.price) : null,
    quantity: line.quantity,
  });
}

function invoiceDigest(invoice: Stripe.Invoice, lines: readonly Stripe.InvoiceLineItem[], subscription: Stripe.Subscription): string {
  return hash({
    id: invoice.id,
    customer: idOf(invoice.customer),
    subscription_id: invoiceSubscription(invoice),
    status: invoice.status,
    currency: invoice.currency,
    amount_due: invoice.amount_due,
    amount_paid: invoice.amount_paid,
    period_start: invoice.period_start,
    period_end: invoice.period_end,
    lines: lines.map((line) => ({ id: line.id, amount: line.amount, currency: line.currency, period: line.period,
      quantity: line.quantity, price: line.pricing?.price_details?.price, product: line.pricing?.price_details?.product })),
    current_subscription: { id: subscription.id, status: subscription.status, current_period_end: subscriptionPeriodEnd(subscription),
      trial_start: subscription.trial_start, trial_end: subscription.trial_end },
  });
}

async function recordTimeTrial(
  event: Stripe.Event,
  deps: FormCoachWebhookDependencies,
  reservation: FormCoachWebhookReservation,
  session: Stripe.Checkout.Session,
  line: Stripe.LineItem,
  invoice: Stripe.Invoice,
  lines: readonly Stripe.InvoiceLineItem[],
  subscription: Stripe.Subscription,
): Promise<string> {
  const customerId = sessionCustomer(session);
  const sessionSubscriptionId = idOf(session.subscription);
  const invoiceLine = lines.length === 1 ? lines[0] : null;
  const invoiceLinePriceId = invoiceLine?.pricing?.price_details?.price ?? null;
  const invoiceLineProductId = invoiceLine?.pricing?.price_details?.product ?? null;
  const existingRegistration = await deps.store.readTrialRegistration(subscription.id);
  const existingRegistrationMatches = Boolean(existingRegistration
    && existingRegistration.requestId === reservation.request_id
    && existingRegistration.reservationId === reservation.id
    && existingRegistration.sessionId === session.id
    && existingRegistration.customerId === customerId
    && existingRegistration.invoiceId === invoice.id
    && existingRegistration.trialDays === reservation.trial_days);
  const lineIdentityMatches = Boolean(invoiceLine
    && invoiceLine.subscription !== null && idOf(invoiceLine.subscription) === subscription.id
    && invoiceLinePriceId === reservation.stripe_price_id
    && invoiceLineProductId === reservation.stripe_product_id
    && invoiceLine.quantity === reservation.pack_quantity
    && invoiceLine.amount === 0
    && invoiceLine.currency.toUpperCase() === reservation.currency);
  const providerIdentityMatches = Boolean(customerId && sessionSubscriptionId === subscription.id
    && subscription.id && subscriptionMetadataMatches(subscription, reservation)
    && idOf(invoice.customer) === customerId && invoiceSubscription(invoice) === subscription.id
    && idOf(session.invoice) === invoice.id
    && session.status === "complete" && session.payment_status === "no_payment_required" && session.mode === "subscription"
    && session.amount_total === 0 && session.amount_subtotal === 0
    && invoice.status === "paid" && invoice.currency.toUpperCase() === reservation.currency
    && invoice.amount_due === 0 && invoice.amount_paid === 0 && invoice.billing_reason === "subscription_create"
    && validateTrialSessionLine(session, line, reservation) && lineIdentityMatches);
  if (!providerIdentityMatches) {
    await recordConflict(deps.store, event, invoice.id, "provider_state_conflict", reservation);
    return "evidence_mismatch";
  }
  if (existingRegistration) {
    if (existingRegistrationMatches) return "already_registered";
    await recordConflict(deps.store, event, invoice.id, "terminal_identity_mismatch", reservation);
    return "evidence_mismatch";
  }
  const trialStart = asIso(subscription.trial_start);
  const trialEnd = asIso(subscription.trial_end);
  const periodEnd = asIso(subscriptionPeriodEnd(subscription));
  const sessionDigest = trialSessionDigest(session, line);
  const invoiceEvidenceDigest = invoiceDigest(invoice, lines, subscription);
  if (!customerId || !sessionSubscriptionId || sessionSubscriptionId !== subscription.id || !trialStart || !trialEnd || !periodEnd
    || subscription.status !== "trialing" || subscription.trial_start === null || subscription.trial_end === null
    || subscriptionPeriodEnd(subscription) !== subscription.trial_end
    || !subscriptionMatchesReservationPrice(subscription, reservation)) {
    await recordConflict(deps.store, event, invoice.id, "provider_state_conflict", reservation);
    return "evidence_mismatch";
  }
  return await deps.store.registerTrial({
    p_request_id: reservation.request_id,
    p_session_id: session.id,
    p_customer_id: customerId,
    p_subscription_id: subscription.id,
    p_invoice_id: invoice.id,
    p_session_status: session.status,
    p_payment_status: session.payment_status,
    p_mode: session.mode,
    p_currency: session.currency?.toUpperCase() ?? "",
    p_session_subtotal: session.amount_subtotal ?? -1,
    p_session_total: session.amount_total ?? -1,
    p_session_metadata: session.metadata ?? {},
    p_price_id: line.price?.id ?? "",
    p_product_id: line.price ? priceProductId(line.price) ?? "" : "",
    p_quantity: line.quantity ?? 0,
    p_subscription_status: subscription.status,
    p_trial_start: trialStart,
    p_trial_end: trialEnd,
    p_period_end: periodEnd,
    p_invoice_status: invoice.status ?? "",
    p_invoice_currency: invoice.currency.toUpperCase(),
    p_invoice_amount_due: invoice.amount_due,
    p_invoice_amount_paid: invoice.amount_paid,
    p_invoice_period_start: asIso(invoice.period_start) ?? "",
    p_invoice_period_end: asIso(invoice.period_end) ?? "",
    p_session_evidence_digest: sessionDigest,
    p_invoice_evidence_digest: invoiceEvidenceDigest,
  });
}

async function registerTimeTrialForCurrentSubscription(
  event: Stripe.Event,
  deps: FormCoachWebhookDependencies,
  reservation: FormCoachWebhookReservation,
  subscriptionId: string,
  preferredSessionId?: string | null,
  knownSubscription?: Stripe.Subscription,
  knownInvoice?: Stripe.Invoice,
  knownInvoiceLines?: readonly Stripe.InvoiceLineItem[],
): Promise<string> {
  const subscription = knownSubscription ?? await deps.stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product"],
  });
  if (subscription.id !== subscriptionId || subscriptionCustomer(subscription) !== reservation.stripe_customer_id
    || !subscriptionMetadataMatches(subscription, reservation)
    || !subscriptionMatchesReservationPrice(subscription, reservation)) {
    throw new Error("Current trial subscription does not match its frozen reservation");
  }
  const verifiedSession = await verifiedTrialSessionForSubscription(
    deps.stripe, deps.store, reservation, subscriptionId, preferredSessionId,
  );
  if (reservation.stripe_checkout_session_id !== null
    && reservation.stripe_checkout_session_id !== verifiedSession.session.id) {
    throw new Error("Trial Checkout session differs from the frozen reservation binding");
  }
  if (reservation.stripe_checkout_session_id === null || reservation.stripe_subscription_id !== subscriptionId) {
    const bound = await deps.store.bindSession({
      reservationId: reservation.id,
      sessionId: verifiedSession.session.id,
      customerId: reservation.stripe_customer_id as string,
      subscriptionId,
    });
    if (!new Set(["bound", "paid", "cancel_required", "unknown"]).has(bound)) {
      throw new Error("Verified trial Checkout session could not be bound");
    }
  }
  const latestInvoiceId = idOf(subscription.latest_invoice);
  const invoice = knownInvoice ?? (latestInvoiceId
    ? await deps.stripe.invoices.retrieve(latestInvoiceId)
    : null);
  if (!invoice || !latestInvoiceId || invoice.id !== latestInvoiceId || invoiceSubscription(invoice) !== subscriptionId) {
    throw new Error("Current trial invoice is not available for exact registration");
  }
  let invoiceLines = knownInvoiceLines;
  let linePage: Stripe.ApiList<Stripe.InvoiceLineItem> | null = null;
  if (!invoiceLines) {
    linePage = await deps.stripe.invoices.listLineItems(invoice.id, { limit: MAX_PROVIDER_ROWS });
    invoiceLines = linePage.data;
  }
  const verifiedInvoiceLines = invoiceLines ?? [];
  if (linePage?.has_more || verifiedInvoiceLines.length !== 1) throw new Error("Current trial invoice lines are incomplete");
  return await recordTimeTrial(event, deps, reservation, verifiedSession.session, verifiedSession.line,
    invoice, verifiedInvoiceLines, subscription);
}

async function findTrialReservationForSubscription(
  stripe: Stripe,
  store: FormCoachWebhookStore,
  subscriptionId: string,
): Promise<{ reservation: FormCoachWebhookReservation; subscription: Stripe.Subscription } | null> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price.product"] });
  if (subscription.id !== subscriptionId || subscription.metadata?.feature_namespace !== FEATURE_KEY
    || subscription.metadata?.feature_key !== FEATURE_KEY || !/^[0-9a-f-]{36}$/i.test(subscription.metadata.request_id ?? "")) {
    return null;
  }
  const storedReservation = await store.readReservation({ requestId: subscription.metadata.request_id });
  if (!storedReservation || storedReservation.trial_days < 1 || storedReservation.credits_per_pack !== null) return null;
  const reservation = await reservationWithVerifiedCustomer(stripe, store, storedReservation);
  if (!reservation || !metadataMatchesSubscription(subscription, reservation)
    || subscriptionCustomer(subscription) !== reservation.stripe_customer_id) return null;
  return { reservation, subscription };
}

async function registerTimeTrialFromCheckout(
  event: Stripe.Event,
  deps: FormCoachWebhookDependencies,
  reservation: FormCoachWebhookReservation,
  subscriptionId: string,
  sessionId: string,
): Promise<string> {
  return await registerTimeTrialForCurrentSubscription(event, deps, reservation, subscriptionId, sessionId);
}

async function maybeRecordTrialTerminal(
  event: Stripe.Event,
  deps: FormCoachWebhookDependencies,
  currentSubscription: Stripe.Subscription,
  reservation: FormCoachWebhookReservation,
  expectedSubscriptionRevision: number,
): Promise<void> {
  const registration = await deps.store.readTrialRegistration(currentSubscription.id);
  if (!registration || reservation.state !== "cancel_required" || !reservation.stripe_checkout_session_id
    || !reservation.stripe_customer_id) return;
  const session = await deps.stripe.checkout.sessions.retrieve(registration.sessionId);
  if (session.status !== "complete" || session.payment_status !== "no_payment_required"
    || idOf(session.customer) !== registration.customerId || idOf(session.subscription) !== currentSubscription.id) {
    await recordConflict(deps.store, event, registration.sessionId, "terminal_identity_mismatch", reservation);
    return;
  }
  const allInvoices = await deps.stripe.invoices.list({ subscription: currentSubscription.id, limit: MAX_PROVIDER_ROWS });
  if (allInvoices.has_more || !allInvoices.data.some((invoice) => invoice.id === registration.invoiceId)) {
    throw new Error("Trial invoice inventory is incomplete");
  }
  const outstanding = allInvoices.data.filter((invoice) => invoice.status !== "paid" && invoice.status !== "void");
  const paymentIntents = await deps.stripe.paymentIntents.list({ customer: registration.customerId, limit: MAX_PROVIDER_ROWS });
  if (paymentIntents.has_more) throw new Error("Trial payment inventory is incomplete");
  const activePaymentIntents = paymentIntents.data.filter((intent) => {
    // This verified Stripe customer is dedicated to Form Coach. Keep the
    // terminal fence closed if any intent on it remains collectible.
    return ["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture"].includes(intent.status);
  });
  const digest = hash({ eventId: event.id, eventType: event.type, session, subscription: currentSubscription,
    invoiceIds: allInvoices.data.map((invoice) => ({ id: invoice.id, status: invoice.status })),
    activePaymentIntents: activePaymentIntents.map((intent) => ({ id: intent.id, status: intent.status })) });
  const result = await deps.store.recordTrialTerminal({
    p_request_id: registration.requestId,
    p_reservation_id: registration.reservationId,
    p_session_id: registration.sessionId,
    p_customer_id: registration.customerId,
    p_subscription_id: currentSubscription.id,
    p_expected_subscription_revision: expectedSubscriptionRevision,
    p_session_status: session.status,
    p_payment_status: session.payment_status,
    p_subscription_status: currentSubscription.status,
    p_outstanding_invoice_count: outstanding.length,
    p_active_payment_intent_count: activePaymentIntents.length,
    p_evidence_digest: digest,
  });
  if (!["canceled", "already_canceled", "not_terminal", "not_found", "binding_mismatch"].includes(result)) {
    throw new Error("Trial terminal reconciliation requires retry or review");
  }
}

async function handleInvoice(event: Stripe.Event, deps: FormCoachWebhookDependencies): Promise<void> {
  const invoiceId = string(eventObject(event).id);
  if (!invoiceId) throw new Error("Invoice event has no identity");
  const subscriptionId = invoiceSubscription(event.data.object as Stripe.Invoice);
  if (!subscriptionId) {
    await recordConflict(deps.store, event, invoiceId, "provider_state_conflict");
    return;
  }
  // Capture the CAS base before provider reads. A delayed current-state GET may never
  // use a newer database revision as if it were the state that was read beforehand.
  const expectedInvoiceRevision = await deps.store.readInvoiceRevision(invoiceId);
  let reservation = await deps.store.readReservation({ subscriptionId });
  const binding = await deps.store.readSubscription(subscriptionId);
  let providerSubscription: Stripe.Subscription | null = null;
  if (!reservation || (!binding && reservation.trial_days > 0)) {
    const recovered = await findTrialReservationForSubscription(deps.stripe, deps.store, subscriptionId);
    if (recovered) {
      // A stored row may exist before its provider IDs are bound. Prefer the same
      // row after ownership is established through the verified customer mapping.
      reservation = recovered.reservation;
      providerSubscription = recovered.subscription;
    }
  }
  if (!reservation) throw new Error("Invoice subscription reservation is not ready");
  const terminalBinding = await deps.store.hasTerminalBinding({ subscriptionId,
    ...(reservation.stripe_checkout_session_id ? { sessionId: reservation.stripe_checkout_session_id } : {}) });
  const invoice = await deps.stripe.invoices.retrieve(invoiceId, {
    expand: ["payments.data.payment.payment_intent", "payments.data.payment.charge"],
  });
  const lines = await deps.stripe.invoices.listLineItems(invoiceId, { limit: MAX_PROVIDER_ROWS });
  if (invoice.id !== invoiceId || invoiceSubscription(invoice) !== subscriptionId || lines.has_more || lines.data.length !== 1) {
    await recordConflict(deps.store, event, invoiceId, "terminal_identity_mismatch", reservation);
    return;
  }
  const line = lines.data[0];
  const linePriceId = line?.pricing?.price_details?.price ?? null;
  const lineProductId = line?.pricing?.price_details?.product ?? null;
  if (!line || line.subscription === null || idOf(line.subscription) !== subscriptionId
    || !linePriceId || !lineProductId || line.quantity !== reservation.pack_quantity
    || line.currency.toUpperCase() !== reservation.currency) {
    await recordConflict(deps.store, event, invoiceId, "terminal_identity_mismatch", reservation);
    return;
  }
  const price = await deps.stripe.prices.retrieve(linePriceId);
  let trialRegistration = await deps.store.readTrialRegistration(subscriptionId);
  const isInitialTrialInvoice = !binding && !trialRegistration && reservation.trial_days > 0
    && reservation.credits_per_pack === null && invoice.billing_reason === "subscription_create";
  let isRegisteredTrialInvoice = Boolean(trialRegistration
    && trialRegistration.requestId === reservation.request_id
    && trialRegistration.reservationId === reservation.id
    && trialRegistration.invoiceId === invoiceId
    && trialRegistration.trialDays === reservation.trial_days
    && trialRegistration.sessionId === reservation.stripe_checkout_session_id
    && trialRegistration.customerId === reservation.stripe_customer_id);
  const priceMatchesReservationContract = price.id === reservation.stripe_price_id
    && priceProductId(price) === reservation.stripe_product_id
    && price.unit_amount === reservation.unit_amount_cents
    && price.currency.toUpperCase() === reservation.currency
    && price.recurring?.interval === reservation.billing_interval;
  const priceMatchesCurrentBinding = binding !== null
    && price.id === binding.stripe_price_id && priceProductId(price) === binding.stripe_product_id
    && price.unit_amount === binding.amount_cents && price.currency.toUpperCase() === binding.currency
    && price.recurring?.interval === binding.billing_interval;
  if (linePriceId !== reservation.stripe_price_id || lineProductId !== reservation.stripe_product_id
    || !priceMatchesReservationContract || (!priceMatchesCurrentBinding && !isInitialTrialInvoice && !isRegisteredTrialInvoice)) {
    await recordConflict(deps.store, event, invoiceId, "terminal_identity_mismatch", reservation);
    return;
  }
  const customerId = idOf(invoice.customer);
  const mapped = await deps.store.readVerifiedCustomer(reservation.payer_id);
  if (!customerId || !mapped || customerId !== mapped.customerId || customerId !== reservation.stripe_customer_id
    || (binding && binding.stripe_customer_id !== customerId)) {
    await recordConflict(deps.store, event, invoiceId, "terminal_identity_mismatch", reservation);
    return;
  }
  const customer = await deps.stripe.customers.retrieve(customerId);
  if (!customerMatches(customer, reservation, mapped.attemptId)) {
    await recordConflict(deps.store, event, invoiceId, "terminal_identity_mismatch", reservation);
    return;
  }
  const subscription = providerSubscription ?? await deps.stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price.product"] });
  if (subscriptionCustomer(subscription) !== customerId || !metadataMatchesSubscription(subscription, reservation)
    || (!isRegisteredTrialInvoice && (subscription.items.has_more || subscription.items.data.length !== 1))) {
    await recordConflict(deps.store, event, invoiceId, "terminal_identity_mismatch", reservation);
    return;
  }
  const currentSubscriptionItem = subscription.items.data[0];
  if (!isRegisteredTrialInvoice && (!currentSubscriptionItem
    || currentSubscriptionItem.quantity !== reservation.pack_quantity
    || currentSubscriptionItem.price.id !== reservation.stripe_price_id
    || priceProductId(currentSubscriptionItem.price) !== reservation.stripe_product_id
    || currentSubscriptionItem.price.unit_amount !== reservation.unit_amount_cents
    || currentSubscriptionItem.price.currency.toUpperCase() !== reservation.currency
    || currentSubscriptionItem.price.recurring?.interval !== reservation.billing_interval
    || (binding !== null && (currentSubscriptionItem.price.id !== binding.stripe_price_id
      || currentSubscriptionItem.price.unit_amount !== binding.amount_cents
      || currentSubscriptionItem.price.currency.toUpperCase() !== binding.currency
      || currentSubscriptionItem.price.recurring?.interval !== binding.billing_interval)))) {
    await recordConflict(deps.store, event, invoiceId, "terminal_identity_mismatch", reservation);
    return;
  }
  if (isInitialTrialInvoice) {
    const registered = await registerTimeTrialForCurrentSubscription(
      event, deps, reservation, subscriptionId, reservation.stripe_checkout_session_id, subscription, invoice, lines.data,
    );
    if (!["registered", "already_registered", "blocked_deletion"].includes(registered)) {
      throw new Error("Verified initial trial invoice could not be registered");
    }
    trialRegistration = await deps.store.readTrialRegistration(subscriptionId);
    if (!trialRegistration || trialRegistration.requestId !== reservation.request_id
      || trialRegistration.reservationId !== reservation.id || trialRegistration.invoiceId !== invoiceId
      || (reservation.stripe_checkout_session_id !== null
        && trialRegistration.sessionId !== reservation.stripe_checkout_session_id)) {
      throw new Error("Verified trial registration could not be reloaded");
    }
    isRegisteredTrialInvoice = trialRegistration.requestId === reservation.request_id
      && trialRegistration.reservationId === reservation.id && trialRegistration.invoiceId === invoiceId
      && trialRegistration.customerId === customerId
      && (reservation.stripe_checkout_session_id === null || trialRegistration.sessionId === reservation.stripe_checkout_session_id)
      && (reservation.stripe_customer_id === null || trialRegistration.customerId === reservation.stripe_customer_id);
  }
  const paymentIntentId = paymentIntentIdFromInvoice(invoice);
  const chargeId = chargeIdFromInvoice(invoice);
  if (invoice.payments?.has_more || (invoice.amount_paid > 0 && !paymentIntentId && !chargeId)) {
    throw new Error("Invoice payment identity needs reconciliation");
  }
  const totalRefunded = await readRefundTotal(deps, invoiceId, paymentIntentId, chargeId);
  const isRegistrationInvoice = trialRegistration?.invoiceId === invoiceId;
  const trialClaimId = isRegistrationInvoice ? await deps.store.readTrialClaim(subscriptionId, invoiceId) : null;
  const zeroTrialInvoice = isRegistrationInvoice && trialClaimId !== null && invoice.status === "paid"
    && invoice.amount_due === 0 && invoice.amount_paid === 0;
  const zeroBlockedTrialInvoice = isRegisteredTrialInvoice && trialClaimId === null
    && reservation.state === "cancel_required" && invoice.status === "paid"
    && invoice.amount_due === 0 && invoice.amount_paid === 0;
  const terminalSubscriptionStatuses = new Set(["canceled", "incomplete_expired"]);
  const zeroTerminalTrialInvoiceCandidate = event.type === "invoice.paid" && terminalBinding
    && isRegisteredTrialInvoice && isRegistrationInvoice && trialRegistration !== null && trialClaimId === null
    && reservation.state === "canceled" && binding !== null
    && terminalSubscriptionStatuses.has(binding.status) && subscription.status === binding.status
    && invoice.billing_reason === "subscription_create" && invoice.status === "paid"
    && invoice.amount_due === 0 && invoice.amount_paid === 0 && totalRefunded === 0;
  if (terminalBinding && !zeroTerminalTrialInvoiceCandidate) {
    await recordConflict(deps.store, event, invoiceId, "payment_after_terminal", reservation);
  }
  if (invoice.status === "paid" && invoice.amount_paid === 0 && !zeroTrialInvoice
    && !zeroBlockedTrialInvoice && !zeroTerminalTrialInvoiceCandidate) {
    await recordConflict(deps.store, event, invoiceId, "provider_state_conflict", reservation);
    return;
  }
  if (invoice.status === "paid" && !zeroTrialInvoice && !zeroBlockedTrialInvoice
    && !zeroTerminalTrialInvoiceCandidate && invoice.amount_paid !== invoice.amount_due) {
    await recordConflict(deps.store, event, invoiceId, "provider_state_conflict", reservation);
    return;
  }
  if (totalRefunded > invoice.amount_paid) {
    await recordConflict(deps.store, event, invoiceId, "provider_state_conflict", reservation);
    return;
  }
  const periodStart = asIso(invoice.period_start);
  const periodEnd = asIso(invoice.period_end);
  if (!periodStart || !periodEnd) throw new Error("Invoice period is not valid");
  let terminalTrialReplayVerified = false;
  if (isRegistrationInvoice && trialRegistration && reservation.trial_days > 0) {
    const sessionVerified = await verifySession(deps.stripe, deps.store, trialRegistration.sessionId);
    if (!sessionVerified || sessionVerified.row.id !== trialRegistration.reservationId
      || sessionCustomer(sessionVerified.session) !== trialRegistration.customerId
      || idOf(sessionVerified.session.subscription) !== subscriptionId
      || idOf(sessionVerified.session.invoice) !== invoiceId) {
      await recordConflict(deps.store, event, invoiceId, "terminal_identity_mismatch", reservation);
      if (zeroTerminalTrialInvoiceCandidate) {
        await recordConflict(deps.store, event, invoiceId, "payment_after_terminal", reservation);
      }
      return;
    }
    const registered = await recordTimeTrial(event, deps, reservation, sessionVerified.session, sessionVerified.line, invoice, lines.data, subscription);
    if (!["registered", "already_registered", "blocked_deletion"].includes(registered)) {
      if (zeroTerminalTrialInvoiceCandidate) {
        await recordConflict(deps.store, event, invoiceId, "payment_after_terminal", reservation);
      }
      throw new Error("Verified trial invoice could not be registered");
    }
    terminalTrialReplayVerified = zeroTerminalTrialInvoiceCandidate && registered === "already_registered";
  }
  if (terminalBinding && terminalTrialReplayVerified) {
    // The immutable trial registration and terminal attestation already preserve
    // this exact zero-payment invoice; replay must not create a false late-payment
    // contradiction or mutate the completed cleanup state.
    return;
  }
  const currentBinding = binding ?? await deps.store.readSubscription(subscriptionId);
  if (!currentBinding) throw new Error("Invoice subscription contract is not ready");
  const actualObject = event.data.object as Stripe.Invoice;
  const snapshotDigest = invoiceDigest(invoice, lines.data, subscription);
  const snapshotRequestId = deterministicSnapshotRequestId(event.id, snapshotDigest, expectedInvoiceRevision);
  const snapshotResult = await deps.store.recordInvoiceSnapshot({
    requestId: snapshotRequestId,
    payerId: reservation.payer_id,
    eventId: event.id,
    eventType: event.type,
    invoiceId,
    subscriptionId,
    contractVersion: currentBinding.contract_version,
    status: invoice.status ?? "",
    currency: invoice.currency.toUpperCase(),
    amountDueCents: invoice.amount_due,
    amountPaidCents: invoice.amount_paid,
    periodStart,
    periodEnd,
    paymentIntentId,
    chargeId,
    trialClaimId: isRegistrationInvoice ? trialClaimId : null,
    expectedInvoiceRevision,
    actualEventDigest: hash({ id: event.id, type: event.type, data: actualObject }),
    snapshotDigest,
  });
  if (!["applied", "duplicate_event", "blocked_deletion", "mismatch", "manual_review"].includes(snapshotResult)) {
    throw new Error("Invoice state reconciliation requires retry or review");
  }
  if (terminalBinding && (snapshotResult === "applied" || snapshotResult === "duplicate_event")
    && (invoice.status === "paid" || invoice.status === "void")) {
    const head = await deps.store.readInvoiceHead({
      invoiceId,
      subscriptionId,
      payerId: reservation.payer_id,
      contractVersion: currentBinding.contract_version,
    });
    const providerPeriodStart = Math.floor(invoice.period_start);
    const providerPeriodEnd = Math.floor(invoice.period_end);
    if (!head || head.status !== invoice.status || head.currency !== invoice.currency.toUpperCase()
      || head.amountDueCents !== invoice.amount_due || head.amountPaidCents !== invoice.amount_paid
      || head.periodStartEpoch !== providerPeriodStart || head.periodEndEpoch !== providerPeriodEnd
      || head.paymentIntentId !== paymentIntentId || head.chargeId !== chargeId
      || head.trialClaimId !== (isRegistrationInvoice ? trialClaimId : null)) {
      throw new Error("Invoice terminal evidence requires a current matching projection");
    }
    const currentInvoiceRevision = head.stateRevision;
    const inventory = await readProviderBillingInventory(deps.stripe, subscriptionId, customerId);
    const evidence = {
      subscriptionId,
      customerId,
      status: invoice.status,
      currency: invoice.currency.toUpperCase(),
      amountDueCents: invoice.amount_due,
      amountPaidCents: invoice.amount_paid,
      expectedRevision: currentInvoiceRevision,
      currentEventId: head.lastEventId,
      outstandingInvoiceCount: inventory.outstandingInvoiceCount,
      activePaymentIntentCount: inventory.activePaymentIntentCount,
      invoiceCount: inventory.invoiceCount,
      paymentIntentCount: inventory.paymentIntentCount,
      chargeCount: inventory.chargeCount,
      invoiceIdsDigest: inventory.invoiceIdsDigest,
      paymentIntentIdsDigest: inventory.paymentIntentIdsDigest,
      chargeIdsDigest: inventory.chargeIdsDigest,
      invoicePaymentCount: inventory.invoicePaymentCount,
      invoicePaymentInventoryDigest: inventory.invoicePaymentInventoryDigest,
      invoiceInventoryDigest: inventory.invoiceInventoryDigest,
      paymentIntentInventoryDigest: inventory.paymentIntentInventoryDigest,
      chargeInventoryDigest: inventory.chargeInventoryDigest,
    } satisfies Readonly<Record<string, string | number | null>>;
    const observedAt = new Date().toISOString();
    const resolution = await deps.store.resolveConflicts({
      requestId: randomUUID(),
      payerId: reservation.payer_id,
      resourceKind: "invoice",
      resourceId: invoiceId,
      expectedRevision: currentInvoiceRevision,
      observedAt,
      evidence,
      evidenceDigest: hash(evidence),
    });
    if (resolution === "stale" || resolution === "retryable_account_serialization") {
      throw new Error("Invoice terminal evidence requires retry");
    }
  }
}

async function readRefundTotal(
  deps: FormCoachWebhookDependencies,
  invoiceId: string,
  paymentIntentId: string | null,
  chargeId: string | null,
): Promise<number> {
  if (!paymentIntentId && !chargeId) return 0;
  const refunds = await deps.stripe.refunds.list({
    ...(paymentIntentId ? { payment_intent: paymentIntentId } : { charge: chargeId as string }),
    limit: MAX_PROVIDER_ROWS,
  });
  if (refunds.has_more) throw new Error("Refund history is incomplete");
  let total = 0;
  for (const item of refunds.data) {
    const itemChargeId = idOf(item.charge);
    const itemPaymentIntentId = idOf(item.payment_intent);
    const matchesPayment = paymentIntentId
      ? itemPaymentIntentId === paymentIntentId
      : itemChargeId === chargeId;
    if (matchesPayment && item.status === "succeeded") total += item.amount;
  }
  if (!Number.isSafeInteger(total) || total < 0) throw new Error(`Refund total is invalid for ${invoiceId}`);
  return total;
}

async function handleChargeRefund(event: Stripe.Event, deps: FormCoachWebhookDependencies): Promise<void> {
  const chargeId = string(eventObject(event).id);
  if (!chargeId) throw new Error("Refund event has no charge identity");
  const raw = event.data.object as Stripe.Charge;
  const paymentIntentId = idOf(raw.payment_intent);
  const alias = paymentIntentId ? await deps.store.readInvoiceAlias("payment_intent", paymentIntentId)
    : await deps.store.readInvoiceAlias("charge", chargeId);
  if (!alias) {
    const receipt = await deps.store.readPackReceipt({ paymentIntentId, chargeId });
    if (!receipt) throw new Error("Refund payment binding is not ready");
    return await reconcilePackChargeRefund(event, deps, chargeId, receipt);
  }
  const charge = await deps.stripe.charges.retrieve(chargeId, { expand: ["refunds.data"] });
  const refunds = charge.refunds;
  if (charge.id !== chargeId || !/^[a-z]{3}$/i.test(charge.currency)
    || idOf(charge.payment_intent) !== paymentIntentId || !refunds || refunds.has_more) {
    await recordConflict(deps.store, event, chargeId, "terminal_identity_mismatch");
    return;
  }
  const succeeded = refunds.data.filter((refund) => refund.status === "succeeded");
  if (succeeded.length !== 1 || refunds.data.length !== 1) {
    await recordConflict(deps.store, event, chargeId, "provider_state_conflict");
    return;
  }
  const refund = succeeded[0];
  if (!refund || refund.currency.toUpperCase() !== charge.currency.toUpperCase()
    || refund.amount < 1 || refund.amount > charge.amount_refunded) {
    await recordConflict(deps.store, event, chargeId, "provider_state_conflict");
    return;
  }
  const result = await deps.store.recordRefund({
    eventId: event.id,
    eventType: event.type,
    digest: hash({ eventId: event.id, eventType: event.type, chargeId, paymentIntentId, refund: { id: refund.id, amount: refund.amount, currency: refund.currency, status: refund.status } }),
    refundId: refund.id,
    invoiceId: alias.invoice_id,
    paymentIntentId,
    chargeId,
    payerId: alias.payer_id,
    amount: refund.amount,
    currency: refund.currency.toUpperCase(),
    expectedInvoiceRevision: alias.state_revision,
  });
  if (!["applied", "refunded", "manual_review", "duplicate_event", "blocked_deletion"].includes(result)) {
    throw new Error("Refund reconciliation requires retry or review");
  }
}

async function handleRefundUpdate(event: Stripe.Event, deps: FormCoachWebhookDependencies): Promise<void> {
  const raw = eventObject(event);
  const refundId = string(raw.id);
  if (!refundId) throw new Error("Refund event has no identity");
  const rawChargeId = idOf(raw.charge);
  const rawPaymentIntentId = idOf(raw.payment_intent);
  const alias = rawChargeId ? await deps.store.readInvoiceAlias("charge", rawChargeId)
    : rawPaymentIntentId ? await deps.store.readInvoiceAlias("payment_intent", rawPaymentIntentId) : null;
  if (!alias) {
    const receipt = await deps.store.readPackReceipt({ paymentIntentId: rawPaymentIntentId, chargeId: rawChargeId });
    if (!receipt) throw new Error("Refund payment binding is not ready");
    const refund = await deps.stripe.refunds.retrieve(refundId, { expand: ["charge", "payment_intent"] });
    const chargeId = idOf(refund.charge);
    const paymentIntentId = idOf(refund.payment_intent);
    if (refund.id !== refundId || !chargeId || paymentIntentId !== receipt.paymentIntentId
      || (rawChargeId !== null && chargeId !== rawChargeId)) {
      await recordConflict(deps.store, event, refundId, "terminal_identity_mismatch");
      return;
    }
    if (refund.status !== "succeeded") return;
    return await reconcilePackChargeRefund(event, deps, chargeId, receipt, refundId);
  }
  // The alias includes the invoice revision read before retrieving current
  // provider state. Never sample a later revision after the retrieve.
  const refund = await deps.stripe.refunds.retrieve(refundId, { expand: ["charge", "payment_intent"] });
  const chargeId = idOf(refund.charge);
  const paymentIntentId = idOf(refund.payment_intent);
  if (refund.id !== refundId || chargeId !== rawChargeId || paymentIntentId !== rawPaymentIntentId) {
    await recordConflict(deps.store, event, refundId, "terminal_identity_mismatch");
    return;
  }
  if (refund.status !== "succeeded") return;
  const result = await deps.store.recordRefund({
    eventId: event.id,
    eventType: event.type,
    digest: hash({ eventId: event.id, eventType: event.type, refund: { id: refund.id, amount: refund.amount, currency: refund.currency, status: refund.status, chargeId, paymentIntentId } }),
    refundId: refund.id,
    invoiceId: alias.invoice_id,
    paymentIntentId,
    chargeId,
    payerId: alias.payer_id,
    amount: refund.amount,
    currency: refund.currency.toUpperCase(),
    expectedInvoiceRevision: alias.state_revision,
  });
  if (!["applied", "refunded", "manual_review", "duplicate_event", "blocked_deletion"].includes(result)) {
    throw new Error("Refund reconciliation requires retry or review");
  }
}

async function reconcilePackChargeRefund(
  event: Stripe.Event,
  deps: FormCoachWebhookDependencies,
  chargeId: string,
  receipt: FormCoachPackReceipt,
  targetRefundId?: string,
): Promise<void> {
  const reservation = await deps.store.readReservation({ requestId: receipt.requestId });
  if (!reservation || reservation.payer_id !== receipt.payerId || reservation.credits_per_pack === null
    || reservation.pack_quantity !== receipt.packQuantity || reservation.credits_per_pack !== receipt.creditsPerPack
    || reservation.total_amount_cents !== receipt.amountCents || reservation.currency !== receipt.currency
    || reservation.stripe_customer_id !== receipt.customerId
    || !await verifyMappedCustomer(deps.stripe, deps.store, reservation)) {
    await recordConflict(deps.store, event, chargeId, "terminal_identity_mismatch", reservation);
    return;
  }
  const charge = await deps.stripe.charges.retrieve(chargeId, { expand: ["customer", "payment_intent"] });
  if (charge.id !== chargeId || idOf(charge.customer) !== receipt.customerId || !charge.paid
    || idOf(charge.payment_intent) !== receipt.paymentIntentId || charge.amount !== receipt.amountCents
    || charge.currency.toUpperCase() !== receipt.currency) {
    await recordConflict(deps.store, event, chargeId, "terminal_identity_mismatch", reservation);
    return;
  }
  const paymentIntent = await deps.stripe.paymentIntents.retrieve(receipt.paymentIntentId);
  if (paymentIntent.id !== receipt.paymentIntentId || idOf(paymentIntent.customer) !== receipt.customerId
    || paymentIntent.status !== "succeeded" || paymentIntent.amount !== receipt.amountCents
    || paymentIntent.amount_received !== receipt.amountCents || paymentIntent.currency.toUpperCase() !== receipt.currency) {
    await recordConflict(deps.store, event, chargeId, "terminal_identity_mismatch", reservation);
    return;
  }
  const page = await deps.stripe.refunds.list({ charge: chargeId, limit: MAX_PROVIDER_ROWS });
  if (page.data.some((refund) => refund.charge !== chargeId && idOf(refund.charge) !== chargeId)) {
    await recordConflict(deps.store, event, chargeId, "terminal_identity_mismatch", reservation);
    return;
  }
  if (page.has_more) {
    await recordConflict(deps.store, event, chargeId, "provider_state_conflict", reservation);
    return;
  }
  const succeeded = page.data.filter((refund) => refund.status === "succeeded");
  const refundedTotal = succeeded.reduce((total, refund) => total + refund.amount, 0);
  const target = targetRefundId ? succeeded.find((refund) => refund.id === targetRefundId) : null;
  if (targetRefundId && !target) {
    await recordConflict(deps.store, event, targetRefundId, "provider_state_conflict", reservation);
    return;
  }
  if (refundedTotal !== charge.amount_refunded || refundedTotal > receipt.amountCents) {
    await recordConflict(deps.store, event, chargeId, "provider_state_conflict", reservation);
    return;
  }
  const refunds = targetRefundId ? [target as Stripe.Refund] : succeeded;
  if (refunds.length === 0) return;
  const observationDigest = hash({
    chargeId,
    chargeAmountRefunded: charge.amount_refunded,
    refunds: succeeded.map((refund) => ({ id: refund.id, amount: refund.amount,
      currency: refund.currency.toUpperCase(), status: refund.status })).sort((a, b) => a.id.localeCompare(b.id)),
  });
  const unitCents = receipt.amountCents / receipt.packQuantity;
  if (!Number.isSafeInteger(unitCents) || unitCents <= 0) {
    await recordConflict(deps.store, event, chargeId, "terminal_identity_mismatch", reservation);
    return;
  }
  for (const refund of refunds) {
    const fullyRefundsReceipt = refund.amount === receipt.amountCents && receipt.packQuantity > 0;
    const amountIdentityIsValid = refund.currency.toUpperCase() === receipt.currency
      && idOf(refund.charge) === chargeId && idOf(refund.payment_intent) === receipt.paymentIntentId
      && refund.amount > 0 && refund.amount <= receipt.amountCents;
    if (!amountIdentityIsValid) {
      await recordConflict(deps.store, event, refund.id, "terminal_identity_mismatch", reservation);
      continue;
    }
    const outcome = fullyRefundsReceipt ? "applied" : "manual_review";
    const result = await deps.store.recordPackRefund({
      eventId: event.id,
      eventType: event.type as "charge.refunded" | "refund.updated",
      refundId: refund.id,
      receiptId: receipt.receiptId,
      payerId: receipt.payerId,
      customerId: receipt.customerId,
      paymentIntentId: receipt.paymentIntentId,
      chargeId,
      amountCents: refund.amount,
      currency: refund.currency.toUpperCase(),
      refundedPackQuantity: fullyRefundsReceipt ? receipt.packQuantity : Math.max(1, Math.min(receipt.packQuantity, Math.ceil(refund.amount / unitCents))),
      outcome,
      reviewReason: fullyRefundsReceipt ? null : "partial_or_ambiguous_amount",
      identityDigest: hash({
        eventId: event.id, eventType: event.type, refundId: refund.id, receiptId: receipt.receiptId,
        payerId: receipt.payerId, customerId: receipt.customerId, paymentIntentId: receipt.paymentIntentId,
        chargeId, amount: refund.amount, currency: refund.currency.toUpperCase(), status: refund.status,
        chargeAmount: charge.amount,
      }),
      observedRefundTotalCents: charge.amount_refunded,
      observationDigest,
      observedAt: new Date().toISOString(),
    });
    if (!["applied", "manual_review", "already_applied", "already_manual_review"].includes(result)) {
      throw new Error("Pack refund reconciliation requires retry or review");
    }
  }
}

async function processKnownFormCoachEvent(event: Stripe.Event, deps: FormCoachWebhookDependencies): Promise<void> {
  if (event.type.startsWith("checkout.session.")) return await handleCheckoutSession(event, deps);
  if (event.type.startsWith("customer.subscription.")) return await handleSubscription(event, deps);
  if (event.type.startsWith("invoice.")) return await handleInvoice(event, deps);
  if (event.type === "charge.refunded") return await handleChargeRefund(event, deps);
  if (event.type === "refund.updated") return await handleRefundUpdate(event, deps);
  await recordConflict(deps.store, event, string(eventObject(event).id) ?? "unknown", "provider_state_conflict");
}

export async function dispatchFormCoachStripeEvent(
  event: Stripe.Event,
  dependencies?: FormCoachWebhookDependencies,
): Promise<boolean> {
  if (!relevantEventTypes.has(event.type)) return false;
  const explicitFeatureIdentity = explicitlyFormCoach(event);
  // Connected-account events can never represent platform Form Coach billing.
  // Explicitly namespaced events are acknowledged without reconciliation so
  // they cannot fall through to generic membership or Connect handlers.
  if (event.account && explicitFeatureIdentity) return true;
  const deps = dependencies ?? { stripe: getStripe(), store: await createStore() };
  const ids = relevantIds(event);
  if (ids.length === 0) {
    if (explicitFeatureIdentity) throw new Error("Form Coach event identity is missing");
    return false;
  }
  let namespace: string | null = null;
  for (const id of ids) {
    const result = await deps.store.classify(eventMetadata(event), id);
    if (result === FEATURE_KEY) {
      namespace = result;
      break;
    }
  }
  if (namespace !== FEATURE_KEY && !explicitFeatureIdentity) return false;
  // A known Form Coach object in a connected account is acknowledged but is
  // never recorded as a platform contradiction or used to block its owner.
  if (event.account) return true;
  // The webhook signing secret and configured Stripe client must describe the
  // same mode as the signed event. A mismatch is retryable and grants nothing.
  if (typeof event.livemode !== "boolean" || event.livemode !== !isStripeTestMode()) {
    throw new Error("Form Coach Stripe event mode does not match configuration");
  }
  if (namespace !== FEATURE_KEY) {
    await recordConflict(deps.store, event, ids[0] ?? "unknown", "terminal_identity_mismatch");
    return true;
  }
  await processKnownFormCoachEvent(event, deps);
  return true;
}
