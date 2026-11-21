import {
  isProgramPurchaseHistoryTimestamp,
  isProgramPurchaseHistoryUuid,
  type ProgramPurchaseHistoryCursor,
  type ProgramPurchaseHistoryItem,
} from "./program-purchase-history-contracts";
import {
  formatProgramPurchaseCents,
  formatProgramPurchaseDate,
  programPurchaseCancellationLabel,
  programPurchasePaymentLabel,
} from "./program-purchase-ui-state";

export type ProgramPurchaseHistoryCursorSearch =
  | { status: "first_page" }
  | { status: "cursor"; value: ProgramPurchaseHistoryCursor }
  | { status: "invalid" };

export type ProgramPurchaseCancellationStorage = {
  version: 1;
  accountId: string;
  orderId: string;
  requestId: string;
};

export type ParsedProgramPurchaseCancellationStorage =
  | { status: "empty" }
  | { status: "valid"; value: ProgramPurchaseCancellationStorage }
  | { status: "invalid" };

const CANCELLATION_STORAGE_VERSION = 1 as const;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parseProgramPurchaseHistoryCursorSearch(
  value: Record<string, string | string[] | undefined> | undefined,
): ProgramPurchaseHistoryCursorSearch {
  if (!value || Object.keys(value).length === 0) return { status: "first_page" };
  if (!exactKeys(value, ["cursorCreatedAt", "cursorOrderId"]) ||
      typeof value.cursorCreatedAt !== "string" || typeof value.cursorOrderId !== "string" ||
      !isProgramPurchaseHistoryTimestamp(value.cursorCreatedAt) ||
      !isProgramPurchaseHistoryUuid(value.cursorOrderId)) return { status: "invalid" };
  return {
    status: "cursor",
    value: { createdAt: value.cursorCreatedAt, orderId: value.cursorOrderId.toLowerCase() },
  };
}

export function programPurchaseHistoryPageHref(cursor: ProgramPurchaseHistoryCursor): string {
  const search = new URLSearchParams({
    cursorCreatedAt: cursor.createdAt,
    cursorOrderId: cursor.orderId,
  });
  return `/program-purchases?${search.toString()}`;
}

export function programPurchaseCreatedAtLabel(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Purchase date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(parsed);
}

export function programPurchasePlanLabel(item: ProgramPurchaseHistoryItem): string {
  if (item.paymentPlan === "free") return "Free purchase";
  if (item.paymentPlan === "pay_in_full") return "One-time payment";
  return `${item.installmentCount} payments`;
}

export function programPurchaseProgressLabel(item: ProgramPurchaseHistoryItem): string {
  if (item.installmentCount === 0) return "No installment payments";
  return `${item.clearedInstallments} of ${item.installmentCount} installments cleared`;
}

export function canRequestProgramPurchaseCancellation(item: ProgramPurchaseHistoryItem): boolean {
  if (item.paymentPlan === "free" || item.safetyStage !== "clear" || item.cancellationStage !== "none") {
    return false;
  }

  const pendingStage = [
    "checkout_required",
    "checkout_pending",
    "checkout_open",
    "checkout_retryable",
    "payment_pending",
  ].includes(item.paymentStage);
  if (item.clearedInstallments >= item.installmentCount) return false;
  if (item.paymentPlan === "pay_in_full") return pendingStage;

    if (item.paymentStage === "partially_refunded") return item.nextDueDate !== null;
    return pendingStage || item.paymentStage === "partially_settled";
}

export function programPurchaseCancellationStorageKey(accountId: string, orderId: string): string {
  return `gymx2:program-cancellation:${CANCELLATION_STORAGE_VERSION}:${accountId}:${orderId}`;
}

export function parseProgramPurchaseCancellationStorage(
  raw: string | null,
  expectedAccountId: string,
  expectedOrderId: string,
): ParsedProgramPurchaseCancellationStorage {
  if (raw === null) return { status: "empty" };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { status: "invalid" };
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["version", "accountId", "orderId", "requestId"]) ||
      record.version !== CANCELLATION_STORAGE_VERSION ||
      record.accountId !== expectedAccountId || record.orderId !== expectedOrderId ||
      !isProgramPurchaseHistoryUuid(record.accountId) || !isProgramPurchaseHistoryUuid(record.orderId) ||
      !isProgramPurchaseHistoryUuid(record.requestId)) return { status: "invalid" };
  return {
    status: "valid",
    value: {
      version: CANCELLATION_STORAGE_VERSION,
      accountId: record.accountId,
      orderId: record.orderId,
      requestId: record.requestId,
    },
  };
}

export function serializeProgramPurchaseCancellationStorage(
  value: ProgramPurchaseCancellationStorage,
): string {
  return JSON.stringify(value);
}

export function programPurchaseHistoryStatusCopy(item: ProgramPurchaseHistoryItem) {
  return {
    payment: programPurchasePaymentLabel(item),
    cancellation: programPurchaseCancellationLabel(item),
    amount: formatProgramPurchaseCents(item.effectiveTotalCents),
    listPrice: formatProgramPurchaseCents(item.listPriceCents),
    plan: programPurchasePlanLabel(item),
    progress: programPurchaseProgressLabel(item),
    nextDueDate: item.nextDueDate ? formatProgramPurchaseDate(item.nextDueDate) : null,
  };
}

export function checkoutReturnNotice(value: unknown): string | null {
  if (value === "success") {
    return "You returned from checkout. The saved purchase status below is authoritative; returning here does not confirm payment.";
  }
  if (value === "cancel") {
    return "You returned from checkout. The saved purchase status below is authoritative; returning here does not cancel the purchase.";
  }
  return null;
}
