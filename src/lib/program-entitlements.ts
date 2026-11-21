import {
  buildProgramPaymentPlan,
  isEligiblePaidProgramBuyer,
  programLessonAccess,
  type ProgramLessonAccess,
  type ProgramLessonReference,
  type ProgramPaymentPlan,
} from "./program-commerce";

export type ProgramSellerSnapshot = {
  platformOwned: boolean;
  sellerProfileId: string;
  connectedAccountId: string | null;
  applicationFeeBasisPoints: number;
};

export type ProgramOrderOffer = ProgramSellerSnapshot & {
  id: string;
  programId: string;
  contentVersionId: string;
  lessonCount: number;
  kind: "paid" | "free";
  currency: string;
  listPriceCents: number;
  maximumInstallments: number;
};

export type ProgramOrderSnapshot = ProgramSellerSnapshot & {
  orderId: string;
  idempotencyKey: string;
  buyerId: string;
  programId: string;
  offerVersionId: string;
  contentVersionId: string;
  lessonCount: number;
  currency: "usd";
  listPriceCents: number;
  discountCents: number;
  effectiveTotalCents: number;
  paymentPlan: ProgramPaymentPlan["mode"];
  installmentCount: number;
  installmentAmountsCents: number[];
  promotionId: string | null;
  zeroTotalGrantReason: "promotion_100_percent" | null;
};

export type ProgramOrderRequest = {
  orderId: string;
  idempotencyKey: string;
  buyerId: string;
  programId: string;
  offer: ProgramOrderOffer;
  discountCents: number;
  promotionId: string | null;
  installmentCount: number;
};

export type ProgramPaymentSnapshot = {
  installmentNumber: number;
  dueCents: number;
  grossSettledCents: number;
  providerRefundedCents: number;
  refundMarkerCents: number;
  currency: string;
  providerStatus: "unpaid" | "requires_payment_method" | "requires_action" | "processing" | "succeeded" | "failed" | "canceled";
};

export type ProgramOrderViewer = {
  memberId: string;
  programId: string;
  contentVersionId: string;
  role: "member" | "coach" | "moderator" | "admin";
  activeTier: "regular" | "premium" | null;
  programPublished: boolean;
  programPlatformOwned: boolean;
  programOwnerId: string;
  linkedToCoach: boolean;
  deletionLocked: boolean;
};

export type ProgramOrderLessonAccess = {
  orderId: string;
  access: ProgramLessonAccess;
};

export type SafeProgramOrderSummary = {
  orderId: string;
  programId: string;
  programTitle: string;
  paymentPlan: ProgramPaymentPlan["mode"];
  currency: "usd";
  listPriceCents: number;
  discountCents: number;
  effectiveTotalCents: number;
  installmentCount: number;
  clearedInstallments: number;
  lessonCount: number;
  fullyFunded: boolean;
  createdAt: string;
  billingState: "free_grant" | "awaiting_payment" | "partially_paid" | "paid" | "closed";
};

function nonEmpty(value: string) {
  return value.trim().length > 0;
}

