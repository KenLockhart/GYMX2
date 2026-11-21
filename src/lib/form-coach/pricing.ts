import {
  BundleFundingReceiptSchema,
  FeaturePricingRevisionSchema,
  FundingCreditLotSchema,
  FundingDecisionSchema,
  FundingEntitlementSchema,
  PricingQuoteSchema,
  type BundleFundingReceipt,
  type FeaturePricingRevision,
  type FundingCreditLot,
  type FundingDecision,
  type FundingEntitlement,
  type FundingResolutionInput,
  type PricingQuote,
} from './types';

export class PricingValidationError extends Error {
  readonly code: 'invalid_config' | 'stale_revision' | 'price_unavailable' | 'invalid_quantity';

  constructor(
    code: PricingValidationError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'PricingValidationError';
    this.code = code;
  }
}

export function parsePricingRevision(input: unknown): FeaturePricingRevision {
  const result = FeaturePricingRevisionSchema.safeParse(input);
  if (!result.success) {
    throw new PricingValidationError('invalid_config', result.error.issues[0]?.message ?? 'Invalid pricing revision.');
  }
  return result.data;
}

export function nextPricingRevision(
  current: FeaturePricingRevision,
  expectedRevision: number,
  proposed: Omit<FeaturePricingRevision, 'featureKey' | 'revision'>,
): FeaturePricingRevision {
  if (!Number.isSafeInteger(expectedRevision) || current.revision !== expectedRevision) {
    throw new PricingValidationError('stale_revision', 'The active pricing revision changed. Reload before saving.');
  }

  if (expectedRevision >= Number.MAX_SAFE_INTEGER) {
    throw new PricingValidationError('invalid_config', 'The pricing revision cannot be incremented safely.');
  }

  const next = parsePricingRevision({
    ...proposed,
    featureKey: current.featureKey,
    revision: expectedRevision + 1,
  });
  return next;
}

export interface QuotePackInput {
  readonly config: FeaturePricingRevision;
  readonly priceKey: string;
  readonly packQuantity: number;
  readonly payerId: string;
}

export function quotePack(input: QuotePackInput): PricingQuote {
  const config = parsePricingRevision(input.config);
  if (config.status !== 'live' || config.billingModel !== 'per_assessment') {
    throw new PricingValidationError('price_unavailable', 'Assessment packs are not currently available.');
  }

  if (!Number.isSafeInteger(input.packQuantity) || input.packQuantity < 1 || input.packQuantity > 100) {
    throw new PricingValidationError('invalid_quantity', 'Choose a whole pack quantity from 1 to 100.');
  }

  const price = config.priceOptions.find((option) => option.priceKey === input.priceKey);
  if (!price || price.creditsPerPack === null || !price.stripeProductId || !price.stripePriceId) {
    throw new PricingValidationError('price_unavailable', 'The selected assessment pack is not available.');
  }

  const totalAmountCents = price.amountCents * input.packQuantity;
  const totalCredits = price.creditsPerPack * input.packQuantity;
  if (!Number.isSafeInteger(totalAmountCents) || !Number.isSafeInteger(totalCredits)) {
    throw new PricingValidationError('invalid_quantity', 'The selected pack quantity is too large.');
  }

  const quote = PricingQuoteSchema.parse({
    featureKey: config.featureKey,
    configRevision: config.revision,
    payer: config.payer,
    payerId: input.payerId,
    priceKey: price.priceKey,
    stripeProductId: price.stripeProductId,
    stripePriceId: price.stripePriceId,
    currency: price.currency,
    unitAmountCents: price.amountCents,
    packQuantity: input.packQuantity,
    creditsPerPack: price.creditsPerPack,
    totalAmountCents,
    totalCredits,
  });

  return Object.freeze(quote);
}

function parseEntitlements(inputs: readonly FundingEntitlement[] = []): FundingEntitlement[] {
  return inputs.map((input) => FundingEntitlementSchema.parse(input));
}

function parseLots(inputs: readonly FundingCreditLot[] = []): FundingCreditLot[] {
  return inputs.map((input) => FundingCreditLotSchema.parse(input));
}

