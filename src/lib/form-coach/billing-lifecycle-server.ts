import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { readFormCoachAssessmentTrialOffer } from "./checkout-server";

export type AssessmentTrialClaimState =
  | "claimed"
  | "already_claimed"
  | "coming_soon"
  | "invalid"
  | "account_deleting"
  | "payer_mismatch"
  | "unavailable";

type ClaimRow = Readonly<{ outcome: string }>;

function firstClaimRow(value: unknown): ClaimRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row !== null && typeof row === "object" && !Array.isArray(row)
    && typeof (row as Record<string, unknown>).outcome === "string"
    ? { outcome: (row as Record<string, string>).outcome }
    : null;
}

export async function claimFormCoachAssessmentTrial(input: Readonly<{
  payerId: string;
  payerRole: string;
  requestId: string;
}>): Promise<AssessmentTrialClaimState> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.payerId)) {
    return "invalid";
  }
  const offer = await readFormCoachAssessmentTrialOffer(input.payerRole);
  if (!offer.enabled || offer.count < 1) return "coming_soon";
  try {
    const { data, error } = await createAdminClient().rpc("service_claim_form_coach_assessment_trial", {
      p_request_id: input.requestId,
      p_payer_id: input.payerId,
    });
    if (error) return "unavailable";
    const row = firstClaimRow(data);
    switch (row?.outcome) {
      case "claimed": return "claimed";
      case "already_claimed": return "already_claimed";
      case "blocked_deletion": return "account_deleting";
      case "payer_mismatch": return "payer_mismatch";
      case "stale_config_revision":
      case "feature_unavailable":
      case "unavailable": return "coming_soon";
      default: return "unavailable";
    }
  } catch {
    return "unavailable";
  }
}

export type FormCoachBillingLifecycleEvidence = Readonly<{
  requestId: string;
  payerId: string;
  eventId: string;
  eventType: string;
  invoiceId: string;
  subscriptionId: string;
  contractVersion: number;
  status: string;
  currency: string;
  amountDueCents: number;
  amountPaidCents: number;
  periodStart: string;
  periodEnd: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  trialClaimId: string | null;
  expectedInvoiceRevision: number;
  actualEventDigest: string;
  snapshotDigest: string;
}>;

export async function recordFormCoachInvoiceSnapshot(evidence: FormCoachBillingLifecycleEvidence): Promise<string> {
  const { data, error } = await createAdminClient().rpc("service_record_form_coach_invoice_snapshot", {
    p_request_id: evidence.requestId,
    p_actual_event_id: evidence.eventId,
    p_actual_event_type: evidence.eventType,
    p_invoice_id: evidence.invoiceId,
    p_subscription_id: evidence.subscriptionId,
    p_payer_id: evidence.payerId,
    p_contract_version: evidence.contractVersion,
    p_status: evidence.status,
    p_currency: evidence.currency,
    p_amount_due_cents: evidence.amountDueCents,
    p_amount_paid_cents: evidence.amountPaidCents,
    p_period_start: evidence.periodStart,
    p_period_end: evidence.periodEnd,
    p_payment_intent_id: evidence.paymentIntentId,
    p_charge_id: evidence.chargeId,
    p_trial_claim_id: evidence.trialClaimId,
    p_expected_invoice_revision: evidence.expectedInvoiceRevision,
    p_actual_event_digest: evidence.actualEventDigest,
    p_snapshot_digest: evidence.snapshotDigest,
  });
  if (error || typeof data !== "string") throw new Error("Invoice snapshot could not be recorded");
  return data;
}

export async function recordFormCoachBillingConflict(input: Readonly<{
  eventId: string;
  eventType: string;
  objectId: string;
  reservationId: string | null;
  payerId: string | null;
  conflictKind: "payment_after_terminal" | "subscription_after_terminal" | "terminal_identity_mismatch" | "provider_state_conflict";
  identityDigest: string;
}>): Promise<string> {
  const { data, error } = await createAdminClient().rpc("service_record_form_coach_billing_conflict", {
    p_event_id: input.eventId,
    p_event_type: input.eventType,
    p_object_id: input.objectId,
    p_reservation_id: input.reservationId,
    p_payer_id: input.payerId,
    p_conflict_kind: input.conflictKind,
    p_identity_digest: input.identityDigest,
  });
  if (error || typeof data !== "string") throw new Error("Billing contradiction could not be recorded");
  return data;
}

