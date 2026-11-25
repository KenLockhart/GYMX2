import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { handlePrintfulApparelRiskEvent, handlePrintfulApparelStripeEvent, stripeNetRevenueFromTrustedFacts } from "./apparel-stripe-events";

const ORDER_ID = "123e4567-e89b-42d3-a456-426614174000";
const SESSION_ID = "cs_test_session12345678";
const PI_ID = "pi_synthetic12345678";
const EVENT = {
  id: "evt_synthetic12345678",
  type: "checkout.session.completed",
  livemode: true,
  data: { object: { id: SESSION_ID, metadata: { kind: "printful_apparel_purchase", printful_apparel_order_id: ORDER_ID } } },
};

function stripeFixture(overrides: {
  accountId?: string;
  paymentStatus?: string;
  sessionStatus?: string;
  liveMode?: boolean;
  address?: unknown;
  refunded?: number;
} = {}) {
  const session = {
    id: SESSION_ID,
    mode: "payment",
    status: overrides.sessionStatus ?? "complete",
    payment_status: overrides.paymentStatus ?? "paid",
    livemode: overrides.liveMode ?? true,
    amount_total: 5000,
    currency: "usd",
    payment_intent: PI_ID,
    total_details: { amount_tax: 0 },
    customer_email: "buyer@example.test",
    customer_details: { email: "buyer@example.test" },
    metadata: { kind: "printful_apparel_purchase", printful_apparel_order_id: ORDER_ID },
    collected_information: overrides.address === null ? null : {
      shipping_details: {
        name: "Synthetic Buyer",
        address: overrides.address ?? { line1: "1 Test Way", line2: "", city: "Albany", state: "NY", country: "US", postal_code: "12207" },
      },
    },
  };
  const stripe = {
    accounts: { retrieve: vi.fn(async () => ({ id: overrides.accountId ?? "acct_expected" })) },
    checkout: { sessions: {
      retrieve: vi.fn(async () => session),
      list: vi.fn(async () => ({ data: [session] })),
    } },
    paymentIntents: { retrieve: vi.fn(async () => ({
      id: PI_ID, status: "succeeded", amount_received: 5000, currency: "usd", livemode: true,
      metadata: { kind: "printful_apparel_purchase", printful_apparel_order_id: ORDER_ID }, latest_charge: "ch_synthetic12345678",
    })) },
    charges: { retrieve: vi.fn(async () => ({
      id: "ch_synthetic12345678", paid: true, captured: true, disputed: false,
      payment_intent: PI_ID, amount: 5000, amount_refunded: overrides.refunded ?? 0, currency: "usd", livemode: true,
      balance_transaction: "txn_synthetic12345678",
    })) },
    balanceTransactions: { retrieve: vi.fn(async () => ({ amount: 5000, fee: 175, net: 4825, currency: "usd", source: "ch_synthetic12345678" })) },
    disputes: { retrieve: vi.fn(async () => ({ id: "dp_synthetic12345678", charge: "ch_synthetic12345678", livemode: true })) },
  };
  const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => ({
    data: name === "expire_printful_apparel_checkout" || name === "hold_printful_apparel_refund" ? true : "queued",
    error: null,
  }));
  return { stripe, admin: { rpc }, session };
}

