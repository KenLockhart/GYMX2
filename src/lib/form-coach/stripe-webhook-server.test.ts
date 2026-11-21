import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { isStripeTestMode } from "@/lib/stripe";
import {
  dispatchFormCoachStripeEvent,
  type FormCoachWebhookDependencies,
  type FormCoachWebhookReservation,
  type FormCoachWebhookStore,
  type FormCoachWebhookSubscription,
} from "./stripe-webhook-server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn(), isStripeTestMode: vi.fn(() => true) }));

const payerId = "00000000-0000-4000-8000-000000000011";
const reservationId = "00000000-0000-4000-8000-000000000012";
const requestId = "00000000-0000-4000-8000-000000000013";
const customerId = "cus_form_coach_synthetic";
const subscriptionId = "sub_form_coach_synthetic";
const invoiceId = "in_form_coach_synthetic";
const priceId = "price_form_coach_synthetic";
const productId = "prod_form_coach_synthetic";
const attemptId = "00000000-0000-4000-8000-000000000014";
const start = 1_800_000_000;
const end = start + 30 * 24 * 60 * 60;

beforeEach(() => {
  vi.mocked(isStripeTestMode).mockReturnValue(true);
});

const reservation: FormCoachWebhookReservation = {
  id: reservationId,
  request_id: requestId,
  idempotency_key: "form-coach:synthetic-request",
  feature_key: "form_coach",
  config_revision: 3,
  payer_role: "coach",
  payer_id: payerId,
  price_key: "monthly",
  stripe_product_id: productId,
  stripe_price_id: priceId,
  unit_amount_cents: 2_500,
  currency: "USD",
  pack_quantity: 1,
  credits_per_pack: null,
  quoted_credits: 100,
  total_amount_cents: 2_500,
  trial_days: 0,
  billing_interval: "month",
  state: "paid",
  stripe_checkout_session_id: "cs_form_coach_synthetic",
  stripe_customer_id: customerId,
  stripe_subscription_id: subscriptionId,
};

const currentBinding: FormCoachWebhookSubscription = {
  stripe_subscription_id: subscriptionId,
  feature_key: "form_coach",
  payer_role: "coach",
  payer_id: payerId,
  config_revision: 3,
  price_key: "monthly",
  stripe_customer_id: customerId,
  status: "active",
  current_period_end: new Date(end * 1000).toISOString(),
  cancel_at_period_end: false,
  state_revision: 2,
  contract_version: 1,
  stripe_product_id: productId,
  stripe_price_id: priceId,
  amount_cents: 2_500,
  currency: "USD",
  billing_interval: "month",
};

function stripeInvoice(status: "paid" | "open", amountPaid: number): Stripe.Invoice {
  return {
    id: invoiceId,
    customer: customerId,
    status,
    currency: "usd",
    amount_due: 2_500,
    amount_paid: amountPaid,
    period_start: start,
    period_end: end,
    billing_reason: "subscription_cycle",
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: {
        subscription: subscriptionId,
        metadata: { feature_namespace: "form_coach", feature_key: "form_coach" },
      },
    },
    payments: {
      object: "list",
      data: [{
        id: "inpay_form_coach_synthetic",
        object: "invoice_payment",
        amount_paid: amountPaid,
        amount_requested: 2_500,
        currency: "usd",
        status: status === "paid" ? "paid" : "open",
        created: start,
        livemode: false,
        payment: {
          type: "payment_intent",
          payment_intent: "pi_form_coach_synthetic",
        },
      }],
      has_more: false,
      url: `/v1/invoices/${invoiceId}/payments`,
    },
  } as unknown as Stripe.Invoice;
}

function invoiceLines(): Stripe.ApiList<Stripe.InvoiceLineItem> {
  return {
    object: "list",
    data: [{
      id: "il_form_coach_synthetic",
      object: "line_item",
      amount: 2_500,
      currency: "usd",
      description: "Synthetic assessment subscription",
      discount_amounts: [],
      discountable: false,
      discounts: [],
      livemode: false,
      metadata: {},
      parent: null,
      period: { start, end },
      price: null,
      pricing: { type: "price_details", price_details: { price: priceId, product: productId } },
      quantity: 1,
      subscription: subscriptionId,
      tax_amounts: [],
      taxes: [],
      unit_amount_excluding_tax: "2500",
    }],
    has_more: false,
    url: `/v1/invoices/${invoiceId}/lines`,
  } as unknown as Stripe.ApiList<Stripe.InvoiceLineItem>;
}

function subscription(status: "active" | "canceled" = "active"): Stripe.Subscription {
  const metadata = {
    feature_namespace: "form_coach",
    feature_key: "form_coach",
    payer_id: payerId,
    reservation_id: reservationId,
    request_id: requestId,
    config_revision: "3",
    price_key: "monthly",
  };
  return {
    id: subscriptionId,
    customer: customerId,
    status,
    metadata,
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    items: {
      object: "list",
      data: [{
        id: "si_form_coach_synthetic",
        object: "subscription_item",
        current_period_end: end,
        current_period_start: start,
        metadata: {},
        price: {
          id: priceId,
          object: "price",
          active: true,
          currency: "usd",
          livemode: false,
          metadata: {},
          product: productId,
          recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
          unit_amount: 2_500,
        },
        quantity: 1,
        subscription: subscriptionId,
      }],
      has_more: false,
      url: `/v1/subscriptions/${subscriptionId}/items`,
    },
  } as unknown as Stripe.Subscription;
}

function makeHarness(options: Readonly<{
  currentInvoiceStatus: "paid" | "open";
  amountPaid: number;
  initialRevision?: number;
  mutateRevisionOnProviderRead?: number;
}>): {
  deps: FormCoachWebhookDependencies;
  store: FormCoachWebhookStore;
  revisionState: Readonly<{ get: () => number; set: (value: number) => void }>;
  calls: string[];
  snapshots: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  resolutions: Array<Record<string, unknown>>;
  packRefunds: Array<Record<string, unknown>>;
} {
  const calls: string[] = [];
  const snapshots: Array<Record<string, unknown>> = [];
  const conflicts: Array<Record<string, unknown>> = [];
  const resolutions: Array<Record<string, unknown>> = [];
  const packRefunds: Array<Record<string, unknown>> = [];
  let revision = options.initialRevision ?? 5;
  const store: FormCoachWebhookStore = {
    classify: vi.fn(async () => "form_coach"),
    readReservation: vi.fn(async () => reservation),
    readVerifiedCustomer: vi.fn(async () => ({ customerId, attemptId })),
    bindSession: vi.fn(async () => "bound"),
    applyCheckoutPayment: vi.fn(async () => "applied"),
    reconcileExpiredSession: vi.fn(async () => "expired"),
    hasTerminalBinding: vi.fn(async () => false),
    readSubscription: vi.fn(async () => currentBinding),
    readInvoiceRevision: vi.fn(async () => {
      calls.push("read_revision");
      return revision;
    }),
    readInvoiceHead: vi.fn(async () => null),
    readInvoiceAlias: vi.fn(async () => null),
    readPackReceipt: vi.fn(async () => null),
    recordPackRefund: vi.fn(async (input) => {
      packRefunds.push(input as unknown as Record<string, unknown>);
      return input.outcome === "applied" ? "applied" : "manual_review";
    }),
    readTrialRegistration: vi.fn(async () => null),
    readTrialClaim: vi.fn(async () => null),
    registerTrial: vi.fn(async () => "registered"),
    recordTrialTerminal: vi.fn(async () => "canceled"),
    applySubscriptionState: vi.fn(async () => "applied"),
    recordRefund: vi.fn(async () => "applied"),
    recordConflict: vi.fn(async (input) => {
      conflicts.push(input as Record<string, unknown>);
      return "recorded";
    }),
    resolveConflicts: vi.fn(async (input) => {
      resolutions.push(input as Record<string, unknown>);
      return "recorded";
    }),
    recordInvoiceSnapshot: vi.fn(async (input) => {
      snapshots.push(input as unknown as Record<string, unknown>);
      return "applied";
    }),
  };
  const stripe = {
    invoices: {
      retrieve: vi.fn(async () => {
        calls.push("retrieve_invoice");
        if (options.mutateRevisionOnProviderRead !== undefined) revision = options.mutateRevisionOnProviderRead;
        return stripeInvoice(options.currentInvoiceStatus, options.amountPaid);
      }),
      listLineItems: vi.fn(async () => invoiceLines()),
    },
    prices: {
      retrieve: vi.fn(async () => ({
        id: priceId,
        product: productId,
        unit_amount: 2_500,
        currency: "usd",
        recurring: { interval: "month" },
      })),
    },
    customers: {
      retrieve: vi.fn(async () => ({
        id: customerId,
        deleted: false,
        metadata: {
          feature_namespace: "form_coach",
          feature_key: "form_coach",
          payer_id: payerId,
          customer_create_attempt_id: attemptId,
        },
      })),
    },
    subscriptions: { retrieve: vi.fn(async () => subscription()) },
    charges: { retrieve: vi.fn() },
    refunds: { list: vi.fn(async () => ({ data: [], has_more: false })) },
  } as unknown as Stripe;
  return {
    deps: { stripe, store },
    store,
    revisionState: { get: () => revision, set: (value) => { revision = value; } },
    calls,
    snapshots,
    conflicts,
    resolutions,
    packRefunds,
  };
}

