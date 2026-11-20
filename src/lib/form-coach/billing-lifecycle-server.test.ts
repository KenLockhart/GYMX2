import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), offer: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("./checkout-server", () => ({ readFormCoachAssessmentTrialOffer: mocks.offer }));

import {
  claimFormCoachAssessmentTrial,
  recordFormCoachBillingCleanupProof,
  recordFormCoachCustomerRetirementProof,
  recordFormCoachBillingConflict,
  recordFormCoachInvoiceSnapshot,
  reserveFormCoachCustomerRetirement,
  resolveFormCoachBillingConflicts,
} from "./billing-lifecycle-server";

const payerId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
const retirementInput = {
  requestId: "00000000-0000-4000-8000-000000000003",
  payerId,
  customerId: "cus_formcoachsynthetic",
  createAttemptId: "00000000-0000-4000-8000-000000000004",
  tombstoneId: "00000000-0000-4000-8000-000000000005",
  tombstoneRevision: 3,
  stripeAccountId: "acct_form_coach_platform",
  livemode: false,
  customerMetadata: {
    feature_namespace: "form_coach" as const,
    feature_key: "form_coach" as const,
    payer_id: payerId,
    customer_create_attempt_id: "00000000-0000-4000-8000-000000000004",
  },
  inventory: {
    complete: true,
    hasMore: false,
    customerId: "cus_formcoachsynthetic",
    stripeAccountId: "acct_form_coach_platform",
    livemode: false,
    checkoutSessionCount: 1,
    subscriptionCount: 0,
    invoiceCount: 0,
    invoicePaymentCount: 0,
    paymentIntentCount: 0,
    chargeCount: 0,
    refundCount: 0,
    activeCheckoutSessionCount: 0,
    activeSubscriptionCount: 0,
    collectibleInvoiceCount: 0,
    activePaymentIntentCount: 0,
    unresolvedRefundCount: 0,
    unresolvedCreateCount: 0,
    resourceIdsDigest: "a".repeat(64),
  },
} as const;

