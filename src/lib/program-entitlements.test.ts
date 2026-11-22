import { describe, expect, it } from "vitest";
import {
  buildProgramOrderSnapshot,
  calculateProgramOrderLessonAccess,
  toSafeProgramOrderSummary,
  type ProgramOrderRequest,
  type ProgramOrderSnapshot,
  type ProgramOrderViewer,
  type ProgramPaymentSnapshot,
} from "./program-entitlements";

const paidOffer: ProgramOrderRequest["offer"] = {
  id: "offer-v2",
  programId: "program-1",
  contentVersionId: "content-v2",
  lessonCount: 3,
  kind: "paid",
  currency: "usd",
  listPriceCents: 1_000,
  maximumInstallments: 3,
  platformOwned: false,
  sellerProfileId: "coach-1",
  connectedAccountId: "acct_coach1",
  applicationFeeBasisPoints: 1_000,
};

function orderRequest(overrides: Partial<ProgramOrderRequest> = {}): ProgramOrderRequest {
  return {
    orderId: "order-1",
    idempotencyKey: "request-1",
    buyerId: "member-1",
    programId: "program-1",
    offer: paidOffer,
    discountCents: 0,
    promotionId: null,
    installmentCount: 3,
    ...overrides,
  };
}

function buildOrder(overrides: Partial<ProgramOrderRequest> = {}): ProgramOrderSnapshot {
  const result = buildProgramOrderSnapshot(orderRequest(overrides));
  if (!result) throw new Error("Expected a valid Program order snapshot");
  return result;
}

function lessons(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    id: `lesson-${index + 1}`,
    ordinal: index + 1,
    timelineDayNumber: index + 1,
  }));
}

function viewer(overrides: Partial<ProgramOrderViewer> = {}): ProgramOrderViewer {
  return {
    memberId: "member-1",
    programId: "program-1",
    contentVersionId: "content-v2",
    role: "member",
    activeTier: "regular",
    programPublished: true,
    programPlatformOwned: false,
    programOwnerId: "coach-1",
    linkedToCoach: true,
    deletionLocked: false,
    ...overrides,
  };
}

function payment(
  installmentNumber: number,
  overrides: Partial<ProgramPaymentSnapshot> = {},
): ProgramPaymentSnapshot {
  const dueCents = [333, 333, 334][installmentNumber - 1];
  return {
    installmentNumber,
    dueCents,
    grossSettledCents: dueCents,
    providerRefundedCents: 0,
    refundMarkerCents: 0,
    currency: "usd",
    providerStatus: "succeeded",
    ...overrides,
  };
}

function access(input: {
  order?: ProgramOrderSnapshot;
  viewer?: ProgramOrderViewer;
  payments?: readonly ProgramPaymentSnapshot[];
  accessStartedOn?: string | null;
  easternToday?: string;
  lessonRows?: ReturnType<typeof lessons>;
}) {
  const order = input.order ?? buildOrder();
  return calculateProgramOrderLessonAccess({
    orderId: order.orderId,
    order,
    viewer: input.viewer ?? viewer(),
    lessons: input.lessonRows ?? lessons(order.lessonCount),
    accessStartedOn: input.accessStartedOn === undefined ? "2026-11-19" : input.accessStartedOn,
    easternToday: input.easternToday ?? "2026-11-19",
    payments: input.payments ?? [],
  });
}

