import "server-only";

import { platformHasTier } from "@/lib/platform-membership-server";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import {
  createProgramCheckout,
  ensureProgramBillingCustomer,
  retryProgramCheckout,
  type ProgramBillingOrder,
  type ProgramCheckoutAttemptIntent,
  type ProgramCheckoutPaymentAttempt,
  type ProgramCheckoutProvider,
  type ProgramCheckoutResult,
  type ProgramCheckoutSession,
  type ProgramCheckoutStore,
  type ProgramCustomerSetupIntent,
  type ProgramPaymentIntent,
  type ProgramProviderScope,
  type ProgramStripeCustomer,
} from "./program-billing";
import { createProgramCheckoutProvider } from "./program-billing-stripe";
import {
  buildProgramCheckoutReturnUrls,
  isUuid,
  isProgramProviderScope,
  isRecordValue,
  isStrictStripeCheckoutUrl,
  isoDate,
  isoTimestamp,
  parseProgramBillingConsent,
  parseProgramCheckoutRetryCommand,
  parseProgramCheckoutStartCommand,
  programBillingOrderFromSnapshot,
  safeInteger,
  type ProgramCheckoutOrderSnapshot,
} from "./program-checkout-contracts";

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }>;
};

export type ProgramCheckoutLoadedSnapshot = {
  order: ProgramCheckoutOrderSnapshot;
  billingOrder: ProgramBillingOrder | null;
  customerSetup: {
    idempotencyKey: string;
    createRequestedAt: string;
    createOutcome: "not_started" | "unknown" | "created";
  } | null;
};

export type ProgramCheckoutServerStore = ProgramCheckoutStore & {
  loadSnapshot(orderId: string, expectedRevision: number): Promise<ProgramCheckoutLoadedSnapshot | { blocked: string }>;
  getCurrentRevision(): number;
};

class ProgramCheckoutContractError extends Error {}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function readProviderScope(value: unknown): ProgramProviderScope | null {
  if (value === null) return null;
  if (!isRecordValue(value)) throw new ProgramCheckoutContractError("Invalid provider scope DTO");
  const scope = { platformAccountId: value.platform_account_id, livemode: value.livemode };
  if (!isProgramProviderScope(scope)) throw new ProgramCheckoutContractError("Invalid provider scope DTO");
  return scope;
}

