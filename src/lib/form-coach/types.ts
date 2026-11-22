import { z } from 'zod';

export const FORM_COACH_FEATURE_KEY = 'form_coach' as const;

export const FeatureStatusSchema = z.enum(['disabled', 'pricing_pending', 'live']);
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

export const FeaturePayerSchema = z.enum(['coach', 'member']);
export type FeaturePayer = z.infer<typeof FeaturePayerSchema>;

export const FeatureBillingModelSchema = z.enum(['subscription', 'per_assessment']);
export type FeatureBillingModel = z.infer<typeof FeatureBillingModelSchema>;

export const BillingIntervalSchema = z.enum(['month', 'year']);
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;

const PriceKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
const StripeIdSchema = z.string().trim().min(1).max(255);

export const FeaturePriceOptionSchema = z.object({
  priceKey: PriceKeySchema,
  amountCents: z.number().int().positive().safe(),
  currency: CurrencySchema,
  stripeProductId: StripeIdSchema.nullable(),
  stripePriceId: StripeIdSchema.nullable(),
  interval: BillingIntervalSchema.nullable(),
  creditsPerPack: z.number().int().positive().safe().nullable(),
});
export type FeaturePriceOption = z.infer<typeof FeaturePriceOptionSchema>;

export const FeaturePricingRevisionSchema = z.object({
  featureKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  revision: z.number().int().positive().safe(),
  status: FeatureStatusSchema,
  payer: FeaturePayerSchema,
  billingModel: FeatureBillingModelSchema.nullable(),
  currency: CurrencySchema,
  displayName: z.string().trim().min(1).max(120),
  description: z.string().max(500),
  marketingCopy: z.string().max(2000),
  trialDays: z.number().int().min(0).max(365),
  trialAssessments: z.number().int().min(0).max(1000),
  priceOptions: z.array(FeaturePriceOptionSchema),
}).superRefine((config, context) => {
  const seen = new Set<string>();
  for (const [index, price] of config.priceOptions.entries()) {
    if (seen.has(price.priceKey)) {
      context.addIssue({
        code: 'custom',
        path: ['priceOptions', index, 'priceKey'],
        message: 'Price keys must be unique within a revision.',
      });
    }
    seen.add(price.priceKey);

    if (price.currency !== config.currency) {
      context.addIssue({
        code: 'custom',
        path: ['priceOptions', index, 'currency'],
        message: 'A price must use its revision currency.',
      });
    }

    const hasProviderBinding = price.stripeProductId !== null && price.stripePriceId !== null;
    if ((price.stripeProductId === null) !== (price.stripePriceId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['priceOptions', index],
        message: 'Stripe product and price bindings must be present together.',
      });
    }

    if (config.billingModel === 'subscription') {
      if (price.interval === null || price.creditsPerPack !== null) {
        context.addIssue({
          code: 'custom',
          path: ['priceOptions', index],
          message: 'Subscription prices need an interval and cannot contain pack credits.',
        });
      }
    } else if (config.billingModel === 'per_assessment') {
      if (price.interval !== null || price.creditsPerPack === null) {
        context.addIssue({
          code: 'custom',
          path: ['priceOptions', index],
          message: 'Assessment packs need a credit quantity and cannot contain an interval.',
        });
      }
    }

    if (config.status === 'live' && !hasProviderBinding) {
      context.addIssue({
        code: 'custom',
        path: ['priceOptions', index, 'stripePriceId'],
        message: 'A live price requires a verified provider binding.',
      });
    }
  }

  if (config.status === 'live') {
    if (config.billingModel === null || config.priceOptions.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['billingModel'],
        message: 'A live revision needs a billing model and at least one price.',
      });
    }
    if (config.billingModel === 'subscription' && config.priceOptions.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['priceOptions'],
        message: 'A live subscription revision must have exactly one price option.',
      });
    }
  }

  if (config.status === 'pricing_pending') {
    if (config.priceOptions.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['priceOptions'],
        message: 'Pricing-pending revisions do not expose purchasable prices.',
      });
    }
    if (config.billingModel !== null) {
      context.addIssue({
        code: 'custom',
        path: ['billingModel'],
        message: 'Pricing-pending revisions do not select a billing model.',
      });
    }
  }

  if (config.billingModel === null && config.priceOptions.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['billingModel'],
      message: 'Price options require a billing model.',
    });
  }
});
export type FeaturePricingRevision = z.infer<typeof FeaturePricingRevisionSchema>;

