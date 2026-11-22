import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  buyerRpc: vi.fn(),
  serviceRpc: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import {
  confirmProgramPurchase,
  createProgramPurchaseServerStore,
  getMyProgramPurchaseContext,
  getMyProgramPurchaseRequest,
  getProgramPurchaseQuote,
  isProgramPurchaseEnabled,
} from "./program-purchase-server";

const buyerId = "62010000-0000-4000-8000-000000000002";
const programId = "62030000-0000-4000-8000-000000000001";
const offerId = "62070000-0000-4000-8000-000000000001";
const contentId = "62060000-0000-4000-8000-000000000001";
const orderId = "62090000-0000-4000-8000-000000000001";
const requestId = "620a0000-0000-4000-8000-000000000001";
const digest = "a".repeat(64);

function quote(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    program_id: programId,
    offer_version_id: offerId,
    content_version_id: contentId,
    lesson_count: 3,
    currency: "usd",
    list_price_cents: 1200,
    discount_cents: 200,
    effective_total_cents: 1000,
    payment_plan: "installments",
    installment_count: 3,
    installment_amounts_cents: [333, 333, 334],
    maximum_installments: 3,
    promotion_code: "ONEUSE",
    quote_date: "2027-01-29",
    charge_dates: ["2027-02-28", "2027-03-31"],
    off_session_consent: true,
    retry_window_days: 7,
    cancellation_stops_future_charges: true,
    schedule_policy_version: "monthly_calendar_eom_v1",
    quote_digest: digest,
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    status: "found",
    request_id: requestId,
    order_id: orderId,
    buyer_id: buyerId,
    program_id: programId,
    offer_version_id: offerId,
    installment_count: 3,
    promotion_code: "ONEUSE",
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    order_id: orderId,
    request_id: requestId,
    buyer_id: buyerId,
    program_id: programId,
    offer_version_id: offerId,
    content_version_id: contentId,
    lesson_count: 3,
    currency: "usd",
    list_price_cents: 1200,
    discount_cents: 200,
    effective_total_cents: 1000,
    payment_plan: "installments",
    installment_count: 3,
    installment_amounts_cents: [333, 333, 334],
    promotion_code: "ONEUSE",
    zero_total_grant_reason: null,
    order_state: "awaiting_checkout",
    billing_state: "terms_saved",
    billing_revision: 1,
    terms: {
      digest,
      accepted_at: "2026-11-21T14:30:00.000Z",
      total_cents: 1000,
      installment_count: 3,
      disclosed_charge_dates: ["2027-02-28", "2027-03-31"],
      saved_card_for_off_session: true,
      retry_window_days: 7,
      cancellation_stops_future_charges: true,
    },
    first_settled_at: null,
    next_anchor_date: null,
    cancellation_requested: false,
    financial_conflict: false,
    canceled: false,
    ...overrides,
  };
}

function freeContext(overrides: Record<string, unknown> = {}) {
  return context({
    list_price_cents: 1200,
    discount_cents: 1200,
    effective_total_cents: 0,
    payment_plan: "free",
    installment_count: 0,
    installment_amounts_cents: [],
    promotion_code: "FREE100",
    zero_total_grant_reason: "promotion_100_percent",
    order_state: "free_grant",
    billing_state: "free_grant",
    billing_revision: 0,
    terms: null,
    ...overrides,
  });
}

const command = {
  programId,
  offerVersionId: offerId,
  installmentCount: 3,
  promotionCode: "oneuse",
  requestId,
  quoteDigest: digest,
  billingConsent: true,
  offSessionConsent: true,
};

function setupBuyer() {
  const client = {
    auth: { getUser: mocks.authGetUser },
    rpc: mocks.buyerRpc,
  };
  mocks.authGetUser.mockResolvedValue({ data: { user: { id: buyerId } }, error: null });
  mocks.createClient.mockResolvedValue(client);
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.serviceRpc });
  return client;
}