export type FormCoachBillingConflictResolutionResult =
  | "recorded"
  | "already_resolved"
  | "not_found"
  | "incomplete"
  | "stale"
  | "identity_mismatch"
  | "conflict"
  | "retryable_account_serialization";

export async function resolveFormCoachBillingConflicts(input: Readonly<{
  requestId: string;
  payerId: string;
  resourceKind: "checkout_session" | "subscription" | "invoice";
  resourceId: string;
  expectedRevision: number | null;
  observedAt: string;
  evidence: Readonly<Record<string, string | number | null>>;
  evidenceDigest: string;
}>): Promise<FormCoachBillingConflictResolutionResult> {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(input.requestId) || !uuidPattern.test(input.payerId)
    || !input.resourceId.trim() || input.resourceId.length > 255
    || (input.expectedRevision !== null && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0))
    || !Number.isFinite(Date.parse(input.observedAt))
    || !/^[a-f0-9]{64}$/.test(input.evidenceDigest)
    || JSON.stringify(input.evidence).length > 8192) {
    throw new Error("Billing conflict evidence identity is invalid");
  }
  const { data, error } = await createAdminClient().rpc("service_resolve_form_coach_billing_conflicts", {
    p_request_id: input.requestId,
    p_payer_id: input.payerId,
    p_resource_kind: input.resourceKind,
    p_resource_id: input.resourceId,
    p_expected_revision: input.expectedRevision,
    p_observed_at: input.observedAt,
    p_evidence: input.evidence,
    p_evidence_digest: input.evidenceDigest,
  });
  const allowed: readonly string[] = [
    "recorded", "already_resolved", "not_found", "incomplete", "stale", "identity_mismatch", "conflict",
    "retryable_account_serialization",
  ];
  if (error || typeof data !== "string" || !allowed.includes(data)) {
    throw new Error("Billing conflict evidence could not be recorded");
  }
  return data as FormCoachBillingConflictResolutionResult;
}

export type FormCoachBillingCleanupProofResult =
  | "recorded"
  | "already_recorded"
  | "tombstone_stale"
  | "component_stale_or_unregistered"
  | "identity_mismatch";

export async function recordFormCoachBillingCleanupProof(input: Readonly<{
  tombstoneId: string;
  tombstoneRevision: number;
  requestId: string;
}>): Promise<FormCoachBillingCleanupProofResult> {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(input.tombstoneId) || !uuidPattern.test(input.requestId)
    || !Number.isSafeInteger(input.tombstoneRevision) || input.tombstoneRevision < 1) {
    throw new Error("Billing cleanup proof identity is invalid");
  }
  const { data, error } = await createAdminClient().rpc("service_record_form_coach_billing_cleanup", {
    target_tombstone_id: input.tombstoneId,
    target_revision: input.tombstoneRevision,
    target_request_id: input.requestId,
  });
  if (error || typeof data !== "string"
    || !["recorded", "already_recorded", "tombstone_stale", "component_stale_or_unregistered", "identity_mismatch"].includes(data)) {
    throw new Error("Billing cleanup proof could not be recorded");
  }
  return data as FormCoachBillingCleanupProofResult;
}

export type FormCoachCustomerRetirementInventory = Readonly<{
  complete: boolean;
  hasMore: boolean;
  customerId: string;
  stripeAccountId: string;
  livemode: boolean;
  checkoutSessionCount: number;
  subscriptionCount: number;
  invoiceCount: number;
  invoicePaymentCount: number;
  paymentIntentCount: number;
  chargeCount: number;
  refundCount: number;
  activeCheckoutSessionCount: number;
  activeSubscriptionCount: number;
  collectibleInvoiceCount: number;
  activePaymentIntentCount: number;
  unresolvedRefundCount: number;
  unresolvedCreateCount: number;
  resourceIdsDigest: string;
}>;

