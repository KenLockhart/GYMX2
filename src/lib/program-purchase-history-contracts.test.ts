import { describe, expect, it } from "vitest";
import {
  isProgramPurchaseHistoryTimestamp,
  parseProgramPurchaseHistoryDetailCommand,
  parseProgramPurchaseHistoryDetailResult,
  parseProgramPurchaseHistoryItem,
  parseProgramPurchaseHistoryListCommand,
  parseProgramPurchaseHistoryListResult,
} from "./program-purchase-history-contracts";

const orderId = "63090000-0000-4000-8000-000000000001";
const programId = "63030000-0000-4000-8000-000000000001";
const createdAt = "2027-01-31T14:30:00.123456+00:00";

function item(overrides: Record<string, unknown> = {}) {
  return {
    order_id: orderId,
    program_id: programId,
    program_label: "Program",
    created_at: createdAt,
    currency: "usd",
    list_price_cents: 1200,
    discount_cents: 200,
    effective_total_cents: 1000,
    payment_plan: "installments",
    installment_count: 3,
    installment_amounts_cents: [333, 333, 334],
    cleared_installments: 1,
    has_recorded_refund: false,
    payment_stage: "partially_settled",
    cancellation_stage: "none",
    safety_stage: "clear",
    checkout_retry_hint: false,
    next_due_date: "2027-02-28",
    retry_deadline: null,
    ...overrides,
  };
}

