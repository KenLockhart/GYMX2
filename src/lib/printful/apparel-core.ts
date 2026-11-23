export type ApparelCurrency = "USD";

export type ApparelSaleListing = Readonly<{
  productId: string;
  storeId: string;
  catalogRevision: string;
  approvalVersion: number;
  classification: string;
  enabled: boolean;
  priceCents: number;
}>;

export type ApparelSaleVariant = Readonly<{
  id: string;
  productId: string;
  storeId: string;
  catalogRevision: string;
  syncVariantId: string;
  color: string | null;
  size: string | null;
  synced: boolean;
  ignored: boolean | null;
  availabilityStatus: string | null;
  available: boolean;
  configurationComplete: boolean;
  configurationFingerprint: string;
  productionCostMinCents: number | null;
  productionCostMaxCents: number | null;
  productionCostCurrency: string | null;
  productionCostSource: string | null;
  productionCostObservedAt: string | null;
  productionCostConfigurationFingerprint: string | null;
}>;

export type ApparelCheckoutGate = Readonly<{
  salesEnabled: boolean;
  fulfillmentEnabled: boolean;
  autoOnlyMode: boolean;
  orderCredentialReady: boolean;
}>;

export type ApparelCheckoutFailure =
  | "checkout_disabled"
  | "fulfillment_disabled"
  | "auto_only_not_enabled"
  | "provider_unavailable"
  | "not_approved_apparel"
  | "invalid_listing"
  | "variant_not_found"
  | "variant_ambiguous"
  | "variant_not_available"
  | "configuration_unverified"
  | "cost_unverified"
  | "cost_expired"
  | "invalid_shipping_address"
  | "quote_required"
  | "quote_address_mismatch"
  | "quote_expired"
  | "quote_configuration_changed"
  | "quote_cost_invalid";

export type ApparelCheckoutReadiness =
  | {
      ok: true;
      productId: string;
      variantId: string;
      syncVariantId: string;
      configurationFingerprint: string;
      priceCents: number;
      shippingCents: 0;
      quantity: 1;
    }
  | { ok: false; reason: ApparelCheckoutFailure };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CATALOG_ID = "9223372036854775807";
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;
function validMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000;
}

function validCatalogId(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) return false;
  return value.length < MAX_CATALOG_ID.length ||
    (value.length === MAX_CATALOG_ID.length && value <= MAX_CATALOG_ID);
}

function validDate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeApparelShippingAddress(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const address = value as Record<string, unknown>;
  const text = (key: string, maximum: number) => {
    const candidate = address[key];
    if (typeof candidate !== "string") return null;
    const normalized = candidate.trim().replace(/\s+/g, " ");
    return normalized && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/.test(normalized)
      ? normalized
      : null;
  };
  const country = text("country", 2)?.toUpperCase();
  const state = text("state", 64)?.toUpperCase();
  const postalCode = text("postalCode", 20)?.toUpperCase();
  const normalized = {
    name: text("name", 200),
    address1: text("address1", 200),
    address2: text("address2", 200) ?? "",
    city: text("city", 100),
    state,
    postalCode,
    country,
  };
  if (
    country !== "US" || !normalized.name || !normalized.address1 || !normalized.city ||
    !state || !postalCode || !/^[A-Z]{2}$/.test(state) || !/^[A-Z0-9 -]{3,20}$/.test(postalCode)
  ) return null;
  return JSON.stringify(normalized);
}