export const DEFAULT_FORM_COACH_PRICING: FeaturePricingRevision = Object.freeze({
  featureKey: FORM_COACH_FEATURE_KEY,
  revision: 1,
  status: 'pricing_pending',
  payer: 'coach',
  billingModel: null,
  currency: 'USD',
  displayName: 'Form Coach',
  description: '',
  marketingCopy: '',
  trialDays: 0,
  trialAssessments: 0,
  priceOptions: Object.freeze([]) as unknown as FeaturePriceOption[],
});

export const PricingQuoteSchema = z.object({
  featureKey: z.string(),
  configRevision: z.number().int().positive().safe(),
  payer: FeaturePayerSchema,
  payerId: z.string().uuid(),
  priceKey: PriceKeySchema,
  stripeProductId: StripeIdSchema,
  stripePriceId: StripeIdSchema,
  currency: CurrencySchema,
  unitAmountCents: z.number().int().positive().safe(),
  packQuantity: z.number().int().positive().max(100),
  creditsPerPack: z.number().int().positive().safe(),
  totalAmountCents: z.number().int().positive().safe(),
  totalCredits: z.number().int().positive().safe(),
});
export type PricingQuote = Readonly<z.infer<typeof PricingQuoteSchema>>;

export const FeatureCheckoutReservationSchema = PricingQuoteSchema.extend({
  reservationId: z.string().uuid(),
  requestId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
  state: z.enum(['reserved', 'unknown', 'bound', 'paid', 'cancel_required', 'canceled', 'expired', 'rejected']),
  checkoutSessionId: StripeIdSchema.nullable(),
  customerId: StripeIdSchema.nullable(),
  subscriptionId: StripeIdSchema.nullable(),
  expiresAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
});
export type FeatureCheckoutReservation = Readonly<z.infer<typeof FeatureCheckoutReservationSchema>>;

export const FundingEntitlementSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('comp'),
    userId: z.string().uuid(),
    sourceId: z.string().min(1),
    startsAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
  }),
  z.object({
    kind: z.literal('subscription'),
    userId: z.string().uuid(),
    sourceId: z.string().min(1),
    paidThrough: z.string().datetime({ offset: true }),
    active: z.boolean(),
  }),
  z.object({
    kind: z.literal('trial_days'),
    userId: z.string().uuid(),
    sourceId: z.string().min(1),
    startsAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  }),
]);
export type FundingEntitlement = z.infer<typeof FundingEntitlementSchema>;

