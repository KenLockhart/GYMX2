import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BillingSyncRequestSchema,
  canTransitionBillingSync,
  classifyInvoiceAccessProof,
  FeatureInvoiceFactSchema,
  FeaturePayerCustomerSchema,
  mayReadOwnBilling,
  mayReuseFeatureCustomer,
  OwnInvoiceHistoryRowSchema,
  SubscriptionAccessProofSchema,
  subscriptionAccessDeadline,
  SubscriptionContractMoveIntentSchema,
  TrialClaimSchema,
  validateContractMoveConfirmation,
} from './billing-types';

const payerId = 'e97cbadb-2780-4e32-962f-a14acbb91f94';
const otherPayerId = '59c341d0-b8f1-497d-9482-47bc233916bd';
const adminId = '37f164c1-2821-4456-9b4d-fbcbf6d75cf2';
const fixedNow = new Date('2026-11-19T16:00:00.000Z');
const digest = 'a'.repeat(64);
const timeTrialBase = {
  claimId: '71f164c1-2821-4456-9b4d-fbcbf6d75cf2',
  requestId: '81f164c1-2821-4456-9b4d-fbcbf6d75cf2',
  featureKey: 'form_coach' as const,
  payerId,
  configRevision: 2,
  kind: 'trial_days' as const,
  sourceKind: 'subscription' as const,
  subscriptionId: 'sub_fc_1',
  sourceId: 'sub_fc_1',
  startsAt: '2026-11-19T00:00:00.000Z',
  expiresAt: '2026-11-26T00:00:00.000Z',
  grantedAssessmentCount: 0,
  requestDigest: digest,
};

function invoice(overrides: Partial<z.infer<typeof FeatureInvoiceFactSchema>> = {}) {
  return FeatureInvoiceFactSchema.parse({
    invoiceId: 'in_fc_renewal_2',
    subscriptionId: 'sub_fc_1',
    payerId,
    contractVersion: 1,
    status: 'paid',
    currency: 'USD',
    amountDueCents: 9000,
    amountPaidCents: 9000,
    periodStart: '2026-11-19T00:00:00.000Z',
    periodEnd: '2026-12-19T00:00:00.000Z',
    refundAmountCents: 0,
    refundState: 'none',
    paymentIntentId: 'pi_fc_2',
    chargeId: 'ch_fc_2',
    ...overrides,
  });
}

function timeTrial(overrides: Partial<z.infer<typeof TrialClaimSchema>> = {}) {
  return TrialClaimSchema.parse({ ...timeTrialBase, ...overrides });
}