export function resolveApparelCheckoutReadiness(input: Readonly<{
  gate: ApparelCheckoutGate;
  listing: ApparelSaleListing;
  variants: readonly ApparelSaleVariant[];
  selectedVariantId: string;
  address: unknown;
  quote: Readonly<{
    status: "ready" | "pending" | "failed";
    source: "printful-order-estimate";
    observedAt: string;
    currency: string;
    totalCents: number | null;
    costFactsComplete: boolean;
    variantId: string;
    catalogRevision: string;
    approvalVersion: number;
    configurationFingerprint: string;
    address: unknown;
    expiresAt: string | null;
  }> | null;
  now?: Date;
}>): ApparelCheckoutReadiness {
  if (!input.gate.salesEnabled) return { ok: false, reason: "checkout_disabled" };
  if (!input.gate.fulfillmentEnabled) return { ok: false, reason: "fulfillment_disabled" };
  if (!input.gate.autoOnlyMode) return { ok: false, reason: "auto_only_not_enabled" };
  if (!input.gate.orderCredentialReady) return { ok: false, reason: "provider_unavailable" };
  if (input.listing.classification !== "apparel" || !input.listing.enabled) {
    return { ok: false, reason: "not_approved_apparel" };
  }
  if (!UUID_PATTERN.test(input.listing.productId) || input.listing.storeId !== "19050731" ||
    !/^(0|[1-9][0-9]{0,14})$/.test(input.listing.catalogRevision) ||
    !Number.isSafeInteger(input.listing.approvalVersion) ||
    input.listing.approvalVersion < 1 || !Number.isSafeInteger(input.listing.priceCents) ||
    input.listing.priceCents < 100 || input.listing.priceCents > 10_000_000) {
    return { ok: false, reason: "invalid_listing" };
  }

  const selected = input.variants.filter((variant) => variant.id === input.selectedVariantId);
  if (selected.length === 0) return { ok: false, reason: "variant_not_found" };
  if (selected.length !== 1) return { ok: false, reason: "variant_ambiguous" };
  const variant = selected[0];
  if (variant.productId !== input.listing.productId || variant.storeId !== input.listing.storeId ||
    variant.catalogRevision !== input.listing.catalogRevision) return { ok: false, reason: "variant_not_found" };
  if (!variant.synced || variant.ignored !== false || !variant.available || variant.availabilityStatus !== "active") {
    return { ok: false, reason: "variant_not_available" };
  }
  if (!variant.configurationComplete || !FINGERPRINT_PATTERN.test(variant.configurationFingerprint)) {
    return { ok: false, reason: "configuration_unverified" };
  }
  if (
    !validCatalogId(variant.syncVariantId) ||
    !validMoney(variant.productionCostMinCents) ||
    !validMoney(variant.productionCostMaxCents) ||
    variant.productionCostCurrency !== "USD" ||
    variant.productionCostSource !== "admin-reviewed-printful-ui" ||
    variant.productionCostConfigurationFingerprint !== variant.configurationFingerprint
  ) return { ok: false, reason: "cost_unverified" };
  if (variant.productionCostMinCents !== variant.productionCostMaxCents) {
    return { ok: false, reason: "cost_unverified" };
  }
  const now = input.now?.getTime() ?? Date.now();
  const normalizedAddress = normalizeApparelShippingAddress(input.address);
  if (!normalizedAddress) return { ok: false, reason: "invalid_shipping_address" };
  if (!input.quote || input.quote.status !== "ready") return { ok: false, reason: "quote_required" };
  const quoteObservedAt = validDate(input.quote.observedAt);
  if (input.quote.source !== "printful-order-estimate" || input.quote.currency !== "USD" ||
    !validMoney(input.quote.totalCents) || !input.quote.costFactsComplete || quoteObservedAt === null ||
    quoteObservedAt > now || now - quoteObservedAt > 10 * 60 * 1000) {
    return { ok: false, reason: "quote_cost_invalid" };
  }
  if (input.quote.variantId !== variant.id || input.quote.configurationFingerprint !== variant.configurationFingerprint ||
    input.quote.catalogRevision !== input.listing.catalogRevision ||
    input.quote.approvalVersion !== input.listing.approvalVersion) {
    return { ok: false, reason: "quote_configuration_changed" };
  }
  if (normalizeApparelShippingAddress(input.quote.address) !== normalizedAddress) {
    return { ok: false, reason: "quote_address_mismatch" };
  }
  const quoteExpiresAt = validDate(input.quote.expiresAt);
  if (quoteExpiresAt === null || quoteExpiresAt <= now) return { ok: false, reason: "quote_expired" };

  return {
    ok: true,
    productId: input.listing.productId,
    variantId: variant.id,
    syncVariantId: variant.syncVariantId,
    configurationFingerprint: variant.configurationFingerprint.toLowerCase(),
    priceCents: input.listing.priceCents,
    shippingCents: 0,
    quantity: 1,
  };
}

export type ApparelOrderState =
  | "paid_queued"
  | "leased"
  | "create_unknown"
  | "draft_created"
  | "quote_pending"
  | "confirm_unknown"
  | "confirmed"
  | "fulfilled"
  | "definitive_unfulfilled"
  | "refund_pending"
  | "refunded"
  | "test_mode_blocked";

export type ApparelOrderEvent =
  | "lease"
  | "provider_create_unknown"
  | "provider_draft_created"
  | "provider_quote_pending"
  | "provider_confirm_unknown"
  | "provider_confirmed"
  | "provider_fulfilled"
  | "provider_no_order_reconciled"
  | "provider_order_cancelled"
  | "provider_failed_before_create"
  | "refund_requested"
  | "refund_succeeded"
  | "stripe_test_event";