export const FundingCreditLotSchema = z.object({
  kind: z.enum(['assessment_trial', 'pack']),
  lotId: z.string().min(1),
  userId: z.string().uuid(),
  sourceReceiptId: z.string().min(1).nullable(),
  packKey: PriceKeySchema.nullable(),
  packUnitIndex: z.number().int().positive().max(100).nullable(),
  grantedUnits: z.number().int().positive().safe(),
  remainingUnits: z.number().int().nonnegative().safe(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
}).superRefine((lot, context) => {
  if (lot.remainingUnits > lot.grantedUnits) {
    context.addIssue({ code: 'custom', path: ['remainingUnits'], message: 'Remaining credits exceed the lot grant.' });
  }
  if (lot.kind === 'pack' && (lot.sourceReceiptId === null || lot.packKey === null || lot.packUnitIndex === null)) {
    context.addIssue({ code: 'custom', message: 'Purchased pack lots must retain their receipt and pack-unit provenance.' });
  }
  if (lot.kind === 'assessment_trial' && lot.sourceReceiptId !== null) {
    context.addIssue({ code: 'custom', path: ['sourceReceiptId'], message: 'Trial lots cannot be attributed to a pack receipt.' });
  }
});
export type FundingCreditLot = z.infer<typeof FundingCreditLotSchema>;

export const BundleFundingReceiptSchema = z.object({
  receiptId: z.string().min(1),
  bundleId: z.string().uuid(),
  featureKey: z.string().min(1),
  payerRole: FeaturePayerSchema,
  payerId: z.string().uuid(),
  configRevision: z.number().int().positive().safe(),
  fundingSource: z.enum(['comp', 'subscription', 'trial_days', 'assessment_trial', 'pack']),
  sourceId: z.string().min(1),
  creditUnitsConsumed: z.union([z.literal(0), z.literal(1)]),
  dueAt: z.string().datetime({ offset: true }),
  operationKey: z.string().min(1),
  fundedAt: z.string().datetime({ offset: true }),
}).superRefine((receipt, context) => {
  const creditSource = receipt.fundingSource === 'assessment_trial' || receipt.fundingSource === 'pack';
  if (receipt.creditUnitsConsumed !== (creditSource ? 1 : 0)) {
    context.addIssue({ code: 'custom', path: ['creditUnitsConsumed'], message: 'Funding receipt debit does not match its source.' });
  }
});
export type BundleFundingReceipt = z.infer<typeof BundleFundingReceiptSchema>;

export const FeaturePaymentReceiptSchema = z.object({
  receiptId: z.string().uuid(),
  featureKey: z.string().min(1),
  reservationId: z.string().uuid(),
  requestId: z.string().uuid(),
  payerRole: FeaturePayerSchema,
  payerId: z.string().uuid(),
  configRevision: z.number().int().positive().safe(),
  priceKey: PriceKeySchema,
  stripeProductId: StripeIdSchema,
  stripePriceId: StripeIdSchema,
  checkoutSessionId: StripeIdSchema,
  paymentObjectId: StripeIdSchema,
  paymentIntentId: StripeIdSchema.nullable(),
  subscriptionId: StripeIdSchema.nullable(),
  packQuantity: z.number().int().positive().max(100),
  creditsPerPack: z.number().int().positive().safe().nullable(),
  totalCredits: z.number().int().nonnegative().safe(),
  amountCents: z.number().int().positive().safe(),
  currency: CurrencySchema,
  disposition: z.enum(['applied', 'blocked_deletion']),
  eventId: StripeIdSchema,
  recordedAt: z.string().datetime({ offset: true }),
});
export type FeaturePaymentReceipt = z.infer<typeof FeaturePaymentReceiptSchema>;

export const FeatureSubscriptionSchema = z.object({
  subscriptionId: StripeIdSchema,
  featureKey: z.string().min(1),
  payerRole: FeaturePayerSchema,
  payerId: z.string().uuid(),
  configRevision: z.number().int().positive().safe(),
  priceKey: PriceKeySchema,
  customerId: StripeIdSchema,
  status: z.enum(['pending_reconcile', 'active', 'trialing', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'unpaid', 'blocked_deletion']),
  currentPeriodEnd: z.string().datetime({ offset: true }),
  cancelAtPeriodEnd: z.boolean(),
  stateRevision: z.number().int().nonnegative().safe(),
});
export type FeatureSubscription = z.infer<typeof FeatureSubscriptionSchema>;
export const FundingDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('blocked'), reason: z.literal('feature_disabled') }),
  z.object({ kind: z.literal('funded_existing'), receiptId: z.string().min(1) }),
  z.object({ kind: z.literal('deferred'), reason: z.enum(['member_payer_first_attempt', 'coach_payer_send_required']) }),
  z.object({
    kind: z.literal('funded'),
    sourceKind: z.enum(['comp', 'subscription', 'trial_days', 'assessment_trial', 'pack']),
    sourceId: z.string().min(1),
    debitUnits: z.union([z.literal(0), z.literal(1)]),
  }).superRefine((value, context) => {
    const creditSource = value.sourceKind === 'assessment_trial' || value.sourceKind === 'pack';
    if (value.debitUnits !== (creditSource ? 1 : 0)) {
      context.addIssue({ code: 'custom', path: ['debitUnits'], message: 'Funding debit does not match its source.' });
    }
  }),
  z.object({ kind: z.literal('unfunded'), reason: z.literal('no_eligible_funding') }),
]);
export type FundingDecision = z.infer<typeof FundingDecisionSchema>;

export interface FundingResolutionInput {
  readonly featureKey: string;
  readonly bundleId: string;
  readonly payerId: string;
  readonly frozenConfigRevision: number;
  readonly bundleDueAt: Date;
  readonly featureStatus: FeatureStatus;
  readonly frozenPayer: FeaturePayer;
  readonly trigger: 'send' | 'first_assessed_attempt';
  readonly now: Date;
  readonly existingReceipt?: BundleFundingReceipt | null;
  readonly entitlements?: readonly FundingEntitlement[];
  readonly creditLots?: readonly FundingCreditLot[];
}
