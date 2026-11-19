import { z } from 'zod';

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ProviderIdSchema = z.string().trim().min(1).max(255);
const DateTimeSchema = z.string().datetime({ offset: true });

export const BillingSyncStateSchema = z.enum([
  'reserved',
  'unknown',
  'bound',
  'verified',
  'cas_applied',
  'cas_stale',
  'failed',
]);
export type BillingSyncState = z.infer<typeof BillingSyncStateSchema>;

const BILLING_SYNC_TRANSITIONS: Record<BillingSyncState, readonly BillingSyncState[]> = {
  reserved: ['unknown', 'bound', 'failed'],
  unknown: ['bound', 'failed'],
  // Once a provider ID is bound, keep it available for reconciliation; do not discard it as failed.
  bound: ['verified'],
  verified: ['cas_applied', 'cas_stale', 'failed'],
  cas_applied: [],
  cas_stale: [],
  failed: [],
};

export function canTransitionBillingSync(
  from: BillingSyncState,
  to: BillingSyncState,
): boolean {
  return from === to || BILLING_SYNC_TRANSITIONS[from].includes(to);
}

export const BillingSyncRequestSchema = z.object({
  requestId: z.string().uuid(),
  featureKey: z.literal('form_coach'),
  expectedRevision: z.number().int().positive().safe(),
  requestDigest: DigestSchema,
  state: BillingSyncStateSchema,
  createdBy: z.string().uuid(),
}).strict();
export type BillingSyncRequest = Readonly<z.infer<typeof BillingSyncRequestSchema>>;

export const PayerCustomerStateSchema = z.enum([
  'reserved',
  'unknown',
  'bound',
  'verified',
  'cancel_required',
  'blocked_deletion',
  'failed',
]);

export const FeaturePayerCustomerSchema = z.object({
  featureKey: z.literal('form_coach'),
  payerId: z.string().uuid(),
  requestId: z.string().uuid(),
  requestDigest: DigestSchema,
  state: PayerCustomerStateSchema,
  customerId: ProviderIdSchema.nullable(),
  createdAt: DateTimeSchema,
}).strict().superRefine((customer, context) => {
  const needsBinding = ['bound', 'verified', 'cancel_required'].includes(customer.state);
  if (needsBinding && customer.customerId === null) {
    context.addIssue({
      code: 'custom',
      path: ['customerId'],
      message: 'A bound customer state requires its immutable provider ID.',
    });
  }
  if (customer.state === 'reserved' && customer.customerId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['customerId'],
      message: 'A reserved customer create cannot claim a provider binding.',
    });
  }
});
export type FeaturePayerCustomer = Readonly<z.infer<typeof FeaturePayerCustomerSchema>>;

export function mayReuseFeatureCustomer(
  customer: FeaturePayerCustomer,
  payerId: string,
  accountDeleting: boolean,
): boolean {
  return !accountDeleting
    && customer.featureKey === 'form_coach'
    && customer.payerId === payerId
    && customer.state === 'verified'
    && customer.customerId !== null;
}

export const SubscriptionStatusSchema = z.enum([
  'pending_reconcile',
  'active',
  'trialing',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'past_due',
  'paused',
  'unpaid',
  'blocked_deletion',
]);

export const SubscriptionAccessProofSchema = z.object({
  subscriptionId: ProviderIdSchema,
  payerId: z.string().uuid(),
  status: SubscriptionStatusSchema,
  providerPeriodEnd: DateTimeSchema,
  verifiedPaidThrough: DateTimeSchema.nullable(),
  verifiedTrialThrough: DateTimeSchema.nullable(),
  stateRevision: z.number().int().nonnegative().safe(),
}).strict();
export type SubscriptionAccessProof = Readonly<z.infer<typeof SubscriptionAccessProofSchema>>;