describe("Program purchase history DTO contracts", () => {
  it("accepts paid history, preserves microsecond cursor timestamps, and accepts non-RFC UUID bits", () => {
    const unusualUuid = "abcdef01-2345-6789-abcd-ef0123456789";
    expect(parseProgramPurchaseHistoryItem(item({ order_id: unusualUuid }))).toMatchObject({
      orderId: unusualUuid,
      createdAt,
      paymentStage: "partially_settled",
    });
    expect(parseProgramPurchaseHistoryListCommand({
      limit: 25,
      cursor: { createdAt, orderId: unusualUuid.toUpperCase() },
      programId: programId.toUpperCase(),
    })).toEqual({
      limit: 25,
      cursor: { createdAt, orderId: unusualUuid },
      programId,
    });
    expect(parseProgramPurchaseHistoryDetailCommand(unusualUuid.toUpperCase())).toBe(unusualUuid);
  });

  it("accepts the zero-total free grant projection", () => {
    expect(parseProgramPurchaseHistoryItem(item({
      list_price_cents: 1000,
      discount_cents: 1000,
      effective_total_cents: 0,
      payment_plan: "free",
      installment_count: 0,
      installment_amounts_cents: [],
      cleared_installments: 0,
      payment_stage: "free_grant",
      cancellation_stage: "not_applicable",
      next_due_date: null,
    }))).toMatchObject({ paymentPlan: "free", paymentStage: "free_grant", installmentAmountsCents: [] });
  });

  it.each(["refunded", "partially_refunded"] as const)("accepts a verified %s projection", (paymentStage) => {
    expect(parseProgramPurchaseHistoryItem(item({
      payment_stage: paymentStage,
      has_recorded_refund: true,
      cleared_installments: paymentStage === "refunded" ? 0 : 1,
      next_due_date: null,
    }))).toMatchObject({ paymentStage, hasRecordedRefund: true });
  });

  it("rejects refund stages whose cleared prefix contradicts the refund evidence", () => {
    expect(parseProgramPurchaseHistoryItem(item({
      payment_stage: "refunded", has_recorded_refund: true, cleared_installments: 1, next_due_date: null,
    }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({
      payment_stage: "partially_refunded", has_recorded_refund: true, cleared_installments: 3, next_due_date: null,
    }))).toBeNull();
  });

  it("rejects future installment dates for a pay-in-full order", () => {
    expect(parseProgramPurchaseHistoryItem(item({
      payment_plan: "pay_in_full",
      installment_count: 1,
      installment_amounts_cents: [1000],
      cleared_installments: 0,
      payment_stage: "checkout_open",
      next_due_date: null,
    }))).not.toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({
      payment_plan: "pay_in_full",
      installment_count: 1,
      installment_amounts_cents: [1000],
      cleared_installments: 0,
      payment_stage: "checkout_open",
      next_due_date: "2027-02-28",
    }))).toBeNull();
  });

  it("accepts an unknown deletion hold only with positive payment details suppressed", () => {
    expect(parseProgramPurchaseHistoryItem(item({
      payment_stage: "unknown",
      cancellation_stage: "unknown",
      safety_stage: "deletion_hold",
      checkout_retry_hint: false,
      next_due_date: null,
      retry_deadline: null,
    }))).toMatchObject({ safetyStage: "deletion_hold", paymentStage: "unknown" });
    expect(parseProgramPurchaseHistoryItem(item({
      payment_stage: "checkout_open",
      cancellation_stage: "unknown",
      safety_stage: "deletion_hold",
      next_due_date: null,
    }))).toBeNull();
  });

  it("rejects provider fields, extra keys, unsupported enums, and invalid economics", () => {
    expect(parseProgramPurchaseHistoryItem(item({ stripe_checkout_session_id: "cs_private" }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ internal_reason: "manual review" }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ payment_stage: "settled-ish" }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ effective_total_cents: 999 }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ discount_cents: 1201 }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ installment_amounts_cents: [333, 333, 333] }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ installment_amounts_cents: [333, 333, 335] }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ installment_amounts_cents: [333, 333, 334.1] }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ list_price_cents: Number.MAX_SAFE_INTEGER }))).toBeNull();
  });

  it("rejects count, cleared-prefix, date, timestamp, and UUID corruption", () => {
    expect(parseProgramPurchaseHistoryItem(item({ installment_count: 13 }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ cleared_installments: 4 }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ next_due_date: "2027-02-29" }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ retry_deadline: "2027-01-31T14:30:00.1234567Z" }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ created_at: "2027-02-30T14:30:00Z" }))).toBeNull();
    expect(parseProgramPurchaseHistoryItem(item({ order_id: "63090000-0000-0000-0000-00000000000z" }))).toBeNull();
    expect(isProgramPurchaseHistoryTimestamp(createdAt)).toBe(true);
    expect(isProgramPurchaseHistoryTimestamp("2027-01-31T24:00:00Z")).toBe(false);
  });

  it("requires a valid bounded list command with a complete cursor pair", () => {
    expect(parseProgramPurchaseHistoryListCommand({ limit: 1 })).toEqual({ limit: 1, cursor: null, programId: null });
    expect(parseProgramPurchaseHistoryListCommand({ limit: 50, cursor: null, programId: null })).toEqual({
      limit: 50, cursor: null, programId: null,
    });
    expect(parseProgramPurchaseHistoryListCommand({ limit: 0 })).toBeNull();
    expect(parseProgramPurchaseHistoryListCommand({ limit: 51 })).toBeNull();
    expect(parseProgramPurchaseHistoryListCommand({ limit: 2, actorId: orderId })).toBeNull();
    expect(parseProgramPurchaseHistoryListCommand({ limit: 2, cursor: { createdAt } })).toBeNull();
    expect(parseProgramPurchaseHistoryListCommand({ limit: 2, cursor: { createdAt: "bad", orderId } })).toBeNull();
    expect(parseProgramPurchaseHistoryListCommand({ limit: 2, programId: "bad" })).toBeNull();
  });

  it("binds has-more cursor to the final returned row without losing timestamp precision", () => {
    const last = item({ order_id: "63090000-0000-4000-8000-000000000002", created_at: createdAt });
    const validPage = {
      status: "ready",
      items: [item(), last],
      has_more: true,
      next_cursor: { created_at: createdAt, order_id: last.order_id },
    };
    expect(parseProgramPurchaseHistoryListResult(validPage)).toMatchObject({
      ok: true,
      value: { hasMore: true, nextCursor: { createdAt, orderId: last.order_id } },
    });
    expect(parseProgramPurchaseHistoryListResult({
      ...validPage,
      next_cursor: { created_at: "2027-01-31T14:30:00.123Z", order_id: last.order_id },
    })).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseHistoryListResult({ ...validPage, has_more: false })).toEqual({
      ok: false, reason: "invalid_response",
    });
  });

  it("rejects duplicate rows, extra response keys, and malformed detail statuses", () => {
    expect(parseProgramPurchaseHistoryListResult({
      status: "ready", items: [item(), item()], has_more: false, next_cursor: null,
    })).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseHistoryListResult({
      status: "ready", items: [], has_more: false, next_cursor: null, provider: "stripe",
    })).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseHistoryDetailResult({ status: "not_found" })).toEqual({ ok: false, reason: "not_found" });
    expect(parseProgramPurchaseHistoryDetailResult({ status: "ready", item: item(), private_reason: "x" }))
      .toEqual({ ok: false, reason: "invalid_response" });
  });
});
