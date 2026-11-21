export type ProgramPurchasePaymentStage =
  | "free_grant"
  | "checkout_required"
  | "checkout_pending"
  | "checkout_open"
  | "checkout_retryable"
  | "payment_pending"
  | "partially_settled"
  | "settled"
  | "refunded"
  | "partially_refunded"
  | "not_started"
  | "unknown";

export type ProgramPurchaseCancellationStage =
  | "requested"
  | "completed"
  | "none"
  | "not_applicable"
  | "unknown";

export type ProgramPurchaseSafetyStage =
  | "clear"
  | "deletion_hold"
  | "financial_conflict"
  | "manual_review"
  | "unknown";

export type ProgramPurchaseHistoryItem = {
  orderId: string;
  programId: string;
  programLabel: "Program";
  createdAt: string;
  currency: "usd";
  listPriceCents: number;
  discountCents: number;
  effectiveTotalCents: number;
  paymentPlan: "free" | "pay_in_full" | "installments";
  installmentCount: number;
  installmentAmountsCents: number[];
  clearedInstallments: number;
  hasRecordedRefund: boolean;
  paymentStage: ProgramPurchasePaymentStage;
  cancellationStage: ProgramPurchaseCancellationStage;
  safetyStage: ProgramPurchaseSafetyStage;
  checkoutRetryHint: boolean;
  nextDueDate: string | null;
  retryDeadline: string | null;
};

export type ProgramPurchaseHistoryCursor = {
  createdAt: string;
  orderId: string;
};

export type ProgramPurchaseHistoryListCommand = {
  limit: number;
  cursor: ProgramPurchaseHistoryCursor | null;
  programId: string | null;
};

export type ProgramPurchaseHistoryPage = {
  items: ProgramPurchaseHistoryItem[];
  hasMore: boolean;
  nextCursor: ProgramPurchaseHistoryCursor | null;
};

export type ProgramPurchaseHistoryRead<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "invalid_request" | "unavailable" | "invalid_response" | "not_found" };

export type ExistingProgramPurchaseRead =
  | { ok: true; orderId: string | null }
  | { ok: false; reason: "invalid_request" | "unavailable" | "invalid_response" };

const MAX_CENTS = 2_147_483_647;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const PAYMENT_STAGES: readonly ProgramPurchasePaymentStage[] = [
  "free_grant", "checkout_required", "checkout_pending", "checkout_open", "checkout_retryable",
  "payment_pending", "partially_settled", "settled", "refunded", "partially_refunded", "not_started", "unknown",
];
const CANCELLATION_STAGES: readonly ProgramPurchaseCancellationStage[] = [
  "requested", "completed", "none", "not_applicable", "unknown",
];
const SAFETY_STAGES: readonly ProgramPurchaseSafetyStage[] = [
  "clear", "deletion_hold", "financial_conflict", "manual_review", "unknown",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isProgramPurchaseHistoryUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function normalizeUuid(value: unknown): string | null {
  return isProgramPurchaseHistoryUuid(value) ? value.toLowerCase() : null;
}

function safeInteger(value: unknown, minimum = 0, maximum = MAX_CENTS): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isCalendarDateParts(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1];
}

export function isProgramPurchaseHistoryDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  return match !== null && isCalendarDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function isProgramPurchaseHistoryTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const [, y, mo, d, h, mi, s, zone, , offsetHours, offsetMinutes] = match;
  const year = Number(y);
  if (!isCalendarDateParts(year, Number(mo), Number(d))) return false;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return false;
  if (zone !== "Z" && (Number(offsetHours) > 15 || Number(offsetMinutes) > 59)) return false;
  return true;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

const ITEM_KEYS = [
  "order_id", "program_id", "program_label", "created_at", "currency", "list_price_cents", "discount_cents",
  "effective_total_cents", "payment_plan", "installment_count", "installment_amounts_cents",
  "cleared_installments", "has_recorded_refund", "payment_stage", "cancellation_stage", "safety_stage",
  "checkout_retry_hint", "next_due_date", "retry_deadline",
] as const;