type FormCoachCustomerRetirementMetadata = Readonly<{
  feature_namespace: "form_coach";
  feature_key: "form_coach";
  payer_id: string;
  customer_create_attempt_id: string;
}>;

export type FormCoachCustomerRetirementInput = Readonly<{
  requestId: string;
  payerId: string;
  customerId: string;
  createAttemptId: string;
  tombstoneId: string;
  tombstoneRevision: number;
  stripeAccountId: string;
  livemode: boolean;
  customerMetadata: FormCoachCustomerRetirementMetadata;
  inventory: FormCoachCustomerRetirementInventory;
}>;

export type FormCoachCustomerRetirementReservationResult =
  | "reserved"
  | "already_reserved"
  | "conflict"
  | "retirement_pending"
  | "tombstone_stale"
  | "identity_mismatch"
  | "inventory_incomplete"
  | "retryable_account_serialization";

const retirementUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const retirementDigestPattern = /^[a-f0-9]{64}$/;
const retirementInventoryKeys = [
  "complete", "hasMore", "customerId", "stripeAccountId", "livemode", "checkoutSessionCount",
  "subscriptionCount", "invoiceCount", "invoicePaymentCount", "paymentIntentCount", "chargeCount",
  "refundCount", "activeCheckoutSessionCount", "activeSubscriptionCount", "collectibleInvoiceCount",
  "activePaymentIntentCount", "unresolvedRefundCount", "unresolvedCreateCount", "resourceIdsDigest",
].sort();

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function validRetirementInput(input: FormCoachCustomerRetirementInput): boolean {
  const inventory = input.inventory;
  const counts = retirementInventoryKeys.filter((key) => key.endsWith("Count"));
  return retirementUuidPattern.test(input.requestId)
    && retirementUuidPattern.test(input.payerId)
    && retirementUuidPattern.test(input.createAttemptId)
    && retirementUuidPattern.test(input.tombstoneId)
    && Number.isSafeInteger(input.tombstoneRevision) && input.tombstoneRevision > 0
    && /^cus_[A-Za-z0-9]{1,251}$/.test(input.customerId)
    && input.stripeAccountId.trim().length > 0 && input.stripeAccountId.length <= 255
    && typeof input.livemode === "boolean"
    && input.customerMetadata.feature_namespace === "form_coach"
    && input.customerMetadata.feature_key === "form_coach"
    && input.customerMetadata.payer_id === input.payerId
    && input.customerMetadata.customer_create_attempt_id === input.createAttemptId
    && Object.keys(input.customerMetadata).sort().join("|") === [
      "customer_create_attempt_id", "feature_key", "feature_namespace", "payer_id",
    ].join("|")
    && Object.keys(inventory).sort().join("|") === retirementInventoryKeys.join("|")
    && inventory.complete === true && inventory.hasMore === false
    && inventory.customerId === input.customerId && inventory.stripeAccountId === input.stripeAccountId
    && inventory.livemode === input.livemode
    && counts.every((key) => Number.isSafeInteger(inventory[key as keyof typeof inventory])
      && Number(inventory[key as keyof typeof inventory]) >= 0
      && Number(inventory[key as keyof typeof inventory]) <= 1_000_000)
    && inventory.activeCheckoutSessionCount === 0
    && inventory.activeSubscriptionCount === 0
    && inventory.collectibleInvoiceCount === 0
    && inventory.activePaymentIntentCount === 0
    && inventory.unresolvedRefundCount === 0
    && inventory.unresolvedCreateCount === 0
    && retirementDigestPattern.test(inventory.resourceIdsDigest);
}

