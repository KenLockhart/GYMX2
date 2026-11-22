export const PROGRAM_PURCHASE_SCHEDULE_POLICY = "monthly_calendar_eom_v1" as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROMOTION_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MAX_CENTS = 2_147_483_647;

export type ProgramPurchaseQuoteCommand = {
  programId: string;
  installmentCount: number;
  promotionCode: string | null;
};

export type ProgramPurchaseConfirmCommand = ProgramPurchaseQuoteCommand & {
  offerVersionId: string;
  requestId: string;
  quoteDigest: string;
  billingConsent: boolean;
  offSessionConsent: boolean;
};

export type ProgramPurchaseRequestCommand = { requestId: string };
export type ProgramPurchaseContextCommand = { orderId: string };

export type ProgramPurchaseQuote = {
  programId: string;
  offerVersionId: string;
  contentVersionId: string;
  lessonCount: number;
  currency: "usd";
  listPriceCents: number;
  discountCents: number;
  effectiveTotalCents: number;
  paymentPlan: "free" | "pay_in_full" | "installments";
  installmentCount: number;
  installmentAmountsCents: number[];
  maximumInstallments: number;
  promotionCode: string | null;
  quoteDate: string | null;
  chargeDates: string[];
  offSessionConsent: boolean;
  retryWindowDays: 7 | null;
  cancellationStopsFutureCharges: true;
  schedulePolicyVersion: typeof PROGRAM_PURCHASE_SCHEDULE_POLICY;
  quoteDigest: string;
};

export type ProgramPurchaseTerms = {
  digest: string;
  acceptedAt: string;
  totalCents: number;
  installmentCount: number;
  chargeDates: string[];
  offSessionConsent: boolean;
  retryWindowDays: 7 | null;
  cancellationStopsFutureCharges: true;
};

export type ProgramPurchaseContext = {
  orderId: string;
  requestId: string | null;
  buyerId: string;
  programId: string;
  offerVersionId: string;
  contentVersionId: string;
  lessonCount: number;
  currency: "usd";
  listPriceCents: number;
  discountCents: number;
  effectiveTotalCents: number;
  paymentPlan: "free" | "pay_in_full" | "installments";
  installmentCount: number;
  installmentAmountsCents: number[];
  promotionCode: string | null;
  zeroTotalGrantReason: "promotion_100_percent" | null;
  orderState: string;
  billingState: string;
  billingRevision: number;
  terms: ProgramPurchaseTerms | null;
  firstSettledAt: string | null;
  nextAnchorDate: string | null;
  cancellationRequested: boolean;
  financialConflict: boolean;
  canceled: boolean;
};

export type ProgramPurchaseRequest = {
  requestId: string;
  orderId: string;
  buyerId: string;
  programId: string;
  offerVersionId: string;
  installmentCount: number;
  promotionCode: string | null;
};

export type ProgramPurchaseRead<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found" | "unavailable" | "invalid_response" | "invalid_request" };

export type ProgramPurchaseQuoteResult =
  | { ok: true; quote: ProgramPurchaseQuote }
  | {
      ok: false;
      reason:
        | "feature_disabled"
        | "invalid_request"
        | "buyer_auth_required"
        | "buyer_ineligible"
        | "account_fenced"
        | "already_owned"
        | "promotion_unavailable"
        | "installment_invalid"
        | "charge_below_minimum"
        | "quote_unavailable"
        | "invalid_response";
    };

export type ProgramPurchaseConfirmResult =
  | { ok: true; status: "confirmed" | "already_confirmed" | "grant_created" | "already_granted"; context: ProgramPurchaseContext }
  | {
      ok: false;
      reason:
        | "feature_disabled"
        | "invalid_request"
        | "buyer_auth_required"
        | "request_conflict"
        | "quote_changed"
        | "consent_required"
        | "off_session_consent_required"
        | "terms_missing"
        | "account_fenced"
        | "buyer_ineligible"
        | "purchase_unavailable"
        | "context_unavailable"
        | "invalid_response";
    };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeProgramPromotionCode(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 128) return undefined;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  return PROMOTION_PATTERN.test(normalized) ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function safeInteger(value: unknown, minimum = 0, maximum = MAX_CENTS): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function parseDateArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(isIsoDate) ? [...value] : null;
}