export function buildProgramOrderSnapshot(input: ProgramOrderRequest): ProgramOrderSnapshot | null {
  const { offer } = input;
  if (
    !nonEmpty(input.idempotencyKey) ||
    !nonEmpty(input.orderId) ||
    !nonEmpty(input.buyerId) ||
    !nonEmpty(input.programId) ||
    !nonEmpty(offer.id) ||
    !nonEmpty(offer.programId) ||
    !nonEmpty(offer.contentVersionId) ||
    offer.kind !== "paid" ||
    offer.programId !== input.programId ||
    offer.currency.toLowerCase() !== "usd" ||
    !nonEmpty(offer.sellerProfileId) ||
    !Number.isSafeInteger(offer.maximumInstallments) ||
    offer.maximumInstallments < 1 || offer.maximumInstallments > 12
  ) {
    return null;
  }

  // The offer version is the sole source for seller and amount terms. A coach sale has a
  // destination and 10% fee snapshot; platform-owned sales never create a coach transfer.
  if (offer.platformOwned) {
    if (offer.connectedAccountId !== null || offer.applicationFeeBasisPoints !== 0) return null;
  } else if (
    !offer.connectedAccountId ||
    !/^acct_[A-Za-z0-9]+$/.test(offer.connectedAccountId) ||
    offer.applicationFeeBasisPoints !== 1_000
  ) {
    return null;
  }

  if (
    !Number.isSafeInteger(input.discountCents) ||
    input.discountCents < 0 ||
    input.discountCents > offer.listPriceCents
  ) {
    return null;
  }

  const effectiveTotalCents = offer.listPriceCents - input.discountCents;
  const zeroTotalGrantReason = effectiveTotalCents === 0 ? "promotion_100_percent" : null;
  const hasPromotion = input.promotionId !== null && nonEmpty(input.promotionId);
  if ((input.discountCents > 0 && !hasPromotion)
      || (effectiveTotalCents === 0 && !hasPromotion)
      || (input.promotionId !== null && !hasPromotion)) return null;

  const plan = buildProgramPaymentPlan({
    lessonCount: offer.lessonCount,
    listPriceCents: offer.listPriceCents,
    discount: { kind: "fixed", amountCents: input.discountCents },
    installmentCount: effectiveTotalCents === 0 ? 0 : input.installmentCount,
  });
  if (!plan.ok || input.installmentCount > offer.maximumInstallments) return null;

  return {
    orderId: input.orderId,
    idempotencyKey: input.idempotencyKey,
    buyerId: input.buyerId,
    programId: input.programId,
    offerVersionId: offer.id,
    contentVersionId: offer.contentVersionId,
    lessonCount: offer.lessonCount,
    currency: "usd",
    listPriceCents: offer.listPriceCents,
    discountCents: input.discountCents,
    effectiveTotalCents,
    paymentPlan: plan.value.mode,
    installmentCount: plan.value.installmentCount,
    installmentAmountsCents: plan.value.installmentAmountsCents,
    promotionId: input.promotionId,
    zeroTotalGrantReason,
    platformOwned: offer.platformOwned,
    sellerProfileId: offer.sellerProfileId,
    connectedAccountId: offer.connectedAccountId,
    applicationFeeBasisPoints: offer.applicationFeeBasisPoints,
  };
}