export async function reserveFormCoachCustomerRetirement(
  input: FormCoachCustomerRetirementInput,
): Promise<FormCoachCustomerRetirementReservationResult> {
  if (!validRetirementInput(input)) throw new Error("Customer retirement inventory is invalid");
  const customerIdentityDigest = sha256([
    "form_coach", input.payerId, input.customerId, input.createAttemptId,
    input.stripeAccountId, String(input.livemode),
  ].join(":"));
  const inventoryDigest = sha256(canonicalJson(input.inventory));
  const requestDigest = sha256([
    input.requestId, customerIdentityDigest, inventoryDigest, input.tombstoneId,
    String(input.tombstoneRevision),
  ].join(":"));

  try {
    const { data, error } = await createAdminClient().rpc("service_reserve_form_coach_customer_retirement", {
      p_request_id: input.requestId,
      p_payer_id: input.payerId,
      p_customer_id: input.customerId,
      p_create_attempt_id: input.createAttemptId,
      p_tombstone_id: input.tombstoneId,
      p_tombstone_revision: input.tombstoneRevision,
      p_stripe_account_id: input.stripeAccountId,
      p_livemode: input.livemode,
      p_customer_metadata: input.customerMetadata,
      p_inventory_summary: input.inventory,
      p_customer_identity_digest: customerIdentityDigest,
      p_inventory_digest: inventoryDigest,
      p_request_digest: requestDigest,
    });
    const outcomes: readonly string[] = [
      "reserved", "already_reserved", "conflict", "retirement_pending", "tombstone_stale",
      "identity_mismatch", "inventory_incomplete", "retryable_account_serialization",
    ];
    if (error || typeof data !== "string" || !outcomes.includes(data)) {
      throw new Error("Customer retirement intent could not be recorded");
    }
    return data as FormCoachCustomerRetirementReservationResult;
  } catch {
    throw new Error("Customer retirement intent could not be recorded");
  }
}

export type FormCoachCustomerRetirementProofResult =
  | "recorded"
  | "already_recorded"
  | "not_deleted"
  | "identity_mismatch"
  | "tombstone_stale"
  | "stale"
  | "resource_set_changed"
  | "retryable_account_serialization";

export async function recordFormCoachCustomerRetirementProof(input: FormCoachCustomerRetirementInput & Readonly<{
  customerResponseId: string | null;
  httpStatus: number;
  providerDeleted: boolean;
  observedAt: string;
}>): Promise<FormCoachCustomerRetirementProofResult> {
  if (!validRetirementInput(input) || !Number.isInteger(input.httpStatus)
    || input.httpStatus < 100 || input.httpStatus > 599 || typeof input.providerDeleted !== "boolean") {
    throw new Error("Customer retirement proof identity is invalid");
  }
  if (input.httpStatus === 200 && input.providerDeleted && input.customerResponseId !== input.customerId) {
    return "identity_mismatch";
  }
  const observedTime = Date.parse(input.observedAt);
  if (!Number.isFinite(observedTime)) throw new Error("Customer retirement proof time is invalid");
  const observedAt = new Date(observedTime).toISOString();
  const customerIdentityDigest = sha256([
    "form_coach", input.payerId, input.customerId, input.createAttemptId,
    input.stripeAccountId, String(input.livemode),
  ].join(":"));
  const inventoryDigest = sha256(canonicalJson(input.inventory));
  const evidenceDigest = sha256(canonicalJson({
    requestId: input.requestId,
    payerId: input.payerId,
    customerId: input.customerId,
    createAttemptId: input.createAttemptId,
    tombstoneId: input.tombstoneId,
    tombstoneRevision: input.tombstoneRevision,
    stripeAccountId: input.stripeAccountId,
    livemode: input.livemode,
    customerIdentityDigest,
    inventoryDigest,
    customerResponseId: input.customerResponseId,
    httpStatus: input.httpStatus,
    providerDeleted: input.providerDeleted,
    observedAt,
  }));

  try {
    const { data, error } = await createAdminClient().rpc("service_record_form_coach_customer_retirement", {
      p_request_id: input.requestId,
      p_payer_id: input.payerId,
      p_customer_id: input.customerId,
      p_create_attempt_id: input.createAttemptId,
      p_tombstone_id: input.tombstoneId,
      p_tombstone_revision: input.tombstoneRevision,
      p_stripe_account_id: input.stripeAccountId,
      p_livemode: input.livemode,
      p_inventory_digest: inventoryDigest,
      p_http_status: input.httpStatus,
      p_provider_deleted: input.providerDeleted,
      p_observed_at: observedAt,
      p_evidence_digest: evidenceDigest,
    });
    const outcomes: readonly string[] = [
      "recorded", "already_recorded", "not_deleted", "identity_mismatch", "tombstone_stale",
      "stale", "resource_set_changed", "retryable_account_serialization",
    ];
    if (error || typeof data !== "string" || !outcomes.includes(data)) {
      throw new Error("Customer retirement proof could not be recorded");
    }
    return data as FormCoachCustomerRetirementProofResult;
  } catch {
    throw new Error("Customer retirement proof could not be recorded");
  }
}