function timestamp(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Current provider status and period end alone are insufficient proof of payment.
 * The access deadline is capped by a verified paid invoice or one verified trial claim.
 */
export function subscriptionAccessDeadline(
  input: SubscriptionAccessProof,
  now: Date,
): string | null {
  const proof = SubscriptionAccessProofSchema.parse(input);
  const nowMs = now.getTime();
  const providerEnd = timestamp(proof.providerPeriodEnd);
  if (!Number.isFinite(nowMs) || providerEnd === null || nowMs > providerEnd) return null;
  if (proof.status !== 'active' && proof.status !== 'trialing') return null;

  const paidThrough = timestamp(proof.verifiedPaidThrough);
  const trialThrough = timestamp(proof.verifiedTrialThrough);
  const candidates = [paidThrough, trialThrough]
    .filter((value): value is number => value !== null)
    .map((value) => Math.min(value, providerEnd))
    .filter((value) => nowMs <= value);

  if (!candidates.length) return null;
  return new Date(Math.max(...candidates)).toISOString();
}

export const TrialClaimKindSchema = z.enum(['trial_days', 'trial_assessments']);
export const TrialClaimSchema = z.object({
  claimId: z.string().uuid(),
  requestId: z.string().uuid(),
  featureKey: z.literal('form_coach'),
  payerId: z.string().uuid(),
  configRevision: z.number().int().positive().safe(),
  kind: TrialClaimKindSchema,
  sourceKind: z.enum(['subscription', 'subscription_invoice', 'assessment_trial']),
  subscriptionId: ProviderIdSchema.nullable(),
  sourceId: ProviderIdSchema,
  startsAt: DateTimeSchema,
  expiresAt: DateTimeSchema.nullable(),
  grantedAssessmentCount: z.number().int().nonnegative().safe(),
  requestDigest: DigestSchema,
}).strict().superRefine((claim, context) => {
  const start = Date.parse(claim.startsAt);
  const expiry = claim.expiresAt === null ? null : Date.parse(claim.expiresAt);
  if (expiry !== null && expiry <= start) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Trial expiry must follow its start.' });
  }
  if (claim.kind === 'trial_days' && (claim.expiresAt === null || claim.grantedAssessmentCount !== 0)) {
    context.addIssue({ code: 'custom', message: 'A time trial needs an expiry and grants no assessment units.' });
  }
  if (claim.kind === 'trial_days' && claim.subscriptionId === null) {
    context.addIssue({ code: 'custom', path: ['subscriptionId'], message: 'A subscription trial must bind to its subscription.' });
  }
  if (claim.kind === 'trial_days' && claim.sourceKind === 'subscription'
    && claim.sourceId !== claim.subscriptionId) {
    context.addIssue({ code: 'custom', path: ['sourceId'], message: 'A subscription trial source must name its bound subscription.' });
  }
  if (claim.kind === 'trial_days' && claim.sourceKind === 'assessment_trial') {
    context.addIssue({ code: 'custom', path: ['sourceKind'], message: 'A time trial cannot use an assessment-trial source.' });
  }
  if (claim.kind === 'trial_assessments' && (claim.grantedAssessmentCount < 1 || claim.expiresAt !== null)) {
    context.addIssue({ code: 'custom', message: 'An assessment trial needs a positive unit count and no time expiry.' });
  }
  if (claim.kind === 'trial_assessments' && claim.sourceKind !== 'assessment_trial') {
    context.addIssue({ code: 'custom', path: ['sourceKind'], message: 'Assessment units require an assessment-trial source.' });
  }
  if (claim.kind === 'trial_assessments' && claim.subscriptionId !== null) {
    context.addIssue({ code: 'custom', path: ['subscriptionId'], message: 'Assessment-count trials are not subscription grants.' });
  }
});
export type TrialClaim = Readonly<z.infer<typeof TrialClaimSchema>>;

export const InvoiceRefundStateSchema = z.enum(['none', 'partial_review', 'fully_refunded', 'unmatched']);
export const FeatureInvoiceFactSchema = z.object({
  invoiceId: ProviderIdSchema,
  subscriptionId: ProviderIdSchema,
  payerId: z.string().uuid(),
  contractVersion: z.number().int().positive().safe(),
  status: z.enum(['draft', 'open', 'paid', 'void', 'uncollectible', 'unknown']),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountDueCents: z.number().int().nonnegative().safe(),
  amountPaidCents: z.number().int().nonnegative().safe(),
  periodStart: DateTimeSchema,
  periodEnd: DateTimeSchema,
  refundAmountCents: z.number().int().nonnegative().safe(),
  refundState: InvoiceRefundStateSchema,
  paymentIntentId: ProviderIdSchema.nullable(),
  chargeId: ProviderIdSchema.nullable(),
}).strict().superRefine((invoice, context) => {
  if (Date.parse(invoice.periodEnd) <= Date.parse(invoice.periodStart)) {
    context.addIssue({ code: 'custom', path: ['periodEnd'], message: 'Invoice period end must follow period start.' });
  }
  if (invoice.refundAmountCents > invoice.amountPaidCents) {
    context.addIssue({ code: 'custom', path: ['refundAmountCents'], message: 'Refund total cannot exceed settled amount.' });
  }
  if (invoice.refundState === 'fully_refunded' && invoice.refundAmountCents !== invoice.amountPaidCents) {
    context.addIssue({ code: 'custom', path: ['refundState'], message: 'A fully refunded invoice must have no net settled amount.' });
  }
  if (invoice.refundState === 'partial_review' && (invoice.refundAmountCents <= 0 || invoice.refundAmountCents >= invoice.amountPaidCents)) {
    context.addIssue({ code: 'custom', path: ['refundState'], message: 'Partial refunds require manual review.' });
  }
});
export type FeatureInvoiceFact = Readonly<z.infer<typeof FeatureInvoiceFactSchema>>;