function mapSnapshot(value: unknown, expectedBuyerId: string): ProgramCheckoutLoadedSnapshot {
  if (!isRecordValue(value)) throw new ProgramCheckoutContractError("Invalid checkout snapshot DTO");
  if (value.status !== "ready") throw new ProgramCheckoutContractError(typeof value.status === "string" ? value.status : "invalid_snapshot_status");
  if (value.buyer_id !== expectedBuyerId || !isUuid(value.order_id) || !isUuid(value.program_id)) {
    throw new ProgramCheckoutContractError("checkout_snapshot_identity_mismatch");
  }
  if (value.currency !== "usd" || !safeInteger(value.effective_total_cents, 50) || !safeInteger(value.installment_count, 1) ||
      value.installment_count > 12 || !Array.isArray(value.installment_amounts_cents) ||
      !value.installment_amounts_cents.every((amount) => safeInteger(amount, 50)) ||
      value.installment_amounts_cents.length !== value.installment_count ||
      value.installment_amounts_cents.reduce((sum, amount) => sum + (amount as number), 0) !== value.effective_total_cents ||
      !safeInteger(value.cleared_installments) || !safeInteger(value.current_attempt_number) ||
      value.cleared_installments > value.installment_count || value.current_attempt_number > 12 ||
      !safeInteger(value.billing_revision, 1)) {
    throw new ProgramCheckoutContractError("checkout_snapshot_amount_or_revision_invalid");
  }
  const reservationState = value.promotion_reservation_state;
  if (!(reservationState === "none" || reservationState === "reserved" || reservationState === "redeemed" || reservationState === "released")) {
    throw new ProgramCheckoutContractError("checkout_snapshot_reservation_invalid");
  }
  if (!isNullableString(value.stripe_customer_id) ||
      (value.stripe_customer_id !== null && !/^cus_[A-Za-z0-9_]+$/.test(value.stripe_customer_id)) ||
      !isNullableString(value.saved_payment_method_id) ||
      (value.saved_payment_method_id !== null && !/^pm_[A-Za-z0-9_]+$/.test(value.saved_payment_method_id)) ||
      typeof value.platform_owned !== "boolean" ||
      !isNullableString(value.connected_account_id) ||
      !safeInteger(value.application_fee_basis_points) ||
      (value.platform_owned && (value.connected_account_id !== null || value.application_fee_basis_points !== 0)) ||
      (!value.platform_owned && (value.connected_account_id === null || value.application_fee_basis_points !== 1000))) {
    throw new ProgramCheckoutContractError("checkout_snapshot_seller_invalid");
  }
  const consent = parseProgramBillingConsent(value.consent);
  if (!consent || consent.totalCents !== value.effective_total_cents || consent.installmentCount !== value.installment_count) {
    throw new ProgramCheckoutContractError("checkout_snapshot_terms_invalid");
  }
  if ((value.installment_count === 1 && (consent.savedCardForOffSession || consent.retryWindowDays !== null ||
        consent.disclosedChargeDates.length !== 0)) ||
      (value.installment_count > 1 && (!consent.savedCardForOffSession || consent.retryWindowDays !== 7 ||
        consent.disclosedChargeDates.length !== value.installment_count - 1))) {
    throw new ProgramCheckoutContractError("checkout_snapshot_schedule_terms_invalid");
  }
  if (!(value.first_settled_at === null || isoTimestamp(value.first_settled_at)) ||
      !(value.next_anchor_date === null || isoDate(value.next_anchor_date)) ||
      !(value.retry_deadline === null || isoTimestamp(value.retry_deadline)) ||
      typeof value.canceled !== "boolean" || typeof value.deletion_pending !== "boolean" ||
      typeof value.financial_conflict !== "boolean" || !Array.isArray(value.attempts) || value.attempts.length > 12) {
    throw new ProgramCheckoutContractError("checkout_snapshot_state_invalid");
  }
  const attempts: ProgramCheckoutOrderSnapshot["attempts"][number][] = value.attempts.map((item) => {
    if (!isRecordValue(item) || !safeInteger(item.attempt_number, 1) || item.attempt_number > 12 ||
        !isUuid(item.attempt_id) ||
        !isNullableString(item.checkout_session_id) || !isNullableString(item.payment_intent_id) ||
        !isNullableString(item.explicit_retry_request_id) ||
        !(item.retry_proof_digest === null || (typeof item.retry_proof_digest === "string" && /^[0-9a-f]{64}$/.test(item.retry_proof_digest)))) {
      throw new ProgramCheckoutContractError("checkout_snapshot_attempt_invalid");
    }
    if ((item.checkout_session_id !== null && !/^cs_[A-Za-z0-9_]+$/.test(item.checkout_session_id)) ||
        (item.payment_intent_id !== null && !/^pi_[A-Za-z0-9_]+$/.test(item.payment_intent_id))) {
      throw new ProgramCheckoutContractError("checkout_snapshot_attempt_identity_invalid");
    }
    if ((item.attempt_number === 1 && (item.explicit_retry_request_id !== null || item.retry_proof_digest !== null)) ||
        (item.attempt_number > 1 && (!isUuid(item.explicit_retry_request_id) || typeof item.retry_proof_digest !== "string"))) {
      throw new ProgramCheckoutContractError("checkout_snapshot_retry_provenance_invalid");
    }
    return {
      attemptNumber: item.attempt_number,
      attemptId: item.attempt_id,
      checkoutSessionId: item.checkout_session_id,
      paymentIntentId: item.payment_intent_id,
      explicitRetryRequestId: item.explicit_retry_request_id,
      retryProofDigest: item.retry_proof_digest,
    };
  });
  if (attempts.some((attempt, index) => attempt.attemptNumber !== index + 1) ||
      attempts.length !== value.current_attempt_number) {
    throw new ProgramCheckoutContractError("checkout_snapshot_attempt_history_invalid");
  }
  const providerScope = readProviderScope(value.provider_scope);
  if (value.stripe_customer_id !== null && providerScope === null) {
    throw new ProgramCheckoutContractError("checkout_snapshot_customer_scope_missing");
  }
  let customerSetup: ProgramCheckoutLoadedSnapshot["customerSetup"] = null;
  if (value.customer_setup !== null) {
    if (!isRecordValue(value.customer_setup) || typeof value.customer_setup.idempotency_key !== "string" ||
        value.customer_setup.idempotency_key.length < 16 || !isoTimestamp(value.customer_setup.create_requested_at) ||
        !(value.customer_setup.create_outcome === "not_started" || value.customer_setup.create_outcome === "unknown" ||
          value.customer_setup.create_outcome === "created")) {
      throw new ProgramCheckoutContractError("checkout_snapshot_customer_setup_invalid");
    }
    customerSetup = {
      idempotencyKey: value.customer_setup.idempotency_key,
      createRequestedAt: value.customer_setup.create_requested_at,
      createOutcome: value.customer_setup.create_outcome,
    };
  }
  const snapshot: ProgramCheckoutOrderSnapshot = {
    orderId: value.order_id as string,
    buyerId: expectedBuyerId,
    programId: value.program_id as string,
    currency: "usd",
    effectiveTotalCents: value.effective_total_cents as number,
    installmentAmountsCents: value.installment_amounts_cents as number[],
    installmentCount: value.installment_count as number,
    clearedInstallments: value.cleared_installments as number,
    promotionReservationState: reservationState,
    stripeCustomerId: value.stripe_customer_id as string | null,
    providerScope,
    savedPaymentMethodId: value.saved_payment_method_id as string | null,
    seller: value.platform_owned
      ? { platformOwned: true, connectedAccountId: null, applicationFeeBasisPoints: 0 }
      : { platformOwned: false, connectedAccountId: value.connected_account_id as string, applicationFeeBasisPoints: 1000 },
    consent,
    firstSettledAt: value.first_settled_at as string | null,
    nextAnchorDate: value.next_anchor_date as string | null,
    retryDeadline: value.retry_deadline as string | null,
    canceled: value.canceled as boolean,
    deletionPending: value.deletion_pending as boolean,
    financialConflict: value.financial_conflict as boolean,
    currentAttemptNumber: value.current_attempt_number as number,
    billingRevision: value.billing_revision as number,
    attempts,
  };
  return { order: snapshot, billingOrder: programBillingOrderFromSnapshot(snapshot), customerSetup };
}