export type FormCoachCustomerRetirementRevalidationResult =
  | "recorded"
  | "already_recorded"
  | "not_deleted"
  | "identity_mismatch"
  | "tombstone_stale"
  | "stale"
  | "resource_set_changed"
  | "conflict"
  | "retryable_account_serialization";

export type FormCoachCustomerRetirementRevalidationInput = FormCoachCustomerRetirementInput & Readonly<{
  sourceRequestId: string;
  customerResponseId: string | null;
  httpStatus: number;
  providerDeleted: boolean;
  observedAt: string;
}>;

export async function recordFormCoachCustomerRetirementRevalidation(
  input: FormCoachCustomerRetirementRevalidationInput,
): Promise<FormCoachCustomerRetirementRevalidationResult> {
  if (!validRetirementInput(input) || !retirementUuidPattern.test(input.sourceRequestId)
    || !Number.isInteger(input.httpStatus) || input.httpStatus < 100 || input.httpStatus > 599
    || typeof input.providerDeleted !== "boolean") {
    throw new Error("Customer retirement revalidation identity is invalid");
  }
  if (input.httpStatus !== 200 || input.providerDeleted !== true || input.customerResponseId !== input.customerId) {
    return "not_deleted";
  }
  const observedTime = Date.parse(input.observedAt);
  if (!Number.isFinite(observedTime)) throw new Error("Customer retirement revalidation time is invalid");
  const observedAt = new Date(observedTime).toISOString();
  const customerIdentityDigest = sha256([
    "form_coach", input.payerId, input.customerId, input.createAttemptId,
    input.stripeAccountId, String(input.livemode),
  ].join(":"));
  const inventoryDigest = sha256(canonicalJson(input.inventory));
  const evidenceDigest = sha256(canonicalJson({
    requestId: input.requestId,
    sourceRequestId: input.sourceRequestId,
    payerId: input.payerId,
    customerId: input.customerId,
    createAttemptId: input.createAttemptId,
    tombstoneId: input.tombstoneId,
    tombstoneRevision: input.tombstoneRevision,
    stripeAccountId: input.stripeAccountId,
    livemode: input.livemode,
    customerIdentityDigest,
    inventoryDigest,
    customerResponseId: input.customerResponseId,
    httpStatus: input.httpStatus,
    providerDeleted: input.providerDeleted,
    observedAt,
  }));

  try {
    const { data, error } = await createAdminClient().rpc("service_record_form_coach_customer_retirement_revalidation", {
      p_request_id: input.requestId,
      p_source_request_id: input.sourceRequestId,
      p_payer_id: input.payerId,
      p_customer_id: input.customerId,
      p_create_attempt_id: input.createAttemptId,
      p_tombstone_id: input.tombstoneId,
      p_tombstone_revision: input.tombstoneRevision,
      p_stripe_account_id: input.stripeAccountId,
      p_livemode: input.livemode,
      p_inventory_digest: inventoryDigest,
      p_http_status: input.httpStatus,
      p_customer_response_id: input.customerResponseId,
      p_provider_deleted: input.providerDeleted,
      p_observed_at: observedAt,
      p_evidence_digest: evidenceDigest,
    });
    const outcomes: readonly string[] = [
      "recorded", "already_recorded", "not_deleted", "identity_mismatch", "tombstone_stale", "stale",
      "resource_set_changed", "conflict", "retryable_account_serialization",
    ];
    if (error || typeof data !== "string" || !outcomes.includes(data)) {
      throw new Error("Customer retirement revalidation could not be recorded");
    }
    return data as FormCoachCustomerRetirementRevalidationResult;
  } catch {
    throw new Error("Customer retirement revalidation could not be recorded");
  }
}
