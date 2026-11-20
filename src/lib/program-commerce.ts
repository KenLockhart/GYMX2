export const PROGRAM_CURRENCY = "usd" as const;
export const PROGRAM_MIN_CHARGE_CENTS = 50;
export const PROGRAM_MAX_LESSONS = 365;
export const PROGRAM_MAX_INSTALLMENTS = 12;
export const PROGRAM_MAX_PRICE_CENTS = 2_147_483_647;

export type ProgramDiscount =
  | { kind: "none" }
  | { kind: "fixed"; amountCents: number }
  | { kind: "percent"; basisPoints: number };

export type ProgramCommerceError =
  | "invalid_lesson_count"
  | "invalid_price"
  | "invalid_discount"
  | "discount_exceeds_price"
  | "invalid_installment_count"
  | "charge_below_minimum"
  | "invalid_payment_record"
  | "invalid_date";

export type ProgramResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProgramCommerceError };

export type ProgramPriceQuote = {
  currency: typeof PROGRAM_CURRENCY;
  listPriceCents: number;
  discountCents: number;
  effectiveTotalCents: number;
};

export type ProgramPaymentPlan = ProgramPriceQuote & {
  mode: "free" | "pay_in_full" | "installments";
  installmentCount: number;
  installmentAmountsCents: number[];
};

export type ProgramPaymentRecord = {
  installmentNumber: number;
  dueCents: number;
  netSettledCents: number;
  settled: boolean;
};

export type ProgramPaymentProgress = {
  clearedInstallments: number;
  fullyFunded: boolean;
  paidLessonCeiling: number;
  installmentAmountsCents: number[];
};

export type ProgramLessonReference = {
  id: string;
  ordinal: number;
  timelineDayNumber: number;
};

export type ProgramLessonAccess = ProgramPaymentProgress & {
  timelineDayCeiling: number;
  timelineLessonCeiling: number;
  lessonCeiling: number;
  lessonOrdinals: number[];
  lessonIds: string[];
};

function isIntegerInRange(value: number, min: number, max: number) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function validLessonCount(value: number) {
  return isIntegerInRange(value, 1, PROGRAM_MAX_LESSONS);
}

function validPrice(value: number) {
  return isIntegerInRange(value, 0, PROGRAM_MAX_PRICE_CENTS);
}

export function quoteProgramPrice(input: {
  listPriceCents: number;
  discount?: ProgramDiscount;
}): ProgramResult<ProgramPriceQuote> {
  const { listPriceCents, discount = { kind: "none" } } = input;
  if (!validPrice(listPriceCents)) return { ok: false, error: "invalid_price" };

  let discountCents = 0;
  if (discount.kind === "fixed") {
    if (!validPrice(discount.amountCents)) {
      return { ok: false, error: "invalid_discount" };
    }
    if (discount.amountCents > listPriceCents) {
      return { ok: false, error: "discount_exceeds_price" };
    }
    discountCents = discount.amountCents;
  } else if (discount.kind === "percent") {
    if (!isIntegerInRange(discount.basisPoints, 0, 10_000)) {
      return { ok: false, error: "invalid_discount" };
    }
    discountCents = Math.round((listPriceCents * discount.basisPoints) / 10_000);
  } else if (discount.kind !== "none") {
    return { ok: false, error: "invalid_discount" };
  }

  return {
    ok: true,
    value: {
      currency: PROGRAM_CURRENCY,
      listPriceCents,
      discountCents,
      effectiveTotalCents: listPriceCents - discountCents,
    },
  };
}

