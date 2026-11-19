import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORM_COACH_PRICING,
  FeaturePricingRevisionSchema,
  type FeaturePricingRevision,
} from './types';
import {
  mayDeleteOwnClip,
  mayReadFeatureHistory,
  nextPricingRevision,
  quotePack,
  refundUnusedPackCredits,
  resolveBundleFunding,
} from './pricing';

const livePackPricing: FeaturePricingRevision = {
  featureKey: 'form_coach',
  revision: 4,
  status: 'live',
  payer: 'coach',
  billingModel: 'per_assessment',
  currency: 'USD',
  displayName: 'Form Coach',
  description: 'Private movement feedback.',
  marketingCopy: 'Practice with form cues and coach review.',
  trialDays: 0,
  trialAssessments: 0,
  priceOptions: [{
    priceKey: 'pack_3',
    amountCents: 1500,
    currency: 'USD',
    stripeProductId: 'prod_form_coach',
    stripePriceId: 'price_form_coach_pack_3',
    interval: null,
    creditsPerPack: 3,
  }],
};

const fixedNow = new Date('2026-11-19T16:00:00.000Z');
const toTime = (hours: number) => new Date(fixedNow.getTime() + hours * 60 * 60 * 1000).toISOString();
const payerId = '2e03ea57-5212-4f2e-8a48-e421d2c959c3';
const otherUserId = '1f03ea57-5212-4f2e-8a48-e421d2c959c3';
const bundleId = '93000000-0000-4000-8000-000000000001';

function fundingInput(overrides: Partial<Parameters<typeof resolveBundleFunding>[0]> = {}) {
  return {
    featureKey: 'form_coach',
    bundleId,
    payerId,
    frozenConfigRevision: 4,
    bundleDueAt: new Date(toTime(3)),
    featureStatus: 'live' as const,
    frozenPayer: 'coach' as const,
    trigger: 'send' as const,
    now: fixedNow,
    ...overrides,
  };
}