describe('Form Coach billing contracts', () => {
  it('accepts a bounded sync request and rejects incomplete or malformed digests', () => {
    expect(BillingSyncRequestSchema.parse({
      requestId: '11f164c1-2821-4456-9b4d-fbcbf6d75cf2',
      featureKey: 'form_coach',
      expectedRevision: 4,
      requestDigest: digest,
      state: 'reserved',
      createdBy: adminId,
    }).state).toBe('reserved');
    expect(BillingSyncRequestSchema.safeParse({
      requestId: '11f164c1-2821-4456-9b4d-fbcbf6d75cf2',
      featureKey: 'form_coach',
      expectedRevision: 4,
      requestDigest: 'short',
      state: 'reserved',
      createdBy: adminId,
    }).success).toBe(false);
  });

  it('allows only forward provider-sync transitions and makes CAS terminal', () => {
    expect(canTransitionBillingSync('reserved', 'unknown')).toBe(true);
    expect(canTransitionBillingSync('unknown', 'bound')).toBe(true);
    expect(canTransitionBillingSync('bound', 'verified')).toBe(true);
    expect(canTransitionBillingSync('bound', 'failed')).toBe(false);
    expect(canTransitionBillingSync('verified', 'cas_applied')).toBe(true);
    expect(canTransitionBillingSync('verified', 'cas_stale')).toBe(true);
    expect(canTransitionBillingSync('cas_stale', 'verified')).toBe(false);
    expect(canTransitionBillingSync('failed', 'bound')).toBe(false);
  });

  it('reuses only a verified Form Coach customer for its exact payer and never during deletion', () => {
    const customer = FeaturePayerCustomerSchema.parse({
      featureKey: 'form_coach',
      payerId,
      requestId: '21f164c1-2821-4456-9b4d-fbcbf6d75cf2',
      requestDigest: digest,
      state: 'verified',
      customerId: 'cus_fc_owner',
      createdAt: '2026-11-19T16:00:00.000Z',
    });
    expect(mayReuseFeatureCustomer(customer, payerId, false)).toBe(true);
    expect(mayReuseFeatureCustomer(customer, otherPayerId, false)).toBe(false);
    expect(mayReuseFeatureCustomer(customer, payerId, true)).toBe(false);
    expect(FeaturePayerCustomerSchema.safeParse({ ...customer, state: 'reserved' }).success).toBe(false);
  });

  it('caps paid subscription access at verified invoice proof despite a later provider period', () => {
    const access = SubscriptionAccessProofSchema.parse({
      subscriptionId: 'sub_fc_1',
      payerId,
      status: 'active',
      providerPeriodEnd: '2026-12-19T00:00:00.000Z',
      verifiedPaidThrough: '2026-11-30T00:00:00.000Z',
      verifiedTrialThrough: null,
      stateRevision: 7,
    });
    expect(subscriptionAccessDeadline(access, fixedNow)).toBe('2026-11-30T00:00:00.000Z');
    expect(subscriptionAccessDeadline(access, new Date('2026-12-01T00:00:00.000Z'))).toBeNull();
    expect(subscriptionAccessDeadline({ ...access, verifiedPaidThrough: null }, fixedNow)).toBeNull();
    expect(subscriptionAccessDeadline({ ...access, status: 'past_due' }, fixedNow)).toBeNull();
  });

  it('caps a verified trial at both its claim expiry and the current provider period', () => {
    const access = SubscriptionAccessProofSchema.parse({
      subscriptionId: 'sub_fc_1',
      payerId,
      status: 'trialing',
      providerPeriodEnd: '2026-12-01T00:00:00.000Z',
      verifiedPaidThrough: null,
      verifiedTrialThrough: '2026-11-26T00:00:00.000Z',
      stateRevision: 1,
    });
    expect(subscriptionAccessDeadline(access, fixedNow)).toBe('2026-11-26T00:00:00.000Z');
  });

  it('requires a payer- and subscription-bound trial claim for a zero-dollar invoice proof', () => {
    const freeTrialInvoice = invoice({
      amountDueCents: 0,
      amountPaidCents: 0,
      periodEnd: '2026-12-01T00:00:00.000Z',
      paymentIntentId: null,
      chargeId: null,
    });
    expect(classifyInvoiceAccessProof(freeTrialInvoice, {
      verifiedTrialClaim: null,
      providerStatus: 'trialing',
    })).toEqual({ kind: 'no_proof' });
    expect(classifyInvoiceAccessProof(freeTrialInvoice, {
      verifiedTrialClaim: timeTrial(),
      providerStatus: 'trialing',
    })).toEqual({ kind: 'trial_period', through: '2026-11-26T00:00:00.000Z' });
    expect(classifyInvoiceAccessProof(freeTrialInvoice, {
      verifiedTrialClaim: timeTrial({ payerId: otherPayerId }),
      providerStatus: 'trialing',
    })).toEqual({ kind: 'no_proof' });
    expect(classifyInvoiceAccessProof(freeTrialInvoice, {
      verifiedTrialClaim: timeTrial({ sourceKind: 'subscription_invoice', sourceId: 'in_fc_other' }),
      providerStatus: 'trialing',
    })).toEqual({ kind: 'no_proof' });
    expect(classifyInvoiceAccessProof(freeTrialInvoice, {
      verifiedTrialClaim: timeTrial({ sourceKind: 'subscription_invoice', sourceId: 'in_fc_renewal_2', startsAt: '2026-11-20T00:00:00.000Z' }),
      providerStatus: 'trialing',
    })).toEqual({ kind: 'no_proof' });
    expect(TrialClaimSchema.safeParse({ ...timeTrialBase, sourceId: 'sub_fc_other' }).success).toBe(false);
    expect(TrialClaimSchema.safeParse({ ...timeTrialBase, kind: 'trial_assessments', sourceKind: 'assessment_trial',
      subscriptionId: 'sub_fc_1', sourceId: 'grant_fc_1', expiresAt: null, grantedAssessmentCount: 2 }).success).toBe(false);
  });

  it('keeps positive invoice proof separate from zero, refunded, and partial-review facts', () => {
    expect(classifyInvoiceAccessProof(invoice(), {
      verifiedTrialClaim: null,
      providerStatus: 'active',
    })).toEqual({ kind: 'paid_period', through: '2026-12-19T00:00:00.000Z' });
    expect(classifyInvoiceAccessProof(invoice({
      refundAmountCents: 9000,
      refundState: 'fully_refunded',
    }), { verifiedTrialClaim: null, providerStatus: 'active' })).toEqual({ kind: 'no_proof' });
    expect(classifyInvoiceAccessProof(invoice({
      refundAmountCents: 1500,
      refundState: 'partial_review',
    }), { verifiedTrialClaim: null, providerStatus: 'active' })).toEqual({ kind: 'manual_review', reason: 'partial_refund' });
    expect(FeatureInvoiceFactSchema.safeParse({
      ...invoice(),
      refundAmountCents: 9001,
    }).success).toBe(false);
  });

  it('requires a confirmed contract move against the current immutable version and state revision', () => {
    const intent = SubscriptionContractMoveIntentSchema.parse({
      requestId: '31f164c1-2821-4456-9b4d-fbcbf6d75cf2',
      subscriptionId: 'sub_fc_1',
      payerId,
      fromVersion: 1,
      fromConfigRevision: 3,
      toConfigRevision: 4,
      toPriceKey: 'monthly_v2',
      toPriceId: 'price_fc_v2',
      toAmountCents: 9900,
      currency: 'USD',
      expectedStateRevision: 9,
      prorationBehavior: 'none',
      confirmedByAdmin: adminId,
      confirmedAt: '2026-11-19T16:00:00.000Z',
      requestDigest: digest,
    });
    expect(validateContractMoveConfirmation(intent, {
      currentVersion: 1,
      currentStateRevision: 9,
      confirmed: true,
    })).toBe(true);
    expect(validateContractMoveConfirmation(intent, {
      currentVersion: 1,
      currentStateRevision: 10,
      confirmed: true,
    })).toBe(false);
    expect(validateContractMoveConfirmation(intent, {
      currentVersion: 1,
      currentStateRevision: 9,
      confirmed: false,
    })).toBe(false);
    expect(SubscriptionContractMoveIntentSchema.safeParse({
      ...intent,
      toConfigRevision: 3,
    }).success).toBe(false);
  });

  it('keeps owner invoice DTOs free of provider IDs and only permits self reads', () => {
    const row = {
      kind: 'subscription' as const,
      status: 'paid' as const,
      amountDueCents: 9000,
      amountPaidCents: 9000,
      currency: 'USD',
      periodStart: '2026-11-19T00:00:00.000Z',
      periodEnd: '2026-12-19T00:00:00.000Z',
      recordedAt: '2026-11-19T16:00:00.000Z',
    };
    expect(OwnInvoiceHistoryRowSchema.parse(row)).toEqual(row);
    expect(OwnInvoiceHistoryRowSchema.safeParse({ ...row, invoiceId: 'in_private' }).success).toBe(false);
    expect(mayReadOwnBilling(payerId, payerId)).toBe(true);
    expect(mayReadOwnBilling(payerId, otherPayerId)).toBe(false);
  });
});
