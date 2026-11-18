import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { POST } from "@/app/api/stripe/webhook/route";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(() => null as unknown as Stripe.Event),
  recordPurchase: vi.fn(),
  recordMembershipInvoice: vi.fn(),
  syncSubscription: vi.fn(),
  syncSubscriptionById: vi.fn(),
  recordRefundFromCharge: vi.fn(),
  releasePlatformCheckout: vi.fn(),
  syncPlatformSubscriptionById: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ webhooks: { constructEvent: mocks.constructEvent } }),
}));
vi.mock("@/lib/purchases", () => ({ recordPurchase: mocks.recordPurchase }));
vi.mock("@/lib/membership-server", () => ({
  recordMembershipInvoice: mocks.recordMembershipInvoice,
  syncSubscription: mocks.syncSubscription,
  syncSubscriptionById: mocks.syncSubscriptionById,
}));
vi.mock("@/lib/refunds", () => ({
  recordRefundFromCharge: mocks.recordRefundFromCharge,
}));
vi.mock("@/lib/platform-membership-server", () => ({
  releasePlatformCheckout: mocks.releasePlatformCheckout,
  syncPlatformSubscriptionById: mocks.syncPlatformSubscriptionById,
}));

const WEBHOOK_SECRET = "whsec_synthetic_test_only";

type SyntheticEvent = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

function prepareEvent(type: string, object: Record<string, unknown>) {
  const event = {
    id: "evt_synthetic_dispatch",
    type,
    created: 1_800_000_000,
    data: { object },
  } as unknown as Stripe.Event;
  mocks.constructEvent.mockReturnValue(event);
  return event as unknown as SyntheticEvent;
}

function webhookRequest(options: { signature?: string } = {}) {
  const headers = new Headers();
  if (options.signature !== undefined) {
    headers.set("stripe-signature", options.signature);
  }
  return new Request("https://gymx2.example/api/stripe/webhook", {
    method: "POST",
    headers,
    body: "synthetic signed payload",
  });
}

async function postSignedWebhook() {
  return POST(webhookRequest({ signature: "synthetic-signature" }) as never);
}

function expectNoBusinessDispatch() {
  expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
  expect(mocks.releasePlatformCheckout).not.toHaveBeenCalled();
  expect(mocks.syncSubscription).not.toHaveBeenCalled();
  expect(mocks.syncSubscriptionById).not.toHaveBeenCalled();
  expect(mocks.recordMembershipInvoice).not.toHaveBeenCalled();
  expect(mocks.recordPurchase).not.toHaveBeenCalled();
  expect(mocks.recordRefundFromCharge).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  mocks.recordPurchase.mockResolvedValue(true);
  mocks.recordMembershipInvoice.mockResolvedValue(true);
  mocks.syncSubscription.mockResolvedValue(undefined);
  mocks.syncSubscriptionById.mockResolvedValue(undefined);
  mocks.recordRefundFromCharge.mockResolvedValue(undefined);
  mocks.releasePlatformCheckout.mockResolvedValue(undefined);
  mocks.syncPlatformSubscriptionById.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Stripe webhook signature gate", () => {
  it.each([
    { label: "a missing signing secret", secret: "", signature: "synthetic-signature" },
    { label: "a missing signature", secret: WEBHOOK_SECRET, signature: undefined },
  ])("rejects before dispatch when there is $label", async ({ secret, signature }) => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    prepareEvent("customer.subscription.created", { id: "sub_synthetic" });

    const response = await POST(webhookRequest({ signature }) as never);

    expect(response.status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expectNoBusinessDispatch();
  });

  it("rejects an invalid signature before any business handler runs", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("synthetic signature failure");
    });

    const response = await postSignedWebhook();

    expect(response.status).toBe(400);
    expect(mocks.constructEvent).toHaveBeenCalledTimes(1);
    expect(mocks.constructEvent).toHaveBeenCalledWith(
      "synthetic signed payload",
      "synthetic-signature",
      WEBHOOK_SECRET,
    );
    expectNoBusinessDispatch();
  });
});