const ORDER_TRANSITIONS: Readonly<Record<ApparelOrderState, readonly ApparelOrderEvent[]>> = {
  paid_queued: ["lease", "stripe_test_event"],
  leased: ["provider_create_unknown", "provider_draft_created", "provider_failed_before_create"],
  create_unknown: ["provider_draft_created", "provider_no_order_reconciled"],
  draft_created: ["provider_quote_pending", "provider_confirm_unknown", "provider_confirmed", "provider_order_cancelled"],
  quote_pending: ["provider_draft_created", "provider_order_cancelled"],
  confirm_unknown: ["provider_confirmed", "provider_fulfilled", "provider_order_cancelled"],
  confirmed: ["provider_fulfilled"],
  fulfilled: [],
  definitive_unfulfilled: ["refund_requested"],
  refund_pending: ["refund_succeeded"],
  refunded: [],
  test_mode_blocked: [],
};

export function transitionApparelOrder(state: ApparelOrderState, event: ApparelOrderEvent): ApparelOrderState | null {
  if (!ORDER_TRANSITIONS[state].includes(event)) return null;
  const transitions: Record<ApparelOrderEvent, ApparelOrderState> = {
    lease: "leased",
    provider_create_unknown: "create_unknown",
    provider_draft_created: "draft_created",
    provider_quote_pending: "quote_pending",
    provider_confirm_unknown: "confirm_unknown",
    provider_confirmed: "confirmed",
    provider_fulfilled: "fulfilled",
    provider_no_order_reconciled: "definitive_unfulfilled",
    provider_order_cancelled: "definitive_unfulfilled",
    provider_failed_before_create: "definitive_unfulfilled",
    refund_requested: "refund_pending",
    refund_succeeded: "refunded",
    stripe_test_event: "test_mode_blocked",
  };
  return transitions[event];
}

export function authorizeApparelOrderConfirmation(input: Readonly<{
  state: ApparelOrderState;
  providerOrderStatus: string;
  providerStoreId: string;
  providerExternalId: string;
  expectedExternalId: string;
  providerSyncVariantId: string;
  expectedSyncVariantId: string;
  currentConfigurationFingerprint: string;
  expectedConfigurationFingerprint: string;
  currency: string;
  finalVendorCostCents: number | null;
  vendorQuoteCapCents: number | null;
  finalQuoteCostCents: number | null;
  finalQuoteCostFactsComplete: boolean;
  finalQuoteCurrency: string;
  finalQuoteMatchesRecipient: boolean;
  finalQuoteMatchesVariant: boolean;
  finalQuoteMatchesConfiguration: boolean;
  stripeNetRevenueCents: number | null;
  hasRefundRequest: boolean;
  stripeLivemode: boolean;
}>): { allowed: true } | { allowed: false; reason: string } {
  if (!input.stripeLivemode) return { allowed: false, reason: "test_mode_never_confirms" };
  if (input.state !== "draft_created" || input.hasRefundRequest) return { allowed: false, reason: "invalid_order_state" };
  if (input.providerStoreId !== "19050731") return { allowed: false, reason: "wrong_provider_store" };
  if (input.providerExternalId !== input.expectedExternalId) return { allowed: false, reason: "external_id_mismatch" };
  if (input.providerOrderStatus !== "draft") return { allowed: false, reason: "order_not_draft" };
  if (input.providerSyncVariantId !== input.expectedSyncVariantId) return { allowed: false, reason: "variant_mismatch" };
  if (!validCatalogId(input.providerSyncVariantId)) return { allowed: false, reason: "invalid_native_variant_id" };
  if (input.currentConfigurationFingerprint !== input.expectedConfigurationFingerprint) {
    return { allowed: false, reason: "design_mismatch" };
  }
  if (input.currency !== "USD") return { allowed: false, reason: "wrong_currency" };
  if (input.finalQuoteCurrency !== "USD") return { allowed: false, reason: "wrong_currency" };
  if (!input.finalQuoteMatchesRecipient || !input.finalQuoteMatchesVariant || !input.finalQuoteMatchesConfiguration) {
    return { allowed: false, reason: "final_quote_mismatch" };
  }
  if (!validMoney(input.finalVendorCostCents) || !validMoney(input.vendorQuoteCapCents) ||
    !validMoney(input.stripeNetRevenueCents) || !input.finalQuoteCostFactsComplete ||
    !validMoney(input.finalQuoteCostCents)) return { allowed: false, reason: "cost_facts_missing" };
  if (input.finalQuoteCostCents > input.vendorQuoteCapCents || input.finalVendorCostCents > input.vendorQuoteCapCents) {
    return { allowed: false, reason: "vendor_quote_exceeded" };
  }
  if (input.finalVendorCostCents > input.finalQuoteCostCents) return { allowed: false, reason: "final_estimate_exceeded" };
  if (input.finalVendorCostCents > input.stripeNetRevenueCents) return { allowed: false, reason: "stripe_net_exceeded" };
  return { allowed: true };
}

export function printfulExternalIdFromOrderId(orderId: string): string | null {
  if (!UUID_PATTERN.test(orderId)) return null;
  return orderId.replaceAll("-", "").toLowerCase();
}