function hasCanonicalInstallmentAmounts(value: unknown, totalCents: number, installmentCount: number): value is number[] {
  if (!Array.isArray(value) || !value.every((item) => safeInteger(item, 0)) || value.length !== installmentCount) return false;
  if (installmentCount === 0) return totalCents === 0;
  if (installmentCount === 1) return totalCents >= 50 && value[0] === totalCents;
  if (totalCents <= 0) return false;
  const eachAmount = Math.floor(totalCents / installmentCount);
  const lastAmount = totalCents - eachAmount * (installmentCount - 1);
  return eachAmount >= 50 && lastAmount >= 50 &&
    value.slice(0, -1).every((amount) => amount === eachAmount) && value.at(-1) === lastAmount;
}

export function parseProgramPurchaseQuoteCommand(value: unknown): ProgramPurchaseQuoteCommand | null {
  if (!isRecord(value) || !exactKeys(value, ["programId", "installmentCount", "promotionCode"])) return null;
  if (value.promotionCode !== null && typeof value.promotionCode !== "string") return null;
  const promotionCode = normalizeProgramPromotionCode(value.promotionCode);
  if (!isUuid(value.programId) || !safeInteger(value.installmentCount, 0, 12) || promotionCode === undefined) return null;
  return { programId: value.programId, installmentCount: value.installmentCount, promotionCode };
}

export function parseProgramPurchaseConfirmCommand(value: unknown): ProgramPurchaseConfirmCommand | null {
  if (!isRecord(value) || !exactKeys(value, [
    "programId", "offerVersionId", "installmentCount", "promotionCode", "requestId",
    "quoteDigest", "billingConsent", "offSessionConsent",
  ])) return null;
  if (value.promotionCode !== null && typeof value.promotionCode !== "string") return null;
  const promotionCode = normalizeProgramPromotionCode(value.promotionCode);
  if (!isUuid(value.programId) || !isUuid(value.offerVersionId) || !isUuid(value.requestId) ||
      !safeInteger(value.installmentCount, 0, 12) || promotionCode === undefined ||
      !isDigest(value.quoteDigest) || typeof value.billingConsent !== "boolean" ||
      typeof value.offSessionConsent !== "boolean") return null;
  return {
    programId: value.programId,
    offerVersionId: value.offerVersionId,
    installmentCount: value.installmentCount,
    promotionCode,
    requestId: value.requestId,
    quoteDigest: value.quoteDigest,
    billingConsent: value.billingConsent,
    offSessionConsent: value.offSessionConsent,
  };
}

export function parseProgramPurchaseRequestCommand(value: unknown): ProgramPurchaseRequestCommand | null {
  if (!isRecord(value) || !exactKeys(value, ["requestId"]) || !isUuid(value.requestId)) return null;
  return { requestId: value.requestId };
}

export function parseProgramPurchaseContextCommand(value: unknown): ProgramPurchaseContextCommand | null {
  if (!isRecord(value) || !exactKeys(value, ["orderId"]) || !isUuid(value.orderId)) return null;
  return { orderId: value.orderId };
}

