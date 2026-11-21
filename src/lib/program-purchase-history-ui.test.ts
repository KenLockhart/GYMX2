import { describe, expect, it } from "vitest";
import type { ProgramPurchaseHistoryItem } from "./program-purchase-history-contracts";
import {
  canRequestProgramPurchaseCancellation,
  checkoutReturnNotice,
  parseProgramPurchaseCancellationStorage,
  parseProgramPurchaseHistoryCursorSearch,
  programPurchaseCancellationStorageKey,
  programPurchaseHistoryPageHref,
  programPurchaseHistoryStatusCopy,
  serializeProgramPurchaseCancellationStorage,
} from "./program-purchase-history-ui";

const accountId = "10000000-0000-4000-8000-000000000001";
const orderId = "40000000-0000-4000-8000-000000000004";
const requestId = "50000000-0000-4000-8000-000000000005";
const cursorCreatedAt = "2027-01-31T14:30:00.123456+00:00";

function item(overrides: Partial<ProgramPurchaseHistoryItem> = {}): ProgramPurchaseHistoryItem {
  return {
    orderId,
    programId: "20000000-0000-4000-8000-000000000002",
    programLabel: "Program",
    createdAt: cursorCreatedAt,
    currency: "usd",
    listPriceCents: 12000,
    discountCents: 0,
    effectiveTotalCents: 12000,
    paymentPlan: "installments",
    installmentCount: 3,
    installmentAmountsCents: [4000, 4000, 4000],
    clearedInstallments: 1,
    hasRecordedRefund: false,
    paymentStage: "partially_settled",
    cancellationStage: "none",
    safetyStage: "clear",
    checkoutRetryHint: false,
    nextDueDate: "2027-02-28",
    retryDeadline: null,
    ...overrides,
  };
}

describe("Program purchase history UI helpers", () => {
  it("accepts only a single paired cursor and preserves microseconds and offset", () => {
    expect(parseProgramPurchaseHistoryCursorSearch(undefined)).toEqual({ status: "first_page" });
    const parsed = parseProgramPurchaseHistoryCursorSearch({
      cursorCreatedAt,
      cursorOrderId: orderId,
    });
    expect(parsed).toEqual({ status: "cursor", value: { createdAt: cursorCreatedAt, orderId } });
    if (parsed.status !== "cursor") throw new Error("Expected a validated cursor");
    const href = programPurchaseHistoryPageHref(parsed.value);
    expect(new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("cursorCreatedAt")).toBe(cursorCreatedAt);
    expect(parseProgramPurchaseHistoryCursorSearch({ cursorCreatedAt })).toEqual({ status: "invalid" });
    expect(parseProgramPurchaseHistoryCursorSearch({ cursorCreatedAt, cursorOrderId: [orderId] })).toEqual({ status: "invalid" });
    expect(parseProgramPurchaseHistoryCursorSearch({ cursorCreatedAt, cursorOrderId: orderId, extra: "x" })).toEqual({ status: "invalid" });
    expect(parseProgramPurchaseHistoryCursorSearch({ cursorCreatedAt: "2027-02-31T00:00:00Z", cursorOrderId: orderId }))
      .toEqual({ status: "invalid" });
  });

  it("only offers cancellation for clear non-free orders with charges outstanding", () => {
    expect(canRequestProgramPurchaseCancellation(item())).toBe(true);
    expect(canRequestProgramPurchaseCancellation(item({ paymentStage: "payment_pending" }))).toBe(true);
    expect(canRequestProgramPurchaseCancellation(item({
      paymentPlan: "pay_in_full", installmentCount: 1, installmentAmountsCents: [12000],
      paymentStage: "checkout_open", clearedInstallments: 0,
    }))).toBe(true);
    expect(canRequestProgramPurchaseCancellation(item({ paymentStage: "settled", clearedInstallments: 3 }))).toBe(false);
    expect(canRequestProgramPurchaseCancellation(item({ paymentStage: "refunded", clearedInstallments: 0 }))).toBe(false);
    expect(canRequestProgramPurchaseCancellation(item({
      paymentStage: "partially_refunded", hasRecordedRefund: true, clearedInstallments: 1,
      nextDueDate: "2027-03-31",
    }))).toBe(true);
    expect(canRequestProgramPurchaseCancellation(item({
      paymentStage: "partially_refunded", hasRecordedRefund: true, clearedInstallments: 2,
      nextDueDate: null,
    }))).toBe(false);
    expect(canRequestProgramPurchaseCancellation(item({ paymentStage: "partially_refunded", clearedInstallments: 3 }))).toBe(false);
    expect(canRequestProgramPurchaseCancellation(item({ cancellationStage: "requested" }))).toBe(false);
    expect(canRequestProgramPurchaseCancellation(item({ safetyStage: "manual_review", paymentStage: "unknown" }))).toBe(false);
    expect(canRequestProgramPurchaseCancellation(item({
      paymentPlan: "free", installmentCount: 0, installmentAmountsCents: [], effectiveTotalCents: 0,
      listPriceCents: 0, paymentStage: "free_grant", cancellationStage: "not_applicable", clearedInstallments: 0,
    }))).toBe(false);
  });

  it("namespaces and validates the minimal cancellation retry record", () => {
    const value = { version: 1 as const, accountId, orderId, requestId };
    const raw = serializeProgramPurchaseCancellationStorage(value);
    expect(programPurchaseCancellationStorageKey(accountId, orderId)).toContain(`:${accountId}:${orderId}`);
    expect(parseProgramPurchaseCancellationStorage(raw, accountId, orderId)).toEqual({ status: "valid", value });
    expect(parseProgramPurchaseCancellationStorage(raw, "60000000-0000-4000-8000-000000000006", orderId))
      .toEqual({ status: "invalid" });
    expect(parseProgramPurchaseCancellationStorage(JSON.stringify({ ...value, checkoutUrl: "secret" }), accountId, orderId))
      .toEqual({ status: "invalid" });
    expect(parseProgramPurchaseCancellationStorage("{", accountId, orderId)).toEqual({ status: "invalid" });
    expect(parseProgramPurchaseCancellationStorage(null, accountId, orderId)).toEqual({ status: "empty" });
    expect(raw).not.toContain("checkout");
    expect(raw).not.toContain("provider");
  });

  it("uses safe summary values and treats checkout return query values as display only", () => {
    const copy = programPurchaseHistoryStatusCopy(item());
    expect(copy).toMatchObject({ amount: "$120.00", plan: "3 payments", progress: "1 of 3 installments cleared" });
    expect(checkoutReturnNotice("success")).toContain("does not confirm payment");
    expect(checkoutReturnNotice("cancel")).toContain("does not cancel the purchase");
    expect(checkoutReturnNotice(["success", "cancel"])).toBeNull();
    expect(checkoutReturnNotice("paid")).toBeNull();
  });
});