describe("immutable Program order quote snapshots", () => {
  it("copies the exact offer, seller split and installment math", () => {
    expect(buildOrder()).toEqual({
      orderId: "order-1",
      idempotencyKey: "request-1",
      buyerId: "member-1",
      programId: "program-1",
      offerVersionId: "offer-v2",
      contentVersionId: "content-v2",
      lessonCount: 3,
      currency: "usd",
      listPriceCents: 1_000,
      discountCents: 0,
      effectiveTotalCents: 1_000,
      paymentPlan: "installments",
      installmentCount: 3,
      installmentAmountsCents: [333, 333, 334],
      promotionId: null,
      zeroTotalGrantReason: null,
      platformOwned: false,
      sellerProfileId: "coach-1",
      connectedAccountId: "acct_coach1",
      applicationFeeBasisPoints: 1_000,
    });
  });

  it("rejects mismatched ownership, fee destination, or uncapped installment requests", () => {
    expect(buildProgramOrderSnapshot(orderRequest({ programId: "other-program" }))).toBeNull();
    expect(buildOrder({ offer: { ...paidOffer, contentVersionId: "other-version" } }).contentVersionId).toBe("other-version");
    expect(buildProgramOrderSnapshot(orderRequest({ offer: { ...paidOffer, applicationFeeBasisPoints: 0 } }))).toBeNull();
    expect(buildProgramOrderSnapshot(orderRequest({ installmentCount: 4 }))).toBeNull();
    expect(buildOrder()).not.toHaveProperty("startedOn");
  });

  it("creates a fully funded zero-total order only from an explicit promotion grant", () => {
    const free = buildOrder({
      discountCents: 1_000,
      promotionId: "promo-100",
      installmentCount: 0,
    });
    expect(free).toMatchObject({
      effectiveTotalCents: 0,
      paymentPlan: "free",
      installmentCount: 0,
      installmentAmountsCents: [],
      zeroTotalGrantReason: "promotion_100_percent",
    });
    expect(access({ order: free })).toMatchObject({
      access: { fullyFunded: true, paidLessonCeiling: 3, lessonCeiling: 1, lessonIds: ["lesson-1"] },
    });
    expect(buildProgramOrderSnapshot(orderRequest({ discountCents: 1_000, installmentCount: 0 }))).toBeNull();
  });

  it("accepts partial fixed or percentage promo snapshots and rejects an unsourced discount", () => {
    expect(buildOrder({ discountCents: 100, promotionId: "promo-fixed" })).toMatchObject({
      discountCents: 100,
      effectiveTotalCents: 900,
      promotionId: "promo-fixed",
    });
    expect(buildOrder({ discountCents: 250, promotionId: "promo-percent" })).toMatchObject({
      discountCents: 250,
      effectiveTotalCents: 750,
      promotionId: "promo-percent",
    });
    expect(buildProgramOrderSnapshot(orderRequest({ discountCents: 100 }))).toBeNull();
    expect(buildProgramOrderSnapshot(orderRequest({ discountCents: 100, promotionId: " " }))).toBeNull();
  });

  it("keeps platform sales free of Connect transfer data", () => {
    const platformOffer = {
      ...paidOffer,
      platformOwned: true,
      sellerProfileId: "platform-owner",
      connectedAccountId: null,
      applicationFeeBasisPoints: 0,
    };
    expect(buildOrder({ offer: platformOffer })).toMatchObject({
      platformOwned: true,
      connectedAccountId: null,
      applicationFeeBasisPoints: 0,
    });
  });
});