export function expectedProgramPurchaseChargeDates(quoteDate: string, installmentCount: number): string[] | null {
  if (!isIsoDate(quoteDate) || !Number.isInteger(installmentCount) || installmentCount < 2 || installmentCount > 12) return null;
  const [year, month, day] = quoteDate.split("-").map(Number);
  const firstMonth = month; // UTC month is zero-based and adding one calendar month is this index.
  const firstLastDay = new Date(Date.UTC(year, firstMonth + 1, 0)).getUTCDate();
  const firstDay = Math.min(day, firstLastDay);
  const first = new Date(Date.UTC(year, firstMonth, firstDay));
  const anchorDay = first.getUTCDate();
  const anchorIsEndOfMonth = anchorDay === new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const dates: string[] = [];
  for (let offset = 0; offset < installmentCount - 1; offset += 1) {
    const targetMonth = first.getUTCMonth() + offset;
    const targetYear = first.getUTCFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = targetMonth % 12;
    const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
    const targetDay = anchorIsEndOfMonth ? lastDay : Math.min(anchorDay, lastDay);
    dates.push(new Date(Date.UTC(targetYear, normalizedMonth, targetDay)).toISOString().slice(0, 10));
  }
  return dates;
}

function parseQuote(value: Record<string, unknown>): ProgramPurchaseQuote | null {
  const keys = [
    "status", "program_id", "offer_version_id", "content_version_id", "lesson_count", "currency",
    "list_price_cents", "discount_cents", "effective_total_cents", "payment_plan", "installment_count",
    "installment_amounts_cents", "maximum_installments", "promotion_code", "quote_date", "charge_dates",
    "off_session_consent", "retry_window_days", "cancellation_stops_future_charges",
    "schedule_policy_version", "quote_digest",
  ];
  if (!exactKeys(value, keys) || value.status !== "ready" || !isUuid(value.program_id) ||
      !isUuid(value.offer_version_id) || !isUuid(value.content_version_id) ||
      !safeInteger(value.lesson_count, 1, 365) || value.currency !== "usd" ||
      !safeInteger(value.list_price_cents, 50) || !safeInteger(value.discount_cents) ||
      !safeInteger(value.effective_total_cents) ||
      value.discount_cents > value.list_price_cents ||
      value.effective_total_cents !== value.list_price_cents - value.discount_cents ||
      !["free", "pay_in_full", "installments"].includes(String(value.payment_plan)) ||
      !safeInteger(value.installment_count, 0, 12) ||
      !safeInteger(value.maximum_installments, 1, Math.min(12, value.lesson_count)) ||
      !(value.promotion_code === null || (typeof value.promotion_code === "string" && PROMOTION_PATTERN.test(value.promotion_code))) ||
      !(value.quote_date === null || isIsoDate(value.quote_date)) ||
      typeof value.off_session_consent !== "boolean" ||
      !(value.retry_window_days === null || value.retry_window_days === 7) ||
      value.cancellation_stops_future_charges !== true ||
      value.schedule_policy_version !== PROGRAM_PURCHASE_SCHEDULE_POLICY || !isDigest(value.quote_digest)) return null;

  const installmentAmountsCents = hasCanonicalInstallmentAmounts(
    value.installment_amounts_cents,value.effective_total_cents,value.installment_count,
  ) ? [...value.installment_amounts_cents] : null;
  const chargeDates = parseDateArray(value.charge_dates);
  if (!installmentAmountsCents || !chargeDates ||
      installmentAmountsCents.reduce((sum, amount) => sum + amount, 0) !== value.effective_total_cents ||
      chargeDates.length !== Math.max(0, value.installment_count - 1)) return null;

  if (value.payment_plan === "free") {
    if (value.effective_total_cents !== 0 || value.installment_count !== 0 ||
        installmentAmountsCents.length !== 0 || value.promotion_code === null ||
        value.quote_date !== null || value.off_session_consent || value.retry_window_days !== null) return null;
  } else if (value.payment_plan === "pay_in_full") {
    if (value.effective_total_cents < 50 || value.installment_count !== 1 ||
        installmentAmountsCents.length !== 1 || value.quote_date !== null ||
        value.off_session_consent || value.retry_window_days !== null) return null;
  } else if (value.installment_count < 2 || value.installment_count > value.maximum_installments ||
      value.effective_total_cents < 50 || installmentAmountsCents.some((amount) => amount < 50) ||
      value.quote_date === null || !value.off_session_consent || value.retry_window_days !== 7 ||
      JSON.stringify(chargeDates) !== JSON.stringify(expectedProgramPurchaseChargeDates(value.quote_date, value.installment_count))) return null;

  return {
    programId: value.program_id,
    offerVersionId: value.offer_version_id,
    contentVersionId: value.content_version_id,
    lessonCount: value.lesson_count,
    currency: "usd",
    listPriceCents: value.list_price_cents,
    discountCents: value.discount_cents,
    effectiveTotalCents: value.effective_total_cents,
    paymentPlan: value.payment_plan as ProgramPurchaseQuote["paymentPlan"],
    installmentCount: value.installment_count,
    installmentAmountsCents,
    maximumInstallments: value.maximum_installments,
    promotionCode: value.promotion_code,
    quoteDate: value.quote_date,
    chargeDates,
    offSessionConsent: value.off_session_consent,
    retryWindowDays: value.retry_window_days,
    cancellationStopsFutureCharges: true,
    schedulePolicyVersion: PROGRAM_PURCHASE_SCHEDULE_POLICY,
    quoteDigest: value.quote_digest,
  };
}