export type InvoiceAccessClassification =
  | { readonly kind: 'paid_period'; readonly through: string }
  | { readonly kind: 'trial_period'; readonly through: string }
  | { readonly kind: 'manual_review'; readonly reason: 'partial_refund' }
  | { readonly kind: 'no_proof' };

/** Invoice money alone never establishes a free trial or assessment credit. */
export function classifyInvoiceAccessProof(
  invoice: FeatureInvoiceFact,
  evidence: {
    readonly verifiedTrialClaim: TrialClaim | null;
    readonly providerStatus: z.infer<typeof SubscriptionStatusSchema>;
  },
): InvoiceAccessClassification {
  const fact = FeatureInvoiceFactSchema.parse(invoice);
  const trial = evidence.verifiedTrialClaim === null
    ? null
    : TrialClaimSchema.parse(evidence.verifiedTrialClaim);

  if (fact.status !== 'paid') return { kind: 'no_proof' };
  if (fact.refundState === 'fully_refunded' || fact.refundState === 'unmatched') return { kind: 'no_proof' };
  if (fact.refundState === 'partial_review') return { kind: 'manual_review', reason: 'partial_refund' };
  if (fact.amountPaidCents > 0) return { kind: 'paid_period', through: fact.periodEnd };

  const verifiedTrial = trial !== null
    && trial.kind === 'trial_days'
    && trial.payerId === fact.payerId
    && trial.subscriptionId === fact.subscriptionId
    && Date.parse(trial.startsAt) <= Date.parse(fact.periodStart)
    && (trial.sourceKind === 'subscription'
      || (trial.sourceKind === 'subscription_invoice' && trial.sourceId === fact.invoiceId))
    && trial.expiresAt !== null
    && evidence.providerStatus === 'trialing';
  if (!verifiedTrial) return { kind: 'no_proof' };

  const expiry = Date.parse(trial.expiresAt!);
  const periodEnd = Date.parse(fact.periodEnd);
  return {
    kind: 'trial_period',
    through: new Date(Math.min(expiry, periodEnd)).toISOString(),
  };
}

export const ContractProrationBehaviorSchema = z.enum(['none', 'create_prorations', 'always_invoice']);
export const SubscriptionContractMoveIntentSchema = z.object({
  requestId: z.string().uuid(),
  subscriptionId: ProviderIdSchema,
  payerId: z.string().uuid(),
  fromVersion: z.number().int().positive().safe(),
  fromConfigRevision: z.number().int().positive().safe(),
  toConfigRevision: z.number().int().positive().safe(),
  toPriceKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  toPriceId: ProviderIdSchema,
  toAmountCents: z.number().int().positive().safe(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expectedStateRevision: z.number().int().nonnegative().safe(),
  prorationBehavior: ContractProrationBehaviorSchema,
  confirmedByAdmin: z.string().uuid(),
  confirmedAt: DateTimeSchema,
  requestDigest: DigestSchema,
}).strict().superRefine((intent, context) => {
  if (intent.toConfigRevision <= intent.fromConfigRevision) {
    context.addIssue({ code: 'custom', path: ['toConfigRevision'], message: 'A contract move must target a later pricing revision.' });
  }
});
export type SubscriptionContractMoveIntent = Readonly<z.infer<typeof SubscriptionContractMoveIntentSchema>>;

export function validateContractMoveConfirmation(
  intent: SubscriptionContractMoveIntent,
  confirmation: { readonly currentVersion: number; readonly currentStateRevision: number; readonly confirmed: boolean },
): boolean {
  const parsed = SubscriptionContractMoveIntentSchema.parse(intent);
  return confirmation.confirmed
    && confirmation.currentVersion === parsed.fromVersion
    && confirmation.currentStateRevision === parsed.expectedStateRevision;
}

/** Safe history row returned to its owner. Provider object IDs are deliberately absent. */
export const OwnInvoiceHistoryRowSchema = z.object({
  kind: z.enum(['subscription', 'pack', 'trial']),
  status: z.enum(['paid', 'trial', 'pending', 'refunded', 'review']),
  amountDueCents: z.number().int().nonnegative().safe(),
  amountPaidCents: z.number().int().nonnegative().safe(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  periodStart: DateTimeSchema.nullable(),
  periodEnd: DateTimeSchema.nullable(),
  recordedAt: DateTimeSchema,
}).strict();
export type OwnInvoiceHistoryRow = Readonly<z.infer<typeof OwnInvoiceHistoryRowSchema>>;

export function mayReadOwnBilling(viewerId: string, payerId: string): boolean {
  return z.string().uuid().safeParse(viewerId).success
    && z.string().uuid().safeParse(payerId).success
    && viewerId === payerId;
}
