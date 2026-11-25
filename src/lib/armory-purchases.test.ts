import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  bind: vi.fn(),
  chargesList: vi.fn(),
  intent: vi.fn(),
  purchase: vi.fn(),
  refund: vi.fn(),
  recordResult: vi.fn(),
  retrieveSession: vi.fn(),
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  createToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/affiliate-server", () => ({ recordAffiliateCommissions: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/email-templates", () => ({ guestArmoryOrderEmail: vi.fn() }));
vi.mock("@/lib/guest-armory-token", () => ({
  createGuestArmoryToken: mocks.createToken,
  GUEST_ARMORY_TOKEN_TTL_SECONDS: 604800,
}));
vi.mock("@/lib/armory-checkout-binding", () => ({
  bindArmoryCheckoutSession: mocks.bind,
}));
vi.mock("@/lib/notify", () => ({ notifyNewSale: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle:
              table === "purchases"
                ? mocks.purchase
                : table === "armory_payment_refunds"
                  ? mocks.refund
                  : mocks.intent,
          }),
          maybeSingle:
            table === "purchases"
              ? mocks.purchase
              : table === "armory_payment_refunds"
                ? mocks.refund
                : mocks.intent,
        }),
      }),
    }),
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/supabase/env", () => ({ getSiteUrl: () => "https://gymx2.example.test" }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: { sessions: { retrieve: mocks.retrieveSession } },
    charges: { list: mocks.chargesList },
  }),
}));

import {
  recordArmoryCheckoutPurchase,
  sendGuestArmoryOrderConfirmation,
  verifyGuestArmoryPurchasePayment,
} from "./armory-purchases";

const intentId = "a1111111-1111-4111-8111-111111111111";
const sessionId = "cs_test_armory_paid_before_bind";
const paymentIntentId = "pi_test_armory_paid_before_bind";

const intent = {
  id: intentId,
  item_id: "b2222222-2222-4222-8222-222222222222",
  member_id: "c3333333-3333-4333-8333-333333333333",
  buyer_was_guest: false,
  guest_email: null,
  seller_id: "d4444444-4444-4444-8444-444444444444",
  item_title: "Paid training guide",
  item_kind: "paid" as const,
  item_category: "ebook",
  locale: "en" as const,
  price_cents: 1800,
  shipping_cents: 0,
  stripe_session_id: null,
  status: "pending",
};

const paidSession = {
  id: sessionId,
  metadata: { kind: "armory_purchase", armory_checkout_intent_id: intentId },
  mode: "payment",
  payment_status: "paid",
  currency: "usd",
  amount_total: 1800,
  shipping_cost: { amount_total: 0 },
  payment_intent: {
    id: paymentIntentId,
    status: "succeeded",
    currency: "usd",
    amount: 1800,
    metadata: { kind: "armory_purchase", armory_checkout_intent_id: intentId },
  },
  customer_details: null,
  customer_email: null,
  collected_information: null,
};

