import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  purchaseContext: vi.fn(),
  purchaseRequest: vi.fn(),
  quote: vi.fn(),
  confirm: vi.fn(),
  findExisting: vi.fn(),
  historyDetail: vi.fn(),
  checkoutEnabled: vi.fn(),
  purchaseEnabled: vi.fn(),
  currentUser: vi.fn(),
  startCheckout: vi.fn(),
  retryCheckout: vi.fn(),
}));

vi.mock("@/lib/program-purchase-server", () => ({
  getMyProgramPurchaseContext: mocks.purchaseContext,
  getMyProgramPurchaseRequest: mocks.purchaseRequest,
  getProgramPurchaseQuote: mocks.quote,
  confirmProgramPurchase: mocks.confirm,
  isProgramPurchaseEnabled: mocks.purchaseEnabled,
}));
vi.mock("@/lib/program-purchase-history-server", () => ({
  findExistingProgramPurchase: mocks.findExisting,
  getMyProgramPurchaseHistoryDetail: mocks.historyDetail,
}));
vi.mock("@/lib/program-checkout-server", () => ({
  isProgramCheckoutEnabled: mocks.checkoutEnabled,
  startProgramCheckout: mocks.startCheckout,
  retryProgramCheckoutForBuyer: mocks.retryCheckout,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.currentUser } })),
}));

import {
  confirmProgramPurchaseAction,
  discoverProgramPurchaseAction,
  quoteProgramPurchaseAction,
  recoverProgramPurchaseAction,
  retryProgramCheckoutAction,
  startProgramCheckoutAction,
} from "./purchase-actions";

const programId = "20000000-0000-4000-8000-000000000002";
const otherProgramId = "20000000-0000-4000-8000-000000000009";
const buyerId = "10000000-0000-4000-8000-000000000001";
const otherBuyerId = "70000000-0000-4000-8000-000000000007";
const orderId = "40000000-0000-4000-8000-000000000004";
const offerId = "30000000-0000-4000-8000-000000000003";
const requestId = "50000000-0000-4000-8000-000000000005";
const quoteDigest = "a".repeat(64);

function context(overrides: Record<string, unknown> = {}) {
  return { orderId, requestId, buyerId, programId, offerVersionId: offerId, ...overrides };
}

function history(overrides: Record<string, unknown> = {}) {
  return { orderId, programId, paymentStage: "checkout_required", ...overrides };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    programId,
    offerVersionId: offerId,
    installmentCount: 1,
    promotionCode: null,
    requestId,
    quoteDigest,
    billingConsent: true,
    offSessionConsent: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.purchaseEnabled.mockReturnValue(true);
  mocks.checkoutEnabled.mockReturnValue(true);
  mocks.currentUser.mockResolvedValue({ data: { user: { id: buyerId } }, error: null });
  mocks.findExisting.mockResolvedValue({ ok: true, orderId: null });
  mocks.purchaseRequest.mockResolvedValue({ ok: false, reason: "not_found" });
  mocks.purchaseContext.mockResolvedValue({ ok: true, value: context() });
  mocks.historyDetail.mockResolvedValue({ ok: true, value: history() });
  mocks.quote.mockResolvedValue({ ok: true, quote: { programId } });
  mocks.confirm.mockResolvedValue({ ok: true, status: "confirmed" });
  mocks.startCheckout.mockResolvedValue({ status: "unknown" });
  mocks.retryCheckout.mockResolvedValue({ status: "unknown" });
});