describe('Form Coach pricing models', () => {
  it('starts pending with coach payer and no price or provider object', () => {
    expect(FeaturePricingRevisionSchema.parse(DEFAULT_FORM_COACH_PRICING)).toMatchObject({
      featureKey: 'form_coach',
      revision: 1,
      status: 'pricing_pending',      billingModel: null,
      payer: 'coach',
      currency: 'USD',
      displayName: 'Form Coach',
      description: '',
      marketingCopy: '',
      trialDays: 0,
      trialAssessments: 0,
      priceOptions: [],
    });
    expect(DEFAULT_FORM_COACH_PRICING.priceOptions).toHaveLength(0);
  });

  it('rejects a live revision without a provider binding', () => {
    const invalid = {
      ...livePackPricing,
      priceOptions: [{ ...livePackPricing.priceOptions[0], stripePriceId: null, stripeProductId: null }],
    };
    expect(FeaturePricingRevisionSchema.safeParse(invalid).success).toBe(false);
  });

  it('keeps pending pricing model-free and requires one subscription price', () => {
    expect(FeaturePricingRevisionSchema.safeParse({
      ...DEFAULT_FORM_COACH_PRICING,
      billingModel: 'subscription',
    }).success).toBe(false);
    const multipleSubscriptionPrices = {
      ...livePackPricing,
      billingModel: 'subscription' as const,
      priceOptions: [
        { ...livePackPricing.priceOptions[0], interval: 'month' as const, creditsPerPack: null },
        { ...livePackPricing.priceOptions[0], priceKey: 'pack_4', interval: 'year' as const, creditsPerPack: null },
      ],
    };
    expect(FeaturePricingRevisionSchema.safeParse(multipleSubscriptionPrices).success).toBe(false);
    expect(FeaturePricingRevisionSchema.safeParse({ ...livePackPricing, trialAssessments: -1 }).success).toBe(false);
    expect(FeaturePricingRevisionSchema.safeParse({ ...livePackPricing, trialAssessments: 1001 }).success).toBe(false);
  });

  it('uses compare-and-swap revision numbers and never rewrites the current revision', () => {
    const next = nextPricingRevision(livePackPricing, 4, {
      status: 'pricing_pending',
      payer: 'member',
      billingModel: null,
      currency: 'USD',
      displayName: 'Form Coach',
      description: '',
      marketingCopy: '',
      trialDays: 0,
      trialAssessments: 0,
      priceOptions: [],
    });
    expect(next.revision).toBe(5);
    expect(livePackPricing.revision).toBe(4);
    expect(() => nextPricingRevision(livePackPricing, 3, {
      status: 'pricing_pending',
      payer: 'member',
      billingModel: null,
      currency: 'USD',
      displayName: 'Form Coach',
      description: '',
      marketingCopy: '',
      trialDays: 0,
      trialAssessments: 0,
      priceOptions: [],
    })).toThrow(/revision changed/);
  });

  it('quotes exact pack quantity, credits, price and payer as a frozen snapshot', () => {
    const quote = quotePack({
      config: livePackPricing,
      priceKey: 'pack_3',
      packQuantity: 4,
      payerId: '2e03ea57-5212-4f2e-8a48-e421d2c959c3',
    });
    expect(quote).toMatchObject({
      configRevision: 4,
      payer: 'coach',
      priceKey: 'pack_3',
      stripePriceId: 'price_form_coach_pack_3',
      packQuantity: 4,
      unitAmountCents: 1500,
      totalAmountCents: 6000,
      creditsPerPack: 3,
      totalCredits: 12,
    });
    expect(Object.isFrozen(quote)).toBe(true);
    expect(() => quotePack({ config: livePackPricing, priceKey: 'pack_3', packQuantity: 0, payerId: '2e03ea57-5212-4f2e-8a48-e421d2c959c3' })).toThrow(/whole pack quantity/);
    expect(() => quotePack({ config: DEFAULT_FORM_COACH_PRICING, priceKey: 'pack_3', packQuantity: 1, payerId: '2e03ea57-5212-4f2e-8a48-e421d2c959c3' })).toThrow(/not currently available/);
  });

  it('blocks new use while disabled but keeps an existing funded bundle usable while enabled', () => {
    const funded = { receiptId: 'funding-1', bundleId, featureKey: 'form_coach', payerRole: 'coach' as const, payerId, configRevision: 4, fundingSource: 'pack' as const, sourceId: 'lot-1', creditUnitsConsumed: 1 as const, dueAt: toTime(3), operationKey: 'funding-op-1', fundedAt: fixedNow.toISOString() };
    expect(resolveBundleFunding(fundingInput({ featureStatus: 'disabled', existingReceipt: funded }))).toEqual({
      kind: 'blocked', reason: 'feature_disabled',
    });
    expect(resolveBundleFunding(fundingInput({ featureStatus: 'pricing_pending', existingReceipt: funded }))).toEqual({
      kind: 'funded_existing', receiptId: 'funding-1',
    });
  });

  it('never funds the same bundle again after its frozen receipt expires', () => {
    const expiredDueAt = new Date(toTime(-1));
    const expiredReceipt = {
      receiptId: 'funding-expired', bundleId, featureKey: 'form_coach', payerRole: 'coach' as const, payerId,
      configRevision: 4, fundingSource: 'pack' as const, sourceId: 'lot-1', creditUnitsConsumed: 1 as const,
      dueAt: expiredDueAt.toISOString(), operationKey: 'funding-op-expired', fundedAt: toTime(-2),
    };
    const pack = {
      kind: 'pack' as const, lotId: 'pack-lot-2', userId: payerId, sourceReceiptId: 'receipt-2',
      packKey: 'pack_3', packUnitIndex: 1, grantedUnits: 3, remainingUnits: 3, expiresAt: toTime(5),
    };
    expect(resolveBundleFunding(fundingInput({ bundleDueAt: expiredDueAt, existingReceipt: expiredReceipt, creditLots: [pack] })))
      .toEqual({ kind: 'unfunded', reason: 'no_eligible_funding' });
  });

  it('rejects a new bundle past its due date before selecting any funding source', () => {
    const pastDue = new Date(toTime(-1));
    const comp = { kind: 'comp' as const, userId: payerId, sourceId: 'comp-late', startsAt: toTime(-2), expiresAt: toTime(5) };
    const subscription = { kind: 'subscription' as const, userId: payerId, sourceId: 'sub-late', paidThrough: toTime(5), active: true };
    const trialDays = { kind: 'trial_days' as const, userId: payerId, sourceId: 'trial-days-late', startsAt: toTime(-2), expiresAt: toTime(5) };
    const trialLot = { kind: 'assessment_trial' as const, lotId: 'trial-late', userId: payerId, sourceReceiptId: null, packKey: null, packUnitIndex: null, grantedUnits: 1, remainingUnits: 1, expiresAt: toTime(5) };
    const pack = { kind: 'pack' as const, lotId: 'pack-late', userId: payerId, sourceReceiptId: 'receipt-late', packKey: 'pack_3', packUnitIndex: 1, grantedUnits: 3, remainingUnits: 3, expiresAt: toTime(5) };

    for (const overrides of [
      { entitlements: [comp] },
      { entitlements: [subscription] },
      { entitlements: [trialDays] },
      { creditLots: [trialLot] },
      { creditLots: [pack] },
    ]) {
      expect(resolveBundleFunding(fundingInput({ bundleDueAt: pastDue, ...overrides })))
        .toEqual({ kind: 'unfunded', reason: 'no_eligible_funding' });
    }
  });

  it('rejects an invalid due date instead of funding from an available source', () => {
    const pack = { kind: 'pack' as const, lotId: 'pack-invalid-date', userId: payerId, sourceReceiptId: 'receipt-invalid-date', packKey: 'pack_3', packUnitIndex: 1, grantedUnits: 3, remainingUnits: 3, expiresAt: toTime(5) };
    expect(() => resolveBundleFunding(fundingInput({ bundleDueAt: new Date(Number.NaN), creditLots: [pack] })))
      .toThrow(/valid bundle due date/);
  });

  it('rejects an existing receipt whose immutable bundle or payer snapshot differs', () => {
    const receipt = {
      receiptId: 'funding-mismatch', bundleId, featureKey: 'form_coach', payerRole: 'coach' as const,
      payerId, configRevision: 4, fundingSource: 'pack' as const, sourceId: 'lot-1',
      creditUnitsConsumed: 1 as const, dueAt: toTime(3), operationKey: 'funding-op-mismatch', fundedAt: fixedNow.toISOString(),
    };
    expect(() => resolveBundleFunding(fundingInput({ existingReceipt: { ...receipt, payerId: otherUserId } })))
      .toThrow(/does not match the frozen bundle identity/);
    expect(() => resolveBundleFunding(fundingInput({ existingReceipt: { ...receipt, configRevision: 5 } })))
      .toThrow(/does not match the frozen bundle identity/);
  });

  it('defers a member-payer bundle until the first assessed attempt', () => {
    expect(resolveBundleFunding(fundingInput({ frozenPayer: 'member' }))).toEqual({
      kind: 'deferred', reason: 'member_payer_first_attempt',
    });
    const pack = {
      kind: 'pack' as const, lotId: 'member-pack', userId: payerId, sourceReceiptId: 'member-receipt',
      packKey: 'pack_3', packUnitIndex: 1, grantedUnits: 3, remainingUnits: 3, expiresAt: toTime(5),
    };
    expect(resolveBundleFunding(fundingInput({ frozenPayer: 'member', trigger: 'first_assessed_attempt', creditLots: [pack] })))
      .toMatchObject({ kind: 'funded', sourceKind: 'pack', sourceId: 'member-pack', debitUnits: 1 });
    expect(resolveBundleFunding(fundingInput({ trigger: 'first_assessed_attempt', creditLots: [pack] })))
      .toEqual({ kind: 'deferred', reason: 'coach_payer_send_required' });
  });

  it('allows only explicit comp to fund new use while pricing is pending', () => {
    const comp = { kind: 'comp' as const, userId: payerId, sourceId: 'comp-1', startsAt: toTime(-1), expiresAt: toTime(5) };
    const subscription = { kind: 'subscription' as const, userId: payerId, sourceId: 'sub-1', paidThrough: toTime(5), active: true };
    const pack = { kind: 'pack' as const, lotId: 'pack-lot-1', userId: payerId, sourceReceiptId: 'receipt-1', packKey: 'pack_3', packUnitIndex: 1, grantedUnits: 3, remainingUnits: 2, expiresAt: toTime(5) };
    expect(resolveBundleFunding(fundingInput({ featureStatus: 'pricing_pending', entitlements: [comp, subscription], creditLots: [pack] }))).toMatchObject({ kind: 'funded', sourceKind: 'comp', debitUnits: 0 });
    expect(resolveBundleFunding(fundingInput({ featureStatus: 'pricing_pending', entitlements: [subscription], creditLots: [pack] }))).toEqual({ kind: 'unfunded', reason: 'no_eligible_funding' });
  });

  it('prefers time access over credits and picks subscription/lot ties deterministically', () => {
    const subLate = { kind: 'subscription' as const, userId: payerId, sourceId: 'sub-b', paidThrough: toTime(24), active: true };
    const subEarly = { kind: 'subscription' as const, userId: payerId, sourceId: 'sub-a', paidThrough: toTime(12), active: true };
    const creditLots = [
      { kind: 'pack' as const, lotId: 'pack-b', userId: payerId, sourceReceiptId: 'receipt-b', packKey: 'pack_3', packUnitIndex: 1, grantedUnits: 3, remainingUnits: 3, expiresAt: toTime(48) },
      { kind: 'pack' as const, lotId: 'pack-a', userId: payerId, sourceReceiptId: 'receipt-a', packKey: 'pack_3', packUnitIndex: 1, grantedUnits: 1, remainingUnits: 1, expiresAt: toTime(48) },
    ];
    expect(resolveBundleFunding(fundingInput({ entitlements: [subEarly, subLate], creditLots }))).toMatchObject({ sourceId: 'sub-b' });
    expect(resolveBundleFunding(fundingInput({ creditLots }))).toMatchObject({ sourceId: 'pack-a' });
  });

  it('uses trial-day access without debit and finite trial units before purchased packs', () => {
    const trialDays = { kind: 'trial_days' as const, userId: payerId, sourceId: 'trial-days-1', startsAt: toTime(-2), expiresAt: toTime(4) };
    const trialLot = { kind: 'assessment_trial' as const, lotId: 'trial-lot-1', userId: payerId, sourceReceiptId: null, packKey: null, packUnitIndex: null, grantedUnits: 1, remainingUnits: 1, expiresAt: toTime(4) };
    const pack = { kind: 'pack' as const, lotId: 'pack-1', userId: payerId, sourceReceiptId: 'receipt-2', packKey: 'pack_8', packUnitIndex: 1, grantedUnits: 8, remainingUnits: 8, expiresAt: toTime(1) };
    expect(resolveBundleFunding(fundingInput({ entitlements: [trialDays], creditLots: [trialLot, pack] }))).toMatchObject({ kind: 'funded', sourceKind: 'trial_days', debitUnits: 0 });
    expect(resolveBundleFunding(fundingInput({ creditLots: [trialLot, pack] }))).toMatchObject({ kind: 'funded', sourceKind: 'assessment_trial', debitUnits: 1 });
  });

  it('only selects entitlement and credit lots owned by the frozen payer', () => {
    const otherSubscription = { kind: 'subscription' as const, userId: otherUserId, sourceId: 'other-sub', paidThrough: toTime(24), active: true };
    const otherPack = {
      kind: 'pack' as const, lotId: 'other-pack', userId: otherUserId, sourceReceiptId: 'receipt-other',
      packKey: 'pack_3', packUnitIndex: 1, grantedUnits: 3, remainingUnits: 3, expiresAt: toTime(24),
    };
    const payerPack = { ...otherPack, lotId: 'payer-pack', userId: payerId, sourceReceiptId: 'receipt-payer' };
    expect(resolveBundleFunding(fundingInput({ entitlements: [otherSubscription], creditLots: [otherPack] })))
      .toEqual({ kind: 'unfunded', reason: 'no_eligible_funding' });
    expect(resolveBundleFunding(fundingInput({ creditLots: [otherPack, payerPack] })))
      .toMatchObject({ kind: 'funded', sourceKind: 'pack', sourceId: 'payer-pack', debitUnits: 1 });
  });

  it('preserves pack lots across a billing-model change and refunds only the selected unused lot', () => {
    const result = refundUnusedPackCredits({ lotId: 'pack-a', kind: 'pack', remainingUnits: 3 }, 2);
    expect(result).toEqual({ lotId: 'pack-a', removedUnits: 2, remainingUnits: 1 });
    expect(refundUnusedPackCredits({ lotId: 'pack-a', kind: 'pack', remainingUnits: 1 }, 20)).toEqual({
      lotId: 'pack-a', removedUnits: 1, remainingUnits: 0,
    });
    expect(() => refundUnusedPackCredits({ lotId: 'trial-a', kind: 'assessment_trial', remainingUnits: 1 }, 1)).toThrow(/purchased pack/);
  });

  it('keeps history readable and owner clip deletion independent of entitlement/membership', () => {
    expect(mayReadFeatureHistory({ isAuthenticatedOwner: true })).toBe(true);
    expect(mayReadFeatureHistory({ isAuthenticatedOwner: false })).toBe(false);
    expect(mayDeleteOwnClip({ isAuthenticatedOwner: true, featureStatus: 'disabled', baseMembershipActive: false })).toBe(true);
    expect(mayDeleteOwnClip({ isAuthenticatedOwner: false, featureStatus: 'live', baseMembershipActive: true })).toBe(false);
  });
});
