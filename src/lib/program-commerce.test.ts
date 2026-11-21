import { describe, expect, it } from "vitest";
import {
  buildProgramPaymentPlan,
  isEligiblePaidProgramBuyer,
  calculateProgramPaidLessonCeiling,
  calculateProgramPaymentProgress,
  programLessonAccess,
  programTimelineLessonCeiling,
  quoteProgramPrice,
} from "./program-commerce";

function lessonRefs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `lesson-${index + 1}`,
    ordinal: index + 1,
    timelineDayNumber: index + 1,
  }));
}

describe("Program quote math", () => {
  it("uses integer cents and the requested fixed discount", () => {
    expect(quoteProgramPrice({ listPriceCents: 12_500, discount: { kind: "fixed", amountCents: 2_500 } })).toEqual({
      ok: true,
      value: { currency: "usd", listPriceCents: 12_500, discountCents: 2_500, effectiveTotalCents: 10_000 },
    });
  });

  it("rounds percentage discounts to the nearest cent and supports a full grant", () => {
    expect(quoteProgramPrice({ listPriceCents: 101, discount: { kind: "percent", basisPoints: 1_250 } })).toMatchObject({
      ok: true,
      value: { discountCents: 13, effectiveTotalCents: 88 },
    });
    expect(quoteProgramPrice({ listPriceCents: 8_000, discount: { kind: "percent", basisPoints: 10_000 } })).toMatchObject({
      ok: true,
      value: { discountCents: 8_000, effectiveTotalCents: 0 },
    });
  });

  it("rejects invalid money and a discount larger than the listed price", () => {
    expect(quoteProgramPrice({ listPriceCents: -1 })).toEqual({ ok: false, error: "invalid_price" });
    expect(quoteProgramPrice({ listPriceCents: 100, discount: { kind: "fixed", amountCents: 101 } })).toEqual({
      ok: false,
      error: "discount_exceeds_price",
    });
    expect(quoteProgramPrice({ listPriceCents: 100, discount: { kind: "percent", basisPoints: 10_001 } })).toEqual({
      ok: false,
      error: "invalid_discount",
    });
  });
});

describe("fixed-total Program payment plans", () => {
  it("creates a one-charge pay-in-full plan", () => {
    expect(buildProgramPaymentPlan({ lessonCount: 42, listPriceCents: 4_999, installmentCount: 1 })).toMatchObject({
      ok: true,
      value: { mode: "pay_in_full", installmentCount: 1, installmentAmountsCents: [4_999] },
    });
  });

  it("allocates equal earlier installments and puts all remainder into the last", () => {
    const result = buildProgramPaymentPlan({ lessonCount: 5, listPriceCents: 152, installmentCount: 3 });
    expect(result).toEqual({
      ok: true,
      value: {
        currency: "usd",
        listPriceCents: 152,
        discountCents: 0,
        effectiveTotalCents: 152,
        mode: "installments",
        installmentCount: 3,
        installmentAmountsCents: [50, 50, 52],
      },
    });
    if (result.ok) expect(result.value.installmentAmountsCents.reduce((sum, value) => sum + value, 0)).toBe(152);
  });

  it("enforces one-lesson and minimum-charge boundaries", () => {
    expect(buildProgramPaymentPlan({ lessonCount: 1, listPriceCents: 100, installmentCount: 2 })).toEqual({
      ok: false,
      error: "invalid_installment_count",
    });
    expect(buildProgramPaymentPlan({ lessonCount: 4, listPriceCents: 99, installmentCount: 2 })).toEqual({
      ok: false,
      error: "charge_below_minimum",
    });
    expect(buildProgramPaymentPlan({ lessonCount: 4, listPriceCents: 49, installmentCount: 1 })).toEqual({
      ok: false,
      error: "charge_below_minimum",
    });
  });

  it("caps installments at twelve and validates payment booleans strictly", () => {
    expect(buildProgramPaymentPlan({ lessonCount: 20, listPriceCents: 1_200, installmentCount: 12 })).toMatchObject({
      ok: true,
      value: { mode: "installments", installmentCount: 12 },
    });
    expect(buildProgramPaymentPlan({ lessonCount: 20, listPriceCents: 2_000, installmentCount: 13 })).toEqual({
      ok: false,
      error: "invalid_installment_count",
    });
    expect(calculateProgramPaymentProgress({
      lessonCount: 2,
      listPriceCents: 200,
      installmentCount: 2,
      payments: [{ installmentNumber: 1, dueCents: 100, netSettledCents: 100, settled: "true" as unknown as boolean }],
    })).toEqual({ ok: false, error: "invalid_payment_record" });
  });

  it("turns a zero total into a no-charge grant", () => {
    expect(buildProgramPaymentPlan({
      lessonCount: 1,
      listPriceCents: 2_000,
      installmentCount: 1,
      discount: { kind: "percent", basisPoints: 10_000 },
    })).toMatchObject({
      ok: true,
      value: { mode: "free", effectiveTotalCents: 0, installmentCount: 0, installmentAmountsCents: [] },
    });
  });
});