function validTimeWindow(startsAt: string, expiresAt: string | null, now: number): boolean {
  const start = Date.parse(startsAt);
  const end = expiresAt === null ? null : Date.parse(expiresAt);
  return Number.isFinite(start) && start <= now && (end === null || (Number.isFinite(end) && now <= end));
}

function eligibleEntitlement(
  entitlement: FundingEntitlement,
  now: number,
): boolean {
  switch (entitlement.kind) {
    case 'comp':
    case 'trial_days':
      return validTimeWindow(entitlement.startsAt, entitlement.expiresAt, now);
    case 'subscription':
      return entitlement.active && Number.isFinite(Date.parse(entitlement.paidThrough)) && now <= Date.parse(entitlement.paidThrough);
  }
}

function stableIdCompare(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function earliestExpiryCompare(
  left: { readonly expiresAt: string | null; readonly sourceId?: string; readonly lotId?: string },
  right: { readonly expiresAt: string | null; readonly sourceId?: string; readonly lotId?: string },
): number {
  const leftExpiry = left.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(left.expiresAt);
  const rightExpiry = right.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(right.expiresAt);
  if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
  return stableIdCompare(left.sourceId ?? left.lotId ?? '', right.sourceId ?? right.lotId ?? '');
}

function selectAccessEntitlement(
  entitlements: readonly FundingEntitlement[],
  now: number,
  compOnly: boolean,
  payerId: string,
): FundingEntitlement | undefined {
  const eligible = entitlements.filter((entry) => entry.userId === payerId && eligibleEntitlement(entry, now));
  const comp = eligible
    .filter((entry): entry is Extract<FundingEntitlement, { kind: 'comp' }> => entry.kind === 'comp')
    .sort((left, right) => earliestExpiryCompare(left, right))[0];
  if (comp) return comp;
  if (compOnly) return undefined;

  const subscription = eligible
    .filter((entry): entry is Extract<FundingEntitlement, { kind: 'subscription' }> => entry.kind === 'subscription')
    .sort((left, right) => {
      const throughDelta = Date.parse(right.paidThrough) - Date.parse(left.paidThrough);
      return throughDelta || stableIdCompare(left.sourceId, right.sourceId);
    })[0];
  if (subscription) return subscription;

  return eligible
    .filter((entry): entry is Extract<FundingEntitlement, { kind: 'trial_days' }> => entry.kind === 'trial_days')
    .sort((left, right) => earliestExpiryCompare(left, right))[0];
}

function selectCreditLot(
  lots: readonly FundingCreditLot[],
  now: number,
  kind: FundingCreditLot['kind'],
  payerId: string,
): FundingCreditLot | undefined {
  return lots
    .filter((lot) => lot.userId === payerId && lot.kind === kind && lot.remainingUnits > 0 && (lot.expiresAt === null || (Number.isFinite(Date.parse(lot.expiresAt)) && now <= Date.parse(lot.expiresAt))))
    .sort((left, right) => earliestExpiryCompare(left, right))[0];
}

function existingReceiptDecision(
  receipt: BundleFundingReceipt | null | undefined,
  input: FundingResolutionInput,
): FundingDecision | undefined {
  if (!receipt) return undefined;

  const parsedReceipt = BundleFundingReceiptSchema.parse(receipt);
  const expectedDueAt = input.bundleDueAt.getTime();
  if (!Number.isFinite(expectedDueAt)) throw new TypeError('Funding resolution needs a valid bundle due date.');
  if (
    parsedReceipt.featureKey !== input.featureKey
    || parsedReceipt.bundleId !== input.bundleId
    || parsedReceipt.payerId !== input.payerId
    || parsedReceipt.payerRole !== input.frozenPayer
    || parsedReceipt.configRevision !== input.frozenConfigRevision
    || Date.parse(parsedReceipt.dueAt) !== expectedDueAt
  ) {
    throw new TypeError('Existing funding receipt does not match the frozen bundle identity.');
  }

  // An expired receipt remains the funding record for this bundle. It must not fall
  // through to another entitlement or consume a second lot on a retry.
  if (Date.parse(parsedReceipt.dueAt) < input.now.getTime()) {
    return { kind: 'unfunded', reason: 'no_eligible_funding' };
  }
  return FundingDecisionSchema.parse({ kind: 'funded_existing', receiptId: parsedReceipt.receiptId });
}

/**
 * Resolves the immutable funding source for a new bundle. The database send/attempt
 * transaction must re-evaluate these same sources under lock before it writes a receipt.
 */
export function resolveBundleFunding(input: FundingResolutionInput): FundingDecision {
  const now = input.now.getTime();
  if (!Number.isFinite(now)) throw new TypeError('Funding resolution needs a valid time.');
  const dueAt = input.bundleDueAt.getTime();
  if (!Number.isFinite(dueAt)) throw new TypeError('Funding resolution needs a valid bundle due date.');

  if (input.featureStatus === 'disabled') {
    return { kind: 'blocked', reason: 'feature_disabled' };
  }

  const existing = existingReceiptDecision(input.existingReceipt, input);
  if (existing) return existing;

  // A new bundle must be funded before its deadline. Existing expired receipts are
  // handled above so retries never fall through and consume another entitlement.
  if (dueAt < now) return { kind: 'unfunded', reason: 'no_eligible_funding' };

  if (input.frozenPayer === 'member' && input.trigger === 'send') {
    return { kind: 'deferred', reason: 'member_payer_first_attempt' };
  }
  if (input.frozenPayer === 'coach' && input.trigger === 'first_assessed_attempt') {
    return { kind: 'deferred', reason: 'coach_payer_send_required' };
  }

  const entitlements = parseEntitlements(input.entitlements);
  const compOnly = input.featureStatus === 'pricing_pending';
  const entitlement = selectAccessEntitlement(entitlements, now, compOnly, input.payerId);
  if (entitlement) {
    return FundingDecisionSchema.parse({
      kind: 'funded',
      sourceKind: entitlement.kind,
      sourceId: entitlement.sourceId,
      debitUnits: 0,
    });
  }

  if (compOnly) return { kind: 'unfunded', reason: 'no_eligible_funding' };

  const lots = parseLots(input.creditLots);
  const trialLot = selectCreditLot(lots, now, 'assessment_trial', input.payerId);
  if (trialLot) {
    return FundingDecisionSchema.parse({
      kind: 'funded',
      sourceKind: 'assessment_trial',
      sourceId: trialLot.lotId,
      debitUnits: 1,
    });
  }

  const packLot = selectCreditLot(lots, now, 'pack', input.payerId);
  if (packLot) {
    return FundingDecisionSchema.parse({
      kind: 'funded',
      sourceKind: 'pack',
      sourceId: packLot.lotId,
      debitUnits: 1,
    });
  }

  return { kind: 'unfunded', reason: 'no_eligible_funding' };
}

export interface RefundableCreditLot {
  readonly lotId: string;
  readonly kind: FundingCreditLot['kind'];
  readonly remainingUnits: number;
}

export interface PackRefundResult {
  readonly lotId: string;
  readonly removedUnits: number;
  readonly remainingUnits: number;
}

/** Apply a refund only against the originating pack lot; unrelated credits are untouched. */
export function refundUnusedPackCredits(
  lot: RefundableCreditLot,
  requestedUnits: number,
): PackRefundResult {
  if (lot.kind !== 'pack') throw new TypeError('Only a purchased pack can be refunded.');
  if (!Number.isSafeInteger(lot.remainingUnits) || lot.remainingUnits < 0) {
    throw new TypeError('Remaining pack credits must be a nonnegative integer.');
  }
  if (!Number.isSafeInteger(requestedUnits) || requestedUnits < 0) {
    throw new TypeError('Refunded credits must be a nonnegative integer.');
  }

  const removedUnits = Math.min(lot.remainingUnits, requestedUnits);
  return Object.freeze({
    lotId: lot.lotId,
    removedUnits,
    remainingUnits: lot.remainingUnits - removedUnits,
  });
}

export function mayReadFeatureHistory(input: { readonly isAuthenticatedOwner: boolean }): boolean {
  return input.isAuthenticatedOwner;
}

export function mayDeleteOwnClip(input: {
  readonly isAuthenticatedOwner: boolean;
  readonly featureStatus: FeaturePricingRevision['status'];
  readonly baseMembershipActive: boolean;
}): boolean {
  // Feature state and paid-use membership do not gate the owner's privacy deletion right.
  return input.isAuthenticatedOwner;
}
