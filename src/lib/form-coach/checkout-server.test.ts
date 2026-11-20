import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn(), isStripeConfigured: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ getSiteUrl: vi.fn() }));

import {
  createFormCoachCheckout,
  formCoachReturnUrl,
  isStripeCheckoutUrl,
  isFormCoachCheckoutEnabled,
  reconcileFormCoachCheckoutReturn,
  type FormCoachCheckoutStore,
} from "./checkout-server";
import { featurePricing as enPricing } from "@/i18n/en/feature-pricing";
import { featurePricing as esPricing } from "@/i18n/es/feature-pricing";
import { getFormCoachOfferTitle } from "./offer-title";

const payerId = "f1000000-0000-4000-8000-000000000001";
const requestId = "f2000000-0000-4000-8000-000000000002";
const customerAttemptId = "f3000000-0000-4000-8000-000000000003";
const reservationId = "f4000000-0000-4000-8000-000000000004";
const customerId = "cus_synthetic";
const sessionId = "cs_test_synthetic";
const priceId = "price_synthetic";
const productId = "prod_synthetic";
const now = new Date("2026-11-19T16:00:00.000Z");

function pricing(overrides: Record<string, unknown> = {}) {
  return {
    featureKey: "form_coach" as const,
    revision: 7,
    status: "live" as const,
    payer: "coach" as const,
    billingModel: "subscription" as const,
    displayName: "Form Coach",
    description: "Synthetic description",
    marketingCopy: "Synthetic copy",
    trialDays: 0,
    trialAssessments: 0,
    offers: [{
      priceKey: "monthly",
      amountCents: 1200,
      currency: "USD",
      interval: "month" as const,
      creditsPerPack: null,
      stripeProductId: productId,
      stripePriceId: priceId,
    }],
    ...overrides,
  };
}

function checkoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: reservationId,
    request_id: requestId,
    idempotency_key: `form-coach:${requestId}`,
    feature_key: "form_coach",
    config_revision: 7,
    payer_role: "coach",
    payer_id: payerId,
    price_key: "monthly",
    stripe_product_id: productId,
    stripe_price_id: priceId,
    unit_amount_cents: 1200,
    currency: "USD",
    pack_quantity: 1,
    credits_per_pack: null,
    quoted_credits: 0,
    total_amount_cents: 1200,
    trial_days: 0,
    state: "reserved",
    stripe_checkout_session_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    expires_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
    created_at: new Date(now.getTime() - 1_000).toISOString(),
    ...overrides,
  };
}