async function callRpc(client: RpcClient, name: string, args: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(`${name}: ${result.error.message ?? "database RPC failed"}`);
  return result.data;
}

function blockedStatus(value: unknown, fallback: string) {
  return isRecordValue(value) && typeof value.status === "string" ? value.status : fallback;
}

function mapAttempt(value: unknown): ProgramCheckoutPaymentAttempt {
  if (!isRecordValue(value) || !safeInteger(value.attemptNumber, 1) || value.attemptNumber > 12 ||
      !isUuid(value.attemptId) ||
      !isNullableString(value.checkoutSessionId) || !isNullableString(value.paymentIntentId)) {
    throw new ProgramCheckoutContractError("checkout_attempt_dto_invalid");
  }
  return {
    attemptNumber: value.attemptNumber,
    attemptId: value.attemptId,
    checkoutSessionId: value.checkoutSessionId,
    paymentIntentId: value.paymentIntentId,
  };
}

function mapPreparedIntent(raw: unknown, snapshot: ProgramCheckoutLoadedSnapshot): ProgramCheckoutAttemptIntent | { blocked: string } {
  if (!isRecordValue(raw) || raw.status !== "prepared") return { blocked: blockedStatus(raw, "checkout_prepare_failed") };
  const order = snapshot.billingOrder;
  if (!order || !safeInteger(raw.revision, 1) || raw.revision !== snapshot.order.billingRevision ||
      !safeInteger(raw.attempt_number, 1) || raw.attempt_number !== order.currentAttemptNumber ||
      !isUuid(raw.attempt_id) ||
      typeof raw.idempotency_key !== "string" || raw.idempotency_key.length < 16 ||
      !(raw.create_outcome === "not_started" || raw.create_outcome === "unknown" || raw.create_outcome === "created") ||
      !isoTimestamp(raw.create_requested_at) || typeof raw.success_url !== "string" || typeof raw.cancel_url !== "string" ||
      !Array.isArray(raw.prior_attempts)) return { blocked: "checkout_prepare_dto_invalid" };
  const persistedAttempt = snapshot.order.attempts[raw.attempt_number - 1];
  if (!persistedAttempt || persistedAttempt.attemptNumber !== raw.attempt_number || persistedAttempt.attemptId !== raw.attempt_id) {
    return { blocked: "checkout_prepare_snapshot_attempt_mismatch" };
  }
  if ((Object.hasOwn(raw, "checkout_session_id") &&
       (!isNullableString(raw.checkout_session_id) || raw.checkout_session_id !== persistedAttempt.checkoutSessionId)) ||
      (Object.hasOwn(raw, "payment_intent_id") &&
       (!isNullableString(raw.payment_intent_id) || raw.payment_intent_id !== persistedAttempt.paymentIntentId))) {
    return { blocked: "checkout_prepare_snapshot_provider_identity_mismatch" };
  }
  if ((Object.hasOwn(raw, "retry_request_id") && raw.retry_request_id !== persistedAttempt.explicitRetryRequestId) ||
      (Object.hasOwn(raw, "retry_proof_digest") && raw.retry_proof_digest !== persistedAttempt.retryProofDigest)) {
    return { blocked: "checkout_prepare_retry_provenance_mismatch" };
  }
  if ((persistedAttempt.attemptNumber === 1 &&
       (persistedAttempt.explicitRetryRequestId !== null || persistedAttempt.retryProofDigest !== null)) ||
      (persistedAttempt.attemptNumber > 1 &&
       (!isUuid(persistedAttempt.explicitRetryRequestId) ||
        !/^[0-9a-f]{64}$/.test(persistedAttempt.retryProofDigest ?? "")))) {
    return { blocked: "checkout_prepare_retry_provenance_missing" };
  }
  const attempt: ProgramCheckoutPaymentAttempt = {
    attemptNumber: raw.attempt_number,
    attemptId: raw.attempt_id,
    checkoutSessionId: persistedAttempt.checkoutSessionId,
    paymentIntentId: persistedAttempt.paymentIntentId,
  };
  const priorAttempts = raw.prior_attempts.map(mapAttempt);
  const expectedPriorAttempts = snapshot.order.attempts.slice(0, attempt.attemptNumber - 1);
  if (priorAttempts.length !== attempt.attemptNumber - 1 ||
      priorAttempts.some((prior, index) => {
        const expected = expectedPriorAttempts[index];
        return !expected || prior.attemptNumber !== expected.attemptNumber || prior.attemptId !== expected.attemptId ||
          prior.checkoutSessionId !== expected.checkoutSessionId || prior.paymentIntentId !== expected.paymentIntentId ||
          prior.checkoutSessionId === null;
      })) {
    return { blocked: "checkout_prepare_history_invalid" };
  }
  return {
    order,
    attempt,
    priorAttempts,
    expectedRevision: raw.revision,
    idempotencyKey: raw.idempotency_key,
    createRequestedAt: raw.create_requested_at,
    createOutcome: raw.create_outcome,
    successUrl: raw.success_url,
    cancelUrl: raw.cancel_url,
    retryProofDigest: persistedAttempt.retryProofDigest,
    retryRequestId: persistedAttempt.explicitRetryRequestId,
  };
}