describe("Form Coach billing lifecycle service boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.offer.mockResolvedValue({ enabled: true, count: 3 });
    mocks.rpc.mockResolvedValue({ data: [{ outcome: "claimed" }], error: null });
  });

  it("does not call the trial RPC for malformed request or disabled offer", async () => {
    await expect(claimFormCoachAssessmentTrial({ payerId, payerRole: "coach", requestId: "bad" }))
      .resolves.toBe("invalid");
    mocks.offer.mockResolvedValue({ enabled: false, count: 0 });
    await expect(claimFormCoachAssessmentTrial({ payerId, payerRole: "coach", requestId }))
      .resolves.toBe("coming_soon");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("derives claim owner from the authenticated caller input and maps only safe outcomes", async () => {
    await expect(claimFormCoachAssessmentTrial({ payerId, payerRole: "coach", requestId })).resolves.toBe("claimed");
    expect(mocks.rpc).toHaveBeenCalledWith("service_claim_form_coach_assessment_trial", {
      p_request_id: requestId,
      p_payer_id: payerId,
    });
    mocks.rpc.mockResolvedValue({ data: [{ outcome: "already_claimed", claim_id: "internal-id" }], error: null });
    await expect(claimFormCoachAssessmentTrial({ payerId, payerRole: "coach", requestId })).resolves.toBe("already_claimed");
  });

  it("fails closed for deletion, identity conflicts, and RPC failures", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ outcome: "blocked_deletion" }], error: null });
    await expect(claimFormCoachAssessmentTrial({ payerId, payerRole: "coach", requestId })).resolves.toBe("account_deleting");
    mocks.rpc.mockResolvedValue({ data: [{ outcome: "payer_mismatch" }], error: null });
    await expect(claimFormCoachAssessmentTrial({ payerId, payerRole: "coach", requestId })).resolves.toBe("payer_mismatch");
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("synthetic database failure") });
    await expect(claimFormCoachAssessmentTrial({ payerId, payerRole: "coach", requestId })).resolves.toBe("unavailable");
  });

  it("records a reconciled invoice snapshot with actual Stripe event identity kept separate", async () => {
    mocks.rpc.mockResolvedValue({ data: "applied", error: null });
    const result = await recordFormCoachInvoiceSnapshot({
      requestId,
      payerId,
      eventId: "evt_actual_payment_failed",
      eventType: "invoice.payment_failed",
      invoiceId: "in_synthetic",
      subscriptionId: "sub_synthetic",
      contractVersion: 1,
      status: "paid",
      currency: "USD",
      amountDueCents: 1200,
      amountPaidCents: 1200,
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-12-01T00:00:00.000Z",
      paymentIntentId: "pi_synthetic",
      chargeId: "ch_synthetic",
      trialClaimId: null,
      expectedInvoiceRevision: 0,
      actualEventDigest: "a".repeat(64),
      snapshotDigest: "c".repeat(64),
    });
    expect(result).toBe("applied");
    expect(mocks.rpc).toHaveBeenCalledWith("service_record_form_coach_invoice_snapshot", expect.objectContaining({
      p_actual_event_id: "evt_actual_payment_failed",
      p_actual_event_type: "invoice.payment_failed",
      p_status: "paid",
      p_expected_invoice_revision: 0,
    }));
  });

  it("reserves customer retirement only for exact complete terminal inventory", async () => {
    mocks.rpc.mockResolvedValue({ data: "reserved", error: null });

    await expect(reserveFormCoachCustomerRetirement(retirementInput)).resolves.toBe("reserved");

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("service_reserve_form_coach_customer_retirement", expect.objectContaining({
      p_request_id: retirementInput.requestId,
      p_payer_id: payerId,
      p_customer_id: retirementInput.customerId,
      p_create_attempt_id: retirementInput.createAttemptId,
      p_tombstone_id: retirementInput.tombstoneId,
      p_tombstone_revision: 3,
      p_livemode: false,
      p_inventory_summary: retirementInput.inventory,
      p_customer_metadata: retirementInput.customerMetadata,
      p_customer_identity_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_inventory_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_request_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it.each([
    { label: "an incomplete provider page", inventory: { ...retirementInput.inventory, complete: false } },
    { label: "a provider page with more results", inventory: { ...retirementInput.inventory, hasMore: true } },
    { label: "a collectible invoice", inventory: { ...retirementInput.inventory, collectibleInvoiceCount: 1 } },
    { label: "inventory for another customer", inventory: { ...retirementInput.inventory, customerId: "cus_othercustomer" } },
    { label: "a foreign customer binding", customerMetadata: { ...retirementInput.customerMetadata, payer_id: "00000000-0000-4000-8000-000000000099" } },
  ])("does not reserve retirement for $label", async (change) => {
    const { label, ...overrides } = change;
    void label;
    const input = { ...retirementInput, ...overrides } as Parameters<typeof reserveFormCoachCustomerRetirement>[0];

    await expect(reserveFormCoachCustomerRetirement(input)).rejects.toThrow("Customer retirement inventory is invalid");

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts only exact successful provider deletion as immutable retirement proof", async () => {
    mocks.rpc.mockResolvedValue({ data: "not_deleted", error: null });
    const proofInput = {
      ...retirementInput,
      customerResponseId: null,
      httpStatus: 404,
      providerDeleted: true,
      observedAt: "2026-11-19T15:00:00.000Z",
    };

    await expect(recordFormCoachCustomerRetirementProof({
      ...proofInput,
      customerResponseId: "cus_othercustomer",
      httpStatus: 200,
    })).resolves.toBe("identity_mismatch");
    expect(mocks.rpc).not.toHaveBeenCalled();

    await expect(recordFormCoachCustomerRetirementProof(proofInput)).resolves.toBe("not_deleted");
    expect(mocks.rpc).toHaveBeenLastCalledWith("service_record_form_coach_customer_retirement", expect.objectContaining({
      p_http_status: 404,
      p_provider_deleted: true,
      p_observed_at: "2026-11-19T15:00:00.000Z",
      p_inventory_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_evidence_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));

    mocks.rpc.mockResolvedValue({ data: "recorded", error: null });
    await expect(recordFormCoachCustomerRetirementProof({
      ...proofInput,
      customerResponseId: retirementInput.customerId,
      httpStatus: 200,
    })).resolves.toBe("recorded");
    expect(mocks.rpc).toHaveBeenLastCalledWith("service_record_form_coach_customer_retirement", expect.objectContaining({
      p_http_status: 200,
      p_provider_deleted: true,
    }));
  });

  it("does not hide billing contradiction persistence failures", async () => {
    mocks.rpc.mockResolvedValue({ data: "recorded", error: null });
    await expect(recordFormCoachBillingConflict({
      eventId: "evt_conflict",
      eventType: "customer.subscription.updated",
      objectId: "sub_conflict",
      reservationId: null,
      payerId,
      conflictKind: "subscription_after_terminal",
      identityDigest: "b".repeat(64),
    })).resolves.toBe("recorded");
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("synthetic failure") });
    await expect(recordFormCoachBillingConflict({
      eventId: "evt_conflict",
      eventType: "customer.subscription.updated",
      objectId: "sub_conflict",
      reservationId: null,
      payerId,
      conflictKind: "subscription_after_terminal",
      identityDigest: "b".repeat(64),
    })).rejects.toThrow("Billing contradiction could not be recorded");
  });

  it("records cleanup evidence only with a well-formed tombstone identity", async () => {
    mocks.rpc.mockResolvedValue({ data: "recorded", error: null });
    await expect(recordFormCoachBillingCleanupProof({
      tombstoneId: payerId,
      tombstoneRevision: 2,
      requestId,
    })).resolves.toBe("recorded");
    expect(mocks.rpc).toHaveBeenCalledWith("service_record_form_coach_billing_cleanup", {
      target_tombstone_id: payerId,
      target_revision: 2,
      target_request_id: requestId,
    });
    await expect(recordFormCoachBillingCleanupProof({
      tombstoneId: "invalid",
      tombstoneRevision: 2,
      requestId,
    })).rejects.toThrow("Billing cleanup proof identity is invalid");
  });

  it("fails closed for unknown cleanup proof outcomes", async () => {
    mocks.rpc.mockResolvedValue({ data: "ready", error: null });
    await expect(recordFormCoachBillingCleanupProof({
      tombstoneId: payerId,
      tombstoneRevision: 2,
      requestId,
    })).rejects.toThrow("Billing cleanup proof could not be recorded");
  });

  it("stores only a scoped current-evidence resolution observation", async () => {
    mocks.rpc.mockResolvedValue({ data: "recorded", error: null });
    const evidence = {
      status: "complete",
      paymentStatus: "paid",
      customerId: "cus_synthetic",
      paymentIntentStatus: "succeeded",
      paymentIntentAmountReceived: 2500,
      paymentIntentCurrency: "USD",
    };
    await expect(resolveFormCoachBillingConflicts({
      requestId,
      payerId,
      resourceKind: "checkout_session",
      resourceId: "cs_synthetic",
      expectedRevision: null,
      observedAt: "2026-11-19T12:00:00.000Z",
      evidence,
      evidenceDigest: "c".repeat(64),
    })).resolves.toBe("recorded");
    expect(mocks.rpc).toHaveBeenCalledWith("service_resolve_form_coach_billing_conflicts", {
      p_request_id: requestId,
      p_payer_id: payerId,
      p_resource_kind: "checkout_session",
      p_resource_id: "cs_synthetic",
      p_expected_revision: null,
      p_observed_at: "2026-11-19T12:00:00.000Z",
      p_evidence: evidence,
      p_evidence_digest: "c".repeat(64),
    });
    mocks.rpc.mockResolvedValue({ data: "ready", error: null });
    await expect(resolveFormCoachBillingConflicts({
      requestId,
      payerId,
      resourceKind: "checkout_session",
      resourceId: "cs_synthetic",
      expectedRevision: null,
      observedAt: "2026-11-19T12:00:00.000Z",
      evidence,
      evidenceDigest: "c".repeat(64),
    })).rejects.toThrow("Billing conflict evidence could not be recorded");
  });

  it("rejects an invalid observation timestamp before the service RPC", async () => {
    await expect(resolveFormCoachBillingConflicts({
      requestId,
      payerId,
      resourceKind: "checkout_session",
      resourceId: "cs_synthetic",
      expectedRevision: null,
      observedAt: "not-a-timestamp",
      evidence: {},
      evidenceDigest: "d".repeat(64),
    })).rejects.toThrow("Billing conflict evidence identity is invalid");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
