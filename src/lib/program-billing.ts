import {
  PROGRAM_CURRENCY,
  PROGRAM_MAX_INSTALLMENTS,
  PROGRAM_MIN_CHARGE_CENTS,
} from "./program-commerce";
import { createHash } from "node:crypto";

export const PROGRAM_BILLING_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PROGRAM_STRIPE_IDEMPOTENCY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const PROGRAM_BILLING_TERMS_VERSION = 1;

export type ProgramBillingSeller =
  | { platformOwned: true; connectedAccountId: null; applicationFeeBasisPoints: 0 }
  | { platformOwned: false; connectedAccountId: string; applicationFeeBasisPoints: 1_000 };

export type ProgramBillingConsent = {
  version: number;
  digest: string;
  acceptedAt: string;
  totalCents: number;
  installmentCount: number;
  disclosedChargeDates: readonly string[];
  savedCardForOffSession: boolean;
  retryWindowDays: 7 | null;
  cancellationStopsFutureCharges: true;
};

export type ProgramProviderScope = { platformAccountId: string; livemode: boolean };

/** Immutable Gate 1 quote plus the per-order Stripe facts recorded by the billing gate. */
export type ProgramBillingOrder = {
  orderId: string;
  buyerId: string;
  currency: typeof PROGRAM_CURRENCY;
  effectiveTotalCents: number;
  installmentAmountsCents: readonly number[];
  installmentCount: number;
  clearedInstallments: number;
  promotionReservationState: "none" | "reserved" | "redeemed" | "released";
  stripeCustomerId: string;
  providerScope?: ProgramProviderScope | null;
  savedPaymentMethodId: string | null;
  seller: ProgramBillingSeller;
  consent: ProgramBillingConsent | null;
  firstSettledAt: string | null;
  nextAnchorDate: string | null;
  retryDeadline: string | null;
  canceled: boolean;
  deletionPending: boolean;
  financialConflict: boolean;
  currentAttemptNumber: number;
};

export type ProgramMonthAnchor = { day: number; endOfMonth: boolean };

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