describe("Program purchase member Server Actions", () => {
  it("discovers a successful empty result and reads an existing owner order in sequence", async () => {
    await expect(discoverProgramPurchaseAction(programId)).resolves.toEqual({ status: "empty" });
    expect(mocks.findExisting).toHaveBeenCalledWith(programId);
    expect(mocks.purchaseContext).not.toHaveBeenCalled();

    mocks.findExisting.mockResolvedValueOnce({ ok: true, orderId });
    await expect(discoverProgramPurchaseAction(programId)).resolves.toEqual({
      status: "found", orderId, context: context(), history: history(),
    });
    expect(mocks.purchaseContext).toHaveBeenCalledWith({ orderId });
    expect(mocks.historyDetail).toHaveBeenCalledWith(orderId);
    expect(mocks.purchaseContext.mock.invocationCallOrder[0]).toBeLessThan(mocks.historyDetail.mock.invocationCallOrder[0]);
  });

  it("recovers the request before reading its context and rejects wrong-Program rows", async () => {
    mocks.purchaseRequest.mockResolvedValueOnce({ ok: true, value: {
      requestId, orderId, buyerId, programId, offerVersionId: offerId, installmentCount: 1, promotionCode: null,
    } });
    await expect(recoverProgramPurchaseAction(requestId, programId)).resolves.toMatchObject({
      status: "found", request: { requestId, programId }, context: { orderId }, history: { orderId },
    });
    expect(mocks.purchaseRequest.mock.invocationCallOrder[0]).toBeLessThan(mocks.purchaseContext.mock.invocationCallOrder[0]);
    expect(mocks.purchaseContext.mock.invocationCallOrder[0]).toBeLessThan(mocks.historyDetail.mock.invocationCallOrder[0]);

    mocks.purchaseRequest.mockResolvedValueOnce({ ok: true, value: {
      requestId, orderId, buyerId, programId: otherProgramId, offerVersionId: offerId, installmentCount: 1, promotionCode: null,
    } });
    await expect(recoverProgramPurchaseAction(requestId, programId)).resolves.toEqual({ status: "invalid_response" });
  });

  it("keeps purchase quote and owner reads independent from checkout flags", async () => {
    mocks.checkoutEnabled.mockReturnValue(false);
    await quoteProgramPurchaseAction(programId, 1, null);
    await discoverProgramPurchaseAction(programId);
    await recoverProgramPurchaseAction(requestId, programId);
    expect(mocks.quote).toHaveBeenCalledWith({ programId, installmentCount: 1, promotionCode: null });
    expect(mocks.findExisting).toHaveBeenCalled();
    expect(mocks.purchaseRequest).toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("blocks paid confirmation before reservation when checkout is disabled but permits a free-grant attempt", async () => {
    mocks.checkoutEnabled.mockReturnValue(false);
    await expect(confirmProgramPurchaseAction(command(), buyerId)).resolves.toEqual({
      ok: false, reason: "checkout_disabled",
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.currentUser).not.toHaveBeenCalled();

    await expect(confirmProgramPurchaseAction(command({
      installmentCount: 0,
      promotionCode: "FREE100",
      billingConsent: false,
      offSessionConsent: false,
    }), buyerId)).resolves.toEqual({ ok: true, status: "confirmed" });
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });

  it("rejects an account change before confirmation or checkout mutation calls", async () => {
    mocks.currentUser.mockResolvedValue({ data: { user: { id: buyerId } }, error: null });
    await expect(confirmProgramPurchaseAction(command(), otherBuyerId)).resolves.toEqual({
      ok: false, reason: "buyer_auth_required",
    });
    expect(mocks.confirm).not.toHaveBeenCalled();

    await expect(startProgramCheckoutAction(orderId, 8, otherBuyerId)).resolves.toEqual({
      status: "blocked", reason: "buyer_auth_or_membership_required",
    });
    await expect(retryProgramCheckoutAction(orderId, 9, requestId, otherBuyerId)).resolves.toEqual({
      status: "blocked", reason: "buyer_auth_or_membership_required",
    });
    expect(mocks.startCheckout).not.toHaveBeenCalled();
    expect(mocks.retryCheckout).not.toHaveBeenCalled();
  });

  it("checks purchase and checkout flags before deriving the current account", async () => {
    mocks.purchaseEnabled.mockReturnValue(false);
    await expect(confirmProgramPurchaseAction(command(), buyerId)).resolves.toEqual({
      ok: false, reason: "feature_disabled",
    });
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();

    mocks.checkoutEnabled.mockReturnValue(false);
    await expect(startProgramCheckoutAction(orderId, 8, buyerId)).resolves.toEqual({
      status: "blocked", reason: "feature_disabled",
    });
    await expect(retryProgramCheckoutAction(orderId, 9, requestId, buyerId)).resolves.toEqual({
      status: "blocked", reason: "feature_disabled",
    });
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.startCheckout).not.toHaveBeenCalled();
    expect(mocks.retryCheckout).not.toHaveBeenCalled();
  });

  it("passes only current order revision and the stable retry request to checkout adapters", async () => {
    await startProgramCheckoutAction(orderId, 8, buyerId);
    await retryProgramCheckoutAction(orderId, 9, requestId, buyerId);
    expect(mocks.startCheckout).toHaveBeenCalledWith({ orderId, expectedRevision: 8 });
    expect(mocks.retryCheckout).toHaveBeenCalledWith({ orderId, expectedRevision: 9, requestId });
    expect(mocks.startCheckout.mock.calls[0]?.[0]).not.toHaveProperty("buyerId");
    expect(mocks.retryCheckout.mock.calls[0]?.[0]).not.toHaveProperty("buyerId");
  });
});
