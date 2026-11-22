import {
  normalizeProgramPromotionCode,
  parseProgramPurchaseConfirmCommand,
  type ProgramPurchaseConfirmCommand,
  type ProgramPurchaseQuote,
  type ProgramPurchaseRequest,
} from "./program-purchase-contracts";
import type { ProgramPurchaseHistoryItem } from "./program-purchase-history-contracts";

export const PROGRAM_PURCHASE_UI_STORAGE_VERSION = 1 as const;

export type ProgramPurchaseCheckoutRetryIntent = {
  orderId: string;
  requestId: string;
};

export type ProgramPurchaseUiStorage = {
  version: typeof PROGRAM_PURCHASE_UI_STORAGE_VERSION;
  buyerId: string;
  programId: string;
  confirmation: ProgramPurchaseConfirmCommand | null;
  checkoutRetry: ProgramPurchaseCheckoutRetryIntent | null;
};

export type ParsedProgramPurchaseUiStorage =
  | { status: "empty"; value: ProgramPurchaseUiStorage }
  | { status: "valid"; value: ProgramPurchaseUiStorage }
  | { status: "invalid" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function programPurchaseUiStorageKey(buyerId: string, programId: string): string {
  return `gymx2:program-purchase:${PROGRAM_PURCHASE_UI_STORAGE_VERSION}:${buyerId}:${programId}`;
}

export function emptyProgramPurchaseUiStorage(buyerId: string, programId: string): ProgramPurchaseUiStorage {
  return {
    version: PROGRAM_PURCHASE_UI_STORAGE_VERSION,
    buyerId,
    programId,
    confirmation: null,
    checkoutRetry: null,
  };
}

export function parseProgramPurchaseUiStorage(
  raw: string | null,
  expectedBuyerId: string,
  expectedProgramId: string,
): ParsedProgramPurchaseUiStorage {
  const empty = emptyProgramPurchaseUiStorage(expectedBuyerId, expectedProgramId);
  if (raw === null) return { status: "empty", value: empty };

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }
  if (!isRecord(decoded) || !exactKeys(decoded, ["version", "buyerId", "programId", "confirmation", "checkoutRetry"]) ||
      decoded.version !== PROGRAM_PURCHASE_UI_STORAGE_VERSION ||
      decoded.buyerId !== expectedBuyerId || decoded.programId !== expectedProgramId) return { status: "invalid" };

  let confirmation: ProgramPurchaseConfirmCommand | null = null;
  if (decoded.confirmation !== null) {
    confirmation = parseProgramPurchaseConfirmCommand(decoded.confirmation);
    if (!confirmation || confirmation.programId !== expectedProgramId) return { status: "invalid" };
  }

  let checkoutRetry: ProgramPurchaseCheckoutRetryIntent | null = null;
  if (decoded.checkoutRetry !== null) {
    if (!isRecord(decoded.checkoutRetry) || !exactKeys(decoded.checkoutRetry, ["orderId", "requestId"]) ||
        !isUuid(decoded.checkoutRetry.orderId) || !isUuid(decoded.checkoutRetry.requestId)) return { status: "invalid" };
    checkoutRetry = { orderId: decoded.checkoutRetry.orderId, requestId: decoded.checkoutRetry.requestId };
  }

  return {
    status: "valid",
    value: {
      version: PROGRAM_PURCHASE_UI_STORAGE_VERSION,
      buyerId: expectedBuyerId,
      programId: expectedProgramId,
      confirmation,
      checkoutRetry,
    },
  };
}

export function serializeProgramPurchaseUiStorage(value: ProgramPurchaseUiStorage): string {
  return JSON.stringify(value);
}

export function programPurchaseCommandMatchesRequest(
  command: ProgramPurchaseConfirmCommand,
  request: ProgramPurchaseRequest,
): boolean {
  return command.requestId === request.requestId &&
    command.programId === request.programId &&
    command.offerVersionId === request.offerVersionId &&
    command.installmentCount === request.installmentCount &&
    command.promotionCode === request.promotionCode;
}

export function programPurchaseCommandMatchesQuote(
  command: ProgramPurchaseConfirmCommand,
  quote: ProgramPurchaseQuote,
): boolean {
  return command.programId === quote.programId &&
    command.offerVersionId === quote.offerVersionId &&
    command.installmentCount === quote.installmentCount &&
    command.promotionCode === quote.promotionCode &&
    command.quoteDigest === quote.quoteDigest;
}

export function makeProgramPurchaseConfirmCommand(input: {
  quote: ProgramPurchaseQuote;
  requestId: string;
  billingConsent: boolean;
  offSessionConsent: boolean;
}): ProgramPurchaseConfirmCommand | null {
  return parseProgramPurchaseConfirmCommand({
    programId: input.quote.programId,
    offerVersionId: input.quote.offerVersionId,
    installmentCount: input.quote.installmentCount,
    promotionCode: normalizeProgramPromotionCode(input.quote.promotionCode),
    requestId: input.requestId,
    quoteDigest: input.quote.quoteDigest,
    billingConsent: input.billingConsent,
    offSessionConsent: input.offSessionConsent,
  });
}

export function formatProgramPurchaseCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatProgramPurchaseDate(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "Scheduled date";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function programPurchasePaymentLabel(item: ProgramPurchaseHistoryItem): string {
  if (item.safetyStage !== "clear") return "We’re checking this purchase.";
  switch (item.paymentStage) {
    case "free_grant": return "Free access granted";
    case "checkout_required": return "Ready for secure checkout";
    case "checkout_pending": return "Checkout is being prepared";
    case "checkout_open": return "Checkout is ready";
    case "checkout_retryable": return "Checkout expired";
    case "payment_pending": return "Payment is processing";
    case "partially_settled": return "Payments are in progress";
    case "settled": return "Paid in full";
    case "refunded": return "Refunded";
    case "partially_refunded": return "Partially refunded";
    case "not_started": return "Purchase not started";
    case "unknown": return "We’re checking this purchase.";
  }
}

export function programPurchaseCancellationLabel(item: ProgramPurchaseHistoryItem): string | null {
  switch (item.cancellationStage) {
    case "requested": return "Cancellation requested";
    case "completed": return "Cancelled";
    case "not_applicable": return "No charges are due for this free purchase";
    case "none": return null;
    case "unknown": return "Cancellation status is being checked";
  }
}

export function isProgramPurchaseCheckoutActionSafe(item: ProgramPurchaseHistoryItem): boolean {
  return item.safetyStage === "clear" && item.cancellationStage === "none" &&
    ["checkout_required", "checkout_pending", "checkout_open", "payment_pending"].includes(item.paymentStage);
}

export function canRetryProgramPurchaseCheckout(item: ProgramPurchaseHistoryItem): boolean {
  return item.safetyStage === "clear" && item.paymentStage === "checkout_retryable" &&
    item.checkoutRetryHint && item.cancellationStage === "none";
}