describe("platform membership dispatch", () => {
  it.each([
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ])("routes %s only to the platform subscription synchronizer", async (type) => {
    const subscription = {
      id: "sub_platform_synthetic",
      metadata: { kind: "platform_membership" },
    };
    const event = prepareEvent(type, subscription);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.constructEvent).toHaveBeenCalledTimes(1);
    expect(mocks.syncPlatformSubscriptionById).toHaveBeenCalledTimes(1);
    expect(mocks.syncPlatformSubscriptionById).toHaveBeenCalledWith(
      subscription.id,
      { id: event.id, created: event.created },
    );
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.syncSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.recordMembershipInvoice).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
  });

  it("routes a completed platform subscription checkout only to platform sync", async () => {
    const memberId = "00000000-0000-4000-8000-000000000001";
    const checkoutRequestId = "00000000-0000-4000-8000-000000000002";
    const session = {
      id: "cs_platform_synthetic",
      mode: "subscription",
      subscription: "sub_platform_synthetic",
      metadata: {
        kind: "platform_membership",
        member_id: memberId,
        checkout_request_id: checkoutRequestId,
      },
      url: "https://gymx2.example/membership/return?success=true",
    };
    const event = prepareEvent("checkout.session.completed", session);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.syncPlatformSubscriptionById).toHaveBeenCalledTimes(1);
    expect(mocks.syncPlatformSubscriptionById).toHaveBeenCalledWith(
      session.subscription,
      { id: event.id, created: event.created },
      { memberId, checkoutRequestId },
    );
    expect(mocks.syncSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
    expect(mocks.recordMembershipInvoice).not.toHaveBeenCalled();
  });

  it("does not route an incomplete platform checkout to the coach subscription helper", async () => {
    const session = {
      id: "cs_platform_missing_ownership_synthetic",
      mode: "subscription",
      subscription: "sub_platform_synthetic",
      metadata: { kind: "platform_membership" },
    };
    prepareEvent("checkout.session.completed", session);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.syncSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.recordMembershipInvoice).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
  });

  it("releases only the platform checkout session that expired", async () => {
    const session = {
      id: "cs_expired_platform_synthetic",
      mode: "subscription",
      metadata: { kind: "platform_membership" },
    };
    prepareEvent("checkout.session.expired", session);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.releasePlatformCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.releasePlatformCheckout).toHaveBeenCalledWith(session.id);
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.syncSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
  });

  it("returns a retryable response if releasing the platform checkout fails", async () => {
    mocks.releasePlatformCheckout.mockRejectedValue(
      new Error("synthetic release failure"),
    );
    const session = {
      id: "cs_expired_platform_synthetic",
      mode: "subscription",
      metadata: { kind: "platform_membership" },
    };
    prepareEvent("checkout.session.expired", session);

    const response = await postSignedWebhook();

    expect(response.status).toBe(500);
    expect(mocks.releasePlatformCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.releasePlatformCheckout).toHaveBeenCalledWith(session.id);
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.syncSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
  });

  it("does not release an expired coach checkout", async () => {
    prepareEvent("checkout.session.expired", {
      id: "cs_expired_coach_synthetic",
      mode: "subscription",
      metadata: { kind: "membership", coach_id: "coach_synthetic" },
    });

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.releasePlatformCheckout).not.toHaveBeenCalled();
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.syncSubscriptionById).not.toHaveBeenCalled();
  });

  it("does not send platform invoices to coach invoice recording even if coach metadata leaks in", async () => {
    const invoice = {
      id: "in_platform_synthetic",
      amount_paid: 2_495,
      currency: "usd",
      parent: {
        type: "subscription_details",
        quote_details: null,
        subscription_details: {
          subscription: "sub_platform_synthetic",
          metadata: {
            kind: "platform_membership",
            member_id: "member_synthetic",
            coach_id: "coach_leaked_synthetic",
            plan_id: "plan_leaked_synthetic",
          },
        },
      },
    };
    prepareEvent("invoice.paid", invoice);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.recordMembershipInvoice).not.toHaveBeenCalled();
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.syncSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
  });

  it("returns a retryable response when platform synchronization fails without coach dispatch", async () => {
    mocks.syncPlatformSubscriptionById.mockRejectedValue(
      new Error("synthetic platform sync failure"),
    );
    prepareEvent("customer.subscription.updated", {
      id: "sub_platform_synthetic",
      metadata: { kind: "platform_membership" },
    });

    const response = await postSignedWebhook();

    expect(response.status).toBe(500);
    expect(mocks.syncPlatformSubscriptionById).toHaveBeenCalledTimes(1);
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.recordMembershipInvoice).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
  });
});