describe("Armory paid Checkout settlement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.intent.mockResolvedValue({ data: { ...intent }, error: null });
    mocks.purchase.mockResolvedValue({ data: null, error: null });
    mocks.refund.mockResolvedValue({ data: null, error: null });
    mocks.retrieveSession.mockResolvedValue(paidSession);
    mocks.chargesList.mockResolvedValue({
      data: [{ id: "ch_test_partial_refund", refunded: false, amount_refunded: 250 }],
    });
    mocks.bind.mockResolvedValue(true);
    mocks.recordResult.mockResolvedValue({
      data: { purchase_id: "e5555555-5555-4555-8555-555555555555", inserted: false, refunded: true },
      error: null,
    });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "is_printful_apparel_auto_only") {
        return Promise.resolve({ data: false, error: null });
      }
      if (name === "record_printful_apparel_legacy_paid_resolution") {
        return Promise.resolve({ data: "synthetic-resolution", error: null });
      }
      if (name === "claim_armory_guest_confirmation") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "finish_armory_guest_confirmation") {
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "mark_armory_payment_refunded") {
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "record_armory_checkout_purchase") {
        return { maybeSingle: mocks.recordResult };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    vi.stubEnv("GUEST_ARMORY_DOWNLOAD_SECRET", "test-secret-at-least-32-characters-long");
    mocks.createToken.mockReturnValue("test-token");
    mocks.sendEmail.mockResolvedValue(true);
  });

  it("binds an unbound webhook-first paid session, records the order, and preserves partial-refund state", async () => {
    await expect(recordArmoryCheckoutPurchase(paidSession as never)).resolves.toBe(true);

    expect(mocks.bind).toHaveBeenCalledWith(intentId, sessionId);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "mark_armory_payment_refunded",
      "record_armory_checkout_purchase",
    ]);
    expect(mocks.rpc.mock.calls[0]?.[1]).toEqual({
      target_payment_intent_id: paymentIntentId,
      target_charge_id: "ch_test_partial_refund",
    });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.bind.mock.invocationCallOrder[0],
    );
    expect(mocks.rpc.mock.invocationCallOrder[1]).toBeGreaterThan(
      mocks.rpc.mock.invocationCallOrder[0],
    );
    expect(mocks.recordResult).toHaveBeenCalledOnce();
  });

  it("refuses to replace an intent already bound to a different Stripe session", async () => {
    mocks.intent.mockResolvedValueOnce({
      data: { ...intent, stripe_session_id: "cs_test_different_session" },
      error: null,
    });

    await expect(recordArmoryCheckoutPurchase(paidSession as never)).resolves.toBe(false);
    expect(mocks.retrieveSession).not.toHaveBeenCalled();
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("holds a verified late-paid physical Armory session during auto-only cutover", async () => {
    mocks.intent.mockResolvedValueOnce({
      data: { ...intent, item_kind: "product", price_cents: 2400, shipping_cents: 0 },
      error: null,
    });
    mocks.retrieveSession.mockResolvedValueOnce({
      ...paidSession,
      amount_total: 2400,
      payment_intent: {
        ...paidSession.payment_intent,
        amount: 2400,
      },
      collected_information: {
        shipping_details: {
          name: "Synthetic Buyer",
          address: { line1: "1 Test Street", city: "Albany", country: "US" },
        },
      },
    });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "is_printful_apparel_auto_only") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "record_printful_apparel_legacy_paid_resolution") {
        return Promise.resolve({ data: "synthetic-resolution", error: null });
      }
      throw new Error("Unexpected RPC: " + name);
    });

    await expect(recordArmoryCheckoutPurchase(paidSession as never)).resolves.toBe(true);

    expect(mocks.rpc).toHaveBeenCalledWith("record_printful_apparel_legacy_paid_resolution", {
      target_checkout_intent_id: intentId,
      target_session_id: sessionId,
      target_payment_intent_id: paymentIntentId,
      target_amount_cents: 2400,
      target_currency: "usd",
      target_reason_code: "physical_paid_after_auto_only_cutover",
    });
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.recordResult).not.toHaveBeenCalled();
  });

  it("does not turn an already-recorded physical purchase into a cutover resolution", async () => {
    mocks.intent.mockResolvedValueOnce({
      data: { ...intent, item_kind: "product", price_cents: 2400, shipping_cents: 0 },
      error: null,
    });
    mocks.retrieveSession.mockResolvedValueOnce({
      ...paidSession,
      amount_total: 2400,
      payment_intent: { ...paidSession.payment_intent, amount: 2400 },
      collected_information: {
        shipping_details: {
          name: "Synthetic Buyer",
          address: { line1: "1 Test Street", city: "Albany", country: "US" },
        },
      },
    });
    mocks.purchase.mockResolvedValueOnce({ data: { id: "existing-synthetic-purchase" }, error: null });

    await expect(recordArmoryCheckoutPurchase(paidSession as never)).resolves.toBe(true);

    expect(mocks.rpc).not.toHaveBeenCalledWith("record_printful_apparel_legacy_paid_resolution", expect.anything());
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.recordResult).not.toHaveBeenCalled();
  });

  it("returns a retryable failure when a guest receipt email fails, then succeeds on paid-event replay without duplicating the order", async () => {
    const guestIntent = {
      ...intent,
      buyer_was_guest: true,
      member_id: null,
      guest_email: "buyer@example.test",
      file_path: "seller/guide.pdf",
      file_name: "guide.pdf",
      stripe_payment_intent_id: paymentIntentId,
      status: "paid",
    };
    mocks.intent
      .mockResolvedValueOnce({ data: { ...guestIntent, stripe_session_id: null }, error: null })
      .mockResolvedValue({ data: { ...guestIntent, stripe_session_id: sessionId }, error: null });
    mocks.purchase.mockResolvedValue({
      data: {
        id: "e5555555-5555-4555-8555-555555555555",
        item_id: guestIntent.item_id,
        member_id: null,
        stripe_session_id: sessionId,
        checkout_intent_id: intentId,
        amount_cents: 1800,
        currency: "usd",
        refunded_at: null,
        size: null,
        item_title: "Paid training guide",
      },
      error: null,
    });
    mocks.refund.mockResolvedValue({ data: null, error: null });
    mocks.chargesList.mockResolvedValue({ data: [] });
    mocks.retrieveSession.mockResolvedValue({
      ...paidSession,
      customer_email: "buyer@example.test",
    });
    mocks.recordResult
      .mockResolvedValueOnce({
        data: { purchase_id: "e5555555-5555-4555-8555-555555555555", inserted: true, refunded: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { purchase_id: "e5555555-5555-4555-8555-555555555555", inserted: false, refunded: false },
        error: null,
      });
    mocks.sendEmail.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(recordArmoryCheckoutPurchase(paidSession as never)).resolves.toBe(false);
    await expect(recordArmoryCheckoutPurchase(paidSession as never)).resolves.toBe(true);

    expect(mocks.rpc.mock.calls.filter(([name]) => name === "record_armory_checkout_purchase")).toHaveLength(2);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "finish_armory_guest_confirmation").map(([, args]) => args)).toEqual([
      { target_purchase_id: "e5555555-5555-4555-8555-555555555555", sent: false },
      { target_purchase_id: "e5555555-5555-4555-8555-555555555555", sent: true },
    ]);
  });

  it("does not acknowledge a live unsent confirmation lease as delivered", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "claim_armory_guest_confirmation") {
        return Promise.resolve({ data: false, error: null });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    mocks.purchase.mockResolvedValue({
      data: { checkout_intent_id: intentId },
      error: null,
    });
    mocks.intent.mockResolvedValue({
      data: { guest_confirmation_sent_at: null },
      error: null,
    });

    await expect(sendGuestArmoryOrderConfirmation("e5555555-5555-4555-8555-555555555555"))
      .resolves.toBe(false);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("only exposes the exact paid guest purchase binding and rejects a partial refund marker", async () => {
    const purchaseId = "e5555555-5555-4555-8555-555555555555";
    const guestIntent = {
      ...intent,
      buyer_was_guest: true,
      member_id: null,
      guest_email: "buyer@example.test",
      file_path: "seller/guide.pdf",
      file_name: "guide.pdf",
      stripe_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      status: "paid",
    };
    mocks.purchase.mockResolvedValue({
      data: {
        id: purchaseId,
        item_id: guestIntent.item_id,
        member_id: null,
        stripe_session_id: sessionId,
        checkout_intent_id: intentId,
        amount_cents: 1800,
        currency: "usd",
        refunded_at: null,
        size: null,
        item_title: "Paid training guide",
      },
      error: null,
    });
    mocks.intent.mockResolvedValue({ data: guestIntent, error: null });
    mocks.retrieveSession.mockResolvedValue({
      ...paidSession,
      customer_email: "buyer@example.test",
    });
    mocks.chargesList.mockResolvedValue({ data: [] });

    await expect(verifyGuestArmoryPurchasePayment({
      purchaseId,
      sessionId,
      itemId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    })).resolves.toBeNull();
    expect(mocks.retrieveSession).not.toHaveBeenCalled();

    await expect(verifyGuestArmoryPurchasePayment({ purchaseId, sessionId, itemId: guestIntent.item_id }))
      .resolves.toEqual({
        email: "buyer@example.test",
        filePath: "seller/guide.pdf",
        fileName: "guide.pdf",
      });

    mocks.chargesList.mockResolvedValueOnce({
      data: [{ id: "ch_test_partial_refund", refunded: false, amount_refunded: 50 }],
    });
    await expect(verifyGuestArmoryPurchasePayment({ purchaseId, sessionId, itemId: guestIntent.item_id }))
      .resolves.toBeNull();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "mark_armory_payment_refunded")).toHaveLength(1);
  });

  it("verifies a guest order by its exact immutable intent when item deletion nulls the live purchase FK", async () => {
    const purchaseId = "e5555555-5555-4555-8555-555555555555";
    const guestIntent = {
      ...intent,
      buyer_was_guest: true,
      member_id: null,
      guest_email: "buyer@example.test",
      file_path: "seller/deleted-item-version.pdf",
      file_name: "deleted-item-version.pdf",
      stripe_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      status: "paid",
    };
    mocks.purchase.mockResolvedValue({
      data: {
        id: purchaseId,
        item_id: null,
        member_id: null,
        stripe_session_id: sessionId,
        checkout_intent_id: intentId,
        amount_cents: 1800,
        currency: "usd",
        refunded_at: null,
        size: null,
        item_title: "Paid training guide",
      },
      error: null,
    });
    mocks.intent.mockResolvedValue({ data: guestIntent, error: null });
    mocks.retrieveSession.mockResolvedValue({
      ...paidSession,
      customer_email: "buyer@example.test",
    });
    mocks.refund.mockResolvedValue({ data: null, error: null });
    mocks.chargesList.mockResolvedValue({ data: [] });

    await expect(verifyGuestArmoryPurchasePayment({
      purchaseId,
      sessionId,
      itemId: guestIntent.item_id,
    })).resolves.toEqual({
      email: "buyer@example.test",
      filePath: "seller/deleted-item-version.pdf",
      fileName: "deleted-item-version.pdf",
    });
  });

  it("rejects a non-null live catalog FK that disagrees with its linked intent", async () => {
    const guestIntent = {
      ...intent,
      buyer_was_guest: true,
      member_id: null,
      guest_email: "buyer@example.test",
      file_path: "seller/guide.pdf",
      file_name: "guide.pdf",
      stripe_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      status: "paid",
    };
    mocks.purchase.mockResolvedValue({
      data: {
        id: "e5555555-5555-4555-8555-555555555555",
        item_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        member_id: null,
        stripe_session_id: sessionId,
        checkout_intent_id: intentId,
        amount_cents: 1800,
        currency: "usd",
        refunded_at: null,
        size: null,
        item_title: "Paid training guide",
      },
      error: null,
    });
    mocks.intent.mockResolvedValue({ data: guestIntent, error: null });

    await expect(verifyGuestArmoryPurchasePayment({
      purchaseId: "e5555555-5555-4555-8555-555555555555",
      sessionId,
      itemId: guestIntent.item_id,
    })).resolves.toBeNull();
    expect(mocks.retrieveSession).not.toHaveBeenCalled();
  });
});