function rpcOk(data: unknown) {
  return { data, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PROGRAM_PURCHASE_ENABLED;
  mocks.serviceRpc.mockResolvedValue(rpcOk({ status: "confirmed", order_id: orderId, billing_revision: 1 }));
  setupBuyer();
});

describe("Program purchase server contracts", () => {
  it("keeps quote and confirmation disabled before auth clients or RPCs", async () => {
    expect(isProgramPurchaseEnabled()).toBe(false);
    await expect(getProgramPurchaseQuote({ programId, installmentCount: 1, promotionCode: null }))
      .resolves.toEqual({ ok: false, reason: "feature_disabled" });
    await expect(confirmProgramPurchase(command)).resolves.toEqual({ ok: false, reason: "feature_disabled" });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.buyerRpc).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("gets an authenticated quote with only caller choices and derives the actor from auth", async () => {
    process.env.PROGRAM_PURCHASE_ENABLED = "true";
    mocks.buyerRpc.mockResolvedValue(rpcOk(quote()));
    await expect(getProgramPurchaseQuote({ programId, installmentCount: 3, promotionCode: " oneuse " }))
      .resolves.toMatchObject({ ok: true, quote: { offerVersionId: offerId, effectiveTotalCents: 1000 } });
    expect(mocks.authGetUser).toHaveBeenCalledOnce();
    expect(mocks.buyerRpc).toHaveBeenCalledWith("get_my_program_purchase_quote", {
      p_program_id: programId, p_installment_count: 3, p_promotion_code: "ONEUSE",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not create a privileged client for owner-scoped recovery reads or require the purchase flag", async () => {
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk(request())).mockResolvedValueOnce(rpcOk(context({
      order_state: "awaiting_checkout",
      billing_state: "awaiting_checkout",
      billing_revision: 0,
      terms: null,
    })));
    await expect(getMyProgramPurchaseRequest({ requestId })).resolves.toMatchObject({ ok: true, value: { buyerId } });
    await expect(getMyProgramPurchaseContext({ orderId })).resolves.toMatchObject({
      ok: true, value: { orderId, billingRevision: 0, billingState: "awaiting_checkout", terms: null },
    });
    expect(mocks.buyerRpc).toHaveBeenNthCalledWith(1, "get_my_program_purchase_request", { p_request_id: requestId });
    expect(mocks.buyerRpc).toHaveBeenNthCalledWith(2, "get_my_program_purchase_context", { p_order_id: orderId });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("confirms from a fresh quote, using server-derived buyer and server quote values", async () => {
    process.env.PROGRAM_PURCHASE_ENABLED = "true";
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk({ status: "not_found" }))
      .mockResolvedValueOnce(rpcOk(quote()))
      .mockResolvedValueOnce(rpcOk(context()));
    await expect(confirmProgramPurchase(command)).resolves.toMatchObject({ ok: true, status: "confirmed", context: { orderId } });
    expect(mocks.buyerRpc).toHaveBeenNthCalledWith(1, "get_my_program_purchase_request", { p_request_id: requestId });
    expect(mocks.buyerRpc).toHaveBeenNthCalledWith(2, "get_my_program_purchase_quote", {
      p_program_id: programId, p_installment_count: 3, p_promotion_code: "ONEUSE",
    });
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.serviceRpc).toHaveBeenCalledWith("confirm_program_purchase", {
      p_buyer_id: buyerId,
      p_program_id: programId,
      p_offer_version_id: offerId,
      p_installment_count: 3,
      p_request_id: requestId,
      p_promotion_code: "ONEUSE",
      p_expected_quote_digest: digest,
      p_charge_dates: ["2027-02-28", "2027-03-31"],
      p_billing_consent: true,
      p_off_session_consent: true,
    });
    expect(mocks.serviceRpc.mock.calls[0][1]).not.toHaveProperty("effective_total_cents");
  });

  it("recovers an owned saved consent before requoting or checking current membership", async () => {
    process.env.PROGRAM_PURCHASE_ENABLED = "true";
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk(request())).mockResolvedValueOnce(rpcOk(context()));
    await expect(confirmProgramPurchase(command)).resolves.toMatchObject({
      ok: true, status: "already_confirmed", context: { billingRevision: 1, terms: { digest } },
    });
    expect(mocks.buyerRpc).toHaveBeenCalledTimes(2);
    expect(mocks.buyerRpc).toHaveBeenNthCalledWith(2, "get_my_program_purchase_context", { p_order_id: orderId });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("recovers a lost zero-total grant from the same UUID without quote or privileged write", async () => {
    process.env.PROGRAM_PURCHASE_ENABLED = "true";
    const freeCommand = {
      ...command,
      installmentCount: 0,
      promotionCode: "FREE100",
      billingConsent: false,
      offSessionConsent: false,
    };
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk(request({ installment_count: 0, promotion_code: "FREE100" })))
      .mockResolvedValueOnce(rpcOk(freeContext()));
    await expect(confirmProgramPurchase(freeCommand)).resolves.toMatchObject({
      ok: true, status: "already_granted", context: { orderId, paymentPlan: "free", billingRevision: 0, terms: null },
    });
    expect(mocks.buyerRpc).toHaveBeenCalledTimes(2);
    expect(mocks.buyerRpc).toHaveBeenNthCalledWith(1, "get_my_program_purchase_request", { p_request_id: requestId });
    expect(mocks.buyerRpc).toHaveBeenNthCalledWith(2, "get_my_program_purchase_context", { p_order_id: orderId });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("rejects changed payload reuse of the same UUID before quote or service calls", async () => {
    process.env.PROGRAM_PURCHASE_ENABLED = "true";
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk(request({ installment_count: 2 })));
    await expect(confirmProgramPurchase(command)).resolves.toEqual({ ok: false, reason: "request_conflict" });
    expect(mocks.buyerRpc).toHaveBeenCalledTimes(1);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a changed current offer or quote digest before creating an order", async () => {
    process.env.PROGRAM_PURCHASE_ENABLED = "true";
    const changedOffer = "62070000-0000-4000-8000-000000000099";
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk({ status: "not_found" }))
      .mockResolvedValueOnce(rpcOk(quote({ offer_version_id: changedOffer })));
    await expect(confirmProgramPurchase(command)).resolves.toEqual({ ok: false, reason: "quote_changed" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("requires explicit payment consent before creating the service client", async () => {
    process.env.PROGRAM_PURCHASE_ENABLED = "true";
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk({ status: "not_found" })).mockResolvedValueOnce(rpcOk(quote()));
    await expect(confirmProgramPurchase({ ...command, billingConsent: false }))
      .resolves.toEqual({ ok: false, reason: "consent_required" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("requires off-session consent for installments before any privileged write", async () => {
    process.env.PROGRAM_PURCHASE_ENABLED = "true";
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk({ status: "not_found" })).mockResolvedValueOnce(rpcOk(quote()));
    await expect(confirmProgramPurchase({ ...command, offSessionConsent: false }))
      .resolves.toEqual({ ok: false, reason: "off_session_consent_required" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not recover another actor's request or context even if a DTO claims ownership", async () => {
    const otherBuyer = "62010000-0000-4000-8000-000000000099";
    const store = createProgramPurchaseServerStore({
      buyerClient: { rpc: vi.fn().mockResolvedValue(rpcOk(request({ buyer_id: otherBuyer }))) },
      serviceClient: { rpc: vi.fn() },
      buyerId,
    });
    await expect(store.loadRequest(requestId)).resolves.toEqual({ ok: false, reason: "invalid_response" });
    const contextStore = createProgramPurchaseServerStore({
      buyerClient: { rpc: vi.fn().mockResolvedValue(rpcOk(context({ buyer_id: otherBuyer }))) },
      buyerId,
    });
    await expect(contextStore.loadContext(orderId)).resolves.toEqual({ ok: false, reason: "invalid_response" });
  });
});