function customer(metadata: Record<string, string> = {
  feature_namespace: "form_coach",
  feature_key: "form_coach",
  payer_id: payerId,
  customer_create_attempt_id: customerAttemptId,
}) {
  return { id: customerId, deleted: false, metadata } as unknown as Stripe.Customer;
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    mode: "subscription",
    status: "open",
    payment_status: "unpaid",
    url: "https://checkout.stripe.com/c/pay/synthetic",
    client_reference_id: payerId,
    currency: "usd",
    amount_subtotal: 1200,
    amount_total: 1200,
    allow_promotion_codes: false,
    discounts: [],
    automatic_tax: { enabled: false },
    total_details: { amount_discount: 0, amount_shipping: null, amount_tax: 0 },
    customer: customerId,
    subscription: null,
    metadata: {
      feature_namespace: "form_coach",
      feature_key: "form_coach",
      payer_id: payerId,
      reservation_id: reservationId,
      request_id: requestId,
      config_revision: "7",
      price_key: "monthly",
      pack_quantity: "1",
    },
    line_items: { has_more: false, data: [{ quantity: 1, currency: "usd", amount_subtotal: 1200, amount_discount: 0, amount_tax: 0,
      amount_total: 1200, price: { id: priceId, product: productId, unit_amount: 1200, currency: "usd", type: "recurring" } }] },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

function historicCheckoutRow(overrides: Record<string, unknown> = {}) {
  const historicRequestId = "f6000000-0000-4000-8000-000000000006";
  return checkoutRow({
    request_id: historicRequestId,
    idempotency_key: `form-coach:${historicRequestId}`,
    config_revision: 6,
    price_key: "pack_5",
    stripe_product_id: "prod_historic",
    stripe_price_id: "price_historic",
    unit_amount_cents: 900,
    currency: "USD",
    pack_quantity: 2,
    credits_per_pack: 5,
    quoted_credits: 10,
    total_amount_cents: 1800,
    state: "bound",
    stripe_checkout_session_id: "cs_test_historic",
    stripe_customer_id: customerId,
    ...overrides,
  });
}

function sessionForReservation(row: ReturnType<typeof historicCheckoutRow>, status: "open" | "expired") {
  const base = session();
  const lineTotal = row.trial_days > 0 ? 0 : row.total_amount_cents;
  return session({
    ...base,
    id: row.stripe_checkout_session_id,
    status,
    mode: row.credits_per_pack === null ? "subscription" : "payment",
    amount_subtotal: lineTotal,
    amount_total: lineTotal,
    metadata: {
      ...base.metadata,
      reservation_id: row.id,
      request_id: row.request_id,
      config_revision: String(row.config_revision),
      price_key: row.price_key,
      pack_quantity: String(row.pack_quantity),
    },
    line_items: {
      has_more: false,
      data: [{
        quantity: row.pack_quantity,
        currency: row.currency.toLowerCase(),
        amount_subtotal: lineTotal,
        amount_discount: 0,
        amount_tax: 0,
        amount_total: lineTotal,
        price: {
          id: row.stripe_price_id,
          product: row.stripe_product_id,
          unit_amount: row.unit_amount_cents,
          currency: row.currency.toLowerCase(),
          type: row.credits_per_pack === null ? "recurring" : "one_time",
        },
      }],
    },
  });
}

function makeStore(options: {
  row?: Record<string, unknown>;
  unresolvedRow?: Record<string, unknown>;
  reservationOutcome?: string;
  reservationRequestId?: string;
  customerOutcome?: string;
  attempt?: Record<string, unknown>;
} = {}) {
  const row = checkoutRow(options.row);
  const attempt = {
    id: customerAttemptId,
    feature_key: "form_coach",
    payer_id: payerId,
    request_id: "f5000000-0000-4000-8000-000000000005",
    request_digest: "a".repeat(64),
    idempotency_key: `form-coach-customer:f5000000-0000-4000-8000-000000000005`,
    state: "reserved",
    stripe_customer_id: null,
    state_revision: 0,
    created_at: new Date(now.getTime() - 1_000).toISOString(),
    ...options.attempt,
  };
  const operations: string[] = [];
  const store: FormCoachCheckoutStore = {
    readUnresolvedCheckout: vi.fn(async () => options.unresolvedRow ? checkoutRow(options.unresolvedRow) as never : null),
    reserveCheckout: vi.fn(async () => {
      operations.push("reserve-checkout");
      return { outcome: options.reservationOutcome ?? "reserved", reservationId, requestId: options.reservationRequestId ?? requestId, expiresAt: row.expires_at as string };
    }),
    readCheckoutReservation: vi.fn(async () => row as never),
    markCheckoutUnknown: vi.fn(async () => true),
    bindCheckout: vi.fn(async () => {
      operations.push("bind-checkout");
      return "bound";
    }),
    reconcileExpiredCheckout: vi.fn(async () => "expired"),
    reserveCustomer: vi.fn(async () => {
      operations.push("reserve-customer");
      return {
        outcome: options.customerOutcome ?? "reserved",
        attemptId: customerAttemptId,
        customerId: null,
        stateRevision: 0,
      };
    }),
    readCustomerAttempt: vi.fn(async () => attempt as never),
    advanceCustomer: vi.fn(async (input) => {
      operations.push(`customer-${input.nextState}`);
      return input.nextState;
    }),
    readVerifiedCustomer: vi.fn(async () => ({ customerId, attemptId: customerAttemptId })),
  };
  return { store, row, attempt, operations };
}

function makeStripe(options: {
  currentCustomer?: Stripe.Customer | Stripe.DeletedCustomer;
  searchedCustomers?: Stripe.Customer[];
  currentSession?: Stripe.Checkout.Session;
  listedSessions?: Stripe.Checkout.Session[];
} = {}) {
  const operations: string[] = [];
  const currentCustomer = options.currentCustomer ?? customer();
  const currentSession = options.currentSession ?? session();
  const stripe = {
    customers: {
      search: vi.fn(async () => ({ data: options.searchedCustomers ?? [], has_more: false, next_page: null })),
      create: vi.fn(async () => {
        operations.push("create-customer");
        return customer();
      }),
      retrieve: vi.fn(async () => currentCustomer),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => {
          operations.push("create-checkout");
          return currentSession;
        }),
        retrieve: vi.fn(async () => currentSession),
        list: vi.fn(async (params) => ({
          data: (options.listedSessions ?? []).filter((listed) => listed.status === params.status),
          has_more: false,
          next_page: null,
        })),
      },
    },
  } as unknown as Stripe;
  return { stripe, operations };
}

function dependencies(
  store: FormCoachCheckoutStore,
  stripe: Stripe,
  overrides: Record<string, unknown> = {},
) {
  return {
    enabled: true,
    pricing: async () => pricing(),
    pricingRevision: async (revision: number) => pricing({ revision }),
    store,
    stripe,
    now: () => now,
    siteUrl: "https://gymx2.com",
    ...overrides,
  };
}