export function parseProgramPurchaseHistoryItem(value: unknown): ProgramPurchaseHistoryItem | null {
  if (!isRecord(value) || !exactKeys(value, ITEM_KEYS)) return null;

  const orderId = normalizeUuid(value.order_id);
  const programId = normalizeUuid(value.program_id);
  if (!orderId || !programId || value.program_label !== "Program" || value.currency !== "usd") return null;
  if (!isProgramPurchaseHistoryTimestamp(value.created_at)) return null;
  if (!safeInteger(value.list_price_cents) || !safeInteger(value.discount_cents) ||
      !safeInteger(value.effective_total_cents) || value.discount_cents > value.list_price_cents ||
      value.effective_total_cents !== value.list_price_cents - value.discount_cents) return null;
  if (!oneOf(value.payment_plan, ["free", "pay_in_full", "installments"] as const)) return null;
  if (!safeInteger(value.installment_count, 0, 12) || !Array.isArray(value.installment_amounts_cents) ||
      !value.installment_amounts_cents.every((amount) => safeInteger(amount, 50)) ||
      !safeInteger(value.cleared_installments, 0, value.installment_count)) return null;
  if (typeof value.has_recorded_refund !== "boolean" || typeof value.checkout_retry_hint !== "boolean") return null;
  if (!oneOf(value.payment_stage, PAYMENT_STAGES) || !oneOf(value.cancellation_stage, CANCELLATION_STAGES) ||
      !oneOf(value.safety_stage, SAFETY_STAGES)) return null;
  if (value.next_due_date !== null && !isProgramPurchaseHistoryDate(value.next_due_date)) return null;
  if (value.retry_deadline !== null && !isProgramPurchaseHistoryTimestamp(value.retry_deadline)) return null;

  const amounts = value.installment_amounts_cents as number[];
  const freePlan = value.payment_plan === "free";
  if (freePlan) {
    if (value.effective_total_cents !== 0 || value.installment_count !== 0 || amounts.length !== 0 ||
        value.cleared_installments !== 0) return null;
  } else if (value.effective_total_cents <= 0 || amounts.length !== value.installment_count ||
      amounts.reduce((sum, amount) => sum + amount, 0) !== value.effective_total_cents ||
      (value.payment_plan === "pay_in_full" && value.installment_count !== 1) ||
      (value.payment_plan === "installments" && (value.installment_count < 2 || value.installment_count > 12))) {
    return null;
  }

  if (value.safety_stage !== "clear" &&
      (value.payment_stage !== "unknown" || value.next_due_date !== null || value.retry_deadline !== null ||
        value.checkout_retry_hint)) return null;
  if (value.safety_stage === "clear" && value.cancellation_stage === "unknown") return null;
  if (value.safety_stage === "deletion_hold" && value.cancellation_stage !== "unknown") return null;
  if (value.checkout_retry_hint !== (value.payment_stage === "checkout_retryable")) return null;
  if (value.payment_stage === "checkout_retryable" &&
      (freePlan || value.cleared_installments !== 0 || value.cancellation_stage !== "none" || value.safety_stage !== "clear")) return null;
  if (value.payment_stage === "free_grant" &&
      (!freePlan || value.safety_stage !== "clear" || value.cancellation_stage !== "not_applicable")) return null;
  if (freePlan && value.safety_stage === "clear" &&
      (value.payment_stage !== "free_grant" || value.cancellation_stage !== "not_applicable")) return null;
  if (!freePlan && value.payment_stage === "free_grant") return null;
  if ((value.payment_stage === "refunded" || value.payment_stage === "partially_refunded") &&
      (!value.has_recorded_refund || freePlan)) return null;
  if (value.payment_stage === "refunded" && value.cleared_installments !== 0) return null;
  if (value.payment_stage === "partially_refunded" && value.cleared_installments >= value.installment_count) return null;
  if (value.payment_stage === "settled" &&
      (freePlan || value.cleared_installments !== value.installment_count || value.has_recorded_refund)) return null;
  if (value.payment_stage === "partially_settled" &&
      (freePlan || value.cleared_installments < 1 || value.cleared_installments >= value.installment_count)) return null;
  if (value.cancellation_stage === "not_applicable" && !freePlan) return null;
  if ((value.cancellation_stage === "requested" || value.cancellation_stage === "completed") &&
      (value.next_due_date !== null || value.retry_deadline !== null || value.checkout_retry_hint)) return null;
  if (value.payment_plan === "pay_in_full" && (value.next_due_date !== null || value.retry_deadline !== null)) return null;
  if (value.payment_stage === "settled" &&
      (value.next_due_date !== null || value.retry_deadline !== null || value.checkout_retry_hint)) return null;

  return {
    orderId,
    programId,
    programLabel: "Program",
    createdAt: value.created_at,
    currency: "usd",
    listPriceCents: value.list_price_cents,
    discountCents: value.discount_cents,
    effectiveTotalCents: value.effective_total_cents,
    paymentPlan: value.payment_plan,
    installmentCount: value.installment_count,
    installmentAmountsCents: [...amounts],
    clearedInstallments: value.cleared_installments,
    hasRecordedRefund: value.has_recorded_refund,
    paymentStage: value.payment_stage,
    cancellationStage: value.cancellation_stage,
    safetyStage: value.safety_stage,
    checkoutRetryHint: value.checkout_retry_hint,
    nextDueDate: value.next_due_date,
    retryDeadline: value.retry_deadline,
  };
}