function makeTrialBootstrapHarness() {
  const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 0 });
  const trialStart = start + 60;
  const trialEnd = trialStart + 7 * 24 * 60 * 60;
  const trialReservation: FormCoachWebhookReservation = {
    ...reservation,
    state: "reserved",
    trial_days: 7,
    stripe_checkout_session_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
  };
  const trialMetadata = {
    feature_namespace: "form_coach",
    feature_key: "form_coach",
    payer_id: payerId,
    reservation_id: reservationId,
    request_id: requestId,
    config_revision: "3",
    price_key: "monthly",
    pack_quantity: "1",
  };
  const trialPrice = {
    id: priceId,
    object: "price",
    active: true,
    currency: "usd",
    livemode: false,
    metadata: {},
    product: productId,
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    unit_amount: 2_500,
  };
  const checkoutLine = {
    id: "li_trial_bootstrap",
    object: "item",
    currency: "usd",
    amount_subtotal: 0,
    amount_discount: 0,
    amount_tax: 0,
    quantity: 1,
    price: trialPrice,
  };
  const session = {
    id: "cs_trial_bootstrap",
    object: "checkout.session",
    customer: customerId,
    invoice: invoiceId,
    mode: "subscription",
    status: "complete",
    payment_status: "no_payment_required",
    amount_subtotal: 0,
    amount_total: 0,
    currency: "usd",
    metadata: trialMetadata,
    total_details: { amount_discount: 0, amount_tax: 0 },
    payment_intent: null,
    subscription: subscriptionId,
  };
  const invoice = {
    id: invoiceId,
    customer: customerId,
    status: "paid",
    currency: "usd",
    amount_due: 0,
    amount_paid: 0,
    period_start: trialStart - 60,
    period_end: trialEnd + 60,
    billing_reason: "subscription_create",
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: { subscription: subscriptionId, metadata: trialMetadata },
    },
    payments: { object: "list", data: [], has_more: false, url: `/v1/invoices/${invoiceId}/payments` },
  };
  const invoiceLine = {
    id: "il_trial_bootstrap",
    object: "line_item",
    amount: 0,
    currency: "usd",
    description: "Synthetic zero-payment trial",
    discount_amounts: [],
    discountable: false,
    discounts: [],
    livemode: false,
    metadata: {},
    parent: null,
    period: { start: trialStart - 60, end: trialEnd + 60 },
    price: null,
    pricing: { type: "price_details", price_details: { price: priceId, product: productId } },
    quantity: 1,
    subscription: subscriptionId,
    tax_amounts: [],
    taxes: [],
    unit_amount_excluding_tax: "0",
  };
  const trialSubscription = {
    ...subscription("active"),
    status: "trialing",
    latest_invoice: invoiceId,
    trial_start: trialStart,
    trial_end: trialEnd,
    items: {
      object: "list",
      data: [{
        id: "si_trial_bootstrap",
        object: "subscription_item",
        current_period_start: trialStart,
        current_period_end: trialEnd,
        metadata: {},
        price: trialPrice,
        quantity: 1,
        subscription: subscriptionId,
      }],
      has_more: false,
      url: `/v1/subscription_items?subscription=${subscriptionId}`,
    },
  };
  const trialRegistration = {
    requestId,
    reservationId,
    sessionId: session.id,
    customerId,
    invoiceId,
    trialDays: 7,
    trialStart: new Date(trialStart * 1000).toISOString(),
    trialEnd: new Date(trialEnd * 1000).toISOString(),
  };
  const trialBinding: FormCoachWebhookSubscription = {
    ...currentBinding,
    status: "trialing",
    current_period_end: new Date(trialEnd * 1000).toISOString(),
    state_revision: 0,
  };
  let subscriptionReads = 0;
  let trialRegistered = false;
  let registerCalls = 0;
  let firstRegisterResult = "registered";
  vi.mocked(harness.store.readReservation).mockImplementation(async () => trialRegistered
    ? { ...trialReservation, stripe_checkout_session_id: session.id, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId }
    : trialReservation);
  vi.mocked(harness.store.readVerifiedCustomer).mockResolvedValue({ customerId, attemptId });
  vi.mocked(harness.store.readSubscription).mockImplementation(async () => {
    subscriptionReads += 1;
    return subscriptionReads === 1 ? null : trialBinding;
  });
  vi.mocked(harness.store.registerTrial).mockImplementation(async () => {
    registerCalls += 1;
    trialRegistered = true;
    return registerCalls === 1 ? firstRegisterResult : "already_registered";
  });
  vi.mocked(harness.store.readTrialRegistration).mockImplementation(async () => trialRegistered ? trialRegistration : null);
  vi.mocked(harness.store.readTrialClaim).mockResolvedValue("claim_trial_bootstrap");
  const stripe = harness.deps.stripe as unknown as {
    checkout: { sessions: { retrieve: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; listLineItems: ReturnType<typeof vi.fn> } };
    customers: { retrieve: ReturnType<typeof vi.fn> };
    invoices: { retrieve: ReturnType<typeof vi.fn>; listLineItems: ReturnType<typeof vi.fn> };
    prices: { retrieve: ReturnType<typeof vi.fn> };
    subscriptions: { retrieve: ReturnType<typeof vi.fn> };
  };
  stripe.checkout = { sessions: {
    retrieve: vi.fn(async () => session),
    list: vi.fn(async () => ({ data: [session], has_more: false })),
    listLineItems: vi.fn(async () => ({ data: [checkoutLine], has_more: false })),
  } };
  stripe.customers.retrieve = vi.fn(async () => ({
    id: customerId,
    deleted: false,
    metadata: { feature_namespace: "form_coach", feature_key: "form_coach", payer_id: payerId, customer_create_attempt_id: attemptId },
  }));
  stripe.invoices.retrieve = vi.fn(async () => invoice);
  stripe.invoices.listLineItems = vi.fn(async () => ({ data: [invoiceLine], has_more: false }));
  stripe.prices.retrieve = vi.fn(async () => trialPrice);
  stripe.subscriptions.retrieve = vi.fn(async () => trialSubscription);
  return {
    ...harness, stripe, session, trialReservation, trialSubscription, trialRegistration,
    getRegisterCalls: () => registerCalls,
    setFirstRegisterResult: (result: string) => { firstRegisterResult = result; },
    setTrialRegistered: (registered: boolean) => { trialRegistered = registered; },
  };
}

function invoiceEvent(type: "invoice.payment_failed" | "invoice.paid"): Stripe.Event {
  return {
    id: type === "invoice.payment_failed" ? "evt_actual_failed" : "evt_actual_paid",
    type,
    livemode: false,
    created: start,
    data: { object: stripeInvoice("open", 0) },
  } as unknown as Stripe.Event;
}