describe("coach membership and armory dispatch", () => {
  it.each([
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ])("keeps coach %s on the existing subscription synchronizer", async (type) => {
    const subscription = {
      id: "sub_coach_synthetic",
      metadata: { kind: "membership", coach_id: "coach_synthetic" },
    };
    prepareEvent(type, subscription);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.syncSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.syncSubscription).toHaveBeenCalledWith(subscription);
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.recordMembershipInvoice).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
  });

  it("keeps coach subscription checkout on the existing coach helper", async () => {
    const session = {
      id: "cs_coach_synthetic",
      mode: "subscription",
      subscription: "sub_coach_synthetic",
      metadata: { kind: "membership", coach_id: "coach_synthetic" },
    };
    prepareEvent("checkout.session.completed", session);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.syncSubscriptionById).toHaveBeenCalledTimes(1);
    expect(mocks.syncSubscriptionById).toHaveBeenCalledWith(session.subscription);
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
  });

  it("keeps coach invoices on the legacy membership invoice recorder", async () => {
    const invoice = {
      id: "in_coach_synthetic",
      amount_paid: 800,
      currency: "usd",
      parent: {
        type: "subscription_details",
        quote_details: null,
        subscription_details: {
          subscription: "sub_coach_synthetic",
          metadata: {
            kind: "membership",
            member_id: "member_synthetic",
            coach_id: "coach_synthetic",
            plan_id: "plan_synthetic",
          },
        },
      },
    };
    prepareEvent("invoice.paid", invoice);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.recordMembershipInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.recordMembershipInvoice).toHaveBeenCalledWith(invoice);
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
  });

  it("preserves legacy handling for invoices without platform metadata", async () => {
    const invoice = {
      id: "in_legacy_synthetic",
      amount_paid: 1_000,
      currency: "usd",
      parent: {
        type: "subscription_details",
        quote_details: null,
        subscription_details: {
          subscription: "sub_legacy_synthetic",
          metadata: { member_id: "member_synthetic", coach_id: "coach_synthetic" },
        },
      },
    };
    prepareEvent("invoice.paid", invoice);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.recordMembershipInvoice).toHaveBeenCalledWith(invoice);
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
  });

  it.each([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
  ])("records a paid armory checkout for %s", async (type) => {
    const session = {
      id: "cs_armory_paid_synthetic",
      mode: "payment",
      payment_status: "paid",
      amount_total: 2_400,
      currency: "usd",
      metadata: {
        item_id: "item_synthetic",
        member_id: "member_synthetic",
        seller_id: "seller_synthetic",
        item_title: "Synthetic armory item",
      },
    };
    prepareEvent(type, session);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.recordPurchase).toHaveBeenCalledTimes(1);
    expect(mocks.recordPurchase).toHaveBeenCalledWith(session);
    expect(mocks.constructEvent).toHaveBeenCalledTimes(1);
    expect(mocks.constructEvent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordPurchase.mock.invocationCallOrder[0],
    );
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.recordMembershipInvoice).not.toHaveBeenCalled();
  });

  it("asks Stripe to retry when saving an already-paid armory checkout fails", async () => {
    mocks.recordPurchase.mockResolvedValue(false);
    const session = {
      id: "cs_armory_failed_save_synthetic",
      mode: "payment",
      payment_status: "paid",
      metadata: { item_id: "item_synthetic", member_id: "member_synthetic" },
    };
    prepareEvent("checkout.session.completed", session);

    const response = await postSignedWebhook();

    expect(response.status).toBe(500);
    expect(mocks.recordPurchase).toHaveBeenCalledWith(session);
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
  });

  it("records dashboard refunds through the existing refund path", async () => {
    const charge = { id: "ch_synthetic", refunded: true };
    prepareEvent("charge.refunded", charge);

    const response = await postSignedWebhook();

    expect(response.status).toBe(200);
    expect(mocks.recordRefundFromCharge).toHaveBeenCalledTimes(1);
    expect(mocks.recordRefundFromCharge).toHaveBeenCalledWith(charge);
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.recordPurchase).not.toHaveBeenCalled();
  });

  it("returns a retryable response when dashboard refund recording fails", async () => {
    mocks.recordRefundFromCharge.mockRejectedValue(
      new Error("synthetic refund failure"),
    );
    const charge = { id: "ch_synthetic", refunded: true };
    prepareEvent("charge.refunded", charge);

    const response = await postSignedWebhook();

    expect(response.status).toBe(500);
    expect(mocks.recordRefundFromCharge).toHaveBeenCalledWith(charge);
    expect(mocks.syncPlatformSubscriptionById).not.toHaveBeenCalled();
    expect(mocks.syncSubscription).not.toHaveBeenCalled();
  });
});