describe("paid lesson ordinal stages", () => {
  it("uses floor(D*k/N) and keeps the final ordinal closed until full settlement", () => {
    expect(calculateProgramPaidLessonCeiling({ lessonCount: 42, installmentCount: 3, clearedInstallments: 0 })).toEqual({ ok: true, value: 0 });
    expect(calculateProgramPaidLessonCeiling({ lessonCount: 42, installmentCount: 3, clearedInstallments: 1 })).toEqual({ ok: true, value: 14 });
    expect(calculateProgramPaidLessonCeiling({ lessonCount: 42, installmentCount: 3, clearedInstallments: 2 })).toEqual({ ok: true, value: 28 });
    expect(calculateProgramPaidLessonCeiling({ lessonCount: 42, installmentCount: 3, clearedInstallments: 3 })).toEqual({ ok: true, value: 42 });
    expect(calculateProgramPaidLessonCeiling({ lessonCount: 1, installmentCount: 2, clearedInstallments: 1 })).toEqual({ ok: false, error: "invalid_installment_count" });
  });

  it("counts only consecutive, fully settled, non-refunded installments", () => {
    const base = { lessonCount: 5, listPriceCents: 300, installmentCount: 3 };
    expect(calculateProgramPaymentProgress({
      ...base,
      payments: [
        { installmentNumber: 2, dueCents: 100, netSettledCents: 100, settled: true },
        { installmentNumber: 3, dueCents: 100, netSettledCents: 100, settled: true },
      ],
    })).toMatchObject({ ok: true, value: { clearedInstallments: 0, paidLessonCeiling: 0, fullyFunded: false } });
    expect(calculateProgramPaymentProgress({
      ...base,
      payments: [
        { installmentNumber: 1, dueCents: 100, netSettledCents: 100, settled: true },
        { installmentNumber: 2, dueCents: 100, netSettledCents: 99, settled: true },
        { installmentNumber: 3, dueCents: 100, netSettledCents: 100, settled: true },
      ],
    })).toMatchObject({ ok: true, value: { clearedInstallments: 1, paidLessonCeiling: 1, fullyFunded: false } });
  });

  it("requires the complete pay-in-full total after refunds", () => {
    expect(calculateProgramPaymentProgress({
      lessonCount: 10,
      listPriceCents: 5_000,
      installmentCount: 1,
      payments: [{ installmentNumber: 1, dueCents: 5_000, netSettledCents: 4_999, settled: true }],
    })).toMatchObject({ ok: true, value: { clearedInstallments: 0, paidLessonCeiling: 0, fullyFunded: false } });
  });

  it("fully opens a zero-total grant with no payment records", () => {
    const savedPlan = buildProgramPaymentPlan({
      lessonCount: 3,
      listPriceCents: 1_200,
      discount: { kind: "percent", basisPoints: 10_000 },
      installmentCount: 0,
    });
    expect(savedPlan).toMatchObject({ ok: true, value: { mode: "free", installmentCount: 0 } });
    if (!savedPlan.ok) throw new Error("Expected a free plan");
    expect(calculateProgramPaymentProgress({
      lessonCount: 3,
      listPriceCents: savedPlan.value.listPriceCents,
      discount: { kind: "fixed", amountCents: savedPlan.value.discountCents },
      installmentCount: savedPlan.value.installmentCount,
      payments: [],
    })).toMatchObject({ ok: true, value: { clearedInstallments: 0, paidLessonCeiling: 3, fullyFunded: true, installmentAmountsCents: [] } });
    expect(programLessonAccess({
      lessons: lessonRefs(3),
      startedOn: "2026-11-01",
      easternToday: "2026-11-03",
      listPriceCents: savedPlan.value.listPriceCents,
      discount: { kind: "fixed", amountCents: savedPlan.value.discountCents },
      installmentCount: savedPlan.value.installmentCount,
      payments: [],
    })).toMatchObject({ ok: true, value: { fullyFunded: true, lessonIds: ["lesson-1", "lesson-2", "lesson-3"] } });
  });

  it("fails closed on duplicate or mismatched payment snapshots", () => {
    const payment = { installmentNumber: 1, dueCents: 100, netSettledCents: 100, settled: true };
    expect(calculateProgramPaymentProgress({ lessonCount: 3, listPriceCents: 200, installmentCount: 2, payments: [payment, payment] })).toEqual({
      ok: false,
      error: "invalid_payment_record",
    });
    expect(calculateProgramPaymentProgress({
      lessonCount: 3,
      listPriceCents: 200,
      installmentCount: 2,
      payments: [{ ...payment, dueCents: 99 }],
    })).toEqual({ ok: false, error: "invalid_payment_record" });
  });
});