describe("Form Coach Stripe invoice reconciliation", () => {
  it("acknowledges a connected-account Form Coach event without provider or store work", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    const event = {
      id: "evt_connected_form_coach",
      type: "checkout.session.completed",
      account: "acct_connected_synthetic",
      livemode: false,
      created: start,
      data: { object: {
        id: "cs_connected_form_coach",
        metadata: { feature_namespace: "form_coach", feature_key: "form_coach" },
      } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

    expect(harness.store.classify).not.toHaveBeenCalled();
    expect(harness.store.recordConflict).not.toHaveBeenCalled();
    expect(harness.calls).toHaveLength(0);
    expect(harness.snapshots).toHaveLength(0);
  });

  it("acknowledges a connected event whose provider ID is already known to Form Coach", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    const event = {
      id: "evt_connected_known_id",
      type: "invoice.paid",
      account: "acct_connected_synthetic",
      livemode: false,
      created: start,
      data: { object: { id: invoiceId, customer: customerId, status: "paid" } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

    expect(harness.store.classify).toHaveBeenCalled();
    expect(harness.store.recordConflict).not.toHaveBeenCalled();
    expect(harness.store.readInvoiceAlias).not.toHaveBeenCalled();
    expect(harness.calls).toHaveLength(0);
    expect(harness.snapshots).toHaveLength(0);
  });

  it("leaves an unrelated connected-account event for the existing Connect handler", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    vi.mocked(harness.store.classify).mockResolvedValue(null);
    const event = {
      id: "evt_unrelated_connect",
      type: "charge.refunded",
      account: "acct_connected_synthetic",
      livemode: false,
      created: start,
      data: { object: { id: "ch_unrelated_synthetic", metadata: {} } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(false);

    expect(harness.store.recordConflict).not.toHaveBeenCalled();
    expect(harness.calls).toHaveLength(0);
  });

  it("fails closed for a platform Form Coach event in the wrong Stripe mode", async () => {
    vi.mocked(isStripeTestMode).mockReturnValue(false);
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    const event = {
      ...invoiceEvent("invoice.paid"),
      livemode: false,
    } as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, harness.deps))
      .rejects.toThrow("Form Coach Stripe event mode does not match configuration");

    expect(harness.store.readInvoiceAlias).not.toHaveBeenCalled();
    expect(harness.store.recordConflict).not.toHaveBeenCalled();
    expect(harness.store.recordInvoiceSnapshot).not.toHaveBeenCalled();
    expect(harness.calls).toHaveLength(0);
    vi.mocked(isStripeTestMode).mockReturnValue(true);
  });

  it("stores the actual failed event identity alongside a retrieved paid current snapshot", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    const event = invoiceEvent("invoice.payment_failed");

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

    expect(harness.snapshots).toHaveLength(1);
    expect(harness.snapshots[0]).toMatchObject({
      eventId: event.id,
      eventType: event.type,
      status: "paid",
      amountDueCents: 2_500,
      amountPaidCents: 2_500,
      expectedInvoiceRevision: 5,
    });
    expect(harness.snapshots[0]?.actualEventDigest).not.toBe(harness.snapshots[0]?.snapshotDigest);
    expect(harness.calls.indexOf("read_revision")).toBeLessThan(harness.calls.indexOf("retrieve_invoice"));
    expect(harness.conflicts).toHaveLength(0);
  });

  it("keeps a paid event identity when the current retrieved invoice is still open", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "open", amountPaid: 0 });
    const event = invoiceEvent("invoice.paid");

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

    expect(harness.snapshots).toHaveLength(1);
    expect(harness.snapshots[0]).toMatchObject({
      eventId: event.id,
      eventType: event.type,
      status: "open",
      amountDueCents: 2_500,
      amountPaidCents: 0,
      expectedInvoiceRevision: 5,
    });
    expect(harness.conflicts).toHaveLength(0);
  });

  it("replays the same invoice delivery with the same internal snapshot identity", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    vi.mocked(harness.store.recordInvoiceSnapshot)
      .mockImplementationOnce(async (snapshot) => {
        harness.snapshots.push(snapshot as unknown as Record<string, unknown>);
        return "applied";
      })
      .mockImplementationOnce(async (snapshot) => {
        harness.snapshots.push(snapshot as unknown as Record<string, unknown>);
        return "duplicate_event";
      });
    const event = invoiceEvent("invoice.paid");

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);
    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

    expect(harness.snapshots).toHaveLength(2);
    expect(harness.snapshots[1]?.requestId).toBe(harness.snapshots[0]?.requestId);
    expect(harness.snapshots[1]?.snapshotDigest).toBe(harness.snapshots[0]?.snapshotDigest);
  });

  it("submits the revision captured before a delayed provider read", async () => {
    const harness = makeHarness({
      currentInvoiceStatus: "paid",
      amountPaid: 2_500,
      initialRevision: 7,
      mutateRevisionOnProviderRead: 8,
    });
    vi.mocked(harness.store.recordInvoiceSnapshot).mockImplementationOnce(async (snapshot) => {
      harness.snapshots.push(snapshot as unknown as Record<string, unknown>);
      return "stale";
    });
    const event = invoiceEvent("invoice.payment_failed");

    await expect(dispatchFormCoachStripeEvent(event, harness.deps))
      .rejects.toThrow("Invoice state reconciliation requires retry or review");

    expect(harness.snapshots[0]).toMatchObject({
      expectedInvoiceRevision: 7,
      status: "paid",
    });
    expect(harness.calls.indexOf("read_revision")).toBeLessThan(harness.calls.indexOf("retrieve_invoice"));
  });

  it("does not let an older interleaved provider read advance an already-updated invoice", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500, initialRevision: 7 });
    let releaseFirstRead: ((invoice: Stripe.Invoice) => void) | undefined;
    const firstRead = new Promise<Stripe.Invoice>((resolve) => { releaseFirstRead = resolve; });
    let retrieveCount = 0;
    vi.mocked(harness.deps.stripe.invoices.retrieve).mockImplementation(async () => {
      retrieveCount += 1;
      const invoice = retrieveCount === 1 ? await firstRead : stripeInvoice("paid", 2_500);
      return invoice as unknown as Stripe.Response<Stripe.Invoice>;
    });
    vi.mocked(harness.store.recordInvoiceSnapshot).mockImplementation(async (evidence) => {
      harness.snapshots.push(evidence as unknown as Record<string, unknown>);
      if (evidence.eventId === "evt_second_interleaved") {
        harness.revisionState.set(8);
        return "applied";
      }
      return "stale";
    });
    const delayedEvent = invoiceEvent("invoice.payment_failed");
    const currentEvent = { ...invoiceEvent("invoice.paid"), id: "evt_second_interleaved" } as Stripe.Event;

    const delayed = dispatchFormCoachStripeEvent(delayedEvent, harness.deps);
    await vi.waitFor(() => expect(retrieveCount).toBe(1));
    const current = dispatchFormCoachStripeEvent(currentEvent, harness.deps);
    await expect(current).resolves.toBe(true);
    releaseFirstRead?.(stripeInvoice("paid", 2_500));
    await expect(delayed).rejects.toThrow("Invoice state reconciliation requires retry or review");

    expect(harness.snapshots).toHaveLength(2);
    expect(harness.snapshots.map((snapshot) => snapshot.expectedInvoiceRevision)).toEqual([7, 7]);
    expect(harness.snapshots.find((snapshot) => snapshot.eventId === currentEvent.id)).toMatchObject({ status: "paid" });
    expect(harness.revisionState.get()).toBe(8);
  });

  it("retries a stale subscription CAS instead of acknowledging the older observation", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    vi.mocked(harness.store.applySubscriptionState).mockResolvedValue("stale_revision");
    const event = {
      id: "evt_stale_subscription_observation",
      type: "customer.subscription.updated",
      livemode: false,
      created: start,
      data: { object: subscription("active") },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, harness.deps))
      .rejects.toThrow("Subscription reconciliation requires a fresh provider observation");
  });

  it("derives the paid subscription PaymentIntent from its exact paid invoice when Checkout omits it", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    const metadata = {
      feature_namespace: "form_coach", feature_key: "form_coach", payer_id: payerId,
      reservation_id: reservationId, request_id: requestId, config_revision: "3", price_key: "monthly", pack_quantity: "1",
    };
    const session = {
      id: "cs_subscription_without_pi", customer: customerId, subscription: subscriptionId,
      mode: "subscription", status: "complete", payment_status: "paid", amount_subtotal: 2_500,
      amount_total: 2_500, currency: "usd", metadata, payment_intent: null, invoice: "in_subscription_create_paid",
      total_details: { amount_discount: 0, amount_tax: 0 },
    };
    const line = {
      id: "li_paid_subscription", quantity: 1, amount_subtotal: 2_500, amount_discount: 0, amount_tax: 0,
      price: { id: priceId, product: productId, unit_amount: 2_500, currency: "usd", recurring: { interval: "month" } },
    };
    const paidInvoice = {
      ...stripeInvoice("paid", 2_500),
      id: "in_subscription_create_paid",
      billing_reason: "subscription_create",
      payments: { object: "list", data: [{ payment: { type: "payment_intent", payment_intent: "pi_subscription_invoice" } }], has_more: false },
    } as unknown as Stripe.Invoice;
    const invoiceLine = {
      id: "il_paid_subscription", quantity: 1, amount: 2_500,
      currency: "usd", subscription: subscriptionId,
      discount_amounts: [], taxes: [], pretax_credit_amounts: [],
      pricing: { price_details: { price: priceId, product: productId } },
    };
    const paidSubscription = {
      ...subscription("active"),
      latest_invoice: "in_renewal_after_checkout",
    };
    vi.mocked(harness.store.readReservation).mockResolvedValue({
      ...reservation,
      stripe_checkout_session_id: session.id,
      stripe_subscription_id: subscriptionId,
    });
    const stripe = harness.deps.stripe as unknown as {
      checkout: { sessions: { retrieve: ReturnType<typeof vi.fn>; listLineItems: ReturnType<typeof vi.fn> } };
      invoices: { retrieve: ReturnType<typeof vi.fn>; listLineItems: ReturnType<typeof vi.fn> };
      prices: { retrieve: ReturnType<typeof vi.fn> };
      subscriptions: { retrieve: ReturnType<typeof vi.fn> };
      paymentIntents: { retrieve: ReturnType<typeof vi.fn> };
    };
    stripe.checkout = { sessions: {
      retrieve: vi.fn(async () => session),
      listLineItems: vi.fn(async () => ({ data: [line], has_more: false })),
    } };
    stripe.invoices.retrieve = vi.fn(async (id: string) => {
      expect(id).toBe(paidInvoice.id);
      return paidInvoice;
    });
    stripe.invoices.listLineItems = vi.fn(async () => ({ data: [invoiceLine], has_more: false }));
    stripe.prices.retrieve = vi.fn(async () => ({ ...line.price, product: productId }));
    stripe.subscriptions.retrieve = vi.fn(async () => paidSubscription);
    stripe.paymentIntents = { retrieve: vi.fn(async () => ({
      id: "pi_subscription_invoice", customer: customerId, status: "succeeded", amount_received: 2_500, currency: "usd",
    })) };
    const event = {
      id: "evt_subscription_checkout_without_pi",
      type: "checkout.session.completed",
      livemode: false,
      created: start,
      data: { object: { id: session.id, metadata } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, { ...harness.deps, stripe: stripe as unknown as Stripe })).resolves.toBe(true);

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_subscription_invoice");
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith("in_subscription_create_paid", expect.anything());
    expect(harness.store.applyCheckoutPayment).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: session.id,
      paymentObjectId: "pi_subscription_invoice",
      paymentIntentId: "pi_subscription_invoice",
    }));
  });

  it.each(["checkout_first", "subscription_first", "invoice_first"] as const)(
    "registers an unbound zero-payment trial when %s arrives first",
    async (firstEvent) => {
      const harness = makeTrialBootstrapHarness();
      const metadata = harness.session.metadata;
      const event = firstEvent === "checkout_first"
        ? ({
          id: "evt_trial_checkout_first", type: "checkout.session.completed", livemode: false, created: start,
          data: { object: { id: harness.session.id, metadata } },
        } as unknown as Stripe.Event)
        : firstEvent === "subscription_first"
          ? ({
            id: "evt_trial_subscription_first", type: "customer.subscription.created", livemode: false, created: start,
            data: { object: harness.trialSubscription },
          } as unknown as Stripe.Event)
          : ({
            id: "evt_trial_invoice_first", type: "invoice.paid", livemode: false, created: start,
            data: { object: {
              id: invoiceId,
              customer: customerId,
              status: "paid",
              currency: "usd",
              amount_due: 0,
              amount_paid: 0,
              period_start: start,
              period_end: start + 7 * 24 * 60 * 60,
              billing_reason: "subscription_create",
              parent: { type: "subscription_details", subscription_details: {
                subscription: subscriptionId, metadata,
              } },
              payments: { data: [], has_more: false },
            } },
          } as unknown as Stripe.Event);

      await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

      expect(harness.store.readVerifiedCustomer).toHaveBeenCalledWith(payerId);
      expect(harness.store.bindSession).toHaveBeenCalledWith({
        reservationId,
        sessionId: harness.session.id,
        customerId,
        subscriptionId,
      });
      expect(harness.store.registerTrial).toHaveBeenCalled();
      if (firstEvent === "invoice_first") expect(harness.store.recordInvoiceSnapshot).toHaveBeenCalled();
    },
  );

  it("replays a terminally registered zero-dollar trial invoice without a false late-payment conflict", async () => {
    const harness = makeTrialBootstrapHarness();
    const deletingReservation: FormCoachWebhookReservation = {
      ...harness.trialReservation,
      state: "cancel_required",
    };
    const boundDeletingReservation: FormCoachWebhookReservation = {
      ...deletingReservation,
      stripe_checkout_session_id: harness.session.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
    };
    const blockedTrialBinding: FormCoachWebhookSubscription = {
      ...currentBinding,
      status: "blocked_deletion",
      current_period_end: new Date((start + 60 + 7 * 24 * 60 * 60) * 1000).toISOString(),
      state_revision: 0,
    };
    let currentReservation = deletingReservation;
    let currentBindingRow: FormCoachWebhookSubscription | null = null;
    let terminal = false;
    vi.mocked(harness.store.readReservation).mockImplementation(async () => currentReservation);
    vi.mocked(harness.store.readSubscription).mockImplementation(async () => currentBindingRow);
    vi.mocked(harness.store.hasTerminalBinding).mockImplementation(async () => terminal);
    vi.mocked(harness.store.recordInvoiceSnapshot).mockResolvedValue("blocked_deletion");
    vi.mocked(harness.store.registerTrial).mockImplementation(async () => {
      harness.setTrialRegistered(true);
      currentReservation = boundDeletingReservation;
      currentBindingRow = blockedTrialBinding;
      return "blocked_deletion";
    });
    vi.mocked(harness.store.readTrialClaim).mockResolvedValue(null);
    vi.mocked(harness.store.applySubscriptionState).mockImplementation(async () => {
      if (currentBindingRow) {
        currentBindingRow = { ...currentBindingRow, status: "blocked_deletion", state_revision: currentBindingRow.state_revision + 1 };
      }
      return "blocked_deletion";
    });
    vi.mocked(harness.store.recordTrialTerminal).mockImplementation(async (input) => {
      terminal = true;
      currentReservation = { ...boundDeletingReservation, state: "canceled" };
      if (currentBindingRow) {
        const subscriptionStatus = input.p_subscription_status;
        const expectedRevision = input.p_expected_subscription_revision;
        if ((subscriptionStatus !== "canceled" && subscriptionStatus !== "incomplete_expired")
          || typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision)) {
          throw new Error("Test terminal subscription evidence is invalid");
        }
        currentBindingRow = {
          ...currentBindingRow,
          status: subscriptionStatus,
          state_revision: expectedRevision + 1,
        };
      }
      return "canceled";
    });
    const event = {
      id: "evt_trial_invoice_during_deletion", type: "invoice.paid", livemode: false, created: start,
      data: { object: {
        id: invoiceId, customer: customerId, status: "paid", currency: "usd", amount_due: 0, amount_paid: 0,
        period_start: start, period_end: start + 7 * 24 * 60 * 60, billing_reason: "subscription_create",
        parent: { type: "subscription_details", subscription_details: {
          subscription: subscriptionId, metadata: harness.session.metadata,
        } }, payments: { data: [], has_more: false },
      } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

    expect(harness.store.registerTrial).toHaveBeenCalledTimes(1);
    expect(harness.store.recordInvoiceSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      eventId: event.id, status: "paid", amountDueCents: 0, amountPaidCents: 0, trialClaimId: null,
    }));
    expect(harness.store.applyCheckoutPayment).not.toHaveBeenCalled();

    const stripe = harness.deps.stripe as unknown as {
      invoices: { list: ReturnType<typeof vi.fn> };
      paymentIntents: { list: ReturnType<typeof vi.fn> };
    };
    stripe.invoices.list = vi.fn(async () => ({ data: [{ id: invoiceId, status: "paid" }], has_more: false }));
    stripe.paymentIntents = { list: vi.fn(async () => ({ data: [], has_more: false })) };
    harness.trialSubscription.status = "canceled";
    const terminalEvent = {
      id: "evt_trial_subscription_deleted", type: "customer.subscription.deleted", livemode: false, created: start + 1,
      data: { object: { id: subscriptionId, customer: customerId, metadata: harness.trialSubscription.metadata } },
    } as unknown as Stripe.Event;
    await expect(dispatchFormCoachStripeEvent(terminalEvent, harness.deps)).resolves.toBe(true);
    expect(harness.store.recordTrialTerminal).toHaveBeenCalledTimes(1);
    expect(terminal).toBe(true);
    expect(currentReservation).toMatchObject({ state: "canceled" });
    expect(currentBindingRow).toMatchObject({ status: "canceled" });

    const conflictsBeforeReplay = vi.mocked(harness.store.recordConflict).mock.calls.length;
    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

    expect(harness.store.hasTerminalBinding).toHaveBeenLastCalledWith({ sessionId: harness.session.id, subscriptionId });
    expect(harness.store.recordConflict).toHaveBeenCalledTimes(conflictsBeforeReplay);
    expect(harness.store.recordInvoiceSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.store.recordTrialTerminal).toHaveBeenCalledTimes(1);
    expect(harness.store.readTrialClaim).toHaveBeenCalledTimes(2);
    expect(harness.store.applyCheckoutPayment).not.toHaveBeenCalled();
  });

  it("replays the exact original zero invoice after subscription cancellation without requiring a new trial claim", async () => {
    const harness = makeTrialBootstrapHarness();
    harness.setTrialRegistered(true);
    const boundReservation: FormCoachWebhookReservation = {
      ...harness.trialReservation,
      state: "bound",
      stripe_checkout_session_id: harness.session.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
    };
    vi.mocked(harness.store.readReservation).mockResolvedValue(boundReservation);
    harness.trialSubscription.status = "canceled";
    const event = {
      id: "evt_original_trial_invoice_after_cancel", type: "invoice.paid", livemode: false, created: start,
      data: { object: {
        id: invoiceId, customer: customerId, status: "paid", currency: "usd", amount_due: 0, amount_paid: 0,
        period_start: start, period_end: start + 7 * 24 * 60 * 60, billing_reason: "subscription_create",
        parent: { type: "subscription_details", subscription_details: {
          subscription: subscriptionId, metadata: harness.session.metadata,
        } }, payments: { data: [], has_more: false },
      } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

    expect(harness.store.registerTrial).not.toHaveBeenCalled();
    expect(harness.store.recordConflict).not.toHaveBeenCalled();
    expect(harness.store.recordInvoiceSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      eventId: event.id, invoiceId, trialClaimId: "claim_trial_bootstrap", amountPaidCents: 0,
    }));
  });

  it.each([
    { snapshotResult: "applied" as const, currentRevision: 6, headEventId: "fc_invoice_snapshot:independent_current_head" },
    { snapshotResult: "duplicate_event" as const, currentRevision: 5, headEventId: "fc_invoice_snapshot:independent_current_head" },
    { snapshotResult: "duplicate_event" as const, currentRevision: 5, headEventId: null },
  ])("keeps a positive invoice after terminal binding conflicting when snapshot is $snapshotResult and head is $headEventId", async ({ snapshotResult, currentRevision, headEventId }) => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    vi.mocked(harness.store.hasTerminalBinding).mockResolvedValue(true);
    vi.mocked(harness.store.recordInvoiceSnapshot).mockResolvedValue(snapshotResult);
    vi.mocked(harness.store.readInvoiceHead).mockResolvedValue(headEventId === null ? null : ({
      invoiceId,
      subscriptionId,
      payerId,
      contractVersion: 1,
      status: "paid",
      currency: "USD",
      amountDueCents: 2_500,
      amountPaidCents: 2_500,
      periodStartEpoch: start,
      periodEndEpoch: end,
      paymentIntentId: "pi_form_coach_synthetic",
      chargeId: null,
      trialClaimId: null,
      lastEventId: headEventId,
      stateRevision: currentRevision,
    }));
    const calls: string[] = [];
    const stripe = harness.deps.stripe as unknown as {
      invoices: {
        list: ReturnType<typeof vi.fn>;
      };
      invoicePayments: { list: ReturnType<typeof vi.fn> };
      paymentIntents: { retrieve: ReturnType<typeof vi.fn> };
      subscriptions: { retrieve: ReturnType<typeof vi.fn> };
    };
    stripe.invoices.list = vi.fn(async () => ({ data: [stripeInvoice("paid", 2_500)], has_more: false }));
    stripe.invoicePayments = { list: vi.fn(async () => ({
      data: [{
        id: "inpay_terminal_positive",
        status: "paid",
        payment: { type: "payment_intent", payment_intent: "pi_terminal_positive" },
      }],
      has_more: false,
    })) };
    stripe.paymentIntents = { retrieve: vi.fn(async (id: string) => {
      calls.push(`payment_intent:${id}`);
      return {
        id,
        customer: customerId,
        status: "succeeded",
        amount: 2_500,
        amount_received: 2_500,
        currency: "usd",
      };
    }) };
    stripe.subscriptions.retrieve = vi.fn(async () => subscription("canceled"));
    const event = {
      id: "evt_positive_invoice_after_terminal",
      type: "invoice.paid",
      livemode: false,
      created: start,
      data: { object: stripeInvoice("paid", 2_500) },
    } as unknown as Stripe.Event;

    const dispatch = dispatchFormCoachStripeEvent(event, harness.deps);
    if (headEventId === null) {
      await expect(dispatch).rejects.toThrow("Invoice terminal evidence requires a current matching projection");
    } else {
      await expect(dispatch).resolves.toBe(true);
    }

    expect(harness.store.recordConflict).toHaveBeenCalledWith(expect.objectContaining({
      eventId: event.id,
      objectId: invoiceId,
      kind: "payment_after_terminal",
    }));
    expect(harness.store.recordInvoiceSnapshot).toHaveBeenCalled();
    if (headEventId === null) {
      expect(harness.store.resolveConflicts).not.toHaveBeenCalled();
    } else {
      expect(harness.store.resolveConflicts).toHaveBeenCalledWith(expect.objectContaining({
        resourceKind: "invoice",
        resourceId: invoiceId,
        expectedRevision: currentRevision,
        evidence: expect.objectContaining({ currentEventId: headEventId, expectedRevision: currentRevision }),
      }));
    }
    expect(harness.store.applyCheckoutPayment).not.toHaveBeenCalled();
    expect(calls).toEqual(headEventId === null ? [] : ["payment_intent:pi_terminal_positive"]);
  });

  it.each([
    { firstEvent: "subscription_first" as const, mismatch: "price" as const },
    { firstEvent: "subscription_first" as const, mismatch: "quantity" as const },
    { firstEvent: "invoice_first" as const, mismatch: "price" as const },
    { firstEvent: "invoice_first" as const, mismatch: "quantity" as const },
  ])("rejects a trial bootstrap with a changed current subscription $mismatch", async ({ firstEvent, mismatch }) => {
    const harness = makeTrialBootstrapHarness();
    const item = harness.trialSubscription.items.data[0];
    if (mismatch === "price") item.price = { ...item.price, id: "price_changed_after_checkout" };
    else item.quantity = 2;
    const event = firstEvent === "subscription_first"
      ? ({
        id: "evt_trial_changed_subscription_price", type: "customer.subscription.created", livemode: false, created: start,
        data: { object: harness.trialSubscription },
      } as unknown as Stripe.Event)
      : ({
        id: "evt_trial_changed_invoice_quantity", type: "invoice.paid", livemode: false, created: start,
        data: { object: {
          id: invoiceId, customer: customerId, status: "paid", currency: "usd", amount_due: 0, amount_paid: 0,
          period_start: start, period_end: start + 7 * 24 * 60 * 60, billing_reason: "subscription_create",
          parent: { type: "subscription_details", subscription_details: {
            subscription: subscriptionId, metadata: harness.session.metadata,
          } }, payments: { data: [], has_more: false },
        } },
      } as unknown as Stripe.Event);

    if (firstEvent === "subscription_first") {
      await expect(dispatchFormCoachStripeEvent(event, harness.deps))
        .rejects.toThrow("Current trial subscription does not match its frozen reservation");
    } else {
      await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);
      expect(harness.store.recordConflict).toHaveBeenCalledWith(expect.objectContaining({
        objectId: invoiceId, kind: "terminal_identity_mismatch",
      }));
    }
    expect(harness.store.registerTrial).not.toHaveBeenCalled();
    expect(harness.store.recordInvoiceSnapshot).not.toHaveBeenCalled();
  });

  it("records trial terminal proof only when the complete current provider inventory is settled", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 0 });
    const trialReservation: FormCoachWebhookReservation = {
      ...reservation,
      trial_days: 7,
      total_amount_cents: 2_500,
      state: "cancel_required",
    };
    const registration = {
      requestId,
      reservationId,
      sessionId: "cs_form_coach_synthetic",
      customerId,
      invoiceId,
      trialDays: 7,
      trialStart: new Date(start * 1000).toISOString(),
      trialEnd: new Date(end * 1000).toISOString(),
    };
    vi.mocked(harness.store.readReservation).mockResolvedValue(trialReservation);
    vi.mocked(harness.store.readTrialRegistration).mockResolvedValue(registration);
    const stripe = harness.deps.stripe as unknown as {
      checkout: { sessions: { retrieve: ReturnType<typeof vi.fn> } };
      invoices: { list: ReturnType<typeof vi.fn> };
      paymentIntents: { list: ReturnType<typeof vi.fn> };
      subscriptions: { retrieve: ReturnType<typeof vi.fn> };
    };
    stripe.subscriptions.retrieve.mockResolvedValue(subscription("canceled"));
    stripe.checkout = { sessions: { retrieve: vi.fn(async () => ({
      id: registration.sessionId,
      status: "complete",
      payment_status: "no_payment_required",
      customer: customerId,
      subscription: subscriptionId,
    })) } };
    stripe.invoices.list = vi.fn(async () => ({
      data: [{ id: invoiceId, status: "paid" }],
      has_more: false,
    }));
    stripe.paymentIntents = { list: vi.fn(async () => ({ data: [], has_more: false })) };
    const event = {
      id: "evt_subscription_canceled_trial",
      type: "customer.subscription.deleted",
      livemode: false,
      created: start,
      data: { object: { id: subscriptionId, customer: customerId, metadata: subscription().metadata } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

    expect(harness.store.recordTrialTerminal).toHaveBeenCalledWith(expect.objectContaining({
      p_session_status: "complete",
      p_payment_status: "no_payment_required",
      p_subscription_status: "canceled",
      p_outstanding_invoice_count: 0,
      p_active_payment_intent_count: 0,
    }));
  });

  it("keeps a trial terminal unresolved when provider inventory is paginated", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 0 });
    const trialReservation: FormCoachWebhookReservation = { ...reservation, trial_days: 7, state: "cancel_required" };
    const registration = {
      requestId,
      reservationId,
      sessionId: "cs_form_coach_synthetic",
      customerId,
      invoiceId,
      trialDays: 7,
      trialStart: new Date(start * 1000).toISOString(),
      trialEnd: new Date(end * 1000).toISOString(),
    };
    vi.mocked(harness.store.readReservation).mockResolvedValue(trialReservation);
    vi.mocked(harness.store.readTrialRegistration).mockResolvedValue(registration);
    const stripe = harness.deps.stripe as unknown as {
      checkout: { sessions: { retrieve: ReturnType<typeof vi.fn> } };
      invoices: { list: ReturnType<typeof vi.fn> };
      paymentIntents: { list: ReturnType<typeof vi.fn> };
      subscriptions: { retrieve: ReturnType<typeof vi.fn> };
    };
    stripe.subscriptions.retrieve.mockResolvedValue(subscription("canceled"));
    stripe.checkout = { sessions: { retrieve: vi.fn(async () => ({
      id: registration.sessionId,
      status: "complete",
      payment_status: "no_payment_required",
      customer: customerId,
      subscription: subscriptionId,
    })) } };
    stripe.invoices.list = vi.fn(async () => ({ data: [{ id: invoiceId, status: "paid" }], has_more: true }));
    stripe.paymentIntents = { list: vi.fn(async () => ({ data: [], has_more: false })) };
    const event = {
      id: "evt_subscription_canceled_trial_paged",
      type: "customer.subscription.deleted",
      livemode: false,
      created: start,
      data: { object: { id: subscriptionId, customer: customerId, metadata: subscription().metadata } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).rejects.toThrow("Trial invoice inventory is incomplete");
    expect(harness.store.recordTrialTerminal).not.toHaveBeenCalled();
  });

  it("captures the refund CAS revision from the alias before retrieving the refund", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500, initialRevision: 4 });
    vi.mocked(harness.store.readInvoiceAlias).mockImplementation(async (kind, objectId) => {
      harness.calls.push(`read_alias:${kind}:${objectId}`);
      return { invoice_id: invoiceId, payer_id: payerId, subscription_id: subscriptionId, state_revision: 4 };
    });
    const stripe = harness.deps.stripe as unknown as {
      refunds: { retrieve: ReturnType<typeof vi.fn> };
    };
    stripe.refunds.retrieve = vi.fn(async () => {
      harness.calls.push("retrieve_refund");
      return {
        id: "re_form_coach_synthetic",
        status: "succeeded",
        charge: "ch_form_coach_synthetic",
        payment_intent: "pi_form_coach_synthetic",
        amount: 2_500,
        currency: "usd",
      };
    });
    const event = {
      id: "evt_refund_updated_synthetic",
      type: "refund.updated",
      livemode: false,
      created: start,
      data: { object: {
        id: "re_form_coach_synthetic",
        charge: "ch_form_coach_synthetic",
        payment_intent: "pi_form_coach_synthetic",
      } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

    expect(harness.calls.indexOf("read_alias:charge:ch_form_coach_synthetic"))
      .toBeLessThan(harness.calls.indexOf("retrieve_refund"));
    expect(harness.store.recordRefund).toHaveBeenCalledWith(expect.objectContaining({
      invoiceId,
      paymentIntentId: "pi_form_coach_synthetic",
      chargeId: "ch_form_coach_synthetic",
      expectedInvoiceRevision: 4,
    }));
  });

  it.each(["charge.refunded", "refund.updated"] as const)(
    "returns a retryable webhook failure for a stale %s CAS, then converges on fresh revision",
    async (eventType) => {
      const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500, initialRevision: 4 });
      let revision = 4;
      const attemptedRevisions: number[] = [];
      vi.mocked(harness.store.readInvoiceAlias).mockImplementation(async () => ({
        invoice_id: invoiceId, payer_id: payerId, subscription_id: subscriptionId, state_revision: revision,
      }));
      vi.mocked(harness.store.recordRefund).mockImplementation(async (input) => {
        attemptedRevisions.push(input.expectedInvoiceRevision);
        if (attemptedRevisions.length === 1) {
          revision = 5;
          return "cas_stale";
        }
        return "refunded";
      });
      const stripe = harness.deps.stripe as unknown as {
        refunds: { retrieve: ReturnType<typeof vi.fn> };
        charges: { retrieve: ReturnType<typeof vi.fn> };
      };
      stripe.refunds.retrieve = vi.fn(async () => ({
        id: "re_stale_retry", status: "succeeded", charge: "ch_stale_retry",
        payment_intent: "pi_stale_retry", amount: 2_500, currency: "usd",
      }));
      stripe.charges.retrieve = vi.fn(async () => ({
        id: "ch_stale_retry", customer: customerId, paid: true, amount: 2_500, amount_refunded: 2_500,
        currency: "usd", payment_intent: "pi_stale_retry", refunds: { data: [{
          id: "re_stale_retry", status: "succeeded", charge: "ch_stale_retry", payment_intent: "pi_stale_retry",
          amount: 2_500, currency: "usd",
        }], has_more: false },
      }));
      const event = {
        id: "evt_refund_stale_retry", type: eventType, livemode: false, created: start,
        data: { object: eventType === "refund.updated"
          ? { id: "re_stale_retry", charge: "ch_stale_retry", payment_intent: "pi_stale_retry" }
          : { id: "ch_stale_retry", payment_intent: "pi_stale_retry" } },
      } as unknown as Stripe.Event;

      await expect(dispatchFormCoachStripeEvent(event, harness.deps))
        .rejects.toThrow("Refund reconciliation requires retry or review");
      await expect(dispatchFormCoachStripeEvent(event, harness.deps)).resolves.toBe(true);

      expect(attemptedRevisions).toEqual([4, 5]);
    },
  );

  it("applies a fully verified Form Coach pack refund through the pack-credit primitive", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    const packReservation: FormCoachWebhookReservation = {
      ...reservation,
      credits_per_pack: 5,
      billing_interval: null,
      stripe_subscription_id: null,
    };
    const receipt = {
      receiptId: "00000000-0000-4000-8000-000000000015",
      requestId,
      payerId,
      customerId,
      paymentIntentId: "pi_pack_refund",
      amountCents: 2_500,
      packQuantity: 1,
      creditsPerPack: 5,
      currency: "USD",
    };
    vi.mocked(harness.store.readReservation).mockResolvedValue(packReservation);
    vi.mocked(harness.store.readPackReceipt).mockResolvedValue(receipt);
    const refund = {
      id: "re_pack_full",
      object: "refund",
      amount: 2_500,
      currency: "usd",
      status: "succeeded",
      charge: "ch_pack_refund",
      payment_intent: receipt.paymentIntentId,
    };
    const stripe = {
      customers: { retrieve: vi.fn(async () => ({
        id: customerId,
        deleted: false,
        metadata: {
          feature_namespace: "form_coach", feature_key: "form_coach", payer_id: payerId,
          customer_create_attempt_id: attemptId,
        },
      })) },
      charges: { retrieve: vi.fn(async () => ({
        id: "ch_pack_refund", customer: customerId, paid: true, amount: 2_500, amount_refunded: 2_500,
        currency: "usd", payment_intent: receipt.paymentIntentId,
      })) },
      paymentIntents: { retrieve: vi.fn(async () => ({
        id: receipt.paymentIntentId, customer: customerId, status: "succeeded", amount: 2_500,
        amount_received: 2_500, currency: "usd",
      })) },
      refunds: { list: vi.fn(async () => ({ data: [refund], has_more: false })) },
    } as unknown as Stripe;
    const event = {
      id: "evt_pack_full_refund",
      type: "charge.refunded",
      livemode: false,
      created: start,
      data: { object: {
        id: "ch_pack_refund", customer: customerId, payment_intent: receipt.paymentIntentId,
        metadata: { feature_namespace: "form_coach", feature_key: "form_coach" },
      } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, { ...harness.deps, stripe })).resolves.toBe(true);

    expect(harness.store.recordPackRefund).toHaveBeenCalledWith(expect.objectContaining({
      eventId: event.id,
      refundId: refund.id,
      receiptId: receipt.receiptId,
      amountCents: receipt.amountCents,
      refundedPackQuantity: receipt.packQuantity,
      outcome: "applied",
    }));
    expect(harness.store.recordRefund).not.toHaveBeenCalled();
  });

  it("durably reviews a partial pack refund without removing pack units", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    const packReservation: FormCoachWebhookReservation = { ...reservation, credits_per_pack: 5, billing_interval: null };
    const receipt = {
      receiptId: "00000000-0000-4000-8000-000000000016", requestId, payerId, customerId,
      paymentIntentId: "pi_pack_partial", amountCents: 2_500, packQuantity: 1, creditsPerPack: 5, currency: "USD",
    };
    vi.mocked(harness.store.readReservation).mockResolvedValue(packReservation);
    vi.mocked(harness.store.readPackReceipt).mockResolvedValue(receipt);
    const refund = {
      id: "re_pack_partial", object: "refund", amount: 1_200, currency: "usd", status: "succeeded",
      charge: "ch_pack_partial", payment_intent: receipt.paymentIntentId,
    };
    const stripe = {
      customers: { retrieve: vi.fn(async () => ({
        id: customerId, deleted: false,
        metadata: { feature_namespace: "form_coach", feature_key: "form_coach", payer_id: payerId, customer_create_attempt_id: attemptId },
      })) },
      charges: { retrieve: vi.fn(async () => ({
        id: "ch_pack_partial", customer: customerId, paid: true, amount: 2_500, amount_refunded: 1_200,
        currency: "usd", payment_intent: receipt.paymentIntentId,
      })) },
      paymentIntents: { retrieve: vi.fn(async () => ({
        id: receipt.paymentIntentId, customer: customerId, status: "succeeded", amount: 2_500,
        amount_received: 2_500, currency: "usd",
      })) },
      refunds: { list: vi.fn(async () => ({ data: [refund], has_more: false })) },
    } as unknown as Stripe;
    const event = {
      id: "evt_pack_partial_refund", type: "charge.refunded", livemode: false, created: start,
      data: { object: { id: "ch_pack_partial", customer: customerId, payment_intent: receipt.paymentIntentId,
        metadata: { feature_namespace: "form_coach", feature_key: "form_coach" } } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, { ...harness.deps, stripe })).resolves.toBe(true);

    expect(harness.store.recordPackRefund).toHaveBeenCalledWith(expect.objectContaining({
      refundId: refund.id, outcome: "manual_review", reviewReason: "partial_or_ambiguous_amount",
    }));
  });

  it("keeps pack refund identity stable while appending newer cumulative provider observations", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    const packReservation: FormCoachWebhookReservation = { ...reservation, credits_per_pack: 5, billing_interval: null };
    const receipt = {
      receiptId: "00000000-0000-4000-8000-000000000018", requestId, payerId, customerId,
      paymentIntentId: "pi_pack_observation", amountCents: 2_500, packQuantity: 1, creditsPerPack: 5, currency: "USD",
    };
    vi.mocked(harness.store.readReservation).mockResolvedValue(packReservation);
    vi.mocked(harness.store.readPackReceipt).mockResolvedValue(receipt);
    const firstRefund = {
      id: "re_pack_observation_first", amount: 500, currency: "usd", status: "succeeded",
      charge: "ch_pack_observation", payment_intent: receipt.paymentIntentId,
    };
    const laterRefund = {
      id: "re_pack_observation_later", amount: 700, currency: "usd", status: "succeeded",
      charge: "ch_pack_observation", payment_intent: receipt.paymentIntentId,
    };
    let amountRefunded = 500;
    let currentRefunds = [firstRefund];
    const stripe = {
      customers: { retrieve: vi.fn(async () => ({
        id: customerId, deleted: false,
        metadata: { feature_namespace: "form_coach", feature_key: "form_coach", payer_id: payerId, customer_create_attempt_id: attemptId },
      })) },
      charges: { retrieve: vi.fn(async () => ({
        id: "ch_pack_observation", customer: customerId, paid: true, amount: 2_500, amount_refunded: amountRefunded,
        currency: "usd", payment_intent: receipt.paymentIntentId,
      })) },
      paymentIntents: { retrieve: vi.fn(async () => ({
        id: receipt.paymentIntentId, customer: customerId, status: "succeeded", amount: 2_500,
        amount_received: 2_500, currency: "usd",
      })) },
      refunds: { list: vi.fn(async () => ({ data: currentRefunds, has_more: false })) },
    } as unknown as Stripe;
    const event = {
      id: "evt_pack_observation_replay", type: "charge.refunded", livemode: false, created: start,
      data: { object: { id: "ch_pack_observation", customer: customerId, payment_intent: receipt.paymentIntentId,
        metadata: { feature_namespace: "form_coach", feature_key: "form_coach" } } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, { ...harness.deps, stripe })).resolves.toBe(true);
    amountRefunded = 1_200;
    currentRefunds = [firstRefund, laterRefund];
    await expect(dispatchFormCoachStripeEvent(event, { ...harness.deps, stripe })).resolves.toBe(true);

    const firstRefundCalls = harness.packRefunds.filter((row) => row.refundId === firstRefund.id);
    expect(firstRefundCalls).toHaveLength(2);
    expect(firstRefundCalls[0]?.identityDigest).toBe(firstRefundCalls[1]?.identityDigest);
    expect(firstRefundCalls[0]?.observedRefundTotalCents).toBe(500);
    expect(firstRefundCalls[1]?.observedRefundTotalCents).toBe(1_200);
    expect(firstRefundCalls[0]?.observationDigest).not.toBe(firstRefundCalls[1]?.observationDigest);
    expect(harness.conflicts).toHaveLength(0);
  });

  it("does not call provider or pack-credit mutation for an unbound refund", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    const provider = { charges: { retrieve: vi.fn() }, paymentIntents: { retrieve: vi.fn() } } as unknown as Stripe;
    vi.mocked(harness.store.readPackReceipt).mockResolvedValue(null);
    const event = {
      id: "evt_unknown_pack_refund", type: "charge.refunded", livemode: false, created: start,
      data: { object: { id: "ch_unknown_pack", payment_intent: "pi_unknown_pack",
        metadata: { feature_namespace: "form_coach", feature_key: "form_coach" } } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, { ...harness.deps, stripe: provider }))
      .rejects.toThrow("Refund payment binding is not ready");

    expect(provider.charges.retrieve).not.toHaveBeenCalled();
    expect(harness.store.recordPackRefund).not.toHaveBeenCalled();
  });
});