export function buildProgramPaymentPlan(input: {
  lessonCount: number;
  listPriceCents: number;
  discount?: ProgramDiscount;
  installmentCount: number;
  minimumChargeCents?: number;
}): ProgramResult<ProgramPaymentPlan> {
  const { lessonCount, installmentCount, minimumChargeCents = PROGRAM_MIN_CHARGE_CENTS } = input;
  if (!validLessonCount(lessonCount)) return { ok: false, error: "invalid_lesson_count" };
  if (!isIntegerInRange(minimumChargeCents, 1, PROGRAM_MAX_PRICE_CENTS)) {
    return { ok: false, error: "invalid_price" };
  }

  const quote = quoteProgramPrice(input);
  if (!quote.ok) return quote;
  const { value } = quote;

  if (value.effectiveTotalCents === 0) {
    if (installmentCount !== 0 && !isIntegerInRange(installmentCount, 1, Math.min(lessonCount, PROGRAM_MAX_INSTALLMENTS))) {
      return { ok: false, error: "invalid_installment_count" };
    }
    return {
      ok: true,
      value: { ...value, mode: "free", installmentCount: 0, installmentAmountsCents: [] },
    };
  }

  if (!isIntegerInRange(installmentCount, 1, Math.min(lessonCount, PROGRAM_MAX_INSTALLMENTS))) {
    return { ok: false, error: "invalid_installment_count" };
  }

  if (installmentCount === 1) {
    if (value.effectiveTotalCents < minimumChargeCents) {
      return { ok: false, error: "charge_below_minimum" };
    }
    return {
      ok: true,
      value: {
        ...value,
        mode: "pay_in_full",
        installmentCount: 1,
        installmentAmountsCents: [value.effectiveTotalCents],
      },
    };
  }

  if (installmentCount < 2 || installmentCount > Math.min(lessonCount, PROGRAM_MAX_INSTALLMENTS)) {
    return { ok: false, error: "invalid_installment_count" };
  }
  const firstAmount = Math.floor(value.effectiveTotalCents / installmentCount);
  const amounts = Array.from({ length: installmentCount }, (_, index) =>
    index === installmentCount - 1
      ? value.effectiveTotalCents - firstAmount * (installmentCount - 1)
      : firstAmount,
  );
  if (amounts.some((amount) => amount < minimumChargeCents)) {
    return { ok: false, error: "charge_below_minimum" };
  }
  return {
    ok: true,
    value: {
      ...value,
      mode: "installments",
      installmentCount,
      installmentAmountsCents: amounts,
    },
  };
}

export function calculateProgramPaidLessonCeiling(input: {
  lessonCount: number;
  installmentCount: number;
  clearedInstallments: number;
}): ProgramResult<number> {
  const { lessonCount, installmentCount, clearedInstallments } = input;
  if (!validLessonCount(lessonCount)) return { ok: false, error: "invalid_lesson_count" };
  if (!isIntegerInRange(installmentCount, 1, Math.min(lessonCount, PROGRAM_MAX_INSTALLMENTS))) {
    return { ok: false, error: "invalid_installment_count" };
  }
  if (!isIntegerInRange(clearedInstallments, 0, installmentCount)) {
    return { ok: false, error: "invalid_payment_record" };
  }
  if (clearedInstallments === installmentCount) {
    return { ok: true, value: lessonCount };
  }
  if (installmentCount === 1 || clearedInstallments === 0) {
    return { ok: true, value: 0 };
  }
  return {
    ok: true,
    value: Math.floor((lessonCount * clearedInstallments) / installmentCount),
  };
}

export function calculateProgramPaymentProgress(input: {
  lessonCount: number;
  listPriceCents: number;
  discount?: ProgramDiscount;
  installmentCount: number;
  payments: readonly ProgramPaymentRecord[];
}): ProgramResult<ProgramPaymentProgress> {
  const plan = buildProgramPaymentPlan(input);
  if (!plan.ok) return plan;
  const expected = plan.value.installmentAmountsCents;
  const byNumber = new Map<number, ProgramPaymentRecord>();
  for (const payment of input.payments) {
    if (
      !isIntegerInRange(payment.installmentNumber, 1, Math.max(1, expected.length)) ||
      !validPrice(payment.dueCents) ||
      !validPrice(payment.netSettledCents) ||
      typeof payment.settled !== "boolean" ||
      byNumber.has(payment.installmentNumber)
    ) {
      return { ok: false, error: "invalid_payment_record" };
    }
    if (payment.dueCents !== expected[payment.installmentNumber - 1]) {
      return { ok: false, error: "invalid_payment_record" };
    }
    byNumber.set(payment.installmentNumber, payment);
  }

  let clearedInstallments = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const payment = byNumber.get(index + 1);
    if (!payment?.settled || payment.netSettledCents < expected[index]) break;
    clearedInstallments += 1;
  }

  const fullyFunded = plan.value.mode === "free" || clearedInstallments === expected.length;
  const ceiling = plan.value.mode === "free"
    ? { ok: true as const, value: input.lessonCount }
    : calculateProgramPaidLessonCeiling({
        lessonCount: input.lessonCount,
        installmentCount: plan.value.installmentCount,
        clearedInstallments,
      });
  if (!ceiling.ok) return ceiling;
  return {
    ok: true,
    value: {
      clearedInstallments,
      fullyFunded,
      paidLessonCeiling: ceiling.value,
      installmentAmountsCents: expected,
    },
  };
}

function parseIsoDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.floor(timestamp / 86_400_000);
}

export function programTimelineLessonCeiling(startedOn: string, easternToday: string) {
  const start = parseIsoDate(startedOn);
  const today = parseIsoDate(easternToday);
  if (start === null || today === null) return 0;
  return Math.max(0, today - start + 1);
}

export function programLessonAccess(input: {
  lessons: readonly ProgramLessonReference[];
  startedOn: string;
  easternToday: string;
  listPriceCents: number;
  discount?: ProgramDiscount;
  installmentCount: number;
  payments: readonly ProgramPaymentRecord[];
}): ProgramResult<ProgramLessonAccess> {
  if (parseIsoDate(input.startedOn) === null || parseIsoDate(input.easternToday) === null) {
    return { ok: false, error: "invalid_date" };
  }
  const lessons = [...input.lessons].sort((a, b) => a.ordinal - b.ordinal);
  if (!validLessonCount(lessons.length)) return { ok: false, error: "invalid_lesson_count" };
  const ids = new Set<string>();
  let previousTimelineDay = 0;
  for (const [index, lesson] of lessons.entries()) {
    if (
      lesson.ordinal !== index + 1 ||
      typeof lesson.id !== "string" || lesson.id.trim().length === 0 ||
      ids.has(lesson.id) ||
      !isIntegerInRange(lesson.timelineDayNumber, 1, PROGRAM_MAX_LESSONS) ||
      lesson.timelineDayNumber <= previousTimelineDay
    ) {
      return { ok: false, error: "invalid_lesson_count" };
    }
    ids.add(lesson.id);
    previousTimelineDay = lesson.timelineDayNumber;
  }

  const progress = calculateProgramPaymentProgress({ ...input, lessonCount: lessons.length });
  if (!progress.ok) return progress;
  const timelineDayCeiling = programTimelineLessonCeiling(input.startedOn, input.easternToday);
  const timelineLessons = lessons.filter((lesson) => lesson.timelineDayNumber <= timelineDayCeiling);
  const timelineLessonCeiling = timelineLessons.at(-1)?.ordinal ?? 0;
  const lessonCeiling = Math.min(progress.value.paidLessonCeiling, timelineLessonCeiling);
  const accessibleLessons = lessons.filter(
    (lesson) => lesson.ordinal <= lessonCeiling && lesson.timelineDayNumber <= timelineDayCeiling,
  );
  return {
    ok: true,
    value: {
      ...progress.value,
      timelineDayCeiling,
      timelineLessonCeiling,
      lessonCeiling,
      lessonOrdinals: accessibleLessons.map((lesson) => lesson.ordinal),
      lessonIds: accessibleLessons.map((lesson) => lesson.id),
    },
  };
}

export function isEligiblePaidProgramBuyer(input: {
  viewerRole: "member" | "coach" | "moderator" | "admin";
  activeTier: "regular" | "premium" | null;
  offerKind: "free" | "paid";
  isPublished: boolean;
  platformOwned: boolean;
  linkedToCoach: boolean;
}) {
  return Boolean(
    input.viewerRole === "member" &&
      input.activeTier &&
      input.offerKind === "paid" &&
      input.isPublished &&
      (input.platformOwned || input.linkedToCoach),
  );
}