export function parseProgramPurchaseHistoryListCommand(value: unknown): ProgramPurchaseHistoryListCommand | null {
  if (!isRecord(value) || !allowedKeys(value, ["limit", "cursor", "programId"]) ||
      !Object.hasOwn(value, "limit") || !safeInteger(value.limit, 1, 50)) return null;

  let cursor: ProgramPurchaseHistoryCursor | null = null;
  if (value.cursor !== undefined && value.cursor !== null) {
    if (!isRecord(value.cursor) || !exactKeys(value.cursor, ["createdAt", "orderId"]) ||
        !isProgramPurchaseHistoryTimestamp(value.cursor.createdAt)) return null;
    const orderId = normalizeUuid(value.cursor.orderId);
    if (!orderId) return null;
    cursor = { createdAt: value.cursor.createdAt, orderId };
  }

  let programId: string | null = null;
  if (value.programId !== undefined && value.programId !== null) {
    programId = normalizeUuid(value.programId);
    if (!programId) return null;
  }

  return { limit: value.limit, cursor, programId };
}

export function parseProgramPurchaseHistoryDetailCommand(value: unknown): string | null {
  return normalizeUuid(value);
}

export function parseProgramPurchaseHistoryProgramId(value: unknown): string | null {
  return normalizeUuid(value);
}

const CURSOR_KEYS = ["created_at", "order_id"] as const;

export function parseProgramPurchaseHistoryListResult(
  value: unknown,
): ProgramPurchaseHistoryRead<ProgramPurchaseHistoryPage> {
  if (!isRecord(value) || typeof value.status !== "string") return { ok: false, reason: "invalid_response" };
  if (value.status === "auth_required" && exactKeys(value, ["status"])) return { ok: false, reason: "unavailable" };
  if (value.status === "invalid_request" && exactKeys(value, ["status"])) return { ok: false, reason: "invalid_request" };
  if (value.status !== "ready" || !exactKeys(value, ["status", "items", "has_more", "next_cursor"]) ||
      !Array.isArray(value.items) || typeof value.has_more !== "boolean") return { ok: false, reason: "invalid_response" };

  const items: ProgramPurchaseHistoryItem[] = [];
  const seen = new Set<string>();
  for (const rawItem of value.items) {
    const item = parseProgramPurchaseHistoryItem(rawItem);
    if (!item || seen.has(item.orderId)) return { ok: false, reason: "invalid_response" };
    seen.add(item.orderId);
    items.push(item);
  }

  let nextCursor: ProgramPurchaseHistoryCursor | null = null;
  if (value.next_cursor !== null) {
    if (!isRecord(value.next_cursor) || !exactKeys(value.next_cursor, CURSOR_KEYS) ||
        !isProgramPurchaseHistoryTimestamp(value.next_cursor.created_at)) return { ok: false, reason: "invalid_response" };
    const orderId = normalizeUuid(value.next_cursor.order_id);
    if (!orderId) return { ok: false, reason: "invalid_response" };
    nextCursor = { createdAt: value.next_cursor.created_at, orderId };
  }
  if (value.has_more) {
    const last = items.at(-1);
    if (!last || !nextCursor || nextCursor.orderId !== last.orderId || nextCursor.createdAt !== last.createdAt) {
      return { ok: false, reason: "invalid_response" };
    }
  } else if (nextCursor !== null) {
    return { ok: false, reason: "invalid_response" };
  }

  return { ok: true, value: { items, hasMore: value.has_more, nextCursor } };
}

export function parseProgramPurchaseHistoryDetailResult(
  value: unknown,
): ProgramPurchaseHistoryRead<ProgramPurchaseHistoryItem> {
  if (!isRecord(value) || typeof value.status !== "string") return { ok: false, reason: "invalid_response" };
  if (value.status === "auth_required" && exactKeys(value, ["status"])) return { ok: false, reason: "unavailable" };
  if (value.status === "invalid_request" && exactKeys(value, ["status"])) return { ok: false, reason: "invalid_request" };
  if (value.status === "not_found" && exactKeys(value, ["status"])) return { ok: false, reason: "not_found" };
  if (value.status !== "ready" || !exactKeys(value, ["status", "item"])) return { ok: false, reason: "invalid_response" };
  const item = parseProgramPurchaseHistoryItem(value.item);
  return item ? { ok: true, value: item } : { ok: false, reason: "invalid_response" };
}