describe("Program order stage and identity predicate", () => {
  it("requires the exact buyer, Program, version, active member, and coach link", () => {
    const order = buildOrder();
    const paid = [payment(1)];
    expect(access({ order, payments: paid })).toMatchObject({ access: { lessonCeiling: 1 } });
    expect(access({ order, payments: paid, viewer: viewer({ memberId: "another-member" }) })).toBeNull();
    expect(access({ order, payments: paid, viewer: viewer({ programId: "another-program" }) })).toBeNull();
    expect(access({ order, payments: paid, viewer: viewer({ contentVersionId: "another-version" }) })).toBeNull();
    expect(access({ order, payments: paid, viewer: viewer({ role: "coach" }) })).toBeNull();
    expect(access({ order, payments: paid, viewer: viewer({ activeTier: null }) })).toBeNull();
    expect(access({ order, payments: paid, viewer: viewer({ deletionLocked: true }) })).toBeNull();
    expect(access({ order, payments: paid, viewer: viewer({ programPublished: false }) })).toBeNull();
    expect(access({ order, payments: paid, viewer: viewer({ linkedToCoach: false }) })).toBeNull();
  });

  it("only clears contiguous fully paid installments and keeps the final lesson closed", () => {
    const order = buildOrder();
    expect(access({ order, payments: [payment(3)] })).toMatchObject({ access: { clearedInstallments: 0, lessonCeiling: 0 } });
    expect(access({ order, payments: [payment(1), payment(3)] })).toMatchObject({
      access: { clearedInstallments: 1, paidLessonCeiling: 1, lessonCeiling: 1, fullyFunded: false },
    });
    expect(access({ order, payments: [payment(1), payment(2), payment(3)] })).toMatchObject({
      access: { clearedInstallments: 3, paidLessonCeiling: 3, lessonCeiling: 1, fullyFunded: true },
    });
  });

  it("does not let a stale full-paid snapshot erase a refund-first marker", () => {
    const order = buildOrder();
    expect(access({
      order,
      payments: [payment(1, { providerRefundedCents: 0, refundMarkerCents: 333 })],
    })).toMatchObject({ access: { clearedInstallments: 0, lessonCeiling: 0, fullyFunded: false } });
  });

  it("combines the daily timeline with the paid stage", () => {
    const order = buildOrder();
    expect(access({ order, payments: [payment(1)], accessStartedOn: "2026-11-18", easternToday: "2026-11-19" })).toMatchObject({
      access: { paidLessonCeiling: 1, timelineLessonCeiling: 2, lessonCeiling: 1, lessonIds: ["lesson-1"] },
    });
    expect(access({ order, payments: [payment(1)], accessStartedOn: "2026-11-18", easternToday: "2026-11-18" })).toMatchObject({
      access: { paidLessonCeiling: 1, timelineLessonCeiling: 1, lessonCeiling: 1, lessonIds: ["lesson-1"] },
    });
    expect(access({ order, payments: [payment(1)], accessStartedOn: null })).toBeNull();
  });

  it("fails closed on duplicate installments, wrong currency, over-refund and malformed lesson identity", () => {
    const order = buildOrder();
    expect(access({ order, payments: [payment(1), payment(1)] })).toBeNull();
    expect(access({ order, payments: [payment(1, { currency: "eur" })] })).toBeNull();
    expect(access({ order, payments: [payment(1, { grossSettledCents: 100, refundMarkerCents: 200 })] })).toBeNull();
    expect(access({ order, payments: [payment(1)], lessonRows: [{ id: "wrong-ordinal", ordinal: 2, timelineDayNumber: 1 }] })).toBeNull();
  });
});

describe("safe Program billing summaries", () => {
  it("returns only the allowlisted receipt fields, without provider identifiers", () => {
    const raw = {
      orderId: "order-1",
      programId: "program-1",
      programTitle: "Strength plan",
      paymentPlan: "installments" as const,
      currency: "usd" as const,
      listPriceCents: 1_000,
      discountCents: 100,
      effectiveTotalCents: 900,
      installmentCount: 3,
      clearedInstallments: 1,
      lessonCount: 3,
      fullyFunded: false,
      createdAt: "2026-11-19T12:00:00.000Z",
      billingState: "partially_paid" as const,
      stripeCustomerId: "cus_private",
      checkoutSessionId: "cs_private",
      paymentIntentId: "pi_private",
    };
    const safe = toSafeProgramOrderSummary(raw);
    expect(safe).not.toBeNull();
    expect(safe).not.toHaveProperty("stripeCustomerId");
    expect(safe).not.toHaveProperty("checkoutSessionId");
    expect(safe).not.toHaveProperty("paymentIntentId");
    expect(toSafeProgramOrderSummary({ ...raw, fullyFunded: "false" as unknown as boolean })).toBeNull();
  });

  it("does not require membership eligibility to display an own-order receipt", () => {
    const summary = toSafeProgramOrderSummary({
      orderId: "order-1",
      programId: "program-1",
      programTitle: "Strength plan",
      paymentPlan: "pay_in_full",
      currency: "usd",
      listPriceCents: 500,
      discountCents: 0,
      effectiveTotalCents: 500,
      installmentCount: 1,
      clearedInstallments: 1,
      lessonCount: 1,
      fullyFunded: true,
      createdAt: "2026-11-19T12:00:00.000Z",
      billingState: "paid",
    });
    expect(summary).toMatchObject({ billingState: "paid", fullyFunded: true });
  });
});
