import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/platform-membership-server", () => ({ platformHasTier: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ getSiteUrl: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));

import { platformHasTier } from "@/lib/platform-membership-server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import {
  createProgramCheckoutServerStore,
  isProgramCheckoutEnabled,
  retryProgramCheckoutForBuyer,
  startProgramCheckout,
} from "./program-checkout-server";
import { retryProgramCheckout, type ProgramCheckoutProvider } from "./program-billing";
import {
  buildProgramCheckoutReturnUrls,
  isStrictStripeCheckoutUrl,
  parseProgramCheckoutRetryCommand,
  parseProgramCheckoutStartCommand,
} from "./program-checkout-contracts";

const buyerId = "f1000000-0000-4000-8000-000000000001";
const orderId = "f2000000-0000-4000-8000-000000000002";
const programId = "f3000000-0000-4000-8000-000000000003";
const attemptId = "f4000000-0000-4000-8000-000000000004";
const secondAttemptId = "f4100000-0000-4000-8000-000000000004";
const retryRequestId = "f4200000-0000-4000-8000-000000000004";
const retryProofDigest = "f".repeat(64);
const priorSessionId = "cs_program_prior";
const priorPaymentIntentId = "pi_program_prior";
const at = "2026-11-20T16:00:00.000Z";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    order_id: orderId,
    buyer_id: buyerId,
    program_id: programId,
    currency: "usd",
    effective_total_cents: 12000,
    installment_amounts_cents: [12000],
    installment_count: 1,
    cleared_installments: 0,
    promotion_reservation_state: "none",
    stripe_customer_id: "cus_program",
    provider_scope: { platform_account_id: "acct_program", livemode: false },
    saved_payment_method_id: null,
    platform_owned: true,
    connected_account_id: null,
    application_fee_basis_points: 0,
    consent: {
      version: 1,
      digest: "a".repeat(64),
      accepted_at: at,
      total_cents: 12000,
      installment_count: 1,
      disclosed_charge_dates: [],
      saved_card_for_off_session: false,
      retry_window_days: null,
      cancellation_stops_future_charges: true,
    },
    first_settled_at: null,
    next_anchor_date: null,
    retry_deadline: null,
    canceled: false,
    deletion_pending: false,
    financial_conflict: false,
    current_attempt_number: 0,
    billing_revision: 4,
    customer_setup: {
      idempotency_key: "program:customer:create:v1",
      create_requested_at: at,
      create_outcome: "not_started",
    },
    attempts: [],
    ...overrides,
  };
}

function preparedAttempt(overrides: Record<string, unknown> = {}) {
  return {
    status: "prepared",
    attempt_number: 1,
    attempt_id: attemptId,
    checkout_session_id: null,
    payment_intent_id: null,
    idempotency_key: "program:order:checkout:1:v1",
    create_outcome: "not_started",
    create_requested_at: at,
    success_url: "https://gymx2.com/programs/program?checkout=success&order_id=order",
    cancel_url: "https://gymx2.com/programs/program?checkout=cancel&order_id=order",
    prior_attempts: [],
    revision: 5,
    retry_request_id: null,
    retry_proof_digest: null,
    ...overrides,
  };
}

function retrySnapshot(overrides: Record<string, unknown> = {}) {
  return snapshot({
    billing_revision: 5,
    current_attempt_number: 2,
    attempts: [
      {
        attempt_number: 1, attempt_id: attemptId, checkout_session_id: priorSessionId,
        payment_intent_id: priorPaymentIntentId, explicit_retry_request_id: null, retry_proof_digest: null,
      },
      {
        attempt_number: 2, attempt_id: secondAttemptId, checkout_session_id: null,
        payment_intent_id: null, explicit_retry_request_id: retryRequestId, retry_proof_digest: retryProofDigest,
      },
    ],
    ...overrides,
  });
}

function advancedAttemptResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "prepared",
    attempt_number: 2,
    attempt_id: secondAttemptId,
    idempotency_key: "program:order:checkout:2:v1",
    create_outcome: "not_started",
    create_requested_at: at,
    success_url: "https://gymx2.com/programs/program?checkout=success&order_id=order",
    cancel_url: "https://gymx2.com/programs/program?checkout=cancel&order_id=order",
    prior_attempts: [{
      attemptNumber: 1, attemptId, checkoutSessionId: priorSessionId, paymentIntentId: priorPaymentIntentId,
    }],
    revision: 5,
    retry_request_id: retryRequestId,
    retry_proof_digest: retryProofDigest,
    ...overrides,
  };
}

function rpcClient(handler: (name: string, args: Record<string, unknown>) => unknown) {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => ({ data: handler(name, args), error: null })),
  };
}

describe("Program Checkout app contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PROGRAM_CHECKOUT_ENABLED;
  });

  it("parses only the explicit order, CAS revision, and retry request", () => {
    expect(parseProgramCheckoutStartCommand({ orderId, expectedRevision: 4 })).toEqual({ orderId, expectedRevision: 4 });
    expect(parseProgramCheckoutStartCommand({ orderId, expectedRevision: 4, buyerId })).toBeNull();
    expect(parseProgramCheckoutStartCommand({ orderId, expectedRevision: 4, stripeCustomerId: "cus_forged" })).toBeNull();
    expect(parseProgramCheckoutRetryCommand({ orderId, expectedRevision: 4, requestId: attemptId })).toEqual({
      orderId, expectedRevision: 4, requestId: attemptId,
    });
    expect(parseProgramCheckoutRetryCommand({ orderId, expectedRevision: 4, requestId: attemptId, amount: 1 })).toBeNull();
  });

  it("builds same-origin order returns and accepts only Stripe Checkout redirects", () => {
    expect(buildProgramCheckoutReturnUrls({ siteUrl: "https://gymx2.com", programId, orderId })).toEqual({
      successUrl: `https://gymx2.com/programs/${programId}?checkout=success&order_id=${orderId}`,
      cancelUrl: `https://gymx2.com/programs/${programId}?checkout=cancel&order_id=${orderId}`,
    });
    expect(() => buildProgramCheckoutReturnUrls({ siteUrl: "https://user@attacker.test", programId, orderId })).toThrow();
    expect(() => buildProgramCheckoutReturnUrls({ siteUrl: "http://localhost:3000", programId, orderId })).toThrow();
    expect(isStrictStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_123" )).toBe(true);
    expect(isStrictStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_123#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2B%2F" )).toBe(true);
    expect(isStrictStripeCheckoutUrl("https://checkout.stripe.com.attacker.test/c/pay" )).toBe(false);
    expect(isStrictStripeCheckoutUrl("https://user@checkout.stripe.com/c/pay" )).toBe(false);
    expect(isStrictStripeCheckoutUrl("http://checkout.stripe.com/c/pay#fidkdWxOYHwnPyd1" )).toBe(false);
    expect(isStrictStripeCheckoutUrl("https://checkout.stripe.com:8443/c/pay#fidkdWxOYHwnPyd1" )).toBe(false);
    expect(isStrictStripeCheckoutUrl("https://checkout.stripe.com:444/c/pay#fidkdWxOYHwnPyd1" )).toBe(false);
  });

  it("keeps the feature disabled by default without creating auth, service, or provider clients", async () => {
    expect(isProgramCheckoutEnabled()).toBe(false);
    await expect(startProgramCheckout({ orderId, expectedRevision: 4 })).resolves.toEqual({ status: "blocked", reason: "feature_disabled" });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("stops before service or Stripe clients when current membership is absent", async () => {
    process.env.PROGRAM_CHECKOUT_ENABLED = "true";
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: buyerId } }, error: null }) },
    } as never);
    vi.mocked(platformHasTier).mockResolvedValue(false);
    await expect(startProgramCheckout({ orderId, expectedRevision: 4 })).resolves.toEqual({
      status: "blocked", reason: "buyer_auth_or_membership_required",
    });
    expect(platformHasTier).toHaveBeenCalledWith(buyerId, "regular");
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("rejects an explicit retry before service or Stripe setup when there is no authenticated buyer", async () => {
    process.env.PROGRAM_CHECKOUT_ENABLED = "true";
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    } as never);
    await expect(retryProgramCheckoutForBuyer({ orderId, expectedRevision: 4, requestId: attemptId })).resolves.toEqual({
      status: "blocked", reason: "buyer_auth_or_membership_required",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("maps the customer prepare RPC and snapshot snake case without accepting another buyer", async () => {
    const service = rpcClient((name) => {
      if (name === "prepare_program_billing_customer") return {
        status: "prepared", customer_id: null, idempotency_key: "program:customer:create:v1",
        revision: 4, create_outcome: "not_started", create_requested_at: at,
        retry_unknown_until: "2026-11-21T15:00:00.000Z",
        provider_scope: { platform_account_id: "acct_program", livemode: false },
      };
      return null;
    });
    const store = createProgramCheckoutServerStore({ serviceClient: service, buyerClient: rpcClient(() => null), buyerId, initialRevision: 4 });
    const result = await store.prepareProgramCustomer({
      orderId, expectedRevision: 4, providerScope: { platformAccountId: "acct_program", livemode: false },
    });
    expect(result).toEqual({
      orderId, expectedRevision: 4, customerId: null, createOutcome: "not_started",
      idempotencyKey: "program:customer:create:v1", retryUnknownUntil: "2026-11-21T15:00:00.000Z",
      providerScope: { platformAccountId: "acct_program", livemode: false },
    });
    expect(service.rpc).toHaveBeenCalledWith("prepare_program_billing_customer", {
      p_order_id: orderId, p_expected_revision: 4,
      p_provider_platform_account_id: "acct_program", p_provider_livemode: false,
    });

    const wrongBuyer = createProgramCheckoutServerStore({
      serviceClient: rpcClient((name) => name === "get_program_checkout_snapshot" ? snapshot({ buyer_id: attemptId }) : null),
      buyerClient: rpcClient(() => null), buyerId, initialRevision: 4,
    });
    await expect(wrongBuyer.loadSnapshot(orderId, 4)).rejects.toThrow("checkout_snapshot_identity_mismatch");
  });

  it("maps Checkout preparation against its returned revision and rejects stale snapshots", async () => {
    const service = rpcClient((name) => {
      if (name === "prepare_program_checkout_attempt") return preparedAttempt();
      if (name === "get_program_checkout_snapshot") return snapshot({
        billing_revision: 5,
        current_attempt_number: 1,
        attempts: [{ attempt_number: 1, attempt_id: attemptId, checkout_session_id: null, payment_intent_id: null,
          explicit_retry_request_id: null, retry_proof_digest: null }],
      });
      return null;
    });
    const store = createProgramCheckoutServerStore({ serviceClient: service, buyerClient: rpcClient(() => null), buyerId, initialRevision: 4 });
    const prepared = await store.prepareCheckoutAttempt({ orderId, expectedRevision: 4, successUrl: "https://gymx2.com/s", cancelUrl: "https://gymx2.com/c" });
    expect("blocked" in prepared).toBe(false);
    if ("blocked" in prepared) return;
    expect(prepared.order.stripeCustomerId).toBe("cus_program");
    expect(prepared.expectedRevision).toBe(5);
    expect(prepared.attempt.attemptNumber).toBe(1);
    expect(service.rpc).toHaveBeenNthCalledWith(1, "prepare_program_checkout_attempt", {
      p_order_id: orderId, p_expected_revision: 4,
      p_success_url: "https://gymx2.com/s", p_cancel_url: "https://gymx2.com/c",
    });
    expect(service.rpc).toHaveBeenNthCalledWith(2, "get_program_checkout_snapshot", {
      p_order_id: orderId, p_expected_buyer_id: buyerId, p_expected_billing_revision: 5,
    });

    const stale = createProgramCheckoutServerStore({
      serviceClient: rpcClient((name) => name === "get_program_checkout_snapshot" ? { status: "stale_revision" } : null),
      buyerClient: rpcClient(() => null), buyerId, initialRevision: 4,
    });
    await expect(stale.loadSnapshot(orderId, 4)).resolves.toEqual({ blocked: "stale_revision" });
  });

  it("hydrates an advanced attempt from persisted IDs and resumes the same retry after an interrupted response", async () => {
    const proof = {
      orderId,
      customerId: "cus_program",
      priorAttemptNumber: 1,
      sessionIds: [priorSessionId],
      paymentIntentIds: [priorPaymentIntentId],
      invoiceIds: [],
      subscriptionIds: [],
      scheduleIds: [],
      pendingInvoiceItemCount: 0,
      attempts: [{
        attemptNumber: 1,
        attemptId,
        sessionId: priorSessionId,
        paymentIntentId: priorPaymentIntentId,
        sessionStatus: "expired" as const,
        sessionPaymentStatus: "unpaid" as const,
        paymentIntentStatus: "canceled" as const,
        amountCents: 12000,
        amountReceivedCents: 0 as const,
        currency: "usd" as const,
        customerId: "cus_program",
        evidenceDigest: "e".repeat(64),
      }],
      digest: retryProofDigest,
      completeInventory: true as const,
    };
    const resumedFromPrepare = {
      status: "prepared",
      attempt_number: 2,
      attempt_id: secondAttemptId,
      checkout_session_id: null,
      payment_intent_id: null,
      idempotency_key: "program:order:checkout:2:v1",
      create_outcome: "not_started",
      create_requested_at: at,
      success_url: "https://gymx2.com/programs/program?checkout=success&order_id=order",
      cancel_url: "https://gymx2.com/programs/program?checkout=cancel&order_id=order",
      prior_attempts: [{
        attemptNumber: 1, attemptId, checkoutSessionId: priorSessionId, paymentIntentId: priorPaymentIntentId,
      }],
      revision: 5,
    };
    const service = rpcClient((name) => {
      if (name === "advance_program_checkout_attempt") return advancedAttemptResponse();
      if (name === "prepare_program_checkout_attempt") return resumedFromPrepare;
      if (name === "get_program_checkout_snapshot") return retrySnapshot();
      return null;
    });
    const store = createProgramCheckoutServerStore({ serviceClient: service, buyerClient: rpcClient(() => null), buyerId, initialRevision: 4 });
    const advanced = await store.advanceCheckoutAttempt({
      orderId, expectedRevision: 4, priorAttemptNumber: 1, explicitRequestId: retryRequestId, proof,
    });
    expect("blocked" in advanced).toBe(false);
    if ("blocked" in advanced) return;
    expect(advanced.attempt).toEqual({
      attemptNumber: 2, attemptId: secondAttemptId, checkoutSessionId: null, paymentIntentId: null,
    });
    expect(advanced.retryRequestId).toBe(retryRequestId);
    expect(advanced.retryProofDigest).toBe(retryProofDigest);
    expect(advanced.expectedRevision).toBe(5);
    expect(service.rpc).toHaveBeenNthCalledWith(1, "advance_program_checkout_attempt", {
      p_order_id: orderId,
      p_expected_revision: 4,
      p_request_id: retryRequestId,
      p_terminal_proof: proof,
      p_proof_digest: retryProofDigest,
    });

    const resumed = await store.prepareCheckoutAttempt({
      orderId, expectedRevision: 5,
      successUrl: "https://gymx2.com/changed-success", cancelUrl: "https://gymx2.com/changed-cancel",
    });
    expect("blocked" in resumed).toBe(false);
    if ("blocked" in resumed) return;
    expect(resumed.attempt).toEqual(advanced.attempt);
    expect(resumed.idempotencyKey).toBe(advanced.idempotencyKey);
    expect(resumed.createRequestedAt).toBe(advanced.createRequestedAt);
    expect(resumed.successUrl).toBe(advanced.successUrl);
    expect(resumed.cancelUrl).toBe(advanced.cancelUrl);
    expect(resumed.retryRequestId).toBe(retryRequestId);
    expect(resumed.retryProofDigest).toBe(retryProofDigest);
    expect(service.rpc).toHaveBeenNthCalledWith(3, "prepare_program_checkout_attempt", {
      p_order_id: orderId,
      p_expected_revision: 5,
      p_success_url: "https://gymx2.com/changed-success",
      p_cancel_url: "https://gymx2.com/changed-cancel",
    });
    expect(service.rpc).toHaveBeenCalledTimes(4);
  });

  it("materializes a retry when the actual advance RPC omits Session and PaymentIntent IDs", async () => {
    const scope = { platformAccountId: "acct_program", livemode: false };
    const initial = snapshot({
      current_attempt_number: 1,
      attempts: [{
        attempt_number: 1, attempt_id: attemptId, checkout_session_id: priorSessionId,
        payment_intent_id: priorPaymentIntentId, explicit_retry_request_id: null, retry_proof_digest: null,
      }],
    });
    const service = rpcClient((name, args) => {
      if (name === "get_program_checkout_snapshot") {
        return args.p_expected_billing_revision === 4 ? initial : retrySnapshot();
      }
      if (name === "advance_program_checkout_attempt") return advancedAttemptResponse();
      if (name === "record_program_checkout_app_audit" || name === "mark_program_checkout_create_unknown" ||
          name === "bind_program_billing_checkout_session") return true;
      return null;
    });
    const buyer = rpcClient((name) => name === "request_program_checkout_retry"
      ? { status: "requested", attempt_number: 1 }
      : null);
    const store = createProgramCheckoutServerStore({ serviceClient: service, buyerClient: buyer, buyerId, initialRevision: 4 });
    const priorSession = {
      id: priorSessionId, url: null, customerId: "cus_program", clientReferenceId: attemptId,
      mode: "payment", status: "expired", paymentStatus: "unpaid", amountTotal: 12000, currency: "usd",
      paymentIntentId: priorPaymentIntentId,
      metadata: {
        program_billing_kind: "program_sale", program_order_id: orderId,
        program_checkout_attempt_id: attemptId, program_checkout_attempt_number: "1", program_installment_number: "1",
        program_platform_account_id: scope.platformAccountId, program_livemode: "false",
      },
      livemode: false, providerScope: scope,
    };
    const priorPaymentIntent = {
      id: priorPaymentIntentId, customerId: "cus_program", amount: 12000, amountReceived: 0, currency: "usd",
      status: "canceled", applicationFeeAmount: null, transferDestinationId: null,
      paymentMethodId: null, latestChargeId: null,
      metadata: {
        program_billing_kind: "program_sale", program_order_id: orderId,
        program_checkout_attempt_id: attemptId, program_checkout_attempt_number: "1", program_installment_number: "1",
        program_platform_account_id: scope.platformAccountId, program_livemode: "false",
      },
      livemode: false, providerScope: scope,
    };
    const customer = {
      id: "cus_program", deleted: false, balance: 0, invoiceCreditBalance: { usd: 0 }, discountId: null, taxExempt: "none",
      metadata: {
        program_order_id: orderId, program_billing_purpose: "program_order",
        program_platform_account_id: scope.platformAccountId, program_livemode: "false",
      },
      livemode: false, providerScope: scope,
    };
    const newSession = {
      id: "cs_program_retry",
      url: "https://checkout.stripe.com/c/pay/cs_program_retry#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2B%2F",
      customerId: "cus_program", clientReferenceId: secondAttemptId,
      mode: "payment", status: "open", paymentStatus: "unpaid", amountTotal: 12000, currency: "usd",
      paymentIntentId: null,
      metadata: {
        program_billing_kind: "program_sale", program_order_id: orderId,
        program_checkout_attempt_id: secondAttemptId, program_checkout_attempt_number: "2", program_installment_number: "1",
        program_platform_account_id: scope.platformAccountId, program_livemode: "false",
      },
      livemode: false, providerScope: scope,
    };
    const provider = {
      getProviderScope: vi.fn(async () => scope),
      retrieveCustomer: vi.fn(async () => customer),
      listInvoices: vi.fn(async () => ({ data: [], hasMore: false })),
      hasPendingInvoiceItems: vi.fn(async () => false),
      listSubscriptions: vi.fn(async () => ({ data: [], hasMore: false })),
      listSubscriptionSchedules: vi.fn(async () => ({ data: [], hasMore: false })),
      listCheckoutSessions: vi.fn(async () => ({ data: [priorSession], hasMore: false })),
      listPaymentIntents: vi.fn(async () => ({ data: [priorPaymentIntent], hasMore: false })),
      retrievePaymentIntent: vi.fn(async () => priorPaymentIntent),
      retrievePaymentMethod: vi.fn(),
      retrieveCheckoutSession: vi.fn(async () => newSession),
      createCustomer: vi.fn(),
      createCheckoutSession: vi.fn(async () => newSession),
    } as unknown as ProgramCheckoutProvider;

    const result = await retryProgramCheckout({
      store, provider, orderId, expectedRevision: 4, explicitRequestId: retryRequestId,
      requestedAt: at, today: "2026-11-20", now: at,
    });
    expect(result).toEqual({ status: "checkout_ready", checkoutUrl: newSession.url, attemptNumber: 2 });
    expect(provider.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: secondAttemptId, attemptNumber: 2, idempotencyKey: "program:order:checkout:2:v1",
      successUrl: "https://gymx2.com/programs/program?checkout=success&order_id=order",
      cancelUrl: "https://gymx2.com/programs/program?checkout=cancel&order_id=order",
    }));
    expect(buyer.rpc).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledWith("advance_program_checkout_attempt", expect.objectContaining({
      p_order_id: orderId, p_expected_revision: 4, p_request_id: retryRequestId, p_proof_digest: expect.any(String),
    }));
    expect(service.rpc).toHaveBeenCalledWith("bind_program_billing_checkout_session", expect.objectContaining({
      p_order_id: orderId, p_expected_revision: 5, p_attempt_number: 2, p_checkout_session_id: newSession.id,
    }));
  });

  it("fails closed on missing snapshot retry proof and RPC provenance disagreement", async () => {
    const missingAttemptStore = createProgramCheckoutServerStore({
      serviceClient: rpcClient((name) => name === "get_program_checkout_snapshot" ? retrySnapshot({
        attempts: [{
          attempt_number: 1, attempt_id: attemptId, checkout_session_id: priorSessionId,
          payment_intent_id: priorPaymentIntentId, explicit_retry_request_id: null, retry_proof_digest: null,
        }],
      }) : null),
      buyerClient: rpcClient(() => null), buyerId, initialRevision: 5,
    });
    await expect(missingAttemptStore.loadSnapshot(orderId, 5)).rejects.toThrow("checkout_snapshot_attempt_history_invalid");

    const missingProof = retrySnapshot({
      attempts: [
        {
          attempt_number: 1, attempt_id: attemptId, checkout_session_id: priorSessionId,
          payment_intent_id: priorPaymentIntentId, explicit_retry_request_id: null, retry_proof_digest: null,
        },
        {
          attempt_number: 2, attempt_id: secondAttemptId, checkout_session_id: null,
          payment_intent_id: null, explicit_retry_request_id: null, retry_proof_digest: null,
        },
      ],
    });
    const missingProofStore = createProgramCheckoutServerStore({
      serviceClient: rpcClient((name) => name === "get_program_checkout_snapshot" ? missingProof : null),
      buyerClient: rpcClient(() => null), buyerId, initialRevision: 5,
    });
    await expect(missingProofStore.loadSnapshot(orderId, 5)).rejects.toThrow("checkout_snapshot_retry_provenance_invalid");

    const mismatchStore = createProgramCheckoutServerStore({
      serviceClient: rpcClient((name) => {
        if (name === "prepare_program_checkout_attempt") return advancedAttemptResponse({ retry_proof_digest: "0".repeat(64) });
        if (name === "get_program_checkout_snapshot") return retrySnapshot();
        return null;
      }),
      buyerClient: rpcClient(() => null), buyerId, initialRevision: 4,
    });
    await expect(mismatchStore.prepareCheckoutAttempt({
      orderId, expectedRevision: 4, successUrl: "https://gymx2.com/s", cancelUrl: "https://gymx2.com/c",
    })).resolves.toEqual({ blocked: "checkout_prepare_retry_provenance_mismatch" });
  });

  it("serializes normalized Stripe evidence with the SQL binder's exact snake-case keys", async () => {
    const service = rpcClient((name) => name === "bind_program_billing_checkout_session" ? true : null);
    const store = createProgramCheckoutServerStore({ serviceClient: service, buyerClient: rpcClient(() => null), buyerId, initialRevision: 5 });
    const scope = { platformAccountId: "acct_program", livemode: false };
    const session = {
      id: "cs_session", url: "https://checkout.stripe.com/c/pay/cs_session", customerId: "cus_program",
      clientReferenceId: attemptId, mode: "payment", status: "open", paymentStatus: "unpaid",
      amountTotal: 12000, currency: "usd", paymentIntentId: "pi_program",
      metadata: { program_order_id: orderId, program_checkout_attempt_id: attemptId },
      livemode: false, providerScope: scope,
    };
    const paymentIntent = {
      id: "pi_program", customerId: "cus_program", amount: 12000, amountReceived: 0, currency: "usd",
      status: "requires_payment_method", applicationFeeAmount: null, transferDestinationId: null,
      paymentMethodId: null, latestChargeId: null, metadata: { program_order_id: orderId },
      livemode: false, providerScope: scope,
    };
    expect(await store.bindCheckoutSession({
      orderId, attemptNumber: 1, expectedRevision: 5, sessionId: session.id, paymentIntentId: paymentIntent.id,
      evidence: { session, paymentIntent }, evidenceDigest: "e".repeat(64),
    })).toBe(true);
    expect(service.rpc).toHaveBeenCalledWith("bind_program_billing_checkout_session", expect.objectContaining({
      p_order_id: orderId,
      p_expected_revision: 5,
      p_attempt_number: 1,
      p_checkout_session_id: "cs_session",
      p_payment_intent_id: "pi_program",
      p_provider_evidence: expect.objectContaining({
        providerScope: { platformAccountId: "acct_program", livemode: false },
        customer_id: "cus_program",
        payment_status: "unpaid",
        payment_intent_id: "pi_program",
        payment_intent: expect.objectContaining({
          customer_id: "cus_program", application_fee_amount: null, transfer_destination_id: null,
        }),
      }),
      p_evidence_digest: "e".repeat(64),
    }));
    expect(store.getCurrentRevision()).toBe(6);
  });

  it("uses the existing unknown-state RPC and narrow append-only pre-bind audit", async () => {
    const service = rpcClient((name) => {
      if (name === "mark_program_billing_operation_unknown" || name === "mark_program_checkout_create_unknown") return true;
      if (name === "record_program_checkout_app_audit") return true;
      return null;
    });
    const store = createProgramCheckoutServerStore({ serviceClient: service, buyerClient: rpcClient(() => null), buyerId, initialRevision: 4 });
    expect(await store.markProgramCustomerCreateUnknown({ orderId })).toBe(true);
    await store.recordProgramCustomerCreateUnknown({ orderId, requestDigest: "b".repeat(64) });
    await store.recordCheckoutCreateUnknown({ orderId, attemptNumber: 1, requestDigest: "c".repeat(64) });
    await store.recordCheckoutObservation({ orderId, attemptNumber: 1, sessionId: "cs_synthetic", paymentIntentId: null, status: "open", digest: "d".repeat(64) });
    expect(await store.markCheckoutCreateUnknown({ orderId, attemptNumber: 1 })).toBe(true);
    expect(service.rpc).toHaveBeenNthCalledWith(1, "mark_program_billing_operation_unknown", {
      p_order_id: orderId, p_operation_kind: "customer_create", p_checkout_attempt: 0,
      p_installment: 0, p_payment_attempt: 0,
    });
    expect(service.rpc).toHaveBeenNthCalledWith(2, "record_program_checkout_app_audit", {
      p_order_id: orderId, p_operation_kind: "customer_create", p_checkout_attempt_number: 0,
      p_event_kind: "unknown", p_reason_code: "provider_request_unknown", p_evidence_digest: "b".repeat(64),
      p_provider_object_id: null, p_provider_status: null,
    });
    expect(service.rpc).toHaveBeenNthCalledWith(3, "record_program_checkout_app_audit", {
      p_order_id: orderId, p_operation_kind: "checkout_create", p_checkout_attempt_number: 1,
      p_event_kind: "unknown", p_reason_code: "provider_request_unknown", p_evidence_digest: "c".repeat(64),
      p_provider_object_id: null, p_provider_status: null,
    });
    expect(service.rpc).toHaveBeenNthCalledWith(4, "record_program_checkout_app_audit", {
      p_order_id: orderId, p_operation_kind: "checkout_create", p_checkout_attempt_number: 1,
      p_event_kind: "observed", p_reason_code: "checkout_session_observed", p_evidence_digest: "d".repeat(64),
      p_provider_object_id: "cs_synthetic", p_provider_status: "open",
    });
    expect(service.rpc).toHaveBeenCalledWith("mark_program_checkout_create_unknown", {
      p_order_id: orderId, p_attempt_number: 1,
    });
  });

  it("keeps authenticated retry requests on the buyer client and maps only persisted attempts", async () => {
    const service = rpcClient((name) => name === "get_program_checkout_snapshot" ? snapshot({
      billing_revision: 4,
      current_attempt_number: 1,
      attempts: [{ attempt_number: 1, attempt_id: attemptId, checkout_session_id: "cs_previous", payment_intent_id: null,
        explicit_retry_request_id: null, retry_proof_digest: null }],
    }) : null);
    const buyer = rpcClient((name, args) => name === "request_program_checkout_retry" && args.p_order_id === orderId
      ? { status: "requested", attempt_number: 1 }
      : null);
    const store = createProgramCheckoutServerStore({ serviceClient: service, buyerClient: buyer, buyerId, initialRevision: 4 });
    const result = await store.prepareBuyerRetry({ orderId, expectedRevision: 4, explicitRequestId: attemptId, requestedAt: at });
    expect("blocked" in result).toBe(false);
    if ("blocked" in result) return;
    expect(result.attempts).toEqual([{
      attemptNumber: 1, attemptId, checkoutSessionId: "cs_previous", paymentIntentId: null,
      explicitRetryRequestId: null, retryProofDigest: null,
    }]);
    expect(buyer.rpc).toHaveBeenCalledWith("request_program_checkout_retry", { p_order_id: orderId, p_request_id: attemptId });
    expect(service.rpc).toHaveBeenNthCalledWith(1, "get_program_checkout_snapshot", {
      p_order_id: orderId, p_expected_buyer_id: buyerId, p_expected_billing_revision: 4,
    });
  });
});