function customerEvidence(value: ProgramStripeCustomer) {
  return {
    id: value.id,
    deleted: value.deleted,
    balance: value.balance,
    invoiceCreditBalance: value.invoiceCreditBalance,
    discountId: value.discountId,
    taxExempt: value.taxExempt,
    metadata: value.metadata,
    livemode: value.livemode,
    providerScope: value.providerScope ? {
      platformAccountId: value.providerScope.platformAccountId,
      livemode: value.providerScope.livemode,
    } : null,
  };
}

function paymentIntentEvidence(value: ProgramPaymentIntent | null) {
  if (!value) return null;
  return {
    id: value.id,
    customer_id: value.customerId,
    amount: value.amount,
    currency: value.currency,
    application_fee_amount: value.applicationFeeAmount,
    transfer_destination_id: value.transferDestinationId,
    livemode: value.livemode,
    metadata: value.metadata,
  };
}

function checkoutEvidence(input: {
  session: ProgramCheckoutSession;
  paymentIntent: ProgramPaymentIntent | null;
}) {
  const { session, paymentIntent } = input;
  return {
    id: session.id,
    providerScope: session.providerScope ? { platformAccountId: session.providerScope.platformAccountId, livemode: session.providerScope.livemode } : null,
    livemode: session.livemode,
    customer_id: session.customerId,
    client_reference_id: session.clientReferenceId,
    mode: session.mode,
    status: session.status,
    payment_status: session.paymentStatus,
    amount_total: session.amountTotal,
    currency: session.currency,
    metadata: session.metadata,
    payment_intent_id: session.paymentIntentId,
    payment_intent: paymentIntentEvidence(paymentIntent),
  };
}