describe("Form Coach checkout server contract", () => {
  beforeEach(() => {
    delete process.env.FORM_COACH_CHECKOUT_ENABLED;
  });

  it("keeps outbound checkout off by default and performs no reservation or provider work", async () => {
    const { store } = makeStore();
    const { stripe } = makeStripe();
    expect(isFormCoachCheckoutEnabled()).toBe(false);
    await expect(createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach", priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe, { enabled: false }))).resolves.toEqual({ kind: "status", status: "coming_soon" });
    expect(store.reserveCheckout).not.toHaveBeenCalled();
    expect((stripe as Stripe).customers.create).not.toHaveBeenCalled();
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("reserves immutable pricing before customer and checkout creates, then binds and retrieves the exact session", async () => {
    const { store, operations: storeOps } = makeStore();
    const { stripe, operations: stripeOps } = makeStripe();
    const result = await createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach", priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe));
    expect(result).toEqual({ kind: "redirect", url: "https://checkout.stripe.com/c/pay/synthetic" });
    expect(storeOps.indexOf("reserve-checkout")).toBeLessThan(storeOps.indexOf("reserve-customer"));
    expect(stripeOps).toEqual(["create-customer", "create-checkout"]);
    expect(store.bindCheckout).toHaveBeenCalledWith(expect.objectContaining({ reservationId, sessionId, customerId }));
    expect((stripe as Stripe).checkout.sessions.retrieve).toHaveBeenCalledWith(sessionId, { expand: ["line_items.data.price.product"] });
    const createCall = (stripe as Stripe).checkout.sessions.create as unknown as ReturnType<typeof vi.fn>;
    const [params, requestOptions] = createCall.mock.calls[0] as [Stripe.Checkout.SessionCreateParams, Stripe.RequestOptions];
    expect(params.mode).toBe("subscription");
    expect(params.customer).toBe(customerId);
    expect(params.line_items).toEqual([{ price: priceId, quantity: 1 }]);
    expect(params.metadata?.feature_namespace).toBe("form_coach");
    expect(params.metadata?.payer_id).toBe(payerId);
    expect(params.metadata?.reservation_id).toBe(reservationId);
    expect(params.success_url).toBe(`https://gymx2.com/billing/form-coach?checkout=returned&request_id=${requestId}`);
    expect(params.success_url).not.toContain("session_id");
    expect(params).not.toHaveProperty("transfer_data");
    expect(params).not.toHaveProperty("on_behalf_of");
    expect(params).not.toHaveProperty("expires_at");
    expect(requestOptions.idempotencyKey).toBe(`form-coach:${requestId}`);
    const customerCreate = (stripe as Stripe).customers.create as unknown as ReturnType<typeof vi.fn>;
    expect(customerCreate.mock.calls[0]?.[0]).toEqual({
      metadata: {
        feature_namespace: "form_coach",
        feature_key: "form_coach",
        payer_id: payerId,
        customer_create_attempt_id: customerAttemptId,
      },
    });
  });

  it("uses only the frozen subscription trial snapshot and requires a zero-total trial session", async () => {
    const trialRow = checkoutRow({ trial_days: 14 });
    const zeroTrialSession = session({
      amount_subtotal: 0,
      amount_total: 0,
      total_details: { amount_discount: 0, amount_shipping: null, amount_tax: 0 },
      line_items: { has_more: false, data: [{ quantity: 1, currency: "usd", amount_subtotal: 0,
        amount_discount: 0, amount_tax: 0, amount_total: 0,
        price: { id: priceId, product: productId, unit_amount: 1200, currency: "usd", type: "recurring" } }] },
    });
    const { store } = makeStore({ row: trialRow });
    const { stripe } = makeStripe({ currentSession: zeroTrialSession });
    const result = await createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach", priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe, { pricing: async () => pricing({ trialDays: 14 }) }));

    expect(result).toEqual({ kind: "redirect", url: "https://checkout.stripe.com/c/pay/synthetic" });
    const createCall = (stripe as Stripe).checkout.sessions.create as unknown as ReturnType<typeof vi.fn>;
    const [params] = createCall.mock.calls[0] as [Stripe.Checkout.SessionCreateParams];
    expect(params.subscription_data?.trial_period_days).toBe(14);
    expect(params.line_items).toEqual([{ price: priceId, quantity: 1 }]);
  });

  it("refuses a stale trial-day quote before creating provider resources", async () => {
    const { store } = makeStore({ row: { trial_days: 0 } });
    const { stripe } = makeStripe();
    await expect(createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach", priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe, { pricing: async () => pricing({ trialDays: 14 }) })))
      .resolves.toEqual({ kind: "status", status: "unavailable" });
    expect(store.reserveCustomer).not.toHaveBeenCalled();
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("fails closed for stale pricing, wrong payer role, and a deletion tombstone", async () => {
    const { store } = makeStore({ reservationOutcome: "account_deleting" });
    const { stripe } = makeStripe();
    const input = { payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach", priceKey: "monthly", quantity: 1, requestId };
    await expect(createFormCoachCheckout(input, dependencies(store, stripe, { pricing: async () => pricing({ status: "pricing_pending", billingModel: null, offers: [] }) })))
      .resolves.toEqual({ kind: "status", status: "unavailable" });
    await expect(createFormCoachCheckout({ ...input, payerRole: "member" }, dependencies(store, stripe)))
      .resolves.toEqual({ kind: "status", status: "unavailable" });
    await expect(createFormCoachCheckout(input, dependencies(store, stripe)))
      .resolves.toEqual({ kind: "status", status: "account_deleting" });
    expect((stripe as Stripe).customers.create).not.toHaveBeenCalled();
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("does not trust a reservation whose frozen quote or provider price differs from the current revision", async () => {
    const { store } = makeStore({ row: { stripe_price_id: "price_other" } });
    const { stripe } = makeStripe();
    await expect(createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach", priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe))).resolves.toEqual({ kind: "status", status: "unavailable" });
    expect(store.reserveCustomer).not.toHaveBeenCalled();
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("reconciles an owned open historical session before validating the payer's new selection", async () => {
    const oldRow = historicCheckoutRow();
    const { store } = makeStore({ row: oldRow, unresolvedRow: oldRow });
    const { stripe } = makeStripe({ currentSession: sessionForReservation(oldRow, "open") });
    const currentPricing = vi.fn(async () => pricing({
      revision: 8,
      payer: "member",
      offers: [{
        priceKey: "monthly", amountCents: 1800, currency: "USD", interval: "month", creditsPerPack: null,
        stripeProductId: "prod_current", stripePriceId: "price_current",
      }],
    }));
    const result = await createFormCoachCheckout({
      payerId, payerRole: "member", email: "member@example.test", displayName: "Member",
      priceKey: "monthly", quantity: 1, requestId: "f7000000-0000-4000-8000-000000000007",
    }, dependencies(store, stripe, { pricing: currentPricing }));

    expect(result).toEqual({ kind: "status", status: "pending" });
    expect(currentPricing).not.toHaveBeenCalled();
    expect(store.reserveCheckout).not.toHaveBeenCalled();
    expect((stripe as Stripe).checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test_historic", { expand: ["line_items.data.price.product"] });
  });

  it("records the exact historical quote when an older session is currently expired", async () => {
    const oldRow = historicCheckoutRow();
    const { store } = makeStore({ row: oldRow, unresolvedRow: oldRow });
    const { stripe } = makeStripe({ currentSession: sessionForReservation(oldRow, "expired") });
    const currentPricing = vi.fn(async () => pricing({ revision: 8, status: "pricing_pending", billingModel: null, offers: [] }));
    const result = await createFormCoachCheckout({
      payerId, payerRole: "member", email: "member@example.test", displayName: "Member",
      priceKey: "monthly", quantity: 1, requestId: "f7000000-0000-4000-8000-000000000007",
    }, dependencies(store, stripe, { pricing: currentPricing }));

    expect(result).toEqual({ kind: "status", status: "expired" });
    expect(currentPricing).not.toHaveBeenCalled();
    expect(store.reconcileExpiredCheckout).toHaveBeenCalledWith(expect.objectContaining({
      requestId: oldRow.request_id,
      reservationId,
      sessionId: "cs_test_historic",
      mode: "payment",
      priceId: "price_historic",
      quantity: 2,
    }));
    expect(store.reserveCheckout).not.toHaveBeenCalled();
  });

  it("does not resume an older unknown checkout under a changed selection", async () => {
    const oldRow = historicCheckoutRow({
      state: "unknown",
      stripe_checkout_session_id: null,
      stripe_customer_id: customerId,
      created_at: new Date(now.getTime() - 60_000).toISOString(),
      expires_at: new Date(now.getTime() + 20 * 60_000).toISOString(),
    });
    const { store } = makeStore({ row: oldRow, unresolvedRow: oldRow });
    const { stripe } = makeStripe({
      currentSession: sessionForReservation({ ...oldRow, stripe_checkout_session_id: sessionId } as unknown as typeof oldRow, "open"),
    });
    const currentPricing = vi.fn(async () => pricing({
      revision: 8,
      offers: [{
        priceKey: "monthly", amountCents: 1800, currency: "USD", interval: "month", creditsPerPack: null,
        stripeProductId: "prod_current", stripePriceId: "price_current",
      }],
    }));
    const result = await createFormCoachCheckout({
      payerId, payerRole: "member", email: "member@example.test", displayName: "Member",
      priceKey: "monthly", quantity: 1, requestId: "f7000000-0000-4000-8000-000000000007",
    }, dependencies(store, stripe, { pricing: currentPricing }));

    expect(result).toEqual({ kind: "status", status: "pending" });
    expect(currentPricing).not.toHaveBeenCalled();
    expect(store.reserveCheckout).not.toHaveBeenCalled();
    expect((stripe as Stripe).checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("recovers an exact expired Session through the verified customer mapping after a lost reservation binding", async () => {
    const oldRow = historicCheckoutRow({
      state: "unknown",
      stripe_checkout_session_id: null,
      stripe_customer_id: null,
    });
    const listedRow = {
      ...oldRow,
      stripe_checkout_session_id: sessionId,
      stripe_customer_id: customerId,
    } as unknown as typeof oldRow;
    const expired = sessionForReservation(listedRow, "expired");
    const { store } = makeStore({ row: oldRow, unresolvedRow: oldRow });
    const { stripe } = makeStripe({ currentSession: expired, listedSessions: [expired] });
    const currentPricing = vi.fn(async () => pricing({
      status: "pricing_pending",
      billingModel: null,
      offers: [],
    }));

    await expect(createFormCoachCheckout({
      payerId, payerRole: "member", email: "member@example.test", displayName: "Member",
      priceKey: "monthly", quantity: 1, requestId: "f7000000-0000-4000-8000-000000000007",
    }, dependencies(store, stripe, { pricing: currentPricing }))).resolves.toEqual({ kind: "status", status: "expired" });

    expect(store.readVerifiedCustomer).toHaveBeenCalledWith(payerId);
    expect((stripe as Stripe).customers.retrieve).toHaveBeenCalledWith(customerId);
    expect((stripe as Stripe).customers.create).not.toHaveBeenCalled();
    expect(store.bindCheckout).toHaveBeenCalledWith(expect.objectContaining({
      reservationId, sessionId, customerId,
    }));
    expect(store.reconcileExpiredCheckout).toHaveBeenCalledWith(expect.objectContaining({
      requestId: oldRow.request_id, reservationId, sessionId, customerId,
    }));
    expect(currentPricing).not.toHaveBeenCalled();
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it.each(["disabled", "pricing_pending"] as const)(
    "does not create a checkout for a sessionless reservation while current pricing is %s",
    async (status) => {
      const oldRow = checkoutRow({
        state: "unknown",
        stripe_customer_id: customerId,
        stripe_checkout_session_id: null,
      });
      const { store } = makeStore({ row: oldRow, unresolvedRow: oldRow });
      const { stripe } = makeStripe();
      const currentPricing = vi.fn(async () => pricing({
        status,
        billingModel: null,
        offers: [],
      }));

      await expect(createFormCoachCheckout({
        payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach",
        priceKey: "monthly", quantity: 1, requestId,
      }, dependencies(store, stripe, { pricing: currentPricing }))).resolves.toEqual({ kind: "status", status: "pending" });

      expect(currentPricing).toHaveBeenCalledTimes(1);
      expect((stripe as Stripe).customers.create).not.toHaveBeenCalled();
      expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
    },
  );

  it("replays a yearly frozen quote using its immutable revision when the current offer interval differs", async () => {
    const annualRow = historicCheckoutRow({
      state: "unknown",
      stripe_checkout_session_id: null,
      stripe_customer_id: customerId,
      price_key: "annual",
      stripe_product_id: "prod_annual",
      stripe_price_id: "price_annual",
      unit_amount_cents: 20_000,
      pack_quantity: 1,
      credits_per_pack: null,
      quoted_credits: 0,
      total_amount_cents: 20_000,
    });
    const originalRevision = pricing({
      revision: 6,
      status: "live",
      payer: "coach",
      billingModel: "subscription",
      offers: [{
        priceKey: "annual",
        amountCents: 20_000,
        currency: "USD",
        interval: "year",
        creditsPerPack: null,
        stripeProductId: "prod_annual",
        stripePriceId: "price_annual",
      }],
    });
    const currentRevision = pricing({
      revision: 8,
      status: "live",
      payer: "coach",
      billingModel: "subscription",
      offers: [{
        priceKey: "annual",
        amountCents: 20_000,
        currency: "USD",
        interval: "month",
        creditsPerPack: null,
        stripeProductId: "prod_annual",
        stripePriceId: "price_annual",
      }],
    });
    const createdAnnualSession = sessionForReservation({
      ...annualRow,
      stripe_checkout_session_id: sessionId,
    } as unknown as typeof annualRow, "open");
    const { store } = makeStore({ row: annualRow, unresolvedRow: annualRow });
    const { stripe } = makeStripe({ currentSession: createdAnnualSession });
    const historicalReader = vi.fn(async (revision: number) => revision === 6 ? originalRevision : null);

    await expect(createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach",
      priceKey: "annual", quantity: 1, requestId: "f7000000-0000-4000-8000-000000000007",
    }, dependencies(store, stripe, {
      pricing: async () => currentRevision,
      pricingRevision: historicalReader,
    }))).resolves.toEqual({ kind: "redirect", url: "https://checkout.stripe.com/c/pay/synthetic" });

    expect(historicalReader).toHaveBeenCalledWith(6);
    const create = (stripe as Stripe).checkout.sessions.create as unknown as ReturnType<typeof vi.fn>;
    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0] as [Stripe.Checkout.SessionCreateParams, Stripe.RequestOptions];
    expect(params.line_items).toEqual([{ price: "price_annual", quantity: 1 }]);
    expect(params.metadata?.config_revision).toBe("6");
    expect(options.idempotencyKey).toBe("form-coach:" + annualRow.request_id);
    expect((stripe as Stripe).customers.create).not.toHaveBeenCalled();
  });

  it("does not replay a sessionless reservation when its immutable pricing revision cannot be verified", async () => {
    const oldRow = checkoutRow({
      config_revision: 6,
      state: "unknown",
      stripe_customer_id: customerId,
      stripe_checkout_session_id: null,
    });
    const { store } = makeStore({ row: oldRow, unresolvedRow: oldRow });
    const { stripe } = makeStripe();

    await expect(createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach",
      priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe, {
      pricing: async () => pricing({ revision: 8 }),
      pricingRevision: async () => pricing({ revision: 8 }),
    }))).resolves.toEqual({ kind: "status", status: "pending" });

    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
    expect((stripe as Stripe).customers.create).not.toHaveBeenCalled();
  });

  it("keeps a changed selection pending after the reserve RPC finds a different frozen quote", async () => {
    const oldRow = historicCheckoutRow();
    const { store } = makeStore({
      row: oldRow,
      reservationOutcome: "pending_reconciliation",
      reservationRequestId: oldRow.request_id as string,
    });
    const { stripe } = makeStripe({ currentSession: sessionForReservation(oldRow, "open") });
    const currentPricing = vi.fn(async () => pricing({
      revision: 8,
      offers: [{
        priceKey: "monthly", amountCents: 1800, currency: "USD", interval: "month", creditsPerPack: null,
        stripeProductId: "prod_current", stripePriceId: "price_current",
      }],
    }));

    await expect(createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach",
      priceKey: "monthly", quantity: 1, requestId: "f7000000-0000-4000-8000-000000000007",
    }, dependencies(store, stripe, { pricing: currentPricing }))).resolves.toEqual({ kind: "status", status: "pending" });
    expect(currentPricing).toHaveBeenCalledTimes(1);
    expect(store.reserveCheckout).toHaveBeenCalledWith({
      payerId, revision: 8, priceKey: "monthly", quantity: 1, requestId: "f7000000-0000-4000-8000-000000000007",
    });
    expect((stripe as Stripe).checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test_historic", { expand: ["line_items.data.price.product"] });
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("reconciles an exact open session for an older unknown request before creating anything else", async () => {
    const oldUnknown = checkoutRow({
      state: "unknown",
      stripe_customer_id: customerId,
      created_at: new Date(now.getTime() - 23.5 * 60 * 60_000).toISOString(),
      expires_at: new Date(now.getTime() - 23 * 60 * 60_000).toISOString(),
    });
    const { store } = makeStore({ row: oldUnknown, reservationOutcome: "pending_reconciliation" });
    const { stripe } = makeStripe({ listedSessions: [session()] });
    await expect(createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach", priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe))).resolves.toEqual({ kind: "redirect", url: "https://checkout.stripe.com/c/pay/synthetic" });
    expect(store.bindCheckout).toHaveBeenCalledWith(expect.objectContaining({ reservationId, sessionId, customerId }));
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("does not create checkout if Stripe's current Customer metadata cannot verify its owner", async () => {
    const { store } = makeStore();
    const { stripe } = makeStripe({ currentCustomer: customer({
      feature_namespace: "form_coach",
      feature_key: "form_coach",
      payer_id: "f9000000-0000-4000-8000-000000000009",
      customer_create_attempt_id: customerAttemptId,
    }) });
    await expect(createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach", priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe))).resolves.toEqual({ kind: "status", status: "pending" });
    expect(store.markCheckoutUnknown).toHaveBeenCalledWith(reservationId);
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("does not redirect when Stripe's retrieved session is bound to another customer or Price", async () => {
    const mismatches = [
      session({ customer: "cus_other" }),
      session({ line_items: { data: [{ quantity: 1, price: { id: "price_other" } }] } }),
    ];
    for (const currentSession of mismatches) {
      const { store } = makeStore();
      const { stripe } = makeStripe({ currentSession });
      await expect(createFormCoachCheckout({
        payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach", priceKey: "monthly", quantity: 1, requestId,
      }, dependencies(store, stripe))).resolves.toEqual({ kind: "status", status: "pending" });
    }
  });

  it("records only an exact current expired and unpaid Session as a terminal reservation", async () => {
    const { store } = makeStore({ row: {
      state: "bound",
      stripe_checkout_session_id: sessionId,
      stripe_customer_id: customerId,
    } });
    const { stripe } = makeStripe({ currentSession: session({ status: "expired", payment_status: "unpaid" }) });
    const result = await createFormCoachCheckout({
      payerId, payerRole: "coach", email: "changed@example.test", displayName: "Changed Name",
      priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe));
    expect(result).toEqual({ kind: "status", status: "expired" });
    expect(store.reconcileExpiredCheckout).toHaveBeenCalledWith(expect.objectContaining({
      requestId,
      reservationId,
      sessionId,
      customerId,
      sessionStatus: "expired",
      paymentStatus: "unpaid",
      mode: "subscription",
      priceId,
      quantity: 1,
      evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", "paid"],
    ["expired", "no_payment_required"],
  ])("does not release a current Session in %s/%s state", async (status, paymentStatus) => {
    const { store } = makeStore({ row: {
      state: "bound",
      stripe_checkout_session_id: sessionId,
      stripe_customer_id: customerId,
    } });
    const { stripe } = makeStripe({ currentSession: session({ status, payment_status: paymentStatus }) });
    const result = await createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach",
      priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe));
    expect(result).toEqual({ kind: "status", status: "pending" });
    expect(store.reconcileExpiredCheckout).not.toHaveBeenCalled();
  });

  it("does not release an expired Session when exact current quote totals or tax state differ", async () => {
    const mismatches = [
      session({ status: "expired", payment_status: "unpaid", amount_total: 1100 }),
      session({ status: "expired", payment_status: "unpaid", currency: "eur" }),
      session({ status: "expired", payment_status: "unpaid", automatic_tax: { enabled: true } }),
      session({ status: "expired", payment_status: "unpaid", discounts: [{ coupon: "coupon_synthetic" }] }),
      session({ status: "expired", payment_status: "unpaid", line_items: { data: [{
        quantity: 1, currency: "usd", amount_subtotal: 1200, amount_discount: 0, amount_tax: 0,
        amount_total: 1200, price: { id: priceId, product: "prod_other", unit_amount: 1200, currency: "usd", type: "recurring" },
      }] } }),
    ];
    for (const currentSession of mismatches) {
      const { store } = makeStore({ row: {
        state: "bound",
        stripe_checkout_session_id: sessionId,
        stripe_customer_id: customerId,
      } });
      const { stripe } = makeStripe({ currentSession });
      const result = await createFormCoachCheckout({
        payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach",
        priceKey: "monthly", quantity: 1, requestId,
      }, dependencies(store, stripe));
      expect(result).toEqual({ kind: "status", status: "pending" });
      expect(store.reconcileExpiredCheckout).not.toHaveBeenCalled();
    }
  });

  it("keeps Customer create payload stable when profile name and email change", async () => {
    const { store } = makeStore();
    const { stripe } = makeStripe();
    const first = await createFormCoachCheckout({
      payerId, payerRole: "coach", email: "first@example.test", displayName: "First Name",
      priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe));
    const second = await createFormCoachCheckout({
      payerId, payerRole: "coach", email: "updated@example.test", displayName: "Updated Name",
      priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe));
    expect(first.kind).toBe("redirect");
    expect(second.kind).toBe("redirect");
    const customerCreate = (stripe as Stripe).customers.create as unknown as ReturnType<typeof vi.fn>;
    expect(customerCreate).toHaveBeenCalledTimes(2);
    expect(customerCreate.mock.calls[0]?.[0]).toEqual(customerCreate.mock.calls[1]?.[0]);
    expect(customerCreate.mock.calls[0]?.[1]).toEqual(customerCreate.mock.calls[1]?.[1]);
    expect(customerCreate.mock.calls[0]?.[0]).not.toHaveProperty("email");
    expect(customerCreate.mock.calls[0]?.[0]).not.toHaveProperty("name");
  });

  it("refuses to retry an unresolved Checkout create beyond 23 hours without exact session reconciliation", async () => {
    const oldRow = checkoutRow({
      state: "unknown",
      stripe_customer_id: customerId,
      created_at: new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
      expires_at: new Date(now.getTime() - 23 * 60 * 60_000).toISOString(),
    });
    const { store } = makeStore({ row: oldRow });
    const { stripe } = makeStripe();
    await expect(createFormCoachCheckout({
      payerId, payerRole: "coach", email: "coach@example.test", displayName: "Coach", priceKey: "monthly", quantity: 1, requestId,
    }, dependencies(store, stripe))).resolves.toEqual({ kind: "status", status: "pending" });
    expect((stripe as Stripe).checkout.sessions.list).toHaveBeenCalledTimes(3);
    expect((stripe as Stripe).checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("validates return destinations and Stripe checkout redirect origins", () => {
    expect(formCoachReturnUrl("https://gymx2.com/some-path", "?checkout=ok"))
      .toBe("https://gymx2.com/billing/form-coach?checkout=ok");
    expect(formCoachReturnUrl("https://gymx2.com.attacker.test")).toBeNull();
    expect(formCoachReturnUrl("https://user:pass@gymx2.com")).toBeNull();
    expect(isStripeCheckoutUrl("https://checkout.stripe.com/c/pay/example")).toBe(true);
    expect(isStripeCheckoutUrl("https://checkout.stripe.com.attacker.test/example")).toBe(false);
    expect(isStripeCheckoutUrl("http://checkout.stripe.com/example")).toBe(false);
  });

  it("resolves a valid opaque return only through the payer-owned reservation and grants nothing", async () => {
    const row = checkoutRow({
      state: "bound",
      stripe_checkout_session_id: sessionId,
      stripe_customer_id: customerId,
    });
    const { store } = makeStore({ row });
    const { stripe } = makeStripe();
    const lookupReservation = vi.fn(async () => row);
    const stripeConfigured = vi.fn(() => true);
    const result = await reconcileFormCoachCheckoutReturn(payerId, requestId, {
      lookupReservation,
      store,
      stripeConfigured,
      stripe,
    });

    expect(result).toBe("processing");
    expect(lookupReservation).toHaveBeenCalledWith(payerId, requestId);
    expect((stripe as Stripe).checkout.sessions.retrieve).toHaveBeenCalledWith(sessionId, { expand: ["line_items.data.price.product"] });
    expect(store.reconcileExpiredCheckout).not.toHaveBeenCalled();
    expect(store.reserveCheckout).not.toHaveBeenCalled();
    expect(store.bindCheckout).not.toHaveBeenCalled();
  });

  it("does not make provider requests for a cross-owner opaque return", async () => {
    const foreignPayerId = "f8000000-0000-4000-8000-000000000008";
    const row = checkoutRow({
      payer_id: foreignPayerId,
      state: "bound",
      stripe_checkout_session_id: sessionId,
      stripe_customer_id: customerId,
    });
    const { store } = makeStore({ row });
    const { stripe } = makeStripe();
    const lookupReservation = vi.fn(async () => row);
    const stripeConfigured = vi.fn(() => true);

    await expect(reconcileFormCoachCheckoutReturn(payerId, requestId, {
      lookupReservation,
      store,
      stripeConfigured,
      stripe,
    })).resolves.toBe("unavailable");
    expect(stripeConfigured).not.toHaveBeenCalled();
    expect((stripe as Stripe).customers.retrieve).not.toHaveBeenCalled();
    expect((stripe as Stripe).checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("does not query storage or Stripe for an invalid opaque return value", async () => {
    const { store } = makeStore();
    const { stripe } = makeStripe();
    const lookupReservation = vi.fn(async () => null);
    const stripeConfigured = vi.fn(() => true);

    await expect(reconcileFormCoachCheckoutReturn(payerId, sessionId, {
      lookupReservation,
      store,
      stripeConfigured,
      stripe,
    })).resolves.toBe("none");
    expect(lookupReservation).not.toHaveBeenCalled();
    expect(stripeConfigured).not.toHaveBeenCalled();
    expect((stripe as Stripe).customers.retrieve).not.toHaveBeenCalled();
    expect((stripe as Stripe).checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("uses localized plan and pack semantics for offer titles", () => {
    expect(getFormCoachOfferTitle({ interval: "month", creditsPerPack: null }, enPricing.billing.offerTitle))
      .toBe("Monthly plan");
    expect(getFormCoachOfferTitle({ interval: "year", creditsPerPack: null }, enPricing.billing.offerTitle))
      .toBe("Annual plan");
    expect(getFormCoachOfferTitle({ interval: null, creditsPerPack: 5 }, esPricing.billing.offerTitle))
      .toBe("Paquete de 5 evaluaciones");
  });
});