describe("Printful apparel Stripe payment boundary", () => {
  it("requires exact live USD balance facts before treating Stripe net as available", () => {
    const facts = {
      livemode: true,
      amountCents: 5000,
      amountTaxCents: 0,
      currency: "usd",
      expectedPaymentIntentId: PI_ID,
      paymentIntentStatus: "succeeded",
      paymentIntentId: PI_ID,
      paymentIntentAmountReceived: 5000,
      paymentIntentCurrency: "usd",
      paymentIntentLivemode: true,
      chargePaid: true,
      chargeCaptured: true,
      chargeDisputed: false,
      chargePaymentIntentId: PI_ID,
      expectedChargeId: "ch_synthetic12345678",
      chargeId: "ch_synthetic12345678",
      chargeAmount: 5000,
      chargeAmountRefunded: 0,
      chargeCurrency: "usd",
      chargeLivemode: true,
      chargeBalanceAmount: 5000,
      chargeBalanceFee: 175,
      chargeBalanceNet: 4825,
      chargeBalanceCurrency: "usd",
      chargeBalanceSource: "ch_synthetic12345678",
    } as const;
    expect(stripeNetRevenueFromTrustedFacts(facts)).toBe(4825);
    expect(stripeNetRevenueFromTrustedFacts({ ...facts, chargeBalanceNet: 4824 })).toBeNull();
    expect(stripeNetRevenueFromTrustedFacts({ ...facts, chargeAmountRefunded: 1 })).toBeNull();
    expect(stripeNetRevenueFromTrustedFacts({ ...facts, livemode: false })).toBeNull();
    expect(stripeNetRevenueFromTrustedFacts({ ...facts, amountTaxCents: 200 })).toBe(4625);
    expect(stripeNetRevenueFromTrustedFacts({ ...facts, chargePaymentIntentId: "pi_other12345678" })).toBeNull();
    expect(stripeNetRevenueFromTrustedFacts({ ...facts, chargeBalanceSource: "ch_other12345678" })).toBeNull();
    expect(stripeNetRevenueFromTrustedFacts({ ...facts, chargeCaptured: false })).toBeNull();
    expect(stripeNetRevenueFromTrustedFacts({ ...facts, chargeDisputed: true })).toBeNull();
  });

  it("dispatches paid apparel metadata into its private intent path, never generic purchases", async () => {
    const { stripe, admin } = stripeFixture();
    const result = await handlePrintfulApparelStripeEvent(EVENT, {
      stripe: stripe as never,
      admin,
      expectedStripeAccountId: "acct_expected",
    });
    expect(result).toBe("handled");
    expect(admin.rpc.mock.calls.map(([name]) => name)).toEqual([
      "record_printful_apparel_paid",
      "record_printful_apparel_stripe_net",
    ]);
    expect(admin.rpc.mock.calls[0][1]).toMatchObject({
      target_order_id: ORDER_ID,
      target_session_id: SESSION_ID,
      target_payment_intent_id: PI_ID,
      target_paid_cents: 5000,
      target_net_revenue_cents: 4825,
      target_currency: "usd",
      target_livemode: true,
    });
    expect(result).toBe("handled");
  });

  it("fails closed on wrong Stripe account without mutating the order", async () => {
    const { stripe, admin } = stripeFixture({ accountId: "acct_wrong" });
    expect(await handlePrintfulApparelStripeEvent(EVENT, {
      stripe: stripe as never, admin, expectedStripeAccountId: "acct_expected",
    })).toBe("retry");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("does not mark an unpaid completed session paid", async () => {
    const { stripe, admin } = stripeFixture({ paymentStatus: "unpaid" });
    expect(await handlePrintfulApparelStripeEvent(EVENT, {
      stripe: stripe as never, admin, expectedStripeAccountId: "acct_expected",
    })).toBe("handled");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("expires only a provider-confirmed expired session", async () => {
    const { stripe, admin } = stripeFixture({ sessionStatus: "expired", paymentStatus: "unpaid" });
    const result = await handlePrintfulApparelStripeEvent({
      ...EVENT, type: "checkout.session.expired",
    }, { stripe: stripe as never, admin, expectedStripeAccountId: "acct_expected" });
    expect(result).toBe("handled");
    expect(admin.rpc).toHaveBeenCalledWith("expire_printful_apparel_checkout", {
      target_order_id: ORDER_ID,
      target_session_id: SESSION_ID,
    });
  });

  it("keeps payment recorded but waits for balance facts when Stripe net is unavailable", async () => {
    const { stripe, admin } = stripeFixture();
    stripe.balanceTransactions.retrieve.mockRejectedValue(new Error("synthetic unavailable"));
    const result = await handlePrintfulApparelStripeEvent(EVENT, {
      stripe: stripe as never, admin, expectedStripeAccountId: "acct_expected",
    });
    expect(result).toBe("handled");
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc.mock.calls[0][1]).toMatchObject({ target_net_revenue_cents: null });
  });

  it("durably holds an apparel refund before the paid webhook binds its PaymentIntent", async () => {
    const { stripe, admin } = stripeFixture({ refunded: 100 });
    const result = await handlePrintfulApparelRiskEvent({
      id: "evt_refund_before_paid_12345678", type: "charge.refunded", livemode: true,
      data: { object: { id: "ch_synthetic12345678" } },
    }, { stripe: stripe as never, admin, expectedStripeAccountId: "acct_expected" });
    expect(stripe.charges.retrieve).toHaveBeenCalledWith("ch_synthetic12345678");
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(PI_ID);
    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({ payment_intent: PI_ID, limit: 2 });
    expect(admin.rpc).toHaveBeenCalled();
    expect(result).toBe("handled");
    expect(admin.rpc).toHaveBeenCalledWith("hold_printful_apparel_refund", {
      target_order_id: ORDER_ID,
      target_session_id: SESSION_ID,
      target_payment_intent_id: PI_ID,
      target_event_id: "evt_refund_before_paid_12345678",
      target_risk_type: "refund",
    });
  });
});