export function calculateProgramOrderLessonAccess(input: {
  orderId: string;
  order: ProgramOrderSnapshot;
  viewer: ProgramOrderViewer;
  lessons: readonly ProgramLessonReference[];
  /** Persisted by the trusted settlement/grant transaction; null means no timeline access. */
  accessStartedOn: string | null;
  easternToday: string;
  payments: readonly ProgramPaymentSnapshot[];
}): ProgramOrderLessonAccess | null {
  const { order, viewer } = input;
  if (
    order.orderId !== input.orderId ||
    !nonEmpty(input.orderId) ||
    order.buyerId !== viewer.memberId ||
    order.programId !== viewer.programId ||
    order.contentVersionId !== viewer.contentVersionId ||
    order.platformOwned !== viewer.programPlatformOwned ||
    order.sellerProfileId !== viewer.programOwnerId ||
    !input.accessStartedOn ||
    viewer.deletionLocked ||
    !isEligiblePaidProgramBuyer({
      viewerRole: viewer.role,
      activeTier: viewer.activeTier,
      offerKind: "paid",
      isPublished: viewer.programPublished,
      platformOwned: order.platformOwned,
      linkedToCoach: viewer.linkedToCoach,
    })
  ) {
    return null;
  }

  const records = new Map<number, ProgramPaymentSnapshot>();
  for (const payment of input.payments) {
    if (
      !Number.isSafeInteger(payment.installmentNumber) ||
      payment.installmentNumber < 1 ||
      payment.installmentNumber > order.installmentCount ||
      payment.currency.toLowerCase() !== order.currency ||
      records.has(payment.installmentNumber) ||
      !["unpaid", "requires_payment_method", "requires_action", "processing", "succeeded", "failed", "canceled"].includes(payment.providerStatus)
    ) {
      return null;
    }
    const expected = order.installmentAmountsCents[payment.installmentNumber - 1];
    if (payment.dueCents !== expected) return null;
    if (
      !Number.isSafeInteger(payment.grossSettledCents) ||
      !Number.isSafeInteger(payment.providerRefundedCents) ||
      !Number.isSafeInteger(payment.refundMarkerCents) ||
      payment.grossSettledCents < 0 ||
      payment.providerRefundedCents < 0 ||
      payment.refundMarkerCents < 0 ||
      payment.grossSettledCents > order.installmentAmountsCents[payment.installmentNumber - 1] ||
      payment.providerRefundedCents > payment.grossSettledCents ||
      payment.refundMarkerCents > order.installmentAmountsCents[payment.installmentNumber - 1] ||
      (payment.providerStatus === "succeeded" && payment.grossSettledCents !== payment.dueCents) ||
      (payment.providerStatus !== "succeeded" && payment.grossSettledCents !== 0)
    ) {
      return null;
    }
    records.set(payment.installmentNumber, payment);
  }

  const paymentRecords = [...records.values()].map((payment) => {
    const refunded = Math.max(payment.providerRefundedCents, payment.refundMarkerCents);
    const netSettledCents = Math.max(0, payment.grossSettledCents - refunded);
    return {
      installmentNumber: payment.installmentNumber,
      dueCents: payment.dueCents,
      netSettledCents,
      settled: payment.providerStatus === "succeeded" && payment.grossSettledCents === payment.dueCents && netSettledCents === payment.dueCents,
    };
  });

  const access = programLessonAccess({
    lessons: input.lessons,
    startedOn: input.accessStartedOn,
    easternToday: input.easternToday,
    listPriceCents: order.listPriceCents,
    discount: { kind: "fixed", amountCents: order.discountCents },
    installmentCount: order.installmentCount,
    payments: paymentRecords,
  });
  if (!access.ok) return null;

  return { orderId: input.orderId, access: access.value };
}

/** Allowlist only safe receipt fields; processor IDs and event metadata never leave this shape. */
export function toSafeProgramOrderSummary(input: SafeProgramOrderSummary): SafeProgramOrderSummary | null {
  if (
    !nonEmpty(input.orderId) || !nonEmpty(input.programId) || !nonEmpty(input.programTitle) ||
    input.currency !== "usd" || !Number.isSafeInteger(input.listPriceCents) ||
    !Number.isSafeInteger(input.discountCents) || !Number.isSafeInteger(input.effectiveTotalCents) ||
    !Number.isSafeInteger(input.installmentCount) || !Number.isSafeInteger(input.clearedInstallments) ||
    !Number.isSafeInteger(input.lessonCount) || !Number.isSafeInteger(Date.parse(input.createdAt)) ||
    input.discountCents < 0 || input.listPriceCents - input.discountCents !== input.effectiveTotalCents ||
    input.clearedInstallments < 0 || input.clearedInstallments > input.installmentCount ||
    input.lessonCount < 1 || typeof input.fullyFunded !== "boolean" ||
    !["free", "pay_in_full", "installments"].includes(input.paymentPlan) ||
    !["free_grant", "awaiting_payment", "partially_paid", "paid", "closed"].includes(input.billingState)
  ) {
    return null;
  }
  return {
    orderId: input.orderId,
    programId: input.programId,
    programTitle: input.programTitle,
    paymentPlan: input.paymentPlan,
    currency: input.currency,
    listPriceCents: input.listPriceCents,
    discountCents: input.discountCents,
    effectiveTotalCents: input.effectiveTotalCents,
    installmentCount: input.installmentCount,
    clearedInstallments: input.clearedInstallments,
    lessonCount: input.lessonCount,
    fullyFunded: input.fullyFunded,
    createdAt: input.createdAt,
    billingState: input.billingState,
  };
}
