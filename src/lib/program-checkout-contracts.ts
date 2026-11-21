import type { ProgramBillingConsent, ProgramBillingOrder, ProgramProviderScope } from "./program-billing";

export type ProgramCheckoutStartCommand = {
  orderId: string;
  expectedRevision: number;
};

export type ProgramCheckoutRetryCommand = ProgramCheckoutStartCommand & {
  requestId: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parseProgramCheckoutStartCommand(value: unknown): ProgramCheckoutStartCommand | null {
  if (!isRecord(value) || !hasExactKeys(value, ["orderId", "expectedRevision"])) return null;
  if (!isUuid(value.orderId)) return null;
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) return null;
  return { orderId: value.orderId, expectedRevision: Number(value.expectedRevision) };
}

export function parseProgramCheckoutRetryCommand(value: unknown): ProgramCheckoutRetryCommand | null {
  if (!isRecord(value) || !hasExactKeys(value, ["orderId", "expectedRevision", "requestId"])) return null;
  if (!isUuid(value.orderId)) return null;
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) return null;
  if (!isUuid(value.requestId)) return null;
  return {
    orderId: value.orderId,
    expectedRevision: Number(value.expectedRevision),
    requestId: value.requestId,
  };
}

export function isProgramProviderScope(value: unknown): value is ProgramProviderScope {
  return isRecord(value) && typeof value.platformAccountId === "string" &&
    /^acct_[A-Za-z0-9]+$/.test(value.platformAccountId) && typeof value.livemode === "boolean";
}

export function isStrictStripeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com" &&
      url.port === "" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function buildProgramCheckoutReturnUrls(input: { siteUrl: string; programId: string; orderId: string }) {
  const base = new URL(input.siteUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("Program Checkout site origin is invalid");
  }
  const route = `/program-purchases/${encodeURIComponent(input.orderId)}`;
  const success = new URL(route, base.origin);
  success.searchParams.set("checkout", "success");
  const cancel = new URL(route, base.origin);
  cancel.searchParams.set("checkout", "cancel");
  return { successUrl: success.toString(), cancelUrl: cancel.toString() };
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

export function isoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime());
}

export function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseProgramBillingConsent(value: unknown): ProgramBillingConsent | null {
  if (!isRecord(value) || !safeInteger(value.version, 1) || typeof value.digest !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.digest) || !isoTimestamp(value.accepted_at) ||
      !safeInteger(value.total_cents, 1) || !safeInteger(value.installment_count, 1) ||
      !Array.isArray(value.disclosed_charge_dates) ||
      !value.disclosed_charge_dates.every(isoDate) || typeof value.saved_card_for_off_session !== "boolean" ||
      !(value.retry_window_days === null || value.retry_window_days === 7) ||
      value.cancellation_stops_future_charges !== true) return null;
  return {
    version: value.version,
    digest: value.digest,
    acceptedAt: value.accepted_at,
    totalCents: value.total_cents,
    installmentCount: value.installment_count,
    disclosedChargeDates: value.disclosed_charge_dates,
    savedCardForOffSession: value.saved_card_for_off_session,
    retryWindowDays: value.retry_window_days as 7 | null,
    cancellationStopsFutureCharges: true,
  };
}

export type ProgramCheckoutOrderSnapshot = Omit<ProgramBillingOrder, "stripeCustomerId"> & {
  stripeCustomerId: string | null;
  programId: string;
  billingRevision: number;
  attempts: readonly {
    attemptNumber: number;
    attemptId: string;
    checkoutSessionId: string | null;
    paymentIntentId: string | null;
    explicitRetryRequestId: string | null;
    retryProofDigest: string | null;
  }[];
};

export function programBillingOrderFromSnapshot(snapshot: ProgramCheckoutOrderSnapshot): ProgramBillingOrder | null {
  if (!snapshot.stripeCustomerId || !/^cus_[A-Za-z0-9_]+$/.test(snapshot.stripeCustomerId)) return null;
  return { ...snapshot, stripeCustomerId: snapshot.stripeCustomerId };
}