const QUOTE_FAILURES = new Set([
  "invalid_request", "buyer_ineligible", "account_fenced", "already_owned",
  "promotion_unavailable", "installment_invalid", "charge_below_minimum", "not_available",
]);

export function parseProgramPurchaseQuoteResult(value: unknown):
  | { ok: true; quote: ProgramPurchaseQuote }
  | { ok: false; reason: string } {
  if (!isRecord(value) || typeof value.status !== "string") return { ok: false, reason: "invalid_response" };
  const quote = parseQuote(value);
  if (quote) return { ok: true, quote };
  return exactKeys(value, ["status"]) && QUOTE_FAILURES.has(value.status)
    ? { ok: false, reason: value.status }
    : { ok: false, reason: "invalid_response" };
}

function parseTerms(value: unknown, orderTotal: number, installmentCount: number): ProgramPurchaseTerms | null {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, [
    "digest", "accepted_at", "total_cents", "installment_count", "disclosed_charge_dates",
    "saved_card_for_off_session", "retry_window_days", "cancellation_stops_future_charges",
  ]) || !isDigest(value.digest) || !isIsoTimestamp(value.accepted_at) ||
      !safeInteger(value.total_cents, 0) || value.total_cents !== orderTotal ||
      !safeInteger(value.installment_count, 0, 12) || value.installment_count !== installmentCount ||
      typeof value.saved_card_for_off_session !== "boolean" ||
      !(value.retry_window_days === null || value.retry_window_days === 7) ||
      value.cancellation_stops_future_charges !== true) return null;
  const chargeDates = parseDateArray(value.disclosed_charge_dates);
  const needsOffSessionConsent = installmentCount > 1;
  if (!chargeDates || chargeDates.length !== Math.max(0, installmentCount - 1) ||
      value.saved_card_for_off_session !== needsOffSessionConsent ||
      value.retry_window_days !== (needsOffSessionConsent ? 7 : null)) return null;
  return {
    digest: value.digest,
    acceptedAt: value.accepted_at,
    totalCents: value.total_cents,
    installmentCount: value.installment_count,
    chargeDates,
    offSessionConsent: value.saved_card_for_off_session,
    retryWindowDays: value.retry_window_days,
    cancellationStopsFutureCharges: true,
  };
}