const customerConflictReasons = new Set(["program_customer_inventory_mismatch", "created_customer_is_not_isolated"]);
const checkoutConflictReasons = new Set([
  "checkout_session_inventory_ambiguous", "checkout_attempt_inventory_mismatch", "checkout_session_identity_mismatch",
  "checkout_payment_intent_identity_mismatch", "checkout_payment_method_identity_mismatch",
  "checkout_paid_without_succeeded_payment_intent", "succeeded_payment_intent_without_paid_checkout",
]);

export function createProgramCheckoutServerStore(input: {
  serviceClient: RpcClient;
  buyerClient: RpcClient;
  buyerId: string;
  initialRevision: number;
}): ProgramCheckoutServerStore {
  let currentRevision = input.initialRevision;
  const loadSnapshot = async (orderId: string, expectedRevision: number) => {
    const raw = await callRpc(input.serviceClient, "get_program_checkout_snapshot", {
      p_order_id: orderId,
      p_expected_buyer_id: input.buyerId,
      p_expected_billing_revision: expectedRevision,
    });
    if (!isRecordValue(raw) || raw.status !== "ready") return { blocked: blockedStatus(raw, "checkout_snapshot_unavailable") } as const;
    const mapped = mapSnapshot(raw, input.buyerId);
    if (mapped.order.orderId !== orderId || mapped.order.billingRevision !== expectedRevision) return { blocked: "checkout_snapshot_cas_mismatch" } as const;
    currentRevision = expectedRevision;
    return mapped;
  };

  const store: ProgramCheckoutServerStore = {
    loadSnapshot,
    getCurrentRevision: () => currentRevision,
    async prepareProgramCustomer(args) {
      const raw = await callRpc(input.serviceClient, "prepare_program_billing_customer", {
        p_order_id: args.orderId,
        p_expected_revision: args.expectedRevision,
        p_provider_platform_account_id: args.providerScope.platformAccountId,
        p_provider_livemode: args.providerScope.livemode,
      });
      if (!isRecordValue(raw) || !(raw.status === "prepared" || raw.status === "already_bound")) {
        return { blocked: blockedStatus(raw, "customer_prepare_failed") };
      }
      if (!safeInteger(raw.revision, 1)) return { blocked: "customer_prepare_revision_invalid" };
      const providerScope = readProviderScope(raw.provider_scope);
      if (!providerScope) return { blocked: "customer_prepare_scope_invalid" };
      currentRevision = raw.revision;
      let idempotencyKey = raw.idempotency_key;
      let createOutcome = raw.create_outcome;
      let createRequestedAt = raw.create_requested_at;
      if (raw.status === "already_bound") {
        const latest = await loadSnapshot(args.orderId, raw.revision);
        if ("blocked" in latest) return { blocked: latest.blocked };
        const customerSetup = latest.customerSetup;
        if (!customerSetup) return { blocked: "customer_setup_intent_missing" };
        idempotencyKey = customerSetup.idempotencyKey;
        createOutcome = customerSetup.createOutcome;
        createRequestedAt = customerSetup.createRequestedAt;
      }
      const customerId = raw.customer_id;
      const retryUnknownUntil = raw.retry_unknown_until;
      if (!(customerId === null || (typeof customerId === "string" && /^cus_[A-Za-z0-9_]+$/.test(customerId))) ||
          typeof idempotencyKey !== "string" || idempotencyKey.length < 16 ||
          !(createOutcome === "not_started" || createOutcome === "unknown" || createOutcome === "created") ||
          !isoTimestamp(createRequestedAt) ||
          !(isoTimestamp(retryUnknownUntil) || raw.status === "already_bound")) {
        return { blocked: "customer_prepare_dto_invalid" };
      }
      const retryUntil = isoTimestamp(retryUnknownUntil)
        ? retryUnknownUntil
        : new Date(Date.parse(createRequestedAt) + 23 * 60 * 60 * 1000).toISOString();
      return {
        orderId: args.orderId,
        expectedRevision: raw.revision,
        customerId,
        createOutcome,
        idempotencyKey,
        retryUnknownUntil: retryUntil,
        providerScope,
      } satisfies ProgramCustomerSetupIntent;
    },
    async bindProgramCustomer(args) {
      const ok = await callRpc(input.serviceClient, "bind_program_billing_customer", {
        p_order_id: args.orderId,
        p_expected_revision: args.expectedRevision,
        p_customer_id: args.customerId,
        p_provider_evidence: customerEvidence(args.evidence),
        p_evidence_digest: args.evidenceDigest,
      });
      if (ok === true) currentRevision = args.expectedRevision + 1;
      return ok === true;
    },
    async markProgramCustomerCreateUnknown(args) {
      const ok = await callRpc(input.serviceClient, "mark_program_billing_operation_unknown", {
        p_order_id: args.orderId,
        p_operation_kind: "customer_create",
        p_checkout_attempt: 0,
        p_installment: 0,
        p_payment_attempt: 0,
      });
      return ok === true;
    },
    async recordProgramCustomerCreateUnknown(args) {
      const ok = await callRpc(input.serviceClient, "record_program_checkout_app_audit", {
        p_order_id: args.orderId,
        p_operation_kind: "customer_create",
        p_checkout_attempt_number: 0,
        p_event_kind: "unknown",
        p_reason_code: "provider_request_unknown",
        p_evidence_digest: args.requestDigest,
        p_provider_object_id: null,
        p_provider_status: null,
      });
      if (ok !== true) throw new Error("Program Customer unknown audit was not recorded");
    },
    async recordProgramCustomerConflict(args) {
      if (!customerConflictReasons.has(args.reason)) throw new Error("Unsupported Program Customer conflict reason");
      const ok = await callRpc(input.serviceClient, "record_program_checkout_app_audit", {
        p_order_id: args.orderId,
        p_operation_kind: "customer_create",
        p_checkout_attempt_number: 0,
        p_event_kind: "conflict",
        p_reason_code: args.reason,
        p_evidence_digest: args.evidenceDigest,
        p_provider_object_id: null,
        p_provider_status: null,
      });
      if (ok !== true) throw new Error("Program Customer conflict audit was not recorded");
    },
    async prepareCheckoutAttempt(args) {
      const raw = await callRpc(input.serviceClient, "prepare_program_checkout_attempt", {
        p_order_id: args.orderId,
        p_expected_revision: args.expectedRevision,
        p_success_url: args.successUrl,
        p_cancel_url: args.cancelUrl,
      });
      if (!isRecordValue(raw) || raw.status !== "prepared" || !safeInteger(raw.revision, 1)) {
        return { blocked: blockedStatus(raw, "checkout_prepare_failed") };
      }
      currentRevision = raw.revision;
      const snapshot = await loadSnapshot(args.orderId, raw.revision);
      if ("blocked" in snapshot) return { blocked: snapshot.blocked };
      return mapPreparedIntent(raw, snapshot);
    },
    async markCheckoutCreateUnknown(args) {
      const ok = await callRpc(input.serviceClient, "mark_program_checkout_create_unknown", {
        p_order_id: args.orderId,
        p_attempt_number: args.attemptNumber,
      });
      return ok === true;
    },
    async bindCheckoutSession(args) {
      const ok = await callRpc(input.serviceClient, "bind_program_billing_checkout_session", {
        p_order_id: args.orderId,
        p_expected_revision: args.expectedRevision,
        p_attempt_number: args.attemptNumber,
        p_checkout_session_id: args.sessionId,
        p_payment_intent_id: args.paymentIntentId,
        p_provider_evidence: checkoutEvidence(args.evidence),
        p_evidence_digest: args.evidenceDigest,
      });
      if (ok === true) currentRevision = args.expectedRevision + 1;
      return ok === true;
    },
    async recordCheckoutObservation(args) {
      const raw = await callRpc(input.serviceClient, "record_program_checkout_app_audit", {
        p_order_id: args.orderId,
        p_operation_kind: "checkout_create",
        p_checkout_attempt_number: args.attemptNumber,
        p_event_kind: "observed",
        p_reason_code: "checkout_session_observed",
        p_evidence_digest: args.digest,
        p_provider_object_id: args.sessionId,
        p_provider_status: args.status,
      });
      if (raw !== true) throw new Error("Program Checkout Session observation was not recorded");
    },
    async recordCheckoutCreateUnknown(args) {
      const ok = await callRpc(input.serviceClient, "record_program_checkout_app_audit", {
        p_order_id: args.orderId,
        p_operation_kind: "checkout_create",
        p_checkout_attempt_number: args.attemptNumber,
        p_event_kind: "unknown",
        p_reason_code: "provider_request_unknown",
        p_evidence_digest: args.requestDigest,
        p_provider_object_id: null,
        p_provider_status: null,
      });
      if (ok !== true) throw new Error("Program Checkout unknown audit was not recorded");
    },
    async recordCheckoutConflict(args) {
      if (!checkoutConflictReasons.has(args.reason)) throw new Error("Unsupported Program Checkout conflict reason");
      const ok = await callRpc(input.serviceClient, "record_program_checkout_app_audit", {
        p_order_id: args.orderId,
        p_operation_kind: "checkout_create",
        p_checkout_attempt_number: args.attemptNumber,
        p_event_kind: "conflict",
        p_reason_code: args.reason,
        p_evidence_digest: args.evidenceDigest,
        p_provider_object_id: null,
        p_provider_status: null,
      });
      if (ok !== true) throw new Error("Program Checkout conflict audit was not recorded");
    },
    async prepareBuyerRetry(args) {
      if (!Number.isFinite(Date.parse(args.requestedAt))) return { blocked: "retry_request_time_invalid" };
      const before = await loadSnapshot(args.orderId, args.expectedRevision);
      if ("blocked" in before) return { blocked: before.blocked };
      if (!before.billingOrder) return { blocked: "checkout_customer_missing" };
      const request = await callRpc(input.buyerClient, "request_program_checkout_retry", {
        p_order_id: args.orderId,
        p_request_id: args.explicitRequestId,
      });
      if (!isRecordValue(request) || !(request.status === "requested" || request.status === "already_requested")) {
        return { blocked: blockedStatus(request, "retry_request_failed") };
      }
      if (request.attempt_number !== before.billingOrder.currentAttemptNumber) {
        return { blocked: "retry_attempt_changed" };
      }
      const latest = await loadSnapshot(args.orderId, args.expectedRevision);
      if ("blocked" in latest) return { blocked: latest.blocked };
      const attempts = latest.order.attempts.map((attempt) => ({ ...attempt }));
      if (attempts.length !== latest.billingOrder!.currentAttemptNumber ||
          attempts.some((attempt, index) => attempt.attemptNumber !== index + 1)) {
        return { blocked: "retry_attempt_history_invalid" };
      }
      return { order: latest.billingOrder!, expectedRevision: args.expectedRevision, attempts };
    },
    async advanceCheckoutAttempt(args) {
      const raw = await callRpc(input.serviceClient, "advance_program_checkout_attempt", {
        p_order_id: args.orderId,
        p_expected_revision: args.expectedRevision,
        p_request_id: args.explicitRequestId,
        p_terminal_proof: args.proof,
        p_proof_digest: args.proof.digest,
      });
      if (!isRecordValue(raw) || raw.status !== "prepared" || !safeInteger(raw.revision, 1)) {
        return { blocked: blockedStatus(raw, "checkout_retry_advance_failed") };
      }
      currentRevision = raw.revision;
      const snapshot = await loadSnapshot(args.orderId, raw.revision);
      if ("blocked" in snapshot) return { blocked: snapshot.blocked };
      return mapPreparedIntent(raw, snapshot);
    },
  };
  return store;
}