describe("Form Coach terminal-conflict reconciliation", () => {
  it("scopes terminal inventory to the subscription invoice payments, not all payer PaymentIntents", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    vi.mocked(harness.store.hasTerminalBinding).mockResolvedValue(true);
    const calls: string[] = [];
    const stripe = {
      invoices: {
        list: vi.fn(async (params: { subscription?: string }) => {
          calls.push(`invoices:${params.subscription}`);
          return { data: [stripeInvoice("paid", 2_500)], has_more: false };
        }),
      },
      invoicePayments: {
        list: vi.fn(async (params: { invoice?: string }) => {
          calls.push(`invoice_payments:${params.invoice}`);
          return { data: [{
            id: "inpay_form_coach_synthetic",
            status: "paid",
            payment: { type: "payment_intent", payment_intent: "pi_form_coach_synthetic" },
          }], has_more: false };
        }),
      },
      paymentIntents: {
        retrieve: vi.fn(async (id: string) => {
          calls.push(`payment_intent:${id}`);
          return {
            id,
            customer: customerId,
            status: "succeeded",
            amount: 2_500,
            amount_received: 2_500,
            currency: "usd",
          };
        }),
      },
      charges: { retrieve: vi.fn() },
      subscriptions: { retrieve: vi.fn(async () => subscription("canceled")) },
    } as unknown as Stripe;
    const event = {
      id: "evt_subscription_terminal_observed",
      type: "customer.subscription.deleted",
      livemode: false,
      created: start,
      data: { object: subscription("canceled") },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, { ...harness.deps, stripe })).resolves.toBe(true);

    expect(calls).toEqual([
      `invoices:${subscriptionId}`,
      `invoice_payments:${invoiceId}`,
      "payment_intent:pi_form_coach_synthetic",
    ]);
    expect(harness.resolutions).toHaveLength(1);
    expect(harness.resolutions[0]).toMatchObject({
      resourceKind: "subscription",
      resourceId: subscriptionId,
      evidence: expect.objectContaining({
        status: "canceled",
        invoiceCount: 1,
        outstandingInvoiceCount: 0,
        paymentIntentCount: 1,
        invoiceIdsDigest: "084fc5df53bfdccd3740010aad6fb2c480d13d9fa344e99dd57d87134137cec6",
        paymentIntentIdsDigest: "510b8869ee0439774c4e98e89a83a4ad660a67804f49d2c697a124f7db8a7ba1",
        chargeIdsDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        activePaymentIntentCount: 0,
        chargeCount: 0,
        invoicePaymentCount: 1,
      }),
    });
  });

  it("records a fresh paid pack contradiction without creating a receipt or entitlement", async () => {
    const harness = makeHarness({ currentInvoiceStatus: "paid", amountPaid: 2_500 });
    const packReservation: FormCoachWebhookReservation = {
      ...reservation,
      credits_per_pack: 5,
      billing_interval: null,
      trial_days: 0,
      state: "expired",
      stripe_subscription_id: null,
    };
    vi.mocked(harness.store.readReservation).mockResolvedValue(packReservation);
    vi.mocked(harness.store.hasTerminalBinding).mockResolvedValue(true);
    const metadata = {
      feature_namespace: "form_coach",
      feature_key: "form_coach",
      payer_id: payerId,
      reservation_id: reservationId,
      request_id: requestId,
      config_revision: "3",
      price_key: "monthly",
      pack_quantity: "1",
    };
    const line = {
      id: "il_pack_synthetic",
      object: "item",
      amount_subtotal: 2_500,
      amount_discount: 0,
      amount_tax: 0,
      quantity: 1,
      price: {
        id: priceId,
        product: productId,
        unit_amount: 2_500,
        currency: "usd",
        recurring: null,
      },
    };
    const session = {
      id: "cs_form_coach_synthetic",
      object: "checkout.session",
      customer: customerId,
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      amount_subtotal: 2_500,
      amount_total: 2_500,
      currency: "usd",
      metadata,
      total_details: { amount_discount: 0, amount_tax: 0 },
      payment_intent: "pi_pack_synthetic",
      subscription: null,
    };
    const calls: string[] = [];
    const stripe = {
      checkout: { sessions: {
        retrieve: vi.fn(async () => { calls.push("session"); return session; }),
        listLineItems: vi.fn(async () => ({ data: [line], has_more: false })),
      } },
      customers: { retrieve: vi.fn(async () => ({
        id: customerId,
        deleted: false,
        metadata: {
          feature_namespace: "form_coach",
          feature_key: "form_coach",
          payer_id: payerId,
          customer_create_attempt_id: attemptId,
        },
      })) },
      paymentIntents: { retrieve: vi.fn(async () => {
        calls.push("payment_intent");
        return {
          id: "pi_pack_synthetic",
          customer: customerId,
          status: "succeeded",
          amount_received: 2_500,
          currency: "usd",
        };
      }) },
    } as unknown as Stripe;
    const deps = { ...harness.deps, stripe };
    const event = {
      id: "evt_late_pack_paid",
      type: "checkout.session.completed",
      livemode: false,
      created: start,
      data: { object: { id: session.id, metadata } },
    } as unknown as Stripe.Event;

    await expect(dispatchFormCoachStripeEvent(event, deps)).resolves.toBe(true);

    expect(harness.conflicts).toContainEqual(expect.objectContaining({
      eventId: event.id,
      objectId: session.id,
      kind: "payment_after_terminal",
    }));
    expect(harness.resolutions).toHaveLength(1);
    expect(harness.resolutions[0]).toMatchObject({
      resourceKind: "checkout_session",
      resourceId: session.id,
      observedAt: expect.stringMatching(/^2026-/),
      evidence: expect.objectContaining({
        reservationId,
        customerId,
        status: "complete",
        paymentStatus: "paid",
        paymentIntentId: "pi_pack_synthetic",
        paymentIntentStatus: "succeeded",
        paymentIntentAmountReceived: 2_500,
      }),
    });
    expect(calls).toEqual(["session", "session", "payment_intent"]);
    expect(harness.store.applyCheckoutPayment).not.toHaveBeenCalled();
  });
});