export function parseProgramPurchaseContextResult(value: unknown):
  | { ok: true; context: ProgramPurchaseContext }
  | { ok: false; reason: string } {
  if (!isRecord(value) || typeof value.status !== "string") return { ok: false, reason: "invalid_response" };
  if (value.status === "not_found") return exactKeys(value, ["status"])
    ? { ok: false, reason: "not_found" } : { ok: false, reason: "invalid_response" };
  const keys = [
    "status", "order_id", "request_id", "buyer_id", "program_id", "offer_version_id", "content_version_id",
    "lesson_count", "currency", "list_price_cents", "discount_cents", "effective_total_cents", "payment_plan",
    "installment_count", "installment_amounts_cents", "promotion_code", "zero_total_grant_reason",
    "order_state", "billing_state", "billing_revision", "terms", "first_settled_at", "next_anchor_date",
    "cancellation_requested", "financial_conflict", "canceled",
  ];
  if (!exactKeys(value, keys) || value.status !== "ready" || !isUuid(value.order_id) ||
      !(value.request_id === null || isUuid(value.request_id)) || !isUuid(value.buyer_id) ||
      !isUuid(value.program_id) || !isUuid(value.offer_version_id) || !isUuid(value.content_version_id) ||
      !safeInteger(value.lesson_count, 1, 365) || value.currency !== "usd" ||
      !safeInteger(value.list_price_cents, 50) || !safeInteger(value.discount_cents) ||
      !safeInteger(value.effective_total_cents) || value.discount_cents > value.list_price_cents ||
      value.effective_total_cents !== value.list_price_cents - value.discount_cents ||
      !["free", "pay_in_full", "installments"].includes(String(value.payment_plan)) ||
      !safeInteger(value.installment_count, 0, 12) ||
      !hasCanonicalInstallmentAmounts(value.installment_amounts_cents,value.effective_total_cents,value.installment_count) ||
      value.installment_amounts_cents.reduce((sum: number, amount: number) => sum + amount, 0) !== value.effective_total_cents ||
      !(value.promotion_code === null || (typeof value.promotion_code === "string" && PROMOTION_PATTERN.test(value.promotion_code))) ||
      !(value.zero_total_grant_reason === null || value.zero_total_grant_reason === "promotion_100_percent") ||
      typeof value.order_state !== "string" || value.order_state.length === 0 ||
      typeof value.billing_state !== "string" || value.billing_state.length === 0 ||
      !safeInteger(value.billing_revision, 0) ||
      !(value.first_settled_at === null || isIsoTimestamp(value.first_settled_at)) ||
      !(value.next_anchor_date === null || isIsoDate(value.next_anchor_date)) ||
      typeof value.cancellation_requested !== "boolean" || typeof value.financial_conflict !== "boolean" ||
      typeof value.canceled !== "boolean") return { ok: false, reason: "invalid_response" };
  const terms = parseTerms(value.terms, value.effective_total_cents, value.installment_count);
  if (value.terms !== null && terms === null) return { ok: false, reason: "invalid_response" };
  if ((value.terms === null) !== (value.billing_revision === 0)) return { ok: false, reason: "invalid_response" };
  if (value.payment_plan === "free" && (value.effective_total_cents !== 0 || value.installment_count !== 0 ||
      value.zero_total_grant_reason !== "promotion_100_percent" || terms !== null)) return { ok: false, reason: "invalid_response" };
  if (value.payment_plan === "pay_in_full" && (value.installment_count !== 1 || value.effective_total_cents < 50)) {
    return { ok: false, reason: "invalid_response" };
  }
  if (value.payment_plan === "installments" && (value.installment_count < 2 || value.effective_total_cents < 50 ||
      value.installment_amounts_cents.some((amount: number) => amount < 50))) {
    return { ok: false, reason: "invalid_response" };
  }
  return {
    ok: true,
    context: {
      orderId: value.order_id,
      requestId: value.request_id,
      buyerId: value.buyer_id,
      programId: value.program_id,
      offerVersionId: value.offer_version_id,
      contentVersionId: value.content_version_id,
      lessonCount: value.lesson_count,
      currency: "usd",
      listPriceCents: value.list_price_cents,
      discountCents: value.discount_cents,
      effectiveTotalCents: value.effective_total_cents,
      paymentPlan: value.payment_plan as ProgramPurchaseContext["paymentPlan"],
      installmentCount: value.installment_count,
      installmentAmountsCents: [...value.installment_amounts_cents] as number[],
      promotionCode: value.promotion_code,
      zeroTotalGrantReason: value.zero_total_grant_reason,
      orderState: value.order_state,
      billingState: value.billing_state,
      billingRevision: value.billing_revision,
      terms,
      firstSettledAt: value.first_settled_at,
      nextAnchorDate: value.next_anchor_date,
      cancellationRequested: value.cancellation_requested,
      financialConflict: value.financial_conflict,
      canceled: value.canceled,
    },
  };
}