describe("Program daily and paid access gates", () => {
  it("uses date-only Eastern calendar values across DST changes", () => {
    expect(programTimelineLessonCeiling("2026-03-07", "2026-03-09")).toBe(3);
    expect(programTimelineLessonCeiling("2026-03-10", "2026-03-09")).toBe(0);
  });

  it("applies both the installment cap and the normal daily timeline", () => {
    const base = {
      lessons: lessonRefs(42),
      startedOn: "2026-11-01",
      easternToday: "2026-11-30",
      listPriceCents: 300,
      installmentCount: 3,
    };
    const firstPayment = [{ installmentNumber: 1, dueCents: 100, netSettledCents: 100, settled: true }];
    expect(programLessonAccess({ ...base, payments: firstPayment })).toMatchObject({
      ok: true,
      value: {
        timelineLessonCeiling: 30,
        paidLessonCeiling: 14,
        lessonCeiling: 14,
        lessonOrdinals: Array.from({ length: 14 }, (_, index) => index + 1),
        lessonIds: Array.from({ length: 14 }, (_, index) => `lesson-${index + 1}`),
      },
    });
    expect(programLessonAccess({ ...base, easternToday: "2026-11-01", payments: firstPayment })).toMatchObject({
      ok: true,
      value: { timelineLessonCeiling: 1, paidLessonCeiling: 14, lessonCeiling: 1, lessonOrdinals: [1], lessonIds: ["lesson-1"] },
    });
  });

  it("rejects malformed dates", () => {
    expect(programLessonAccess({
      lessons: lessonRefs(1),
      startedOn: "2026-02-30",
      easternToday: "2026-03-01",
      listPriceCents: 100,
      installmentCount: 1,
      payments: [],
    })).toEqual({ ok: false, error: "invalid_date" });
  });

  it("rejects noncontiguous or ambiguous immutable lesson references", () => {
    const base = {
      startedOn: "2026-11-01",
      easternToday: "2026-11-30",
      listPriceCents: 100,
      installmentCount: 1,
      payments: [{ installmentNumber: 1, dueCents: 100, netSettledCents: 100, settled: true }],
    };
    expect(programLessonAccess({ ...base, lessons: [{ id: "x", ordinal: 2, timelineDayNumber: 1 }] }))
      .toEqual({ ok: false, error: "invalid_lesson_count" });
    expect(programLessonAccess({
      ...base,
      lessons: [
        { id: "duplicate", ordinal: 1, timelineDayNumber: 1 },
        { id: "duplicate", ordinal: 2, timelineDayNumber: 2 },
      ],
      installmentCount: 2,
    })).toEqual({ ok: false, error: "invalid_lesson_count" });
    expect(programLessonAccess({
      ...base,
      lessons: [
        { id: "later-day", ordinal: 1, timelineDayNumber: 2 },
        { id: "earlier-day", ordinal: 2, timelineDayNumber: 1 },
        { id: "last-day", ordinal: 3, timelineDayNumber: 3 },
      ],
      installmentCount: 1,
    })).toEqual({ ok: false, error: "invalid_lesson_count" });
  });
});

describe("active membership eligibility for paid Programs", () => {
  it("requires an active tier and the published coach relationship when applicable", () => {
    expect(isEligiblePaidProgramBuyer({ viewerRole: "member", activeTier: "regular", offerKind: "paid", isPublished: true, platformOwned: true, linkedToCoach: false })).toBe(true);
    expect(isEligiblePaidProgramBuyer({ viewerRole: "member", activeTier: "premium", offerKind: "paid", isPublished: true, platformOwned: false, linkedToCoach: true })).toBe(true);
    expect(isEligiblePaidProgramBuyer({ viewerRole: "member", activeTier: "regular", offerKind: "paid", isPublished: true, platformOwned: false, linkedToCoach: false })).toBe(false);
    expect(isEligiblePaidProgramBuyer({ viewerRole: "member", activeTier: "regular", offerKind: "paid", isPublished: false, platformOwned: true, linkedToCoach: false })).toBe(false);
    expect(isEligiblePaidProgramBuyer({ viewerRole: "member", activeTier: "regular", offerKind: "free", isPublished: true, platformOwned: true, linkedToCoach: false })).toBe(false);
  });

  it("does not treat coach, moderator, or admin roles as paid-buyer entitlements", () => {
    for (const viewerRole of ["coach", "moderator", "admin"] as const) {
      expect(isEligiblePaidProgramBuyer({ viewerRole, activeTier: "premium", offerKind: "paid", isPublished: true, platformOwned: true, linkedToCoach: true })).toBe(false);
    }
  });
});