function isValidIsoDate(value: string) {
  if (!isoDatePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isoCalendarDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function lastCalendarDay(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function dateInProgramBillingTimezone(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarMonth(anchorDate: string, anchor: ProgramMonthAnchor) {
  if (!isValidIsoDate(anchorDate)) return null;
  const [year, month, day] = anchorDate.split("-").map(Number);
  const monthIndex = month - 1 + 1;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonthIndex = monthIndex % 12;
  const targetDay = anchor.endOfMonth
    ? lastCalendarDay(targetYear, targetMonthIndex)
    : Math.min(anchor.day, lastCalendarDay(targetYear, targetMonthIndex));
  if (day < 1 || day > 31 || anchor.day < 1 || anchor.day > 31) return null;
  return isoCalendarDay(new Date(Date.UTC(targetYear, targetMonthIndex, targetDay)));
}

export function buildProgramMonthlyAnchors(input: {
  firstSettledAt: string;
  installmentCount: number;
}): { anchor: ProgramMonthAnchor; futureDates: string[] } | null {
  const settledAt = new Date(input.firstSettledAt);
  if (
    Number.isNaN(settledAt.getTime()) ||
    !Number.isInteger(input.installmentCount) ||
    input.installmentCount < 1 ||
    input.installmentCount > PROGRAM_MAX_INSTALLMENTS
  ) {
    return null;
  }
  if (settledAt.toISOString() !== input.firstSettledAt) return null;
  const firstSettlementDate = dateInProgramBillingTimezone(settledAt);
  const [year, month, day] = firstSettlementDate.split("-").map(Number);
  const anchor = {
    day,
    endOfMonth: day === lastCalendarDay(year, month - 1),
  };
  if (input.installmentCount === 1) return { anchor, futureDates: [] };
  const firstFutureDate = addCalendarMonth(firstSettlementDate, anchor);
  if (!firstFutureDate) return null;
  const futureDates = [firstFutureDate];
  for (let index = 1; index < input.installmentCount - 1; index += 1) {
    const nextDate = addCalendarMonth(futureDates[index - 1], anchor);
    if (!nextDate) return null;
    futureDates.push(nextDate);
  }
  return { anchor, futureDates };
}

export type ProgramInvoiceReadiness =
  | { status: "not_due" }
  | { status: "buyer_confirmation_required" }
  | { status: "blocked"; reason: "canceled" | "deleting" | "financial_conflict" | "terms_missing" | "retry_expired" | "order_invalid" }
  | { status: "ready"; amountCents: number; dueDate: string; retryDeadline: string | null };

/** The database remains responsible for stage access; this only authorizes invoice work. */
export function getProgramInvoiceReadiness(input: {
  order: ProgramBillingOrder;
  installmentNumber: number;
  today: string;
  now: string;
  retryStartedAt?: string | null;
  retryDeadline?: string | null;
}): ProgramInvoiceReadiness {
  const { order, installmentNumber, today } = input;
  if (order.canceled) return { status: "blocked", reason: "canceled" };
  if (order.deletionPending) return { status: "blocked", reason: "deleting" };
  if (order.financialConflict) return { status: "blocked", reason: "financial_conflict" };
  if (!order.consent || order.consent.savedCardForOffSession !== true || order.consent.cancellationStopsFutureCharges !== true) {
    return { status: "blocked", reason: "terms_missing" };
  }
  if (
    order.currency !== PROGRAM_CURRENCY ||
    !Number.isInteger(order.installmentCount) ||
    order.installmentCount < 2 ||
    order.installmentCount > PROGRAM_MAX_INSTALLMENTS ||
    !Number.isInteger(order.clearedInstallments) ||
    order.clearedInstallments !== installmentNumber - 1 ||
    order.installmentAmountsCents.length !== order.installmentCount ||
    order.installmentAmountsCents.some((amount) => !Number.isSafeInteger(amount) || amount < PROGRAM_MIN_CHARGE_CENTS) ||
    order.installmentAmountsCents.reduce((sum, amount) => sum + amount, 0) !== order.effectiveTotalCents ||
    !Number.isInteger(installmentNumber) ||
    installmentNumber < 2 ||
    installmentNumber > order.installmentCount ||
    !isValidIsoDate(today)
  ) {
    return { status: "blocked", reason: "order_invalid" };
  }
  const dateIndex = installmentNumber - 2;
  const dueDate = order.consent.disclosedChargeDates[dateIndex];
  const retryDeadline = input.retryDeadline === undefined ? order.retryDeadline : input.retryDeadline;
  if (!dueDate || !isValidIsoDate(dueDate)) {
    return { status: "blocked", reason: "terms_missing" };
  }
  const retryDeadlineDate = retryDeadline === null ? null : new Date(retryDeadline);
  if (retryDeadlineDate && Number.isNaN(retryDeadlineDate.getTime())) return { status: "blocked", reason: "terms_missing" };
  if (today < dueDate) return { status: "not_due" };
  // Start a stage only on its disclosed date. Once that exact invoice has a durable
  // attempt, allow retries during the seven-day window without creating catch-up invoices.
  if (today > dueDate && !input.retryStartedAt) return { status: "buyer_confirmation_required" };
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return { status: "blocked", reason: "terms_missing" };
  if (retryDeadlineDate && now > retryDeadlineDate.getTime()) return { status: "blocked", reason: "retry_expired" };
  if (order.consent.totalCents !== order.effectiveTotalCents || order.consent.installmentCount !== order.installmentCount) {
    return { status: "blocked", reason: "terms_missing" };
  }
  return {
    status: "ready",
    amountCents: order.installmentAmountsCents[installmentNumber - 1],
    dueDate,
    retryDeadline,
  };
}

export function isValidProgramBillingConsent(input: {
  consent: ProgramBillingConsent;
  order: Pick<ProgramBillingOrder, "effectiveTotalCents" | "installmentCount">;
  now: string;
}) {
  const acceptedAt = new Date(input.consent.acceptedAt);
  const now = new Date(input.now);
  return Boolean(
    input.consent.version === PROGRAM_BILLING_TERMS_VERSION &&
      sha256Pattern.test(input.consent.digest) &&
      !Number.isNaN(now.getTime()) &&
      !Number.isNaN(acceptedAt.getTime()) &&
      acceptedAt.toISOString() === input.consent.acceptedAt &&
      acceptedAt.getTime() <= now.getTime() &&
      input.consent.totalCents === input.order.effectiveTotalCents &&
      input.consent.installmentCount === input.order.installmentCount &&
      input.consent.disclosedChargeDates.length === Math.max(0, input.order.installmentCount - 1) &&
      input.consent.disclosedChargeDates.every(isValidIsoDate) &&
      input.consent.savedCardForOffSession === (input.order.installmentCount > 1) &&
      input.consent.retryWindowDays === (input.order.installmentCount > 1 ? 7 : null) &&
      input.consent.cancellationStopsFutureCharges === true,
  );
}

export type ProgramInvoiceLine = {
  id: string;
  invoiceId: string | null;
  amount: number;
  currency: string;
  quantity: number | null;
  invoiceItemId: string | null;
  customerId: string;
  description: string | null;
  discountable: boolean;
  discounts: readonly unknown[] | null;
  taxRates: readonly unknown[] | null;
  taxAmounts: readonly unknown[] | null;
  proration: boolean;
  subscriptionId: string | null;
  metadata: Record<string, string> | null;
  livemode?: boolean;
  providerScope?: ProgramProviderScope;
};

export type ProgramInvoice = {
  id: string;
  customerId: string;
  currency: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible" | null;
  autoAdvance: boolean | null;
  collectionMethod: string;
  billingReason: string;
  subscriptionId: string | null;
  parentType: string | null;
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  amountOverpaid: number;
  amountShipping: number;
  subtotal: number;
  total: number;
  subtotalExcludingTax: number | null;
  totalExcludingTax: number | null;
  startingBalance: number;
  endingBalance: number | null;
  discounts: readonly unknown[] | null;
  totalDiscountAmounts: readonly unknown[] | null;
  defaultTaxRates: readonly unknown[] | null;
  totalTaxes: readonly unknown[] | null;
  automaticTaxEnabled: boolean;
  metadata: Record<string, string> | null;
  defaultPaymentMethodId: string | null;
  lines: { data: readonly ProgramInvoiceLine[]; hasMore: boolean; totalCount: number };
  livemode?: boolean;
  providerScope?: ProgramProviderScope;
};

export type ProgramPaymentIntent = {
  id: string;
  customerId: string | null;
  amount: number;
  amountReceived: number;
  currency: string;
  status: string;
  applicationFeeAmount: number | null;
  transferDestinationId: string | null;
  paymentMethodId: string | null;
  latestChargeId: string | null;
  metadata: Record<string, string> | null;
  livemode?: boolean;
  providerScope?: ProgramProviderScope;
};

export type ProgramPaymentMethod = {
  id: string;
  customerId: string | null;
  type: string;
  livemode?: boolean;
  providerScope?: ProgramProviderScope;
};

export type ProgramInvoicePayment = {
  id: string;
  invoiceId: string;
  isDefault: boolean;
  status: string;
  amountRequested: number;
  amountPaid: number | null;
  currency: string;
  type: string;
  paymentIntentId: string | null;
  livemode?: boolean;
  providerScope?: ProgramProviderScope;
};

export type ProgramInvoiceDeleteReadback =
  | { status: "present"; invoice: ProgramInvoice; providerScope: ProgramProviderScope }
  | { status: "missing"; invoiceId: string; httpStatus: 404; errorCode: "resource_missing"; providerScope: ProgramProviderScope };

export type ProgramInvoiceDeleteTerminal =
  | { status: "deleted"; invoiceId: string; object: "invoice"; deleted: true; providerScope: ProgramProviderScope }
  | {
      status: "missing";
      invoiceId: string;
      httpStatus: 404;
      errorCode: "resource_missing";
      providerScope: ProgramProviderScope;
      inventory: {
        completeInventory: true;
        customerId: string;
        customer: ProgramStripeCustomer;
        invoices: readonly ProgramInvoice[];
        paymentIntents: readonly ProgramPaymentIntent[];
        pendingInvoiceItemCount: 0;
        pendingInvoiceItemIds: readonly [];
        subscriptionIds: readonly string[];
        scheduleIds: readonly string[];
      };
    }
;

export type ProgramStripeCustomer = {
  id: string;
  deleted: boolean;
  balance: number;
  invoiceCreditBalance: Record<string, number>;
  discountId: string | null;
  taxExempt: string | null;
  metadata: Record<string, string> | null;
  livemode?: boolean;
  providerScope?: ProgramProviderScope;
};

export type ProgramCheckoutSession = {
  id: string;
  url: string | null;
  customerId: string | null;
  clientReferenceId: string | null;
  mode: string;
  status: string | null;
  paymentStatus: string;
  amountTotal: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  metadata: Record<string, string> | null;
  livemode?: boolean;
  providerScope?: ProgramProviderScope;
};

export type ProgramCheckoutPaymentAttempt = {
  attemptNumber: number;
  attemptId: string;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
};

export type ProgramInvoiceAttempt = {
  order: ProgramBillingOrder;
  installmentNumber: number;
  expectedRevision: number;
  invoiceId: string | null;
  invoiceItemId: string | null;
  paymentIntentId: string | null;
  createInvoiceIdempotencyKey: string;
  createLineIdempotencyKey: string;
  finalizeIdempotencyKey: string;
  currentPayAttempt: number;
  currentPayIdempotencyKey: string | null;
  currentPayOutcome: "none" | "unknown" | "failed" | "requires_action" | "processing" | "succeeded";
  invoiceCreateOutcome: "not_started" | "unknown" | "created";
  lineCreateOutcome: "not_started" | "unknown" | "created";
  finalizeOutcome: "not_started" | "unknown" | "finalized";
  /** First durable provider-object create intent; used only for Stripe's idempotency safety window. */
  retryStartedAt: string | null;
  /** Set only when the first explicit invoice-pay intent is persisted. */
  collectionStartedAt: string | null;
  retryDeadline: string | null;
};

export type ProgramBillingStore = {
  /** Locks the canonical buyer/order and commits all action intents before any provider request. */
  prepareInstallmentInvoice(input: {
    orderId: string;
    installmentNumber: number;
    expectedRevision: number;
    today: string;
  }): Promise<ProgramInvoiceAttempt | { blocked: string }>;
  bindInvoice(input: { orderId: string; installmentNumber: number; expectedRevision: number; invoiceId: string; evidence: ProgramInvoice; evidenceDigest: string }): Promise<boolean>;
  bindInvoiceItem(input: { orderId: string; installmentNumber: number; expectedRevision: number; invoiceItemId: string; evidence: ProgramInvoiceLine; evidenceDigest: string }): Promise<boolean>;
  bindPaymentIntent(input: { orderId: string; installmentNumber: number; expectedRevision: number; paymentIntentId: string; evidence: { invoice: ProgramInvoice; invoicePayments: readonly ProgramInvoicePayment[]; paymentIntent: ProgramPaymentIntent }; evidenceDigest: string }): Promise<boolean>;
  markOperationUnknown(input: {
    orderId: string;
    operationKind: "invoice_create" | "invoice_item_create" | "invoice_finalize";
    checkoutAttemptNumber: number;
    installmentNumber: number;
    paymentAttemptNumber: number;
  }): Promise<boolean>;
  prepareInvoicePayAttempt(input: {
    orderId: string;
    installmentNumber: number;
    expectedRevision: number;
    invoiceId: string;
    paymentIntentId: string;
    verifiedStatus: string;
    evidenceDigest: string;
  }): Promise<{ attemptNumber: number; idempotencyKey: string } | { blocked: string }>;
  recordProviderObservation(input: {
    orderId: string;
    checkoutAttemptNumber: number;
    installmentNumber: number;
    providerObjectType: "checkout_session" | "payment_intent" | "invoice" | "invoice_item" | "customer";
    providerObjectId: string;
    status: string;
    digest: string;
    isCurrentAttempt: boolean;
  }): Promise<void>;
  recordActionRequired(input: { orderId: string; installmentNumber: number; paymentIntentId: string }): Promise<void>;
};

export type ProgramInvoiceProvider = {
  getProviderScope(): Promise<ProgramProviderScope>;
  retrieveCustomer(customerId: string): Promise<ProgramStripeCustomer>;
  hasPendingInvoiceItems(customerId: string): Promise<boolean>;
  listSubscriptions(input: { customerId: string; startingAfter?: string }): Promise<{ data: Array<{ id: string }>; hasMore: boolean }>;
  listSubscriptionSchedules(input: { customerId: string; startingAfter?: string }): Promise<{ data: Array<{ id: string }>; hasMore: boolean }>;
  listPaymentIntents(input: { customerId: string; startingAfter?: string }): Promise<{ data: ProgramPaymentIntent[]; hasMore: boolean }>;
  listCheckoutSessions(input: { customerId: string; startingAfter?: string }): Promise<{ data: ProgramCheckoutSession[]; hasMore: boolean }>;
  retrieveCheckoutSession(sessionId: string): Promise<ProgramCheckoutSession>;
  createInvoice(input: {
    customerId: string;
    savedPaymentMethodId: string;
    amountCents: number;
    currency: string;
    orderId: string;
    installmentNumber: number;
    attemptNumber: number;
    seller: ProgramBillingSeller;
    providerScope: ProgramProviderScope;
    idempotencyKey: string;
  }): Promise<ProgramInvoice>;
  listInvoices(input: { customerId: string; startingAfter?: string }): Promise<{ data: ProgramInvoice[]; hasMore: boolean }>;
  retrieveInvoice(invoiceId: string): Promise<ProgramInvoice>;
  deleteDraftInvoice(input: { invoiceId: string; providerScope: ProgramProviderScope; idempotencyKey: string }): Promise<{
    id: string;
    object: "invoice";
    deleted: true;
    providerScope: ProgramProviderScope;
  }>;
  retrieveInvoiceDeleteReadback(input: { invoiceId: string; providerScope: ProgramProviderScope }): Promise<ProgramInvoiceDeleteReadback>;
  createInvoiceLine(input: {
    invoiceId: string;
    customerId: string;
    amountCents: number;
    currency: string;
    orderId: string;
    installmentNumber: number;
    attemptNumber: number;
    providerScope: ProgramProviderScope;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  listInvoiceLines(input: { invoiceId: string; startingAfter?: string }): Promise<{ data: ProgramInvoiceLine[]; hasMore: boolean }>;
  finalizeInvoice(input: { invoiceId: string; autoAdvance: false; idempotencyKey: string }): Promise<ProgramInvoice>;
  listInvoicePayments(input: { invoiceId: string; startingAfter?: string }): Promise<{
    data: ProgramInvoicePayment[];
    hasMore: boolean;
  }>;
  retrievePaymentIntent(paymentIntentId: string): Promise<ProgramPaymentIntent>;
  retrievePaymentMethod(paymentMethodId: string): Promise<ProgramPaymentMethod>;
  payInvoice(input: {
    invoiceId: string;
    paymentMethodId: string;
    offSession: true;
    idempotencyKey: string;
  }): Promise<ProgramInvoice>;
};

export type ProgramDraftInvoiceDeleteIntent = {
  order: ProgramBillingOrder;
  installmentNumber: number;
  checkoutAttemptNumber: number;
  expectedRevision: number;
  invoiceId: string;
  invoiceItemId: string | null;
  /** Exact payment-intent IDs already bound to this order, used for full-customer inventory comparison. */
  knownPaymentIntentIds: readonly string[];
};

export type ProgramDraftInvoiceDeleteSnapshot = {
  invoice: ProgramInvoice;
  lines: readonly ProgramInvoiceLine[];
  invoicePayments: readonly ProgramInvoicePayment[];
  customer: ProgramStripeCustomer;
  customerId: string;
  pendingInvoiceItemCount: 0;
  pendingInvoiceItemIds: readonly [];
  providerScope: ProgramProviderScope;
  invoiceIds: readonly string[];
  paymentIntents: readonly ProgramPaymentIntent[];
  subscriptionIds: readonly string[];
  scheduleIds: readonly string[];
};

export type ProgramDraftInvoiceDeleteProof = {
  orderId: string;
  installmentNumber: number;
  checkoutAttemptNumber: number;
  invoiceId: string;
  customerId: string;
  providerScope: ProgramProviderScope;
  snapshot: ProgramDraftInvoiceDeleteSnapshot;
  snapshotDigest: string;
  proofState: "prepared" | "unknown" | "deleted" | "missing";
  operationState: "intent" | "unknown" | "succeeded" | "terminal_failure";
  idempotencyKey: string;
};

export type ProgramDraftInvoiceDeleteStore = {
  /** Reads the exact persisted proof through a service-only RPC; never reads the protected table directly. */
  getDraftInvoiceDelete(input: {
    orderId: string;
    installmentNumber: number;
    invoiceId: string;
  }): Promise<ProgramDraftInvoiceDeleteProof | null | { blocked: string }>;
  /** Persists an exact pre-delete snapshot and immutable delete operation before any DELETE request. */
  prepareDraftInvoiceDelete(input: {
    orderId: string;
    installmentNumber: number;
    expectedRevision: number;
    invoiceId: string;
    snapshot: ProgramDraftInvoiceDeleteSnapshot;
    snapshotDigest: string;
  }): Promise<{ idempotencyKey: string; snapshotDigest: string } | { blocked: string }>;
  /** Moves only the persisted delete intent to unknown immediately before calling Stripe. */
  markDraftInvoiceDeleteUnknown(input: { orderId: string; installmentNumber: number; invoiceId: string }): Promise<boolean>;
  /** Persists only exact same-ID delete/readback evidence; it cannot alter billing access or payment claims. */
  reconcileDraftInvoiceDelete(input: {
    orderId: string;
    installmentNumber: number;
    invoiceId: string;
    idempotencyKey: string;
    snapshotDigest: string;
    terminal: ProgramInvoiceDeleteTerminal;
    terminalDigest: string;
  }): Promise<"deleted" | "present" | "unknown" | "blocked">;
};

type ProgramCustomerInventoryProvider = Pick<ProgramInvoiceProvider,
  "getProviderScope" | "retrieveCustomer" | "hasPendingInvoiceItems" | "listSubscriptions" | "listSubscriptionSchedules" | "listInvoices"
>;

export type ProgramCheckoutProvider = Pick<ProgramInvoiceProvider,
  "getProviderScope" | "listCheckoutSessions" | "retrieveCheckoutSession" | "listPaymentIntents" | "retrievePaymentIntent" | "retrievePaymentMethod" | "listInvoices" | "listSubscriptions" | "listSubscriptionSchedules" | "retrieveCustomer" | "hasPendingInvoiceItems"
> & {
  createCustomer(input: { orderId: string; idempotencyKey: string; providerScope: ProgramProviderScope }): Promise<ProgramStripeCustomer>;
  createCheckoutSession(input: {
    order: ProgramBillingOrder;
    attemptId: string;
    attemptNumber: number;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<ProgramCheckoutSession>;
};

export type ProgramCheckoutAttemptIntent = {
  order: ProgramBillingOrder;
  attempt: ProgramCheckoutPaymentAttempt;
  priorAttempts: readonly ProgramCheckoutPaymentAttempt[];
  expectedRevision: number;
  idempotencyKey: string;
  createRequestedAt: string;
  createOutcome: "not_started" | "unknown" | "created";
  successUrl: string;
  cancelUrl: string;
  retryProofDigest: string | null;
  retryRequestId: string | null;
};

export type ProgramCheckoutStore = {
  prepareProgramCustomer(input: { orderId: string; expectedRevision: number; providerScope: ProgramProviderScope }): Promise<ProgramCustomerSetupIntent | { blocked: string }>;
  bindProgramCustomer(input: { orderId: string; expectedRevision: number; customerId: string; evidence: ProgramStripeCustomer; evidenceDigest: string }): Promise<boolean>;
  markProgramCustomerCreateUnknown(input: { orderId: string }): Promise<boolean>;
  recordProgramCustomerCreateUnknown(input: { orderId: string; requestDigest: string }): Promise<void>;
  recordProgramCustomerConflict(input: { orderId: string; reason: string; evidenceDigest: string }): Promise<void>;
  prepareCheckoutAttempt(input: { orderId: string; expectedRevision: number; successUrl: string; cancelUrl: string }): Promise<ProgramCheckoutAttemptIntent | { blocked: string }>;
  markCheckoutCreateUnknown(input: { orderId: string; attemptNumber: number }): Promise<boolean>;
  bindCheckoutSession(input: { orderId: string; attemptNumber: number; expectedRevision: number; sessionId: string; paymentIntentId: string | null; evidence: { session: ProgramCheckoutSession; paymentIntent: ProgramPaymentIntent | null }; evidenceDigest: string }): Promise<boolean>;
  recordCheckoutObservation(input: {
    orderId: string;
    attemptNumber: number;
    sessionId: string;
    paymentIntentId: string | null;
    status: string;
    digest: string;
  }): Promise<void>;
  recordCheckoutCreateUnknown(input: { orderId: string; attemptNumber: number; requestDigest: string }): Promise<void>;
  recordCheckoutConflict(input: { orderId: string; attemptNumber: number; reason: string; evidenceDigest: string }): Promise<void>;
  prepareBuyerRetry(input: {
    orderId: string;
    expectedRevision: number;
    explicitRequestId: string;
    requestedAt: string;
  }): Promise<{ order: ProgramBillingOrder; expectedRevision: number; attempts: ProgramCheckoutPaymentAttempt[] } | { blocked: string }>;
  advanceCheckoutAttempt(input: {
    orderId: string;
    expectedRevision: number;
    priorAttemptNumber: number;
    explicitRequestId: string;
    proof: ProgramCheckoutTerminalProof;
  }): Promise<ProgramCheckoutAttemptIntent | { blocked: string }>;
};

export type ProgramCustomerSetupIntent = {
  orderId: string;
  expectedRevision: number;
  customerId: string | null;
  createOutcome: "not_started" | "unknown" | "created";
  idempotencyKey: string;
  retryUnknownUntil: string;
  providerScope: ProgramProviderScope;
};

export type ProgramCheckoutTerminalProof = {
  orderId: string;
  customerId: string;
  priorAttemptNumber: number;
  sessionIds: readonly string[];
  paymentIntentIds: readonly string[];
  invoiceIds: readonly string[];
  subscriptionIds: readonly string[];
  scheduleIds: readonly string[];
  pendingInvoiceItemCount: number;
  attempts: readonly {
    attemptNumber: number;
    attemptId: string;
    sessionId: string;
    paymentIntentId: string | null;
    sessionStatus: "expired";
    sessionPaymentStatus: "unpaid";
    paymentIntentStatus: "canceled" | null;
    amountCents: number;
    amountReceivedCents: 0;
    currency: "usd";
    customerId: string;
    evidenceDigest: string;
  }[];
  digest: string;
  completeInventory: true;
};

export type ProgramInvoiceResult =
  | { status: "blocked"; reason: string }
  | { status: "not_due" | "buyer_confirmation_required" | "retry_expired" | "requires_action" | "processing" | "unknown" | "retryable_failure" }
  | { status: "payment_succeeded_awaiting_ledger"; invoiceId: string; paymentIntentId: string; chargeId: string };

export type ProgramCheckoutResult =
  | { status: "blocked"; reason: string }
  | { status: "unknown" | "expired_requires_explicit_retry" | "paid_awaiting_ledger" }
  | { status: "checkout_ready"; checkoutUrl: string; attemptNumber: number };

export function programInvoiceIdempotencyKey(orderId: string, installmentNumber: number, operation: string) {
  return `program:${orderId}:${installmentNumber}:${operation}:v1`;
}

function providerScopeMatches(actual: ProgramProviderScope | undefined | null, expected: ProgramProviderScope | null | undefined) {
  if (!expected) return true;
  return Boolean(actual && actual.platformAccountId === expected.platformAccountId && actual.livemode === expected.livemode);
}

function providerMetadataMatchesScope(metadata: Record<string, string> | null | undefined, expected: ProgramProviderScope | null | undefined) {
  if (!expected) return true;
  return metadata?.program_platform_account_id === expected.platformAccountId &&
    metadata.program_livemode === String(expected.livemode);
}

function lineInvoiceItemId(line: ProgramInvoiceLine) {
  return line.invoiceItemId ?? null;
}

function expectedApplicationFee(order: ProgramBillingOrder, amountCents: number) {
  return order.seller.platformOwned ? 0 : Math.round((amountCents * order.seller.applicationFeeBasisPoints) / 10_000);
}

function validSeller(order: ProgramBillingOrder) {
  return order.seller.platformOwned
    ? order.seller.connectedAccountId === null && order.seller.applicationFeeBasisPoints === 0
    : /^acct_[A-Za-z0-9]+$/.test(order.seller.connectedAccountId) && order.seller.applicationFeeBasisPoints === 1_000;
}

function hasZeroInvoiceCreditBalance(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((balance) => typeof balance === "number" && balance === 0));
}

function assertCompletePage<T>(value: unknown, label: string): asserts value is { data: T[]; hasMore: boolean } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data) ||
    typeof (value as { hasMore?: unknown }).hasMore !== "boolean") {
    throw new Error(`${label} provider inventory page is incomplete`);
  }
}

export async function listAllProgramInvoices(provider: Pick<ProgramInvoiceProvider, "listInvoices">, customerId: string) {
  const invoices: ProgramInvoice[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 1_000; page += 1) {
    const result = await provider.listInvoices({ customerId, ...(startingAfter ? { startingAfter } : {}) });
    assertCompletePage<ProgramInvoice>(result, "Invoice");
    if (result.data.some((invoice) => !invoice.id || invoice.customerId !== customerId)) {
      throw new Error("Program invoice inventory returned a mismatched Customer or missing ID");
    }
    invoices.push(...result.data);
    if (!result.hasMore) return invoices;
    const lastId = result.data.at(-1)?.id;
    if (!lastId || lastId === startingAfter) throw new Error("Program invoice inventory pagination did not advance");
    startingAfter = lastId;
  }
  throw new Error("Program invoice inventory exceeded the pagination safety bound");
}

async function assertNoProviderObjects<T extends { id: string }>(input: {
  fetchPage: (startingAfter?: string) => Promise<{ data: T[]; hasMore: boolean }>;
  label: string;
}) {
  const rows: T[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 1_000; page += 1) {
    const result = await input.fetchPage(startingAfter);
    assertCompletePage<T>(result, input.label);
    rows.push(...result.data);
    if (!result.hasMore) {
      if (rows.length) throw new Error(`Unexpected ${input.label} in isolated Program Customer`);
      return;
    }
    const lastId = result.data.at(-1)?.id;
    if (!lastId || lastId === startingAfter) throw new Error(`${input.label} pagination did not advance`);
    startingAfter = lastId;
  }
  throw new Error(`${input.label} inventory exceeded the pagination safety bound`);
}

export async function verifyProgramCustomerIsolation(provider: ProgramCustomerInventoryProvider, order: ProgramBillingOrder) {
  const providerScope = await provider.getProviderScope?.();
  if (order.providerScope && !providerScopeMatches(providerScope, order.providerScope)) throw new Error("Program Stripe account or mode changed");
  const customer = await provider.retrieveCustomer(order.stripeCustomerId);
  if (
    !customer || customer.deleted || customer.id !== order.stripeCustomerId || customer.balance !== 0 ||
    !hasZeroInvoiceCreditBalance(customer.invoiceCreditBalance) ||
    customer.discountId !== null || customer.taxExempt !== "none" ||
    (providerScope && (customer.livemode !== providerScope.livemode || !providerScopeMatches(customer.providerScope, providerScope) ||
      !providerMetadataMatchesScope(customer.metadata, providerScope))) ||
    customer.metadata?.program_order_id !== order.orderId ||
    customer.metadata?.program_billing_purpose !== "program_order"
  ) throw new Error("Program billing Customer is not isolated or has an unexpected balance, tax, or discount");

  const invoices = await listAllProgramInvoices(provider, customer.id);
  if (invoices.some((invoice) => invoice.metadata?.program_order_id !== order.orderId ||
    (providerScope && (invoice.livemode !== providerScope.livemode || !providerScopeMatches(invoice.providerScope, providerScope) ||
      !providerMetadataMatchesScope(invoice.metadata, providerScope))))) {
    throw new Error("Unrelated invoice found on the isolated Program Customer");
  }
  if (await provider.hasPendingInvoiceItems(customer.id) !== false) throw new Error("Pending invoice-item inventory is incomplete or nonempty");
  await assertNoProviderObjects({
    label: "Subscription",
    fetchPage: (startingAfter) => provider.listSubscriptions({ customerId: customer.id, ...(startingAfter ? { startingAfter } : {}) }),
  });
  await assertNoProviderObjects({
    label: "Subscription Schedule",
    fetchPage: (startingAfter) => provider.listSubscriptionSchedules({ customerId: customer.id, ...(startingAfter ? { startingAfter } : {}) }),
  });
  return { customer, invoices };
}

async function listAllInvoiceLines(provider: ProgramInvoiceProvider, invoiceId: string) {
  const lines: ProgramInvoiceLine[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 1_000; page += 1) {
    const result = await provider.listInvoiceLines({ invoiceId, ...(startingAfter ? { startingAfter } : {}) });
    assertCompletePage<ProgramInvoiceLine>(result, "Invoice line");
    lines.push(...result.data);
    if (!result.hasMore) return lines;
    const lastId = result.data.at(-1)?.id;
    if (!lastId || lastId === startingAfter) throw new Error("Program invoice line pagination did not advance");
    startingAfter = lastId;
  }
  throw new Error("Program invoice lines exceeded the pagination safety bound");
}

async function listAllInvoicePayments(provider: ProgramInvoiceProvider, invoiceId: string) {
  const payments: ProgramInvoicePayment[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 1_000; page += 1) {
    const result = await provider.listInvoicePayments({ invoiceId, ...(startingAfter ? { startingAfter } : {}) });
    assertCompletePage<ProgramInvoicePayment>(result, "InvoicePayment");
    payments.push(...result.data);
    if (!result.hasMore) return payments;
    const lastId = result.data.at(-1)?.id;
    if (!lastId || lastId === startingAfter) throw new Error("Program invoice payment pagination did not advance");
    startingAfter = lastId;
  }
  throw new Error("Program invoice payments exceeded the pagination safety bound");
}

async function findSingleMetadataInvoice(provider: ProgramInvoiceProvider, order: ProgramBillingOrder, installmentNumber: number, attemptNumber: number) {
  const invoices = await listAllProgramInvoices(provider, order.stripeCustomerId);
  const matching = invoices.filter((invoice) =>
    invoice.metadata?.program_order_id === order.orderId &&
    invoice.metadata?.program_installment_number === String(installmentNumber) &&
    invoice.metadata?.program_attempt_number === String(attemptNumber),
  );
  if (matching.length > 1) throw new Error("Multiple Stripe invoices claim this Program attempt");
  return matching[0] ?? null;
}

function verifyInvoiceBase(input: {
  invoice: ProgramInvoice;
  order: ProgramBillingOrder;
  installmentNumber: number;
  attemptNumber: number;
  expectedAmount: number;
  invoiceId?: string;
  allowedStatus: readonly ("draft" | "open" | "paid")[];
}) {
  const { invoice, order, installmentNumber, attemptNumber, expectedAmount } = input;
  return Boolean(
    (!input.invoiceId || invoice.id === input.invoiceId) &&
      (!order.providerScope || (invoice.livemode === order.providerScope.livemode &&
        providerScopeMatches(invoice.providerScope, order.providerScope) && providerMetadataMatchesScope(invoice.metadata, order.providerScope))) &&
      invoice.customerId === order.stripeCustomerId &&
      invoice.currency === PROGRAM_CURRENCY &&
      input.allowedStatus.includes(invoice.status as "draft" | "open" | "paid") &&
      invoice.autoAdvance === false &&
      invoice.collectionMethod === "charge_automatically" &&
      invoice.billingReason === "manual" &&
      invoice.subscriptionId === null &&
      invoice.parentType === null &&
      invoice.amountDue === expectedAmount &&
      invoice.total === expectedAmount &&
      invoice.subtotal === expectedAmount &&
      invoice.amountShipping === 0 &&
      invoice.amountOverpaid === 0 &&
      invoice.amountPaid === (invoice.status === "paid" ? expectedAmount : 0) &&
      invoice.amountRemaining === (invoice.status === "paid" ? 0 : expectedAmount) &&
      invoice.startingBalance === 0 &&
      (invoice.endingBalance === null || invoice.endingBalance === 0) &&
      (invoice.subtotalExcludingTax === null || invoice.subtotalExcludingTax === expectedAmount) &&
      (invoice.totalExcludingTax === null || invoice.totalExcludingTax === expectedAmount) &&
      (invoice.discounts?.length ?? 0) === 0 &&
      (invoice.totalDiscountAmounts?.length ?? 0) === 0 &&
      (invoice.defaultTaxRates?.length ?? 0) === 0 &&
      (invoice.totalTaxes?.length ?? 0) === 0 &&
      invoice.automaticTaxEnabled === false &&
      invoice.defaultPaymentMethodId === order.savedPaymentMethodId &&
      invoice.metadata?.program_order_id === order.orderId &&
      invoice.metadata?.program_installment_number === String(installmentNumber) &&
      invoice.metadata?.program_attempt_number === String(attemptNumber) &&
      invoice.metadata?.program_billing_kind === "standalone_installment" &&
      validSeller(order),
  );
}

function verifyExactLine(lines: readonly ProgramInvoiceLine[], input: {
  invoiceId: string;
  expectedInvoiceItemId: string;
  order: ProgramBillingOrder;
  installmentNumber: number;
  attemptNumber: number;
  amountCents: number;
  customerId: string;
}) {
  if (lines.length !== 1) return false;
  const line = lines[0];
  return Boolean(
    lineInvoiceItemId(line) === input.expectedInvoiceItemId &&
      (!input.order.providerScope || (line.livemode === input.order.providerScope.livemode &&
        providerScopeMatches(line.providerScope, input.order.providerScope) && providerMetadataMatchesScope(line.metadata, input.order.providerScope))) &&
      line.invoiceId === input.invoiceId &&
      line.amount === input.amountCents &&
      line.currency === PROGRAM_CURRENCY &&
      // Stripe may omit quantity for a direct-amount InvoiceItem. The exact item ID
      // and amount are verified above, so both Stripe representations are valid.
      (line.quantity === null || line.quantity === 1) &&
      line.customerId === input.customerId &&
      line.discountable === false &&
      (line.discounts?.length ?? 0) === 0 &&
      (line.taxRates?.length ?? 0) === 0 &&
      (line.taxAmounts?.length ?? 0) === 0 &&
      line.proration === false &&
      line.subscriptionId === null &&
      line.metadata?.program_order_id === input.order.orderId &&
      line.metadata?.program_installment_number === String(input.installmentNumber) &&
      line.metadata?.program_attempt_number === String(input.attemptNumber) &&
      line.metadata?.program_billing_kind === "standalone_installment_line",
  );
}

async function verifyInvoiceLines(provider: ProgramInvoiceProvider, invoice: ProgramInvoice, input: {
  order: ProgramBillingOrder;
  installmentNumber: number;
  attemptNumber: number;
  amountCents: number;
  expectedInvoiceItemId: string;
}) {
  const lines = await listAllInvoiceLines(provider, invoice.id);
  if (invoice.lines.hasMore || lines.length !== invoice.lines.totalCount || lines.length !== 1) return false;
  return verifyExactLine(lines, {
    invoiceId: invoice.id,
    expectedInvoiceItemId: input.expectedInvoiceItemId,
    order: input.order,
    installmentNumber: input.installmentNumber,
    attemptNumber: input.attemptNumber,
    amountCents: input.amountCents,
    customerId: input.order.stripeCustomerId,
  });
}

async function listAllCustomerPaymentIntents(provider: ProgramInvoiceProvider, customerId: string) {
  const intents: ProgramPaymentIntent[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 1_000; page += 1) {
    const result = await provider.listPaymentIntents({ customerId, ...(startingAfter ? { startingAfter } : {}) });
    assertCompletePage<ProgramPaymentIntent>(result, "PaymentIntent");
    if (result.data.some((intent) => !intent.id || intent.customerId !== customerId)) {
      throw new Error("Program PaymentIntent inventory returned a mismatched Customer or missing ID");
    }
    intents.push(...result.data);
    if (!result.hasMore) return intents;
    const lastId = result.data.at(-1)?.id;
    if (!lastId || lastId === startingAfter) throw new Error("Program PaymentIntent pagination did not advance");
    startingAfter = lastId;
  }
  throw new Error("Program PaymentIntent inventory exceeded the pagination safety bound");
}

function sameIds(actual: readonly string[], expected: readonly string[]) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return new Set(actual).size === actual.length && new Set(expected).size === expected.length &&
    sortedActual.length === sortedExpected.length && sortedActual.every((id, index) => id === sortedExpected[index]);
}

function sameEvidence(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (actual === null || expected === null || typeof actual !== "object" || typeof expected !== "object") return false;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
      actual.every((value, index) => sameEvidence(value, expected[index]));
  }
  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const actualKeys = Object.keys(actualRecord).sort();
  const expectedKeys = Object.keys(expectedRecord).sort();
  return sameIds(actualKeys, expectedKeys) && actualKeys.every((key) => sameEvidence(actualRecord[key], expectedRecord[key]));
}

function persistedDraftDeleteMatchesIntent(proof: ProgramDraftInvoiceDeleteProof, intent: ProgramDraftInvoiceDeleteIntent) {
  const { order, installmentNumber } = intent;
  const snapshot = proof.snapshot;
  const amountCents = intent.invoiceItemId === null ? 0 : order.installmentAmountsCents[installmentNumber - 1];
  const linesMatch = snapshot.lines.length === snapshot.invoice.lines.totalCount && !snapshot.invoice.lines.hasMore &&
    (intent.invoiceItemId === null ? snapshot.lines.length === 0 : snapshot.lines.length === 1 && verifyExactLine(snapshot.lines, {
      invoiceId: intent.invoiceId,
      expectedInvoiceItemId: intent.invoiceItemId,
      order,
      installmentNumber,
      attemptNumber: intent.checkoutAttemptNumber,
      amountCents,
      customerId: order.stripeCustomerId,
    }));
  const expectedKey = `program:${order.orderId}:invoice_delete:a${proof.checkoutAttemptNumber}:i${installmentNumber}:p0:v1`;
  return proof.orderId === order.orderId && proof.installmentNumber === installmentNumber &&
    proof.checkoutAttemptNumber === intent.checkoutAttemptNumber && proof.invoiceId === intent.invoiceId &&
    proof.customerId === order.stripeCustomerId && Boolean(order.providerScope &&
      providerScopeMatches(proof.providerScope, order.providerScope) &&
      providerScopeMatches(snapshot.providerScope, order.providerScope)) &&
    proof.snapshotDigest.length === 64 && /^[0-9a-f]{64}$/.test(proof.snapshotDigest) &&
    proof.idempotencyKey === expectedKey && snapshot.invoice.id === intent.invoiceId &&
    snapshot.invoice.customerId === order.stripeCustomerId && snapshot.invoice.status === "draft" &&
    verifyInvoiceBase({ invoice: snapshot.invoice, order, installmentNumber,
      attemptNumber: intent.checkoutAttemptNumber, expectedAmount: amountCents,
      invoiceId: intent.invoiceId, allowedStatus: ["draft"] }) &&
    snapshot.invoicePayments.length === 0 && linesMatch &&
    snapshot.customerId === order.stripeCustomerId && snapshot.customer.id === order.stripeCustomerId &&
    snapshot.pendingInvoiceItemCount === 0 && snapshot.pendingInvoiceItemIds.length === 0 &&
    snapshot.invoiceIds.filter((id) => id === intent.invoiceId).length === 1 &&
    snapshot.subscriptionIds.length === 0 && snapshot.scheduleIds.length === 0 &&
    sameIds(snapshot.paymentIntents.map((row) => row.id), intent.knownPaymentIntentIds);
}

async function reconcilePersistedUnknownDraftDelete(input: {
  proof: ProgramDraftInvoiceDeleteProof;
  store: ProgramDraftInvoiceDeleteStore;
  provider: ProgramInvoiceProvider;
  intent: ProgramDraftInvoiceDeleteIntent;
}): Promise<{ status: "deleted" | "present" | "unknown" | "blocked"; reason?: string }> {
  const { proof, store, provider, intent } = input;
  const { order, installmentNumber } = intent;
  const providerScope = order.providerScope;
  if (proof.proofState !== "unknown" || proof.operationState !== "unknown" ||
    !persistedDraftDeleteMatchesIntent(proof, intent)) {
    return { status: "blocked", reason: "persisted_draft_delete_identity_mismatch" };
  }
  try {
    if (!providerScope || !providerScopeMatches(await provider.getProviderScope(), providerScope)) {
      return { status: "blocked", reason: "provider_scope_changed" };
    }
    const readback = await provider.retrieveInvoiceDeleteReadback({ invoiceId: intent.invoiceId, providerScope });
    if (!providerScopeMatches(readback.providerScope, providerScope)) {
      return { status: "unknown", reason: "draft_invoice_delete_readback_scope_mismatch" };
    }
    const isolated = await verifyProgramCustomerIsolation(provider, order);
    const paymentIntents = await listAllCustomerPaymentIntents(provider, order.stripeCustomerId);
    if (!sameIds(paymentIntents.map((row) => row.id), proof.snapshot.paymentIntents.map((row) => row.id)) ||
      !sameIds(paymentIntents.map((row) => row.id), intent.knownPaymentIntentIds) ||
      paymentIntents.some((row) => row.livemode !== providerScope.livemode ||
        !providerScopeMatches(row.providerScope, providerScope))) {
      return { status: "unknown", reason: "draft_invoice_delete_payment_inventory_mismatch" };
    }

    let terminal: ProgramInvoiceDeleteTerminal;
    if (readback.status === "missing") {
      if (readback.invoiceId !== intent.invoiceId || readback.httpStatus !== 404 || readback.errorCode !== "resource_missing") {
        return { status: "unknown", reason: "draft_invoice_delete_readback_unqualified" };
      }
      const expectedRemainingInvoiceIds = proof.snapshot.invoiceIds.filter((id) => id !== intent.invoiceId);
      if (!sameIds(isolated.invoices.map((invoice) => invoice.id), expectedRemainingInvoiceIds)) {
        return { status: "unknown", reason: "draft_invoice_delete_absence_inventory_mismatch" };
      }
      terminal = {
        ...readback,
        inventory: {
          completeInventory: true,
          customerId: isolated.customer.id,
          customer: isolated.customer,
          invoices: isolated.invoices,
          paymentIntents,
          pendingInvoiceItemCount: 0,
          pendingInvoiceItemIds: [],
          subscriptionIds: [],
          scheduleIds: [],
        },
      };
    } else {
      if (readback.invoice.id !== intent.invoiceId ||
        !sameIds(isolated.invoices.map((invoice) => invoice.id), proof.snapshot.invoiceIds)) {
        return { status: "unknown", reason: "draft_invoice_delete_present_inventory_mismatch" };
      }
      const currentInvoice = readback.invoice;
      const amountCents = intent.invoiceItemId === null ? 0 : order.installmentAmountsCents[installmentNumber - 1];
      if (currentInvoice.status !== "draft" || !sameEvidence(currentInvoice, proof.snapshot.invoice) ||
        !verifyInvoiceBase({ invoice: currentInvoice, order, installmentNumber,
          attemptNumber: intent.checkoutAttemptNumber, expectedAmount: amountCents,
          invoiceId: intent.invoiceId, allowedStatus: ["draft"] })) {
        return { status: "blocked", reason: "persisted_draft_invoice_changed" };
      }
      const lines = await listAllInvoiceLines(provider, intent.invoiceId);
      if (!sameEvidence(lines, proof.snapshot.lines) ||
        (intent.invoiceItemId === null && lines.length !== 0) ||
        (intent.invoiceItemId !== null && !verifyExactLine(lines, {
          invoiceId: intent.invoiceId,
          expectedInvoiceItemId: intent.invoiceItemId,
          order,
          installmentNumber,
          attemptNumber: intent.checkoutAttemptNumber,
          amountCents,
          customerId: order.stripeCustomerId,
        }))) {
        return { status: "blocked", reason: "persisted_draft_invoice_lines_changed" };
      }
      const invoicePayments = await listAllInvoicePayments(provider, intent.invoiceId);
      if (invoicePayments.length !== 0 || proof.snapshot.invoicePayments.length !== 0) {
        return { status: "blocked", reason: "persisted_draft_invoice_payment_activity" };
      }

      // This is a continuation of the exact unknown cleanup operation. The stored
      // proof and key are reused; no create, finalize, or pay request is possible here.
      try {
        const deleted = await provider.deleteDraftInvoice({
          invoiceId: intent.invoiceId,
          providerScope,
          idempotencyKey: proof.idempotencyKey,
        });
        if (deleted.id !== intent.invoiceId || deleted.object !== "invoice" || deleted.deleted !== true ||
          !providerScopeMatches(deleted.providerScope, providerScope)) {
          return { status: "unknown", reason: "draft_invoice_delete_response_unverified" };
        }
      } catch {
        // Continue below with an exact readback and fresh full inventory.
      }
      const afterDelete = await provider.retrieveInvoiceDeleteReadback({ invoiceId: intent.invoiceId, providerScope });
      if (!providerScopeMatches(afterDelete.providerScope, providerScope)) {
        return { status: "unknown", reason: "draft_invoice_delete_readback_scope_mismatch" };
      }
      const afterInventory = await verifyProgramCustomerIsolation(provider, order);
      const afterPaymentIntents = await listAllCustomerPaymentIntents(provider, order.stripeCustomerId);
      if (!sameIds(afterPaymentIntents.map((row) => row.id), proof.snapshot.paymentIntents.map((row) => row.id)) ||
        !sameIds(afterPaymentIntents.map((row) => row.id), intent.knownPaymentIntentIds) ||
        afterPaymentIntents.some((row) => row.livemode !== providerScope.livemode ||
          !providerScopeMatches(row.providerScope, providerScope))) {
        return { status: "unknown", reason: "draft_invoice_delete_payment_inventory_mismatch" };
      }
      if (afterDelete.status === "present") {
        if (afterDelete.invoice.id !== intent.invoiceId || !sameEvidence(afterDelete.invoice, proof.snapshot.invoice) ||
          !sameIds(afterInventory.invoices.map((invoice) => invoice.id), proof.snapshot.invoiceIds)) {
          return { status: "blocked", reason: "persisted_draft_invoice_changed" };
        }
        return { status: "unknown", reason: "draft_invoice_still_present" };
      }
      if (afterDelete.invoiceId !== intent.invoiceId || afterDelete.httpStatus !== 404 ||
        afterDelete.errorCode !== "resource_missing" ||
        !sameIds(afterInventory.invoices.map((invoice) => invoice.id),
          proof.snapshot.invoiceIds.filter((id) => id !== intent.invoiceId))) {
        return { status: "unknown", reason: "draft_invoice_delete_absence_inventory_mismatch" };
      }
      terminal = {
        ...afterDelete,
        inventory: {
          completeInventory: true,
          customerId: afterInventory.customer.id,
          customer: afterInventory.customer,
          invoices: afterInventory.invoices,
          paymentIntents: afterPaymentIntents,
          pendingInvoiceItemCount: 0,
          pendingInvoiceItemIds: [],
          subscriptionIds: [],
          scheduleIds: [],
        },
      };
    }
    let reconciled: "deleted" | "present" | "unknown" | "blocked";
    try {
      reconciled = await store.reconcileDraftInvoiceDelete({
        orderId: order.orderId,
        installmentNumber,
        invoiceId: intent.invoiceId,
        idempotencyKey: proof.idempotencyKey,
        snapshotDigest: proof.snapshotDigest,
        terminal,
        terminalDigest: digestProgramBillingEvidence(terminal),
      });
    } catch {
      return { status: "unknown", reason: "draft_invoice_delete_reconciliation_pending" };
    }
    if (reconciled === "deleted") return { status: "deleted" };
    if (reconciled === "present") return { status: "present" };
    if (reconciled === "blocked") return { status: "blocked", reason: "draft_invoice_delete_reconciliation_blocked" };
    return { status: "unknown", reason: "draft_invoice_delete_reconciliation_pending" };
  } catch {
    return { status: "unknown", reason: "draft_invoice_delete_outcome_unresolved" };
  }
}

/**
 * Prepares and reconciles deletion of one exact draft Invoice after a durable
 * buyer-cancellation/deletion fence. The database store must persist the full
 * pre-delete snapshot before this function makes the DELETE request.
 */
export async function deleteDraftProgramInvoiceForCancellation(input: {
  store: ProgramDraftInvoiceDeleteStore;
  provider: ProgramInvoiceProvider;
  intent: ProgramDraftInvoiceDeleteIntent;
}): Promise<{ status: "deleted" | "present" | "unknown" | "blocked"; reason?: string }> {
  const { intent, provider, store } = input;
  const { order, installmentNumber } = intent;
  const providerScope = order.providerScope;
  if (!order.canceled && !order.deletionPending) return { status: "blocked", reason: "cancellation_not_fenced" };
  if (!providerScope || !/^in_[A-Za-z0-9_]+$/.test(intent.invoiceId) ||
    !Number.isInteger(installmentNumber) || installmentNumber < 2 || installmentNumber > order.installmentCount ||
    !Number.isInteger(intent.checkoutAttemptNumber) || intent.checkoutAttemptNumber < 1 || intent.checkoutAttemptNumber > 12 ||
    intent.knownPaymentIntentIds.some((id) => !/^pi_[A-Za-z0-9_]+$/.test(id))) {
    return { status: "blocked", reason: "invoice_delete_identity_invalid" };
  }

  let persisted: ProgramDraftInvoiceDeleteProof | null | { blocked: string };
  try {
    persisted = await store.getDraftInvoiceDelete({
      orderId: order.orderId,
      installmentNumber,
      invoiceId: intent.invoiceId,
    });
  } catch {
    return { status: "unknown", reason: "draft_invoice_delete_state_unavailable" };
  }
  if (persisted && "blocked" in persisted) return { status: "blocked", reason: persisted.blocked };
  if (persisted) {
    if (!persistedDraftDeleteMatchesIntent(persisted, intent)) {
      return { status: "blocked", reason: "persisted_draft_delete_identity_mismatch" };
    }
    if ((persisted.proofState === "deleted" || persisted.proofState === "missing") &&
      persisted.operationState === "succeeded") return { status: "deleted" };
    if (persisted.proofState === "unknown" && persisted.operationState === "unknown") {
      return reconcilePersistedUnknownDraftDelete({ proof: persisted, store, provider, intent });
    }
    if (persisted.proofState !== "prepared" || persisted.operationState !== "intent") {
      return { status: "unknown", reason: "draft_invoice_delete_state_unresolved" };
    }
  }

  let snapshot: ProgramDraftInvoiceDeleteSnapshot;
  try {
    const isolated = await verifyProgramCustomerIsolation(provider, order);
    if (!providerScopeMatches(await provider.getProviderScope(), providerScope)) {
      return { status: "blocked", reason: "provider_scope_changed" };
    }
    const invoice = await provider.retrieveInvoice(intent.invoiceId);
    const amountCents = intent.invoiceItemId === null ? 0 : order.installmentAmountsCents[installmentNumber - 1];
    const attemptNumber = intent.checkoutAttemptNumber;
    if (isolated.invoices.filter((candidate) => candidate.id === invoice.id).length !== 1 ||
      invoice.id !== intent.invoiceId || invoice.status !== "draft" ||
      !verifyInvoiceBase({ invoice, order, installmentNumber, attemptNumber, expectedAmount: amountCents, invoiceId: intent.invoiceId, allowedStatus: ["draft"] })) {
      return { status: "blocked", reason: "draft_invoice_identity_mismatch" };
    }
    const lines = await listAllInvoiceLines(provider, invoice.id);
    if (invoice.lines.hasMore || lines.length !== invoice.lines.totalCount ||
      (intent.invoiceItemId === null && lines.length !== 0) ||
      (intent.invoiceItemId !== null && !verifyExactLine(lines, {
        invoiceId: invoice.id,
        expectedInvoiceItemId: intent.invoiceItemId,
        order,
        installmentNumber,
        attemptNumber,
        amountCents,
        customerId: order.stripeCustomerId,
      }))) return { status: "blocked", reason: "draft_invoice_line_inventory_mismatch" };
    const invoicePayments = await listAllInvoicePayments(provider, invoice.id);
    if (invoicePayments.length !== 0) return { status: "blocked", reason: "draft_invoice_payment_inventory_mismatch" };
    const paymentIntents = await listAllCustomerPaymentIntents(provider, order.stripeCustomerId);
    if (new Set(intent.knownPaymentIntentIds).size !== intent.knownPaymentIntentIds.length ||
      !sameIds(paymentIntents.map((intentRow) => intentRow.id), intent.knownPaymentIntentIds) ||
      paymentIntents.some((intentRow) => intentRow.livemode !== providerScope.livemode ||
        !providerScopeMatches(intentRow.providerScope, providerScope))) {
      return { status: "blocked", reason: "payment_intent_inventory_mismatch" };
    }
    snapshot = {
      invoice,
      lines,
      invoicePayments,
      customer: isolated.customer,
      customerId: order.stripeCustomerId,
      pendingInvoiceItemCount: 0,
      pendingInvoiceItemIds: [],
      providerScope,
      invoiceIds: isolated.invoices.map((candidate) => candidate.id).sort(),
      paymentIntents,
      subscriptionIds: [],
      scheduleIds: [],
    };
  } catch {
    return { status: "unknown", reason: "pre_delete_inventory_unavailable" };
  }

  const snapshotDigest = digestProgramBillingEvidence(snapshot);
  const prepared = await store.prepareDraftInvoiceDelete({
    orderId: order.orderId,
    installmentNumber,
    expectedRevision: intent.expectedRevision,
    invoiceId: intent.invoiceId,
    snapshot,
    snapshotDigest,
  });
  if ("blocked" in prepared) return { status: "blocked", reason: prepared.blocked };
  if (!prepared.idempotencyKey || prepared.snapshotDigest !== snapshotDigest) {
    return { status: "blocked", reason: "draft_invoice_delete_intent_mismatch" };
  }
  let currentProof: ProgramDraftInvoiceDeleteProof | null | { blocked: string };
  try {
    currentProof = await store.getDraftInvoiceDelete({
      orderId: order.orderId,
      installmentNumber,
      invoiceId: intent.invoiceId,
    });
  } catch {
    return { status: "unknown", reason: "draft_invoice_delete_state_unavailable" };
  }
  if (currentProof && "blocked" in currentProof) return { status: "blocked", reason: currentProof.blocked };
  if (!currentProof || !persistedDraftDeleteMatchesIntent(currentProof, intent) ||
    currentProof.snapshotDigest !== prepared.snapshotDigest || currentProof.idempotencyKey !== prepared.idempotencyKey) {
    return { status: "unknown", reason: "draft_invoice_delete_intent_unverified" };
  }
  if (currentProof.proofState === "unknown" && currentProof.operationState === "unknown") {
    return reconcilePersistedUnknownDraftDelete({ proof: currentProof, store, provider, intent });
  }
  if (currentProof.proofState !== "prepared" || currentProof.operationState !== "intent") {
    return { status: "unknown", reason: "draft_invoice_delete_state_unresolved" };
  }
  if (!await store.markDraftInvoiceDeleteUnknown({
    orderId: order.orderId,
    installmentNumber,
    invoiceId: intent.invoiceId,
  })) {
    try {
      const racedProof = await store.getDraftInvoiceDelete({
        orderId: order.orderId,
        installmentNumber,
        invoiceId: intent.invoiceId,
      });
      if (racedProof && !("blocked" in racedProof)) {
        return reconcilePersistedUnknownDraftDelete({ proof: racedProof, store, provider, intent });
      }
    } catch {
      // Keep the durable operation pending when another worker claimed it first.
    }
    return { status: "unknown", reason: "draft_invoice_delete_intent_not_durable" };
  }

  let terminal: ProgramInvoiceDeleteTerminal;
  try {
    const deleted = await provider.deleteDraftInvoice({
      invoiceId: intent.invoiceId,
      providerScope,
      idempotencyKey: prepared.idempotencyKey,
    });
    if (deleted.id !== intent.invoiceId || deleted.object !== "invoice" || deleted.deleted !== true ||
      !providerScopeMatches(deleted.providerScope, providerScope)) {
      return { status: "unknown", reason: "draft_invoice_delete_response_unverified" };
    }
    terminal = {
      status: "deleted",
      invoiceId: deleted.id,
      object: deleted.object,
      deleted: deleted.deleted,
      providerScope: deleted.providerScope,
    };
  } catch {
    try {
      const readback = await provider.retrieveInvoiceDeleteReadback({ invoiceId: intent.invoiceId, providerScope });
      if (!providerScopeMatches(readback.providerScope, providerScope)) {
        return { status: "unknown", reason: "draft_invoice_delete_readback_scope_mismatch" };
      }
      if (readback.status === "missing") {
        if (readback.invoiceId !== intent.invoiceId || readback.httpStatus !== 404 || readback.errorCode !== "resource_missing") {
          return { status: "unknown", reason: "draft_invoice_delete_readback_unqualified" };
        }
        const isolated = await verifyProgramCustomerIsolation(provider, order);
        const paymentIntents = await listAllCustomerPaymentIntents(provider, order.stripeCustomerId);
        if (isolated.invoices.some((invoice) => invoice.id === intent.invoiceId) ||
          !sameIds(paymentIntents.map((intentRow) => intentRow.id), intent.knownPaymentIntentIds) ||
          paymentIntents.some((intentRow) => intentRow.livemode !== providerScope.livemode ||
            !providerScopeMatches(intentRow.providerScope, providerScope))) {
          return { status: "unknown", reason: "draft_invoice_delete_absence_inventory_mismatch" };
        }
        terminal = {
          ...readback,
          inventory: {
            completeInventory: true,
            customerId: isolated.customer.id,
            customer: isolated.customer,
            invoices: isolated.invoices,
            paymentIntents,
            pendingInvoiceItemCount: 0,
            pendingInvoiceItemIds: [],
            subscriptionIds: [],
            scheduleIds: [],
          },
        };
      } else {
        if (readback.invoice.id !== intent.invoiceId) return { status: "unknown", reason: "draft_invoice_delete_readback_identity_mismatch" };
        return { status: "unknown", reason: "draft_invoice_still_present" };
      }
    } catch {
      return { status: "unknown", reason: "draft_invoice_delete_outcome_unresolved" };
    }
  }
  let reconciled: "deleted" | "present" | "unknown" | "blocked";
  try {
    reconciled = await store.reconcileDraftInvoiceDelete({
      orderId: order.orderId,
      installmentNumber,
      invoiceId: intent.invoiceId,
      idempotencyKey: prepared.idempotencyKey,
      snapshotDigest,
      terminal,
      terminalDigest: digestProgramBillingEvidence(terminal),
    });
  } catch {
    return { status: "unknown", reason: "draft_invoice_delete_reconciliation_pending" };
  }
  if (reconciled === "deleted") return { status: "deleted" };
  if (reconciled === "present") return { status: "present" };
  if (reconciled === "blocked") return { status: "blocked", reason: "draft_invoice_delete_reconciliation_blocked" };
  return { status: "unknown", reason: "draft_invoice_delete_reconciliation_pending" };
}

async function verifyDefaultInvoicePayment(provider: ProgramInvoiceProvider, invoiceId: string) {
  const payments = await listAllInvoicePayments(provider, invoiceId);
  if (payments.length !== 1 || !payments[0].isDefault || payments[0].type !== "payment_intent" || !payments[0].paymentIntentId) return null;
  if (payments[0].invoiceId !== invoiceId) return null;
  return payments[0];
}

function verifyPaymentIntent(intent: ProgramPaymentIntent, order: ProgramBillingOrder, amountCents: number, allowedStatus: readonly string[]) {
  const expectedFee = expectedApplicationFee(order, amountCents);
  const expectedDestination = order.seller.platformOwned ? null : order.seller.connectedAccountId;
  return Boolean(
    (!order.providerScope || (intent.livemode === order.providerScope.livemode &&
      providerScopeMatches(intent.providerScope, order.providerScope))) &&
    intent.customerId === order.stripeCustomerId &&
      intent.amount === amountCents &&
      intent.currency === PROGRAM_CURRENCY &&
      intent.amountReceived === (intent.status === "succeeded" ? amountCents : 0) &&
      allowedStatus.includes(intent.status) &&
      intent.paymentMethodId === order.savedPaymentMethodId &&
      intent.applicationFeeAmount === (expectedFee === 0 ? null : expectedFee) &&
      intent.transferDestinationId === expectedDestination,
  );
}

async function invoiceAndIntent(provider: ProgramInvoiceProvider, order: ProgramBillingOrder, invoiceId: string, amountCents: number, allowedInvoiceStatuses: readonly ("draft" | "open" | "paid")[], allowedIntentStatuses: readonly string[]) {
  const invoice = await provider.retrieveInvoice(invoiceId);
  if (!verifyInvoiceBase({
    invoice,
    order,
    installmentNumber: Number(invoice.metadata?.program_installment_number),
    attemptNumber: Number(invoice.metadata?.program_attempt_number),
    expectedAmount: amountCents,
    invoiceId,
    allowedStatus: allowedInvoiceStatuses,
  })) return null;
  const invoicePayment = await verifyDefaultInvoicePayment(provider, invoiceId);
  if (!invoicePayment?.paymentIntentId) return null;
  if (
    invoicePayment.status !== (invoice.status === "paid" ? "paid" : "open") ||
    invoicePayment.amountRequested !== amountCents ||
    invoicePayment.amountPaid !== (invoice.status === "paid" ? amountCents : null) ||
    invoicePayment.currency !== PROGRAM_CURRENCY
  ) return null;
  const paymentIntentId = invoicePayment.paymentIntentId;
  const intent = await provider.retrievePaymentIntent(paymentIntentId);
  if (!verifyPaymentIntent(intent, order, amountCents, allowedIntentStatuses)) return null;
  return { invoice, invoicePayments: [invoicePayment], paymentIntentId, intent };
}

function canonicalChargeId(intent: ProgramPaymentIntent) {
  return intent.latestChargeId && /^ch_[A-Za-z0-9_]+$/.test(intent.latestChargeId) ? intent.latestChargeId : null;
}

async function audit(provider: ProgramBillingStore, input: {
  orderId: string;
  checkoutAttemptNumber: number;
  installmentNumber: number;
  providerObjectType: "checkout_session" | "payment_intent" | "invoice" | "invoice_item" | "customer";
  providerObjectId: string;
  status: string;
  digest: string;
  isCurrentAttempt: boolean;
}) {
  await provider.recordProviderObservation(input);
}

/** Creates/finalizes one invoice without automatic collection, then explicitly pays its exact PI. */
export async function collectProgramInstallment(input: {
  store: ProgramBillingStore;
  stripe: ProgramInvoiceProvider;
  orderId: string;
  installmentNumber: number;
  expectedRevision: number;
  today: string;
  now: string;
}): Promise<ProgramInvoiceResult> {
  const prepared = await input.store.prepareInstallmentInvoice({
    orderId: input.orderId,
    installmentNumber: input.installmentNumber,
    expectedRevision: input.expectedRevision,
    today: input.today,
  });
  if ("blocked" in prepared) return { status: "blocked", reason: prepared.blocked };
  if (prepared.order.providerScope) {
    try {
      if (!providerScopeMatches(await input.stripe.getProviderScope(), prepared.order.providerScope)) {
        return { status: "blocked", reason: "provider_scope_changed" };
      }
    } catch {
      return { status: "blocked", reason: "provider_scope_unavailable" };
    }
  }
  const readiness = getProgramInvoiceReadiness({
    order: prepared.order,
    installmentNumber: prepared.installmentNumber,
    today: input.today,
    now: input.now,
    retryStartedAt: prepared.collectionStartedAt,
    retryDeadline: prepared.retryDeadline,
  });
  if (readiness.status !== "ready") {
    return readiness.status === "blocked"
      ? { status: "blocked", reason: readiness.reason }
      : { status: readiness.status };
  }
  if (!isValidProgramBillingConsent({ consent: prepared.order.consent!, order: prepared.order, now: input.now })) {
    return { status: "blocked", reason: "invalid_or_expired_terms" };
  }
  if (!prepared.order.providerScope) return { status: "blocked", reason: "provider_scope_missing" };
  if (!validSeller(prepared.order) || prepared.order.savedPaymentMethodId === null) {
    return { status: "blocked", reason: "seller_or_saved_card_invalid" };
  }
  if (prepared.installmentNumber < 2 || prepared.order.installmentAmountsCents.length !== prepared.order.installmentCount) {
    return { status: "blocked", reason: "invalid_installment" };
  }
  try {
    await verifyProgramCustomerIsolation(input.stripe, prepared.order);
  } catch {
    return { status: "blocked", reason: "program_customer_inventory_mismatch" };
  }

  const attemptNumber = prepared.order.currentAttemptNumber;
  const expectedAmount = readiness.amountCents;
  let invoiceId = prepared.invoiceId;

  if (!invoiceId) {
    if (prepared.invoiceCreateOutcome === "unknown") {
      try {
        const existing = await findSingleMetadataInvoice(input.stripe, prepared.order, prepared.installmentNumber, attemptNumber);
        if (existing) {
          invoiceId = existing.id;
        } else {
          if (!canRepeatStripeCreate({ firstRequestedAt: prepared.retryStartedAt!, now: input.now })) return { status: "unknown" };
          const marked = await input.store.markOperationUnknown({
            orderId: prepared.order.orderId,
            operationKind: "invoice_create",
            checkoutAttemptNumber: attemptNumber,
            installmentNumber: prepared.installmentNumber,
            paymentAttemptNumber: 0,
          });
          if (!marked) return { status: "unknown" };
          const retried = await input.stripe.createInvoice({
            customerId: prepared.order.stripeCustomerId,
            savedPaymentMethodId: prepared.order.savedPaymentMethodId!,
            amountCents: expectedAmount,
            currency: PROGRAM_CURRENCY,
            orderId: prepared.order.orderId,
            installmentNumber: prepared.installmentNumber,
            attemptNumber,
            seller: prepared.order.seller,
            providerScope: prepared.order.providerScope,
            idempotencyKey: prepared.createInvoiceIdempotencyKey,
          });
          invoiceId = retried.id;
        }
      } catch {
        return { status: "unknown" };
      }
    } else {
      const marked = await input.store.markOperationUnknown({
        orderId: prepared.order.orderId,
        operationKind: "invoice_create",
        checkoutAttemptNumber: attemptNumber,
        installmentNumber: prepared.installmentNumber,
        paymentAttemptNumber: 0,
      });
      if (!marked) return { status: "unknown" };
      try {
        const created = await input.stripe.createInvoice({
          customerId: prepared.order.stripeCustomerId,
          savedPaymentMethodId: prepared.order.savedPaymentMethodId!,
          amountCents: expectedAmount,
          currency: PROGRAM_CURRENCY,
          orderId: prepared.order.orderId,
          installmentNumber: prepared.installmentNumber,
          attemptNumber,
          seller: prepared.order.seller,
          providerScope: prepared.order.providerScope,
          idempotencyKey: prepared.createInvoiceIdempotencyKey,
        });
        invoiceId = created.id;
      } catch {
        try {
          const existing = await findSingleMetadataInvoice(input.stripe, prepared.order, prepared.installmentNumber, attemptNumber);
          if (!existing) return { status: "unknown" };
          invoiceId = existing.id;
        } catch {
          return { status: "unknown" };
        }
      }
    }
    if (!/^in_[A-Za-z0-9_]+$/.test(invoiceId)) return { status: "blocked", reason: "invalid_invoice_id" };
    let invoiceEvidence: ProgramInvoice;
    try {
      invoiceEvidence = await input.stripe.retrieveInvoice(invoiceId);
    } catch {
      return { status: "unknown" };
    }
    if (!verifyInvoiceBase({
      invoice: invoiceEvidence,
      order: prepared.order,
      installmentNumber: prepared.installmentNumber,
      attemptNumber,
      expectedAmount: 0,
      invoiceId,
      allowedStatus: ["draft"],
    }) || invoiceEvidence.lines.hasMore || invoiceEvidence.lines.totalCount !== 0) {
      await audit(input.store, {
        orderId: prepared.order.orderId,
        checkoutAttemptNumber: attemptNumber,
        installmentNumber: prepared.installmentNumber,
        providerObjectType: "invoice",
        providerObjectId: invoiceId,
        status: "invoice_quarantined",
        digest: digestProgramBillingEvidence(invoiceEvidence),
        isCurrentAttempt: true,
      });
      return { status: "blocked", reason: "invoice_identity_mismatch_quarantined" };
    }
    const bound = await input.store.bindInvoice({
      orderId: prepared.order.orderId,
      installmentNumber: prepared.installmentNumber,
      expectedRevision: prepared.expectedRevision,
      invoiceId,
      evidence: invoiceEvidence,
      evidenceDigest: digestProgramBillingEvidence(invoiceEvidence),
    });
    if (!bound) return { status: "unknown" };
  }

  let invoice: ProgramInvoice;
  let invoiceItemId = prepared.invoiceItemId;
  try {
    invoice = await input.stripe.retrieveInvoice(invoiceId);
    if (!invoiceItemId && prepared.lineCreateOutcome === "unknown") {
      const lines = await listAllInvoiceLines(input.stripe, invoiceId);
      const matching = lines.filter((line) =>
        line.metadata?.program_order_id === prepared.order.orderId &&
        line.metadata?.program_installment_number === String(prepared.installmentNumber) &&
        line.metadata?.program_attempt_number === String(attemptNumber),
      );
      if (matching.length === 1 && lines.length === 1 && lineInvoiceItemId(matching[0]) && verifyExactLine(lines, {
        invoiceId,
        expectedInvoiceItemId: lineInvoiceItemId(matching[0])!,
        order: prepared.order,
        installmentNumber: prepared.installmentNumber,
        attemptNumber,
        amountCents: expectedAmount,
        customerId: prepared.order.stripeCustomerId,
      })) {
        invoiceItemId = lineInvoiceItemId(matching[0]);
      } else if (lines.length !== 0) {
        await audit(input.store, {
          orderId: prepared.order.orderId,
          checkoutAttemptNumber: attemptNumber,
          installmentNumber: prepared.installmentNumber,
          providerObjectType: "invoice",
          providerObjectId: invoiceId,
          status: "invoice_line_inventory_mismatch",
          digest: digestProgramBillingEvidence(lines),
          isCurrentAttempt: true,
        });
        return { status: "blocked", reason: "invoice_line_inventory_mismatch" };
      }
    }
  } catch {
    return { status: "unknown" };
  }
  if (!verifyInvoiceBase({
    invoice,
    order: prepared.order,
    installmentNumber: prepared.installmentNumber,
    attemptNumber,
    expectedAmount: invoiceItemId ? expectedAmount : 0,
    invoiceId,
    allowedStatus: ["draft", "open", "paid"],
  })) {
    await audit(input.store, {
      orderId: prepared.order.orderId,
      checkoutAttemptNumber: attemptNumber,
      installmentNumber: prepared.installmentNumber,
      providerObjectType: "invoice",
      providerObjectId: invoiceId,
      status: "invoice_quarantined",
      digest: digestProgramBillingEvidence(invoice),
      isCurrentAttempt: true,
    });
    return { status: "blocked", reason: "invoice_mismatch_quarantined" };
  }
  if (invoice.status !== "draft" && !invoiceItemId) {
    return { status: "blocked", reason: "paid_invoice_without_bound_line" };
  }

  if (!invoiceItemId) {
    if (prepared.lineCreateOutcome === "unknown") {
      try {
        const lines = await listAllInvoiceLines(input.stripe, invoiceId);
        const matching = lines.filter((line) =>
          line.metadata?.program_order_id === prepared.order.orderId &&
          line.metadata?.program_installment_number === String(prepared.installmentNumber) &&
          line.metadata?.program_attempt_number === String(attemptNumber),
        );
        if (matching.length === 1 && lines.length === 1 && lineInvoiceItemId(matching[0])) {
          invoiceItemId = lineInvoiceItemId(matching[0]);
        } else if (lines.length !== 0) {
          return { status: "blocked", reason: "invoice_line_inventory_mismatch" };
        } else if (!canRepeatStripeCreate({ firstRequestedAt: prepared.retryStartedAt!, now: input.now })) {
          return { status: "unknown" };
        }
      } catch {
        return { status: "unknown" };
      }
    }
    if (!invoiceItemId) {
      const marked = await input.store.markOperationUnknown({
        orderId: prepared.order.orderId,
        operationKind: "invoice_item_create",
        checkoutAttemptNumber: attemptNumber,
        installmentNumber: prepared.installmentNumber,
        paymentAttemptNumber: 0,
      });
      if (!marked) return { status: "unknown" };
      try {
        const line = await input.stripe.createInvoiceLine({
          invoiceId,
          customerId: prepared.order.stripeCustomerId,
          amountCents: expectedAmount,
          currency: PROGRAM_CURRENCY,
          orderId: prepared.order.orderId,
          installmentNumber: prepared.installmentNumber,
          attemptNumber,
          providerScope: prepared.order.providerScope,
          idempotencyKey: prepared.createLineIdempotencyKey,
        });
        invoiceItemId = line.id;
      } catch {
        try {
          const lines = await listAllInvoiceLines(input.stripe, invoiceId);
          const matching = lines.filter((line) =>
            line.metadata?.program_order_id === prepared.order.orderId &&
            line.metadata?.program_installment_number === String(prepared.installmentNumber) &&
            line.metadata?.program_attempt_number === String(attemptNumber),
          );
          if (matching.length !== 1 || !lineInvoiceItemId(matching[0])) return { status: "unknown" };
          invoiceItemId = lineInvoiceItemId(matching[0]);
        } catch {
          return { status: "unknown" };
        }
      }
      if (!invoiceItemId) return { status: "unknown" };
    }
  }
  if (!/^ii_[A-Za-z0-9_]+$/.test(invoiceItemId)) return { status: "blocked", reason: "invalid_invoice_item_id" };

  let exactInvoiceLine: ProgramInvoiceLine | null = null;
  try {
    const lines = await listAllInvoiceLines(input.stripe, invoiceId);
    if (!verifyExactLine(lines, {
      invoiceId,
      expectedInvoiceItemId: invoiceItemId,
      order: prepared.order,
      installmentNumber: prepared.installmentNumber,
      attemptNumber,
      amountCents: expectedAmount,
      customerId: prepared.order.stripeCustomerId,
    })) return { status: "blocked", reason: "invoice_line_mismatch" };
    exactInvoiceLine = lines[0];
  } catch {
    return { status: "unknown" };
  }
  if (!prepared.invoiceItemId) {
    const bound = await input.store.bindInvoiceItem({
      orderId: prepared.order.orderId,
      installmentNumber: prepared.installmentNumber,
      expectedRevision: prepared.expectedRevision,
      invoiceItemId,
      evidence: exactInvoiceLine,
      evidenceDigest: digestProgramBillingEvidence(exactInvoiceLine),
    });
    if (!bound) return { status: "unknown" };
  }

  try {
    const lines = await listAllInvoiceLines(input.stripe, invoiceId);
    const current = await input.stripe.retrieveInvoice(invoiceId);
    if (current.status === "draft") {
      if (!verifyInvoiceBase({
        invoice: current,
        order: prepared.order,
        installmentNumber: prepared.installmentNumber,
        attemptNumber,
        expectedAmount,
        invoiceId,
        allowedStatus: ["draft"],
      }) || !verifyExactLine(lines, {
        invoiceId,
        expectedInvoiceItemId: invoiceItemId,
        order: prepared.order,
        installmentNumber: prepared.installmentNumber,
        attemptNumber,
        amountCents: expectedAmount,
        customerId: prepared.order.stripeCustomerId,
      })) {
        return { status: "blocked", reason: "draft_invoice_line_mismatch" };
      }
      try {
        const marked = await input.store.markOperationUnknown({
          orderId: prepared.order.orderId,
          operationKind: "invoice_finalize",
          checkoutAttemptNumber: attemptNumber,
          installmentNumber: prepared.installmentNumber,
          paymentAttemptNumber: 0,
        });
        if (!marked) return { status: "unknown" };
        await input.stripe.finalizeInvoice({
          invoiceId,
          autoAdvance: false,
          idempotencyKey: prepared.finalizeIdempotencyKey,
        });
      } catch {
        // The durable finalize intent is reconciled by retrieving this exact invoice on retry.
      }
    } else if (!verifyExactLine(lines, {
      invoiceId,
      expectedInvoiceItemId: invoiceItemId,
      order: prepared.order,
      installmentNumber: prepared.installmentNumber,
      attemptNumber,
      amountCents: expectedAmount,
      customerId: prepared.order.stripeCustomerId,
    })) {
      return { status: "blocked", reason: "invoice_line_mismatch" };
    }
  } catch {
    return { status: "unknown" };
  }

  let verified: Awaited<ReturnType<typeof invoiceAndIntent>>;
  try {
    const currentInvoice = await input.stripe.retrieveInvoice(invoiceId);
    if (!verifyInvoiceBase({
      invoice: currentInvoice,
      order: prepared.order,
      installmentNumber: prepared.installmentNumber,
      attemptNumber,
      expectedAmount,
      invoiceId,
      allowedStatus: ["open", "paid"],
    }) || !await verifyInvoiceLines(input.stripe, currentInvoice, {
      order: prepared.order,
      installmentNumber: prepared.installmentNumber,
      attemptNumber,
      amountCents: expectedAmount,
      expectedInvoiceItemId: invoiceItemId,
    })) {
      return { status: "blocked", reason: "finalized_invoice_mismatch" };
    }
    verified = await invoiceAndIntent(
      input.stripe,
      prepared.order,
      invoiceId,
      expectedAmount,
      ["open", "paid"],
      ["requires_payment_method", "requires_confirmation", "requires_action", "processing", "succeeded"],
    );
    if (!verified) return { status: "blocked", reason: "invoice_payment_intent_mismatch" };
    if (prepared.paymentIntentId && prepared.paymentIntentId !== verified.paymentIntentId) {
      return { status: "blocked", reason: "payment_intent_identity_changed" };
    }
    if (!prepared.paymentIntentId) {
      const bound = await input.store.bindPaymentIntent({
        orderId: prepared.order.orderId,
        installmentNumber: prepared.installmentNumber,
        expectedRevision: prepared.expectedRevision,
        paymentIntentId: verified.paymentIntentId,
        evidence: { invoice: verified.invoice, invoicePayments: verified.invoicePayments, paymentIntent: verified.intent },
        evidenceDigest: digestProgramBillingEvidence({ invoice: verified.invoice, invoicePayments: verified.invoicePayments, paymentIntent: verified.intent }),
      });
      if (!bound) return { status: "unknown" };
    }
    await audit(input.store, {
      orderId: prepared.order.orderId,
      checkoutAttemptNumber: attemptNumber,
      installmentNumber: prepared.installmentNumber,
      providerObjectType: "payment_intent",
      providerObjectId: verified.paymentIntentId,
      status: verified.intent.status,
      digest: digestProgramBillingEvidence({ invoice: verified.invoice, paymentIntent: verified.intent }),
      isCurrentAttempt: true,
    });
    const savedMethod = await input.stripe.retrievePaymentMethod(prepared.order.savedPaymentMethodId);
    if (savedMethod.id !== prepared.order.savedPaymentMethodId || savedMethod.customerId !== prepared.order.stripeCustomerId || savedMethod.type !== "card") {
      return { status: "blocked", reason: "saved_card_customer_mismatch" };
    }
    if (verified.intent.status === "succeeded" && verified.invoice.status === "paid") {
      const chargeId = canonicalChargeId(verified.intent);
      if (!chargeId || !invoiceItemId || !await verifyInvoiceLines(input.stripe, verified.invoice, {
        order: prepared.order,
        installmentNumber: prepared.installmentNumber,
        attemptNumber,
        amountCents: expectedAmount,
        expectedInvoiceItemId: invoiceItemId,
      })) return { status: "blocked", reason: "paid_invoice_proof_incomplete" };
      return { status: "payment_succeeded_awaiting_ledger", invoiceId, paymentIntentId: verified.paymentIntentId, chargeId };
    }
    if (verified.intent.status === "canceled") return { status: "blocked", reason: "installment_payment_intent_canceled" };
    if (verified.intent.status === "requires_action") {
      await input.store.recordActionRequired({ orderId: prepared.order.orderId, installmentNumber: prepared.installmentNumber, paymentIntentId: verified.paymentIntentId });
      return { status: "requires_action" };
    }
    if (verified.intent.status === "processing") return { status: "processing" };
  } catch {
    return { status: "unknown" };
  }

  if (readiness.retryDeadline !== null && Date.parse(input.now) > Date.parse(readiness.retryDeadline)) {
    return { status: "retry_expired" };
  }

  const payAttempt = await input.store.prepareInvoicePayAttempt({
    orderId: prepared.order.orderId,
    installmentNumber: prepared.installmentNumber,
    expectedRevision: prepared.expectedRevision,
    invoiceId,
    paymentIntentId: verified!.paymentIntentId,
    verifiedStatus: verified!.intent.status,
    evidenceDigest: digestProgramBillingEvidence({ invoice: verified!.invoice, paymentIntent: verified!.intent }),
  });
  if ("blocked" in payAttempt) return { status: "blocked", reason: payAttempt.blocked };

  let paymentResult: ProgramInvoice;
  try {
    paymentResult = await input.stripe.payInvoice({
      invoiceId,
      paymentMethodId: prepared.order.savedPaymentMethodId,
      offSession: true,
      idempotencyKey: payAttempt.idempotencyKey,
    });
  } catch {
    // Reconcile the exact Invoice/PI. Never repeat an uncertain pay request with a new key here.
    try {
      const post = await invoiceAndIntent(input.stripe, prepared.order, invoiceId, expectedAmount, ["open", "paid"], [
        "requires_payment_method", "requires_action", "processing", "succeeded",
      ]);
      if (!post) return { status: "unknown" };
      await audit(input.store, {
        orderId: prepared.order.orderId,
        checkoutAttemptNumber: attemptNumber,
        installmentNumber: prepared.installmentNumber,
        providerObjectType: "payment_intent",
        providerObjectId: post.paymentIntentId,
        status: post.intent.status,
        digest: digestProgramBillingEvidence(post.intent),
        isCurrentAttempt: true,
      });
      if (post.intent.status === "requires_action") {
        await input.store.recordActionRequired({ orderId: prepared.order.orderId, installmentNumber: prepared.installmentNumber, paymentIntentId: post.paymentIntentId });
        return { status: "requires_action" };
      }
      if (post.intent.status === "processing") return { status: "processing" };
      if (post.intent.status === "succeeded" && post.invoice.status === "paid") {
        const chargeId = canonicalChargeId(post.intent);
        if (!chargeId || !invoiceItemId || !await verifyInvoiceLines(input.stripe, post.invoice, {
          order: prepared.order,
          installmentNumber: prepared.installmentNumber,
          attemptNumber,
          amountCents: expectedAmount,
          expectedInvoiceItemId: invoiceItemId,
        })) return { status: "blocked", reason: "paid_invoice_proof_incomplete" };
        return { status: "payment_succeeded_awaiting_ledger", invoiceId, paymentIntentId: post.paymentIntentId, chargeId };
      }
      if (post.intent.status === "requires_payment_method") return { status: "retryable_failure" };
      return { status: "unknown" };
    } catch {
      return { status: "unknown" };
    }
  }
  if (paymentResult.id !== invoiceId || paymentResult.customerId !== prepared.order.stripeCustomerId) return { status: "blocked", reason: "pay_response_mismatch" };

  try {
    const post = await invoiceAndIntent(input.stripe, prepared.order, invoiceId, expectedAmount, ["open", "paid"], [
      "requires_payment_method", "requires_action", "processing", "succeeded",
    ]);
    if (!post) return { status: "unknown" };
    const chargeId = canonicalChargeId(post.intent);
    await audit(input.store, {
      orderId: prepared.order.orderId,
      checkoutAttemptNumber: attemptNumber,
      installmentNumber: prepared.installmentNumber,
      providerObjectType: "payment_intent",
      providerObjectId: post.paymentIntentId,
      status: post.intent.status,
      digest: digestProgramBillingEvidence(post.intent),
      isCurrentAttempt: true,
    });
    if (post.intent.status === "requires_action") {
      await input.store.recordActionRequired({ orderId: prepared.order.orderId, installmentNumber: prepared.installmentNumber, paymentIntentId: post.paymentIntentId });
      return { status: "requires_action" };
    }
    if (post.intent.status === "processing") return { status: "processing" };
    if (post.intent.status !== "succeeded" || post.invoice.status !== "paid" || !chargeId) return { status: "unknown" };
    if (!await verifyInvoiceLines(input.stripe, post.invoice, {
      order: prepared.order,
      installmentNumber: prepared.installmentNumber,
      attemptNumber,
      amountCents: expectedAmount,
      expectedInvoiceItemId: invoiceItemId,
    })) return { status: "blocked", reason: "paid_invoice_line_mismatch" };
    return { status: "payment_succeeded_awaiting_ledger", invoiceId, paymentIntentId: post.paymentIntentId, chargeId };
  } catch {
    return { status: "unknown" };
  }
}

export function digestProgramBillingEvidence(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function listAllCheckoutSessions(
  provider: ProgramCheckoutProvider,
  customerId: string,
  expectedScope?: ProgramProviderScope | null,
) {
  const sessions: ProgramCheckoutSession[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 1_000; page += 1) {
    const result = await provider.listCheckoutSessions({ customerId, ...(startingAfter ? { startingAfter } : {}) });
    assertCompletePage<ProgramCheckoutSession>(result, "Checkout Session");
    if (result.data.some((session) => !session.id || session.customerId !== customerId ||
      (expectedScope && (session.livemode !== expectedScope.livemode ||
        !providerScopeMatches(session.providerScope, expectedScope) ||
        !providerMetadataMatchesScope(session.metadata, expectedScope))))) {
      throw new Error("Checkout Session inventory returned a mismatched Customer or missing ID");
    }
    sessions.push(...result.data);
    if (!result.hasMore) return sessions;
    const lastId = result.data.at(-1)?.id;
    if (!lastId || lastId === startingAfter) throw new Error("Checkout Session inventory pagination did not advance");
    startingAfter = lastId;
  }
  throw new Error("Checkout Session inventory exceeded the pagination safety bound");
}

async function listAllPaymentIntents(
  provider: ProgramCheckoutProvider,
  customerId: string,
  expectedScope?: ProgramProviderScope | null,
) {
  const intents: ProgramPaymentIntent[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 1_000; page += 1) {
    const result = await provider.listPaymentIntents({ customerId, ...(startingAfter ? { startingAfter } : {}) });
    assertCompletePage<ProgramPaymentIntent>(result, "PaymentIntent");
    if (result.data.some((intent) => !intent.id || intent.customerId !== customerId ||
      (expectedScope && (intent.livemode !== expectedScope.livemode ||
        !providerScopeMatches(intent.providerScope, expectedScope) ||
        !providerMetadataMatchesScope(intent.metadata, expectedScope))))) {
      throw new Error("PaymentIntent inventory returned a mismatched Customer or missing ID");
    }
    intents.push(...result.data);
    if (!result.hasMore) return intents;
    const lastId = result.data.at(-1)?.id;
    if (!lastId || lastId === startingAfter) throw new Error("PaymentIntent inventory pagination did not advance");
    startingAfter = lastId;
  }
  throw new Error("PaymentIntent inventory exceeded the pagination safety bound");
}

function validProgramCheckoutTerms(order: ProgramBillingOrder, today: string, now: string) {
  if (
    order.currency !== PROGRAM_CURRENCY ||
    order.effectiveTotalCents <= 0 ||
    order.installmentCount < 1 ||
    order.installmentCount > PROGRAM_MAX_INSTALLMENTS ||
    order.installmentAmountsCents.length !== order.installmentCount ||
    order.installmentAmountsCents.some((amount) => !Number.isSafeInteger(amount) || amount < PROGRAM_MIN_CHARGE_CENTS) ||
    order.installmentAmountsCents.reduce((sum, amount) => sum + amount, 0) !== order.effectiveTotalCents ||
    !order.consent ||
    !isValidProgramBillingConsent({ consent: order.consent, order, now }) ||
    !validSeller(order) ||
    !isValidIsoDate(today)
  ) return false;
  if (order.installmentCount === 1) return order.consent.disclosedChargeDates.length === 0;
  const dates = order.consent.disclosedChargeDates;
  if (dates.length !== order.installmentCount - 1 || dates[0] <= today) return false;
  const [firstYear, firstMonth, firstDay] = dates[0].split("-").map(Number);
  const anchor = { day: firstDay, endOfMonth: firstDay === lastCalendarDay(firstYear, firstMonth - 1) };
  for (let index = 1; index < dates.length; index += 1) {
    const nextDate = addCalendarMonth(dates[index - 1], anchor);
    if (!nextDate || dates[index] !== nextDate) return false;
  }
  return true;
}

function validProgramCheckoutReturnUrls(successUrl: string, cancelUrl: string) {
  try {
    const success = new URL(successUrl);
    const cancel = new URL(cancelUrl);
    return success.protocol === "https:" && cancel.protocol === "https:" &&
      success.origin === cancel.origin && !success.username && !success.password &&
      !cancel.username && !cancel.password && !success.hash && !cancel.hash &&
      successUrl.length <= 2_048 && cancelUrl.length <= 2_048;
  } catch {
    return false;
  }
}

function checkoutSessionIdentityMatches(session: ProgramCheckoutSession, intent: ProgramCheckoutAttemptIntent) {
  const scope = intent.order.providerScope;
  return Boolean(
    session.customerId === intent.order.stripeCustomerId &&
    (!scope || (session.livemode === scope.livemode && providerScopeMatches(session.providerScope, scope) &&
      providerMetadataMatchesScope(session.metadata, scope))) &&
    session.clientReferenceId === intent.attempt.attemptId &&
    session.mode === "payment" &&
    session.amountTotal === intent.order.installmentAmountsCents[0] &&
    session.currency === PROGRAM_CURRENCY &&
    session.metadata?.program_billing_kind === "program_sale" &&
    session.metadata?.program_order_id === intent.order.orderId &&
    session.metadata?.program_checkout_attempt_id === intent.attempt.attemptId &&
    session.metadata?.program_checkout_attempt_number === String(intent.attempt.attemptNumber)
  );
}

function checkoutPaymentIntentIdentityMatches(
  paymentIntent: ProgramPaymentIntent,
  intent: ProgramCheckoutAttemptIntent,
) {
  const { order, attempt } = intent;
  const amount = order.installmentAmountsCents[0];
  const fee = expectedApplicationFee(order, amount);
  const scope = order.providerScope;
  return Boolean(
      (attempt.paymentIntentId === null || paymentIntent.id === attempt.paymentIntentId) &&
      (!scope || (paymentIntent.livemode === scope.livemode && providerScopeMatches(paymentIntent.providerScope, scope) &&
        providerMetadataMatchesScope(paymentIntent.metadata, scope))) &&
      paymentIntent.customerId === order.stripeCustomerId &&
      paymentIntent.amount === amount &&
      paymentIntent.currency === PROGRAM_CURRENCY &&
      paymentIntent.amountReceived === (paymentIntent.status === "succeeded" ? amount : 0) &&
      paymentIntent.applicationFeeAmount === (fee === 0 ? null : fee) &&
      paymentIntent.transferDestinationId === (order.seller.platformOwned ? null : order.seller.connectedAccountId) &&
      paymentIntent.metadata?.program_billing_kind === "program_sale" &&
      paymentIntent.metadata?.program_order_id === order.orderId &&
      paymentIntent.metadata?.program_checkout_attempt_id === attempt.attemptId &&
      paymentIntent.metadata?.program_checkout_attempt_number === String(attempt.attemptNumber) &&
      paymentIntent.metadata?.program_installment_number === "1" &&
      ["requires_payment_method", "requires_confirmation", "requires_action", "processing", "succeeded", "canceled"].includes(paymentIntent.status),
  );
}

class ProgramCheckoutInventoryConflict extends Error {}

async function resolveCheckoutSession(input: {
  intent: ProgramCheckoutAttemptIntent;
  provider: ProgramCheckoutProvider;
}) {
  const { intent, provider } = input;
  if (intent.attempt.checkoutSessionId) {
    return provider.retrieveCheckoutSession(intent.attempt.checkoutSessionId);
  }
  if (intent.createOutcome === "unknown") {
    const sessions = await listAllCheckoutSessions(provider, intent.order.stripeCustomerId, intent.order.providerScope);
    const matching = sessions.filter((session) => checkoutSessionIdentityMatches(session, intent));
    if (matching.length !== 1) {
      if (matching.length > 1) throw new ProgramCheckoutInventoryConflict("Multiple Checkout Sessions claim one Program attempt");
      return null;
    }
    return matching[0];
  }
  return null;
}

function canRepeatStripeCreate(input: { firstRequestedAt: string; now: string }) {
  const requestedAt = Date.parse(input.firstRequestedAt);
  const now = Date.parse(input.now);
  return Number.isFinite(requestedAt) && Number.isFinite(now) && now >= requestedAt &&
    now - requestedAt < PROGRAM_STRIPE_IDEMPOTENCY_RETRY_WINDOW_MS;
}

async function verifyCheckoutAttemptInventory(input: {
  provider: ProgramCheckoutProvider;
  intent: ProgramCheckoutAttemptIntent;
  currentSessionId: string | null;
}) {
  const { intent, provider } = input;
  const { order, attempt, priorAttempts } = intent;
  if (
    priorAttempts.length !== attempt.attemptNumber - 1 ||
    priorAttempts.some((prior, index) => prior.attemptNumber !== index + 1 || !prior.checkoutSessionId)
  ) return false;
  const isolated = await verifyProgramCustomerIsolation(provider, order);
  if (isolated.invoices.length !== 0) return false;
  const [sessions, paymentIntents] = await Promise.all([
    listAllCheckoutSessions(provider, order.stripeCustomerId, order.providerScope),
    listAllPaymentIntents(provider, order.stripeCustomerId, order.providerScope),
  ]);
  const expected = [
    ...priorAttempts,
    ...(input.currentSessionId ? [{ ...attempt, checkoutSessionId: input.currentSessionId }] : []),
  ];
  if (sessions.length !== expected.length) return false;
  const expectedIntentIds = new Set<string>();
  for (const expectedAttempt of expected) {
    const attemptContext = { ...intent, attempt: expectedAttempt };
    const matching = sessions.filter((session) =>
      session.id === expectedAttempt.checkoutSessionId && checkoutSessionIdentityMatches(session, attemptContext),
    );
    if (matching.length !== 1) return false;
    const session = matching[0];
    const isPrior = expectedAttempt.attemptNumber < attempt.attemptNumber;
    if (isPrior && (session.status !== "expired" || session.paymentStatus !== "unpaid")) return false;
    if ((isPrior && session.paymentIntentId !== expectedAttempt.paymentIntentId) ||
      (!isPrior && expectedAttempt.paymentIntentId && session.paymentIntentId !== expectedAttempt.paymentIntentId)) return false;
    if (session.paymentIntentId) {
      expectedIntentIds.add(session.paymentIntentId);
      const paymentIntent = await provider.retrievePaymentIntent(session.paymentIntentId);
      if (!checkoutPaymentIntentIdentityMatches(paymentIntent, attemptContext)) return false;
      if (isPrior && (paymentIntent.status !== "canceled" || paymentIntent.amountReceived !== 0)) return false;
    }
  }
  if (paymentIntents.length !== expectedIntentIds.size || paymentIntents.some((item) => !expectedIntentIds.has(item.id))) return false;
  return true;
}

async function materializeCheckout(input: {
  store: ProgramCheckoutStore;
  provider: ProgramCheckoutProvider;
  intent: ProgramCheckoutAttemptIntent;
  today: string;
  now: string;
}): Promise<ProgramCheckoutResult> {
  const { intent, store, provider } = input;
  const order = intent.order;
  if (order.providerScope) {
    try {
      if (!providerScopeMatches(await provider.getProviderScope(), order.providerScope)) {
        return { status: "blocked", reason: "provider_scope_changed" };
      }
    } catch {
      return { status: "blocked", reason: "provider_scope_unavailable" };
    }
  }
  if (order.canceled || order.deletionPending || order.financialConflict || order.firstSettledAt !== null || order.clearedInstallments !== 0) {
    return { status: "blocked", reason: "order_not_checkout_eligible" };
  }
  if (order.promotionReservationState === "released" || order.promotionReservationState === "redeemed") {
    return { status: "blocked", reason: "promotion_reservation_not_current" };
  }
  if (!validProgramCheckoutTerms(order, input.today, input.now)) {
    return { status: "blocked", reason: "terms_invalid_or_updated_dates_required" };
  }
  if (!/^[-0-9a-f]{36}$/i.test(intent.attempt.attemptId) || intent.attempt.attemptNumber !== order.currentAttemptNumber) {
    return { status: "blocked", reason: "checkout_attempt_identity_mismatch" };
  }
  if (intent.priorAttempts.length !== intent.attempt.attemptNumber - 1 || !Number.isFinite(Date.parse(intent.createRequestedAt))) {
    return { status: "blocked", reason: "checkout_attempt_history_incomplete" };
  }
  if (intent.attempt.attemptNumber > 1 && (!intent.retryRequestId || !sha256Pattern.test(intent.retryProofDigest ?? ""))) {
    return { status: "blocked", reason: "checkout_retry_missing_terminal_proof" };
  }

  let session: ProgramCheckoutSession | null;
  try {
    session = await resolveCheckoutSession({ intent, provider });
  } catch (error) {
    if (!(error instanceof ProgramCheckoutInventoryConflict)) return { status: "unknown" };
    const digest = digestProgramBillingEvidence({ orderId: order.orderId, attempt: intent.attempt, error: String(error) });
    await store.recordCheckoutConflict({ orderId: order.orderId, attemptNumber: intent.attempt.attemptNumber, reason: "checkout_session_inventory_ambiguous", evidenceDigest: digest });
    return { status: "blocked", reason: "checkout_session_inventory_ambiguous" };
  }

  let createdFromResponse = false;
  if (!session && (intent.createOutcome === "not_started" || intent.createOutcome === "unknown")) {
    let inventoryClear = false;
    try {
      inventoryClear = await verifyCheckoutAttemptInventory({ provider, intent, currentSessionId: null });
    } catch {
      return { status: "unknown" };
    }
    if (!inventoryClear) {
      await store.recordCheckoutConflict({
        orderId: order.orderId,
        attemptNumber: intent.attempt.attemptNumber,
        reason: "checkout_attempt_inventory_mismatch",
        evidenceDigest: digestProgramBillingEvidence({ orderId: order.orderId, attempt: intent.attempt }),
      });
      return { status: "blocked", reason: "checkout_attempt_inventory_mismatch" };
    }
    if (intent.createOutcome === "unknown" && !canRepeatStripeCreate({ firstRequestedAt: intent.createRequestedAt, now: input.now })) {
      return { status: "unknown" };
    }
    const marked = await store.markCheckoutCreateUnknown({
      orderId: order.orderId,
      attemptNumber: intent.attempt.attemptNumber,
    });
    if (!marked) return { status: "unknown" };
    try {
      session = await provider.createCheckoutSession({
        order,
        attemptId: intent.attempt.attemptId,
        attemptNumber: intent.attempt.attemptNumber,
        successUrl: intent.successUrl,
        cancelUrl: intent.cancelUrl,
        idempotencyKey: intent.idempotencyKey,
      });
      session = await provider.retrieveCheckoutSession(session.id);
      createdFromResponse = true;
    } catch {
      await store.recordCheckoutCreateUnknown({
        orderId: order.orderId,
        attemptNumber: intent.attempt.attemptNumber,
        requestDigest: digestProgramBillingEvidence({ orderId: order.orderId, attempt: intent.attempt, amount: order.installmentAmountsCents[0] }),
      });
      try {
        session = await resolveCheckoutSession({ intent: { ...intent, createOutcome: "unknown" }, provider });
      } catch {
        return { status: "unknown" };
      }
    }
  }
  if (!session) return { status: "unknown" };
  if (!checkoutSessionIdentityMatches(session, intent) || !/^cs_[A-Za-z0-9_]+$/.test(session.id)) {
    await store.recordCheckoutConflict({
      orderId: order.orderId,
      attemptNumber: intent.attempt.attemptNumber,
      reason: "checkout_session_identity_mismatch",
      evidenceDigest: digestProgramBillingEvidence(session),
    });
    return { status: "blocked", reason: "checkout_session_identity_mismatch" };
  }
  if (!createdFromResponse) {
    let inventoryMatches = false;
    try {
      inventoryMatches = await verifyCheckoutAttemptInventory({ provider, intent, currentSessionId: session.id });
    } catch {
      return { status: "unknown" };
    }
    if (!inventoryMatches) {
      await store.recordCheckoutConflict({
        orderId: order.orderId,
        attemptNumber: intent.attempt.attemptNumber,
        reason: "checkout_attempt_inventory_mismatch",
        evidenceDigest: digestProgramBillingEvidence({ orderId: order.orderId, session }),
      });
      return { status: "blocked", reason: "checkout_attempt_inventory_mismatch" };
    }
  }
  let paymentIntent: ProgramPaymentIntent | null = null;
  if (session.paymentIntentId) {
    try {
      paymentIntent = await provider.retrievePaymentIntent(session.paymentIntentId);
    } catch {
      return { status: "unknown" };
    }
    if (
      paymentIntent.id !== session.paymentIntentId ||
      !checkoutPaymentIntentIdentityMatches(paymentIntent, intent)
    ) {
      await store.recordCheckoutConflict({
        orderId: order.orderId,
        attemptNumber: intent.attempt.attemptNumber,
        reason: "checkout_payment_intent_identity_mismatch",
        evidenceDigest: digestProgramBillingEvidence(paymentIntent),
      });
      return { status: "blocked", reason: "checkout_payment_intent_identity_mismatch" };
    }
    if (paymentIntent.paymentMethodId) {
      let method: ProgramPaymentMethod;
      try {
        method = await provider.retrievePaymentMethod(paymentIntent.paymentMethodId);
      } catch {
        return { status: "unknown" };
      }
      if (
        method.id !== paymentIntent.paymentMethodId || method.type !== "card" ||
        (order.installmentCount > 1 && method.customerId !== order.stripeCustomerId)
      ) {
        await store.recordCheckoutConflict({
          orderId: order.orderId,
          attemptNumber: intent.attempt.attemptNumber,
          reason: "checkout_payment_method_identity_mismatch",
          evidenceDigest: digestProgramBillingEvidence(method),
        });
        return { status: "blocked", reason: "checkout_payment_method_identity_mismatch" };
      }
    } else if (paymentIntent.status === "succeeded" || paymentIntent.status === "canceled") {
      return { status: "unknown" };
    }
  }
  if (session.paymentStatus === "paid" && (session.status !== "complete" || paymentIntent?.status !== "succeeded")) {
    await store.recordCheckoutConflict({
      orderId: order.orderId,
      attemptNumber: intent.attempt.attemptNumber,
      reason: "checkout_paid_without_succeeded_payment_intent",
      evidenceDigest: digestProgramBillingEvidence({ session, paymentIntent }),
    });
    return { status: "blocked", reason: "checkout_paid_without_succeeded_payment_intent" };
  }
  if (session.paymentStatus === "paid" && (!paymentIntent?.paymentMethodId || !canonicalChargeId(paymentIntent))) {
    return { status: "unknown" };
  }
  if (paymentIntent?.status === "succeeded" && (session.status !== "complete" || session.paymentStatus !== "paid")) {
    await store.recordCheckoutConflict({
      orderId: order.orderId,
      attemptNumber: intent.attempt.attemptNumber,
      reason: "succeeded_payment_intent_without_paid_checkout",
      evidenceDigest: digestProgramBillingEvidence({ session, paymentIntent }),
    });
    return { status: "blocked", reason: "succeeded_payment_intent_without_paid_checkout" };
  }
  await store.recordCheckoutObservation({
    orderId: order.orderId,
    attemptNumber: intent.attempt.attemptNumber,
    sessionId: session.id,
    paymentIntentId: session.paymentIntentId,
    status: session.status ?? "unknown",
    digest: digestProgramBillingEvidence({ session, paymentIntent }),
  });
  const bound = await store.bindCheckoutSession({
    orderId: order.orderId,
    attemptNumber: intent.attempt.attemptNumber,
    expectedRevision: intent.expectedRevision,
    sessionId: session.id,
    paymentIntentId: session.paymentIntentId,
    evidence: { session, paymentIntent },
    evidenceDigest: digestProgramBillingEvidence({ session, paymentIntent }),
  });
  if (!bound) return { status: "unknown" };
  if (session.status === "expired" && session.paymentStatus === "unpaid") {
    return paymentIntent?.status === "canceled" && paymentIntent.amountReceived === 0
      ? { status: "expired_requires_explicit_retry" }
      : { status: "unknown" };
  }
  if (session.status === "complete" && session.paymentStatus === "paid") return { status: "paid_awaiting_ledger" };
  if (session.status !== "open" || session.paymentStatus !== "unpaid" || !session.url) return { status: "unknown" };
  if (paymentIntent && ["processing", "succeeded", "canceled"].includes(paymentIntent.status)) return { status: "unknown" };
  return { status: "checkout_ready", checkoutUrl: session.url, attemptNumber: intent.attempt.attemptNumber };
}

export async function createProgramCheckout(input: {
  store: ProgramCheckoutStore;
  provider: ProgramCheckoutProvider;
  orderId: string;
  expectedRevision: number;
  successUrl: string;
  cancelUrl: string;
  today: string;
  now: string;
}): Promise<ProgramCheckoutResult> {
  if (!validProgramCheckoutReturnUrls(input.successUrl, input.cancelUrl)) {
    return { status: "blocked", reason: "checkout_return_urls_invalid" };
  }
  const intent = await input.store.prepareCheckoutAttempt({
    orderId: input.orderId,
    expectedRevision: input.expectedRevision,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
  if ("blocked" in intent) return { status: "blocked", reason: intent.blocked };
  return materializeCheckout({ ...input, intent });
}

/** Persists a per-order Customer intent before creating the isolated Stripe Customer. */
export async function ensureProgramBillingCustomer(input: {
  store: ProgramCheckoutStore;
  provider: ProgramCheckoutProvider;
  orderId: string;
  expectedRevision: number;
  now: string;
}) {
  let providerScope: ProgramProviderScope;
  try {
    providerScope = await input.provider.getProviderScope();
  } catch {
    return { status: "blocked" as const, reason: "provider_scope_unavailable" };
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(providerScope.platformAccountId) || typeof providerScope.livemode !== "boolean") {
    return { status: "blocked" as const, reason: "provider_scope_invalid" };
  }
  const intent = await input.store.prepareProgramCustomer({ orderId: input.orderId, expectedRevision: input.expectedRevision, providerScope });
  if ("blocked" in intent) return { status: "blocked" as const, reason: intent.blocked };
  if (!providerScopeMatches(intent.providerScope, providerScope)) {
    return { status: "blocked" as const, reason: "provider_scope_changed" };
  }
  if (intent.customerId) {
    try {
      const customer = await input.provider.retrieveCustomer(intent.customerId);
      if (
        customer.deleted || customer.id !== intent.customerId ||
        customer.metadata?.program_order_id !== intent.orderId ||
        customer.metadata?.program_billing_purpose !== "program_order" ||
        customer.balance !== 0 || !hasZeroInvoiceCreditBalance(customer.invoiceCreditBalance) ||
        customer.discountId !== null || customer.taxExempt !== "none"
        || customer.livemode !== providerScope.livemode || !providerScopeMatches(customer.providerScope, providerScope)
        || !providerMetadataMatchesScope(customer.metadata, providerScope)
      ) {
        await input.store.recordProgramCustomerConflict({
          orderId: intent.orderId,
          reason: "program_customer_inventory_mismatch",
          evidenceDigest: digestProgramBillingEvidence(customer),
        });
        return { status: "blocked" as const, reason: "program_customer_inventory_mismatch" };
      }
      return { status: "ready" as const, customerId: customer.id };
    } catch {
      return { status: "unknown" as const };
    }
  }
  const retryUntil = Date.parse(intent.retryUnknownUntil);
  const now = Date.parse(input.now);
  if (!Number.isFinite(now) || !Number.isFinite(retryUntil)) return { status: "blocked" as const, reason: "customer_intent_timestamp_invalid" };
  if (now >= retryUntil) return { status: "unknown" as const };
  if (intent.createOutcome === "created") return { status: "unknown" as const };
  const marked = await input.store.markProgramCustomerCreateUnknown({ orderId: intent.orderId });
  if (!marked) return { status: "unknown" as const };
  try {
    const customer = await input.provider.createCustomer({
      orderId: intent.orderId,
      idempotencyKey: intent.idempotencyKey,
      providerScope,
    });
    if (
      !/^cus_[A-Za-z0-9_]+$/.test(customer.id) || customer.deleted ||
      customer.metadata?.program_order_id !== intent.orderId ||
      customer.metadata?.program_billing_purpose !== "program_order" ||
      customer.balance !== 0 || !hasZeroInvoiceCreditBalance(customer.invoiceCreditBalance) ||
      customer.discountId !== null || customer.taxExempt !== "none" ||
      customer.livemode !== providerScope.livemode || !providerScopeMatches(customer.providerScope, providerScope) ||
      !providerMetadataMatchesScope(customer.metadata, providerScope)
    ) {
      await input.store.recordProgramCustomerConflict({
        orderId: intent.orderId,
        reason: "created_customer_is_not_isolated",
        evidenceDigest: digestProgramBillingEvidence(customer),
      });
      return { status: "blocked" as const, reason: "created_customer_is_not_isolated" };
    }
    const bound = await input.store.bindProgramCustomer({
      orderId: intent.orderId,
      expectedRevision: intent.expectedRevision,
      customerId: customer.id,
      evidence: customer,
      evidenceDigest: digestProgramBillingEvidence(customer),
    });
    return bound ? { status: "ready" as const, customerId: customer.id } : { status: "unknown" as const };
  } catch {
    await input.store.recordProgramCustomerCreateUnknown({
      orderId: intent.orderId,
      requestDigest: digestProgramBillingEvidence({ orderId: intent.orderId, operation: "create_isolated_program_customer" }),
    });
    return { status: "unknown" as const };
  }
}

/** Full provider proof for a retry after an expired unpaid initial Checkout Session. */
export async function verifyTerminalProgramCheckoutInventory(input: {
  provider: ProgramCheckoutProvider;
  order: ProgramBillingOrder;
  attempts: readonly ProgramCheckoutPaymentAttempt[];
  priorAttemptNumber: number;
}) {
  const { order, provider } = input;
  if (
    order.firstSettledAt !== null || order.clearedInstallments !== 0 ||
    order.canceled || order.deletionPending || order.financialConflict ||
    order.installmentCount < 1 || order.installmentAmountsCents.length !== order.installmentCount || !order.providerScope ||
    input.priorAttemptNumber !== order.currentAttemptNumber ||
    input.attempts.length !== input.priorAttemptNumber ||
    input.attempts.some((attempt, index) => attempt.attemptNumber !== index + 1 || !attempt.checkoutSessionId || !/^[-0-9a-f]{36}$/i.test(attempt.attemptId))
  ) return null;

  try {
    const isolated = await verifyProgramCustomerIsolation(provider, order);
    if (isolated.invoices.length !== 0) return null;
    const [sessions, paymentIntents] = await Promise.all([
      listAllCheckoutSessions(provider, order.stripeCustomerId, order.providerScope),
      listAllPaymentIntents(provider, order.stripeCustomerId, order.providerScope),
    ]);
    if (sessions.length !== input.attempts.length) return null;
    const observed: Array<ProgramCheckoutTerminalProof["attempts"][number]> = [];
    const expectedPaymentIntentIds = new Set<string>();
    for (const attempt of input.attempts) {
      const matchingSessions = sessions.filter((session) =>
        session.id === attempt.checkoutSessionId &&
        session.metadata?.program_order_id === order.orderId &&
        session.metadata?.program_checkout_attempt_id === attempt.attemptId &&
        session.metadata?.program_checkout_attempt_number === String(attempt.attemptNumber),
      );
      if (matchingSessions.length !== 1) return null;
      const session = matchingSessions[0];
      if (
        session.customerId !== order.stripeCustomerId || session.clientReferenceId !== attempt.attemptId ||
        session.livemode !== order.providerScope.livemode || !providerScopeMatches(session.providerScope, order.providerScope) ||
        !providerMetadataMatchesScope(session.metadata, order.providerScope) ||
        session.mode !== "payment" || session.status !== "expired" || session.paymentStatus !== "unpaid" ||
        session.amountTotal !== order.installmentAmountsCents[0] || session.currency !== PROGRAM_CURRENCY ||
        session.paymentIntentId !== attempt.paymentIntentId
      ) return null;
      const paymentIntentId = session.paymentIntentId;
      let intent: ProgramPaymentIntent | null = null;
      if (paymentIntentId) {
        expectedPaymentIntentIds.add(paymentIntentId);
        intent = await provider.retrievePaymentIntent(paymentIntentId);
        const expectedFee = expectedApplicationFee(order, order.installmentAmountsCents[0]);
        if (
          intent.id !== paymentIntentId || intent.customerId !== order.stripeCustomerId ||
          intent.livemode !== order.providerScope.livemode || !providerScopeMatches(intent.providerScope, order.providerScope) ||
          !providerMetadataMatchesScope(intent.metadata, order.providerScope) ||
          intent.amount !== order.installmentAmountsCents[0] || intent.currency !== PROGRAM_CURRENCY ||
          intent.status !== "canceled" || intent.amountReceived !== 0 ||
          intent.applicationFeeAmount !== (expectedFee === 0 ? null : expectedFee) ||
          intent.transferDestinationId !== (order.seller.platformOwned ? null : order.seller.connectedAccountId) ||
          intent.metadata?.program_order_id !== order.orderId ||
          intent.metadata?.program_checkout_attempt_id !== attempt.attemptId ||
          intent.metadata?.program_checkout_attempt_number !== String(attempt.attemptNumber)
        ) return null;
      }
      observed.push({
        attemptNumber: attempt.attemptNumber,
        attemptId: attempt.attemptId,
        sessionId: session.id,
        paymentIntentId,
        sessionStatus: "expired",
        sessionPaymentStatus: "unpaid",
        paymentIntentStatus: intent ? "canceled" : null,
        amountCents: order.installmentAmountsCents[0],
        amountReceivedCents: 0,
        currency: PROGRAM_CURRENCY,
        customerId: order.stripeCustomerId,
        evidenceDigest: digestProgramBillingEvidence({ session, intent }),
      });
    }
    if (paymentIntents.length !== expectedPaymentIntentIds.size ||
      paymentIntents.some((intent) => !expectedPaymentIntentIds.has(intent.id)) ||
      [...expectedPaymentIntentIds].some((id) => paymentIntents.filter((intent) => intent.id === id).length !== 1)) return null;
    const evidence = {
      orderId: order.orderId,
      customerId: order.stripeCustomerId,
      priorAttemptNumber: input.priorAttemptNumber,
      attempts: observed,
      invoices: isolated.invoices.map((invoice) => invoice.id).sort(),
      subscriptions: [],
      schedules: [],
      pendingInvoiceItems: 0,
      sessionIds: sessions.map((session) => session.id).sort(),
      paymentIntentIds: paymentIntents.map((intent) => intent.id).sort(),
    };
    return {
      orderId: order.orderId,
      customerId: order.stripeCustomerId,
      priorAttemptNumber: input.priorAttemptNumber,
      sessionIds: evidence.sessionIds,
      paymentIntentIds: evidence.paymentIntentIds,
      invoiceIds: evidence.invoices,
      subscriptionIds: [] as string[],
      scheduleIds: [] as string[],
      pendingInvoiceItemCount: 0,
      attempts: observed,
      digest: digestProgramBillingEvidence(evidence),
      completeInventory: true as const,
    } satisfies ProgramCheckoutTerminalProof;
  } catch {
    return null;
  }
}

/** Requires a persisted buyer retry request and exact terminal provider proof before rotating the pointer. */
export async function retryProgramCheckout(input: {
  store: ProgramCheckoutStore;
  provider: ProgramCheckoutProvider;
  orderId: string;
  expectedRevision: number;
  explicitRequestId: string;
  requestedAt: string;
  today: string;
  now: string;
}): Promise<ProgramCheckoutResult> {
  if (!/^[-0-9a-f]{36}$/i.test(input.explicitRequestId)) return { status: "blocked", reason: "retry_request_id_invalid" };
  const prior = await input.store.prepareBuyerRetry({
    orderId: input.orderId,
    expectedRevision: input.expectedRevision,
    explicitRequestId: input.explicitRequestId,
    requestedAt: input.requestedAt,
  });
  if ("blocked" in prior) return { status: "blocked", reason: prior.blocked };
  if (prior.order.promotionReservationState === "released" || prior.order.promotionReservationState === "redeemed") {
    return { status: "blocked", reason: "frozen_quote_or_promotion_no_longer_current" };
  }
  const proof = await verifyTerminalProgramCheckoutInventory({
    provider: input.provider,
    order: prior.order,
    attempts: prior.attempts,
    priorAttemptNumber: prior.order.currentAttemptNumber,
  });
  if (!proof) return { status: "unknown" };
  const next = await input.store.advanceCheckoutAttempt({
    orderId: input.orderId,
    expectedRevision: prior.expectedRevision,
    priorAttemptNumber: prior.order.currentAttemptNumber,
    explicitRequestId: input.explicitRequestId,
    proof,
  });
  if ("blocked" in next) return { status: "blocked", reason: next.blocked };
  return materializeCheckout({ store: input.store, provider: input.provider, today: input.today, now: input.now, intent: next });
}
