import { describe, expect, it } from "vitest";
import type { ProgramPurchaseQuote, ProgramPurchaseRequest } from "./program-purchase-contracts";
import type { ProgramPurchaseHistoryItem } from "./program-purchase-history-contracts";
import {
  canRetryProgramPurchaseCheckout,
  emptyProgramPurchaseUiStorage,
  formatProgramPurchaseCents,
  formatProgramPurchaseDate,
  makeProgramPurchaseConfirmCommand,
  parseProgramPurchaseUiStorage,
  programPurchaseCancellationLabel,
  programPurchaseCommandMatchesRequest,
  programPurchasePaymentLabel,
  programPurchaseUiStorageKey,
  serializeProgramPurchaseUiStorage,
} from "./program-purchase-ui-state";

const buyerId = "10000000-0000-4000-8000-000000000001";
const programId = "20000000-0000-4000-8000-000000000002";
const offerId = "30000000-0000-4000-8000-000000000003";
const orderId = "40000000-0000-4000-8000-000000000004";
const requestId = "50000000-0000-4000-8000-000000000005";

function quote(overrides: Partial<ProgramPurchaseQuote> = {}): ProgramPurchaseQuote {
  return {
    programId,
    offerVersionId: offerId,
    contentVersionId: "60000000-0000-4000-8000-000000000006",
    lessonCount: 3,
    currency: "usd",
    listPriceCents: 12000,
    discountCents: 0,
    effectiveTotalCents: 12000,
    paymentPlan: "installments",
    installmentCount: 3,
    installmentAmountsCents: [4000, 4000, 4000],
    maximumInstallments: 3,
    promotionCode: "SAVE10",
    quoteDate: "2027-01-31",
    chargeDates: ["2027-02-28", "2027-03-31"],
    offSessionConsent: true,
    retryWindowDays: 7,
    cancellationStopsFutureCharges: true,
    schedulePolicyVersion: "monthly_calendar_eom_v1",
    quoteDigest: "a".repeat(64),
    ...overrides,
  };
}

function historyItem(overrides: Partial<ProgramPurchaseHistoryItem> = {}): ProgramPurchaseHistoryItem {
  return {
    orderId,
    programId,
    programLabel: "Program",
    createdAt: "2027-01-31T12:00:00Z",
    currency: "usd",
    listPriceCents: 12000,
    discountCents: 0,
    effectiveTotalCents: 12000,
    paymentPlan: "installments",
    installmentCount: 3,
    installmentAmountsCents: [4000, 4000, 4000],
    clearedInstallments: 0,
    hasRecordedRefund: false,
    paymentStage: "checkout_retryable",
    cancellationStage: "none",
    safetyStage: "clear",
    checkoutRetryHint: true,
    nextDueDate: "2027-02-28",
    retryDeadline: "2027-03-07T12:00:00Z",
    ...overrides,
  };
}

describe("Program purchase UI state helpers", () => {
  it("namespaces pending information by buyer and Program and restores exact command identity", () => {
    const command = makeProgramPurchaseConfirmCommand({
      quote: quote(), requestId, billingConsent: true, offSessionConsent: true,
    });
    expect(command).not.toBeNull();
    const storage = { ...emptyProgramPurchaseUiStorage(buyerId, programId), confirmation: command };
    const raw = serializeProgramPurchaseUiStorage(storage);
    expect(raw).toContain('"confirmation"');
    expect(raw).not.toContain("12000");
    expect(raw).not.toContain("checkout.stripe.com");
    expect(programPurchaseUiStorageKey(buyerId, programId)).not.toBe(programPurchaseUiStorageKey(buyerId, orderId));
    expect(parseProgramPurchaseUiStorage(raw, buyerId, programId)).toEqual({ status: "valid", value: storage });
    expect(parseProgramPurchaseUiStorage(raw, "70000000-0000-4000-8000-000000000007", programId).status).toBe("invalid");
    expect(parseProgramPurchaseUiStorage(raw, buyerId, orderId).status).toBe("invalid");
  });

  it("distinguishes missing storage from corrupt or unsupported data", () => {
    expect(parseProgramPurchaseUiStorage(null, buyerId, programId).status).toBe("empty");
    expect(parseProgramPurchaseUiStorage("{", buyerId, programId).status).toBe("invalid");
    expect(parseProgramPurchaseUiStorage(JSON.stringify({ version: 99 }), buyerId, programId).status).toBe("invalid");
    expect(parseProgramPurchaseUiStorage(JSON.stringify({
      ...emptyProgramPurchaseUiStorage(buyerId, programId),
      confirmation: { requestId },
    }), buyerId, programId).status).toBe("invalid");
  });

  it("keeps retry identity minimal and rejects malformed saved retry selectors", () => {
    const storage = {
      ...emptyProgramPurchaseUiStorage(buyerId, programId),
      checkoutRetry: { orderId, requestId },
    };
    expect(parseProgramPurchaseUiStorage(serializeProgramPurchaseUiStorage(storage), buyerId, programId))
      .toEqual({ status: "valid", value: storage });
    expect(parseProgramPurchaseUiStorage(JSON.stringify({
      ...storage,
      checkoutRetry: { orderId, requestId, checkoutUrl: "https://checkout.stripe.com/secret" },
    }), buyerId, programId).status).toBe("invalid");
  });

  it("binds recovered request identity to the persisted command", () => {
    const command = makeProgramPurchaseConfirmCommand({
      quote: quote(), requestId, billingConsent: true, offSessionConsent: true,
    });
    const request: ProgramPurchaseRequest = {
      requestId, orderId, buyerId, programId, offerVersionId: offerId,
      installmentCount: 3, promotionCode: "SAVE10",
    };
    expect(command && programPurchaseCommandMatchesRequest(command, request)).toBe(true);
    expect(command && programPurchaseCommandMatchesRequest(command, { ...request, installmentCount: 2 })).toBe(false);
  });

  it("formats immutable cents and date keys without timezone day shifts", () => {
    expect(formatProgramPurchaseCents(12345)).toBe("$123.45");
    expect(formatProgramPurchaseDate("2027-02-28")).toBe("Feb 28, 2027");
  });

  it("keeps safety status copy neutral and only offers retry for an exact persisted hint", () => {
    expect(programPurchasePaymentLabel(historyItem())).toBe("Checkout expired");
    expect(canRetryProgramPurchaseCheckout(historyItem())).toBe(true);
    expect(canRetryProgramPurchaseCheckout(historyItem({ cancellationStage: "requested" }))).toBe(false);
    expect(programPurchasePaymentLabel(historyItem({ safetyStage: "financial_conflict", paymentStage: "unknown" })))
      .toBe("We’re checking this purchase.");
    expect(programPurchaseCancellationLabel(historyItem({ cancellationStage: "completed" }))).toBe("Cancelled");
  });
});
