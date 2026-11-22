import { describe, expect, it } from "vitest";
import {
  expectedProgramPurchaseChargeDates,
  parseProgramPurchaseConfirmCommand,
  parseProgramPurchaseContextResult,
  parseProgramPurchaseQuoteCommand,
  parseProgramPurchaseQuoteResult,
  parseProgramPurchaseRequestCommand,
  parseProgramPurchaseRequestResult,
  parseProgramPurchaseConfirmRpcResult,
} from "./program-purchase-contracts";

const programId = "62030000-0000-4000-8000-000000000001";
const offerId = "62070000-0000-4000-8000-000000000001";
const contentId = "62060000-0000-4000-8000-000000000001";
const orderId = "62090000-0000-4000-8000-000000000001";
const buyerId = "62010000-0000-4000-8000-000000000002";
const requestId = "620a0000-0000-4000-8000-000000000001";
const digest = "a".repeat(64);
const acceptedAt = "2026-11-21T14:30:00.000Z";

function rawQuote(overrides: Record<string, unknown> = {}) {
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

function rawContext(overrides: Record<string, unknown> = {}) {
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
      accepted_at: acceptedAt,
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

describe("Program purchase contracts", () => {
  it("normalizes only the explicit quote command and rejects extra fields", () => {
    expect(parseProgramPurchaseQuoteCommand({
      programId, installmentCount: 3, promotionCode: " oneuse ",
    })).toEqual({ programId, installmentCount: 3, promotionCode: "ONEUSE" });
    expect(parseProgramPurchaseQuoteCommand({
      programId, installmentCount: 3, promotionCode: null, buyerId,
    })).toBeNull();
    expect(parseProgramPurchaseQuoteCommand({
      programId, installmentCount: 3, promotionCode: undefined,
    })).toBeNull();
    expect(parseProgramPurchaseQuoteCommand({
      programId, installmentCount: 13, promotionCode: null,
    })).toBeNull();
    expect(parseProgramPurchaseQuoteCommand({
      programId, installmentCount: 3, promotionCode: "bad code",
    })).toBeNull();
  });

  it("strictly binds confirmation to the quote, request UUID and consent booleans", () => {
    const command = {
      programId, offerVersionId: offerId, installmentCount: 3, promotionCode: " oneuse ",
      requestId, quoteDigest: digest, billingConsent: true, offSessionConsent: true,
    };
    expect(parseProgramPurchaseConfirmCommand(command)).toMatchObject({ promotionCode: "ONEUSE", requestId });
    expect(parseProgramPurchaseConfirmCommand({ ...command, buyerId })).toBeNull();
    expect(parseProgramPurchaseConfirmCommand({ ...command, requestId: "not-a-uuid" })).toBeNull();
    expect(parseProgramPurchaseConfirmCommand({ ...command, quoteDigest: "not-a-digest" })).toBeNull();
    expect(parseProgramPurchaseConfirmCommand({ ...command, offSessionConsent: "yes" })).toBeNull();
  });

  it("verifies exact order, quote money, plan, dates and schedule version", () => {
    const parsed = parseProgramPurchaseQuoteResult(rawQuote());
    expect(parsed).toMatchObject({ ok: true, quote: { effectiveTotalCents: 1000, installmentAmountsCents: [333, 333, 334] } });
    expect(parseProgramPurchaseQuoteResult(rawQuote({ effective_total_cents: 999 }))).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseQuoteResult(rawQuote({ installment_amounts_cents: [300, 300, 300] }))).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseQuoteResult(rawQuote({ installment_amounts_cents: [300, 300, 400] }))).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseQuoteResult(rawQuote({ charge_dates: ["2027-02-28", "2027-03-30"] }))).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseQuoteResult(rawQuote({ schedule_policy_version: "unknown" }))).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseQuoteResult(rawQuote({ extra: true }))).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseQuoteResult(rawQuote({
      discount_cents: 1199, effective_total_cents: 1, payment_plan: "pay_in_full",
      installment_count: 1, installment_amounts_cents: [1], maximum_installments: 3,
      promotion_code: "ONECENT", quote_date: null, charge_dates: [], off_session_consent: false, retry_window_days: null,
    }))).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseQuoteResult(rawQuote({
      discount_cents: 1151, effective_total_cents: 49, payment_plan: "pay_in_full",
      installment_count: 1, installment_amounts_cents: [49], maximum_installments: 3,
      promotion_code: "FORTYNINE", quote_date: null, charge_dates: [], off_session_consent: false, retry_window_days: null,
    }))).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseQuoteResult(rawQuote({
      discount_cents: 1150, effective_total_cents: 50, payment_plan: "pay_in_full",
      installment_count: 1, installment_amounts_cents: [50], maximum_installments: 3,
      promotion_code: "FIFTYCENTS", quote_date: null, charge_dates: [], off_session_consent: false, retry_window_days: null,
    }))).toMatchObject({ ok: true, quote: { effectiveTotalCents: 50, installmentAmountsCents: [50] } });
  });

  it("uses the frozen month-end schedule for January and leap-year anchors", () => {
    expect(expectedProgramPurchaseChargeDates("2027-01-29", 3)).toEqual(["2027-02-28", "2027-03-31"]);
    expect(expectedProgramPurchaseChargeDates("2027-01-30", 3)).toEqual(["2027-02-28", "2027-03-31"]);
    expect(expectedProgramPurchaseChargeDates("2027-01-31", 3)).toEqual(["2027-02-28", "2027-03-31"]);
    expect(expectedProgramPurchaseChargeDates("2028-01-29", 3)).toEqual(["2028-02-29", "2028-03-31"]);
    expect(expectedProgramPurchaseChargeDates("2027-01-31", 1)).toBeNull();
  });

  it("accepts saved order context only when its economics and terms agree", () => {
    expect(parseProgramPurchaseContextResult(rawContext())).toMatchObject({
      ok: true,
      context: { buyerId, orderId, billingRevision: 1, terms: { retryWindowDays: 7 } },
    });
    expect(parseProgramPurchaseContextResult(rawContext({ buyer_id: "62010000-0000-4000-8000-000000000099" })))
      .toMatchObject({ ok: true });
    expect(parseProgramPurchaseContextResult(rawContext({
      terms: { ...(rawContext().terms as Record<string, unknown>), total_cents: 999 },
    }))).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseContextResult(rawContext({
      billing_revision: 0,
    }))).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseContextResult(rawContext({ stripe_customer_id: "cus_test" })))
      .toEqual({ ok: false, reason: "invalid_response" });
  });

  it("accepts the actual owner-scoped pre-consent SQL context and rejects revision/terms contradictions", () => {
    const preTermsContext = rawContext({
      order_state: "awaiting_checkout",
      billing_state: "awaiting_checkout",
      billing_revision: 0,
      terms: null,
    });
    expect(parseProgramPurchaseContextResult(preTermsContext)).toMatchObject({
      ok: true,
      context: { orderId, billingRevision: 0, billingState: "awaiting_checkout", terms: null },
    });
    expect(parseProgramPurchaseContextResult(rawContext({
      billing_revision: 1,
      terms: null,
    }))).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("preserves a zero-total grant with no billing row", () => {
    expect(parseProgramPurchaseContextResult(rawContext({
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
    }))).toMatchObject({ ok: true, context: { paymentPlan: "free", billingRevision: 0, terms: null } });
  });

  it("parses owner-scoped recovery selectors and payloads", () => {
    expect(parseProgramPurchaseRequestCommand({ requestId })).toEqual({ requestId });
    expect(parseProgramPurchaseRequestCommand({ requestId, buyerId })).toBeNull();
    expect(parseProgramPurchaseRequestResult({ status: "not_found" })).toEqual({ ok: false, reason: "not_found" });
    expect(parseProgramPurchaseRequestResult({
      status: "found", request_id: requestId, order_id: orderId, buyer_id: buyerId,
      program_id: programId, offer_version_id: offerId, installment_count: 3, promotion_code: "ONEUSE",
    })).toMatchObject({ ok: true, request: { requestId, orderId, buyerId } });
  });

  it("requires confirmation RPC revisions to match paid and zero-total outcomes", () => {
    expect(parseProgramPurchaseConfirmRpcResult({
      status: "confirmed", order_id: orderId, billing_revision: 1,
    })).toMatchObject({ ok: true, status: "confirmed", orderId });
    expect(parseProgramPurchaseConfirmRpcResult({
      status: "confirmed", order_id: orderId, billing_revision: null,
    })).toEqual({ ok: false, reason: "invalid_response" });
    expect(parseProgramPurchaseConfirmRpcResult({
      status: "grant_created", order_id: orderId, billing_revision: null,
    })).toMatchObject({ ok: true, status: "grant_created" });
    expect(parseProgramPurchaseConfirmRpcResult({
      status: "grant_created", order_id: orderId, billing_revision: 1,
    })).toEqual({ ok: false, reason: "invalid_response" });
  });
});