export function parseProgramPurchaseRequestResult(value: unknown):
  | { ok: true; request: ProgramPurchaseRequest }
  | { ok: false; reason: string } {
  if (!isRecord(value) || typeof value.status !== "string") return { ok: false, reason: "invalid_response" };
  if (value.status === "not_found") return exactKeys(value, ["status"])
    ? { ok: false, reason: "not_found" } : { ok: false, reason: "invalid_response" };
  const keys = ["status", "request_id", "order_id", "buyer_id", "program_id", "offer_version_id", "installment_count", "promotion_code"];
  if (!exactKeys(value, keys) || value.status !== "found" || !isUuid(value.request_id) || !isUuid(value.order_id) ||
      !isUuid(value.buyer_id) || !isUuid(value.program_id) || !isUuid(value.offer_version_id) ||
      !safeInteger(value.installment_count, 0, 12) ||
      !(value.promotion_code === null || (typeof value.promotion_code === "string" && PROMOTION_PATTERN.test(value.promotion_code)))) {
    return { ok: false, reason: "invalid_response" };
  }
  return {
    ok: true,
    request: {
      requestId: value.request_id,
      orderId: value.order_id,
      buyerId: value.buyer_id,
      programId: value.program_id,
      offerVersionId: value.offer_version_id,
      installmentCount: value.installment_count,
      promotionCode: value.promotion_code,
    },
  };
}

export function sameProgramPurchasePayload(
  request: ProgramPurchaseRequest,
  command: ProgramPurchaseConfirmCommand,
) {
  return request.requestId === command.requestId && request.programId === command.programId &&
    request.offerVersionId === command.offerVersionId && request.installmentCount === command.installmentCount &&
    request.promotionCode === command.promotionCode;
}

export function parseProgramPurchaseConfirmRpcResult(value: unknown):
  | { ok: true; status: "confirmed" | "already_confirmed" | "grant_created" | "already_granted"; orderId: string }
  | { ok: false; reason: string } {
  if (!isRecord(value) || typeof value.status !== "string") return { ok: false, reason: "invalid_response" };
  const success = new Set(["confirmed", "already_confirmed", "grant_created", "already_granted"]);
  const failures = new Set([
    "quote_changed", "consent_required", "off_session_consent_required", "terms_missing",
    "request_conflict", "account_fenced", "buyer_ineligible", "purchase_unavailable", "invalid_request",
  ]);
  if (success.has(value.status)) {
    if (!exactKeys(value, ["status", "order_id", "billing_revision"]) || !isUuid(value.order_id) ||
        !(value.billing_revision === null || safeInteger(value.billing_revision, 0))) return { ok: false, reason: "invalid_response" };
    if ((value.status === "confirmed" || value.status === "already_confirmed") &&
        !safeInteger(value.billing_revision,1)) return { ok: false, reason: "invalid_response" };
    if ((value.status === "grant_created" || value.status === "already_granted") && value.billing_revision !== null) {
      return { ok: false, reason: "invalid_response" };
    }
    return { ok: true, status: value.status as "confirmed" | "already_confirmed" | "grant_created" | "already_granted", orderId: value.order_id };
  }
  if (failures.has(value.status) && exactKeys(value, ["status"])) return { ok: false, reason: value.status };
  return { ok: false, reason: "invalid_response" };
}