export function isProgramCheckoutEnabled() {
  return process.env.PROGRAM_CHECKOUT_ENABLED === "true";
}

async function currentEligibleBuyer() {
  const buyerClient = await createClient();
  const { data, error } = await buyerClient.auth.getUser();
  const buyerId = data?.user?.id;
  if (error || !buyerId || !(await platformHasTier(buyerId, "regular"))) return null;
  return { buyerClient: buyerClient as unknown as RpcClient, buyerId };
}

function programToday(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function safeBlocked(reason: string): ProgramCheckoutResult {
  return { status: "blocked", reason };
}

async function prepareRuntime(value: unknown) {
  if (!isProgramCheckoutEnabled()) return { ok: false, result: safeBlocked("feature_disabled") } as const;
  const command = parseProgramCheckoutStartCommand(value);
  if (!command) return { ok: false, result: safeBlocked("checkout_request_invalid") } as const;
  const actor = await currentEligibleBuyer();
  if (!actor) return { ok: false, result: safeBlocked("buyer_auth_or_membership_required") } as const;
  const service = createAdminClient() as unknown as RpcClient;
  const store = createProgramCheckoutServerStore({
    serviceClient: service,
    buyerClient: actor.buyerClient,
    buyerId: actor.buyerId,
    initialRevision: command.expectedRevision,
  });
  const initial = await store.loadSnapshot(command.orderId, command.expectedRevision);
  if ("blocked" in initial) return { ok: false, result: safeBlocked(initial.blocked) } as const;
  if (initial.order.canceled || initial.order.deletionPending || initial.order.financialConflict) {
    return { ok: false, result: safeBlocked("order_not_checkout_eligible") } as const;
  }
  return { ok: true, command, actor, service, store, initial } as const;
}

export async function startProgramCheckout(value: unknown): Promise<ProgramCheckoutResult> {
  try {
    const runtime = await prepareRuntime(value);
    if (!runtime.ok) return runtime.result;
    const now = new Date();
    let current = runtime.initial;
    const urls = buildProgramCheckoutReturnUrls({
      siteUrl: getSiteUrl(), programId: current.order.programId, orderId: current.order.orderId,
    });
    const stripe = getStripe();
    const provider = createProgramCheckoutProvider(stripe);
    if (current.order.stripeCustomerId === null) {
      const customer = await ensureProgramBillingCustomer({
        store: runtime.store,
        provider,
        orderId: runtime.command.orderId,
        expectedRevision: current.order.billingRevision,
        now: now.toISOString(),
      });
      if (customer.status !== "ready") return customer.status === "blocked" ? safeBlocked(customer.reason) : { status: "unknown" };
      const refreshed = await runtime.store.loadSnapshot(runtime.command.orderId, runtime.store.getCurrentRevision());
      if ("blocked" in refreshed) return safeBlocked(refreshed.blocked);
      current = refreshed;
    }
    if (!current.billingOrder) return { status: "unknown" };
    const result = await createProgramCheckout({
      store: runtime.store,
      provider,
      orderId: runtime.command.orderId,
      expectedRevision: current.order.billingRevision,
      ...urls,
      today: programToday(now),
      now: now.toISOString(),
    });
    return result.status === "checkout_ready" && !isStrictStripeCheckoutUrl(result.checkoutUrl)
      ? safeBlocked("checkout_redirect_url_invalid")
      : result;
  } catch (error) {
    return error instanceof ProgramCheckoutContractError
      ? safeBlocked("checkout_data_invalid")
      : { status: "unknown" };
  }
}

export async function retryProgramCheckoutForBuyer(value: unknown): Promise<ProgramCheckoutResult> {
  try {
    if (!isProgramCheckoutEnabled()) return safeBlocked("feature_disabled");
    const command = parseProgramCheckoutRetryCommand(value);
    if (!command) return safeBlocked("checkout_retry_request_invalid");
    const actor = await currentEligibleBuyer();
    if (!actor) return safeBlocked("buyer_auth_or_membership_required");
    const service = createAdminClient() as unknown as RpcClient;
    const store = createProgramCheckoutServerStore({
      serviceClient: service,
      buyerClient: actor.buyerClient,
      buyerId: actor.buyerId,
      initialRevision: command.expectedRevision,
    });
    const initial = await store.loadSnapshot(command.orderId, command.expectedRevision);
    if ("blocked" in initial) return safeBlocked(initial.blocked);
    if (!initial.billingOrder || initial.order.canceled || initial.order.deletionPending || initial.order.financialConflict) {
      return safeBlocked("order_not_checkout_eligible");
    }
    const now = new Date();
    const provider: ProgramCheckoutProvider = createProgramCheckoutProvider(getStripe());
    const result = await retryProgramCheckout({
      store,
      provider,
      orderId: command.orderId,
      expectedRevision: command.expectedRevision,
      explicitRequestId: command.requestId,
      requestedAt: now.toISOString(),
      today: programToday(now),
      now: now.toISOString(),
    });
    return result.status === "checkout_ready" && !isStrictStripeCheckoutUrl(result.checkoutUrl)
      ? safeBlocked("checkout_redirect_url_invalid")
      : result;
  } catch (error) {
    return error instanceof ProgramCheckoutContractError
      ? safeBlocked("checkout_data_invalid")
      : { status: "unknown" };
  }
}
