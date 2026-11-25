import { describe, expect, it } from "vitest";
import {
  authorizeApparelOrderConfirmation,
  normalizeApparelShippingAddress,
  printfulExternalIdFromOrderId,
  resolveApparelCheckoutReadiness,
  transitionApparelOrder,
  type ApparelCheckoutGate,
  type ApparelSaleListing,
  type ApparelSaleVariant,
} from "./apparel-core";

const now = new Date("2026-11-22T12:00:00.000Z");
const productId = "03f2bc0b-8c02-43ca-aebc-18a285fa24d2";
const redId = "13f2bc0b-8c02-43ca-aebc-18a285fa24d2";
const blueId = "23f2bc0b-8c02-43ca-aebc-18a285fa24d2";
const fingerprint = "a".repeat(64);
const gate: ApparelCheckoutGate = {
  salesEnabled: true,
  fulfillmentEnabled: true,
  autoOnlyMode: true,
  orderCredentialReady: true,
};
const listing: ApparelSaleListing = {
  productId,
  storeId: "19050731",
  catalogRevision: "17",
  approvalVersion: 3,
  classification: "apparel",
  enabled: true,
  priceCents: 3192,
};
const variant = (id: string, color: string): ApparelSaleVariant => ({
  id,
  productId,
  storeId: "19050731",
  catalogRevision: "17",
  syncVariantId: color === "Red" ? "5635838147" : "5635838148",
  color,
  size: "M",
  synced: true,
  ignored: false,
  availabilityStatus: "active",
  available: true,
  configurationComplete: true,
  configurationFingerprint: fingerprint,
  productionCostMinCents: 1192,
  productionCostMaxCents: 1192,
  productionCostCurrency: "USD",
  productionCostSource: "admin-reviewed-printful-ui",
  productionCostObservedAt: "2026-11-22T11:00:00.000Z",
  productionCostConfigurationFingerprint: fingerprint,
});
const address = {
  name: "Sample Buyer",
  address1: "1 Test Street",
  address2: "",
  city: "Albany",
  state: "ny",
  postalCode: "12207",
  country: "us",
};
const quote = (variantId = redId, overrides: Record<string, unknown> = {}) => ({
  status: "ready" as const,
  source: "printful-order-estimate" as const,
  observedAt: "2026-11-22T11:59:00.000Z",
  currency: "USD",
  totalCents: 2150,
  costFactsComplete: true,
  variantId,
  catalogRevision: "17",
  approvalVersion: 3,
  configurationFingerprint: fingerprint,
  address,
  expiresAt: "2026-11-22T12:15:00.000Z",
  ...overrides,
});
const ready = (overrides: Partial<Parameters<typeof resolveApparelCheckoutReadiness>[0]> = {}) =>
  resolveApparelCheckoutReadiness({
    gate,
    listing,
    variants: [variant(redId, "Red"), variant(blueId, "Blue")],
    selectedVariantId: redId,
    address,
    quote: quote(),
    now,
    ...overrides,
  });

describe("Printful apparel checkout eligibility", () => {
  it("resolves the exact opaque color/size variant, including same-size colors", () => {
    expect(ready()).toMatchObject({ ok: true, variantId: redId, syncVariantId: "5635838147", priceCents: 3192, shippingCents: 0, quantity: 1 });
    expect(ready({ selectedVariantId: blueId, quote: quote(blueId) })).toMatchObject({
      ok: true, variantId: blueId, syncVariantId: "5635838148",
    });
  });

  it("requires every launch gate, explicit apparel classification, and the exact store", () => {
    expect(ready({ gate: { ...gate, salesEnabled: false } })).toMatchObject({ ok: false, reason: "checkout_disabled" });
    expect(ready({ gate: { ...gate, fulfillmentEnabled: false } })).toMatchObject({ ok: false, reason: "fulfillment_disabled" });
    expect(ready({ gate: { ...gate, autoOnlyMode: false } })).toMatchObject({ ok: false, reason: "auto_only_not_enabled" });
    expect(ready({ gate: { ...gate, orderCredentialReady: false } })).toMatchObject({ ok: false, reason: "provider_unavailable" });
    expect(ready({ listing: { ...listing, classification: "accessories" } })).toMatchObject({ ok: false, reason: "not_approved_apparel" });
    expect(ready({ listing: { ...listing, storeId: "19050732" } })).toMatchObject({ ok: false, reason: "invalid_listing" });
  });

  it("rejects missing, duplicate, foreign-product, or stale-approval variant selections", () => {
    expect(ready({ selectedVariantId: "33f2bc0b-8c02-43ca-aebc-18a285fa24d2" })).toMatchObject({ ok: false, reason: "variant_not_found" });
    expect(ready({ variants: [variant(redId, "Red"), variant(redId, "Blue")] })).toMatchObject({ ok: false, reason: "variant_ambiguous" });
    expect(ready({ variants: [{ ...variant(redId, "Red"), productId: blueId }] })).toMatchObject({ ok: false, reason: "variant_not_found" });
    expect(ready({ quote: quote(redId, { approvalVersion: 2 }) })).toMatchObject({ ok: false, reason: "quote_configuration_changed" });
  });

  it("uses only the exact Printful sync variant ID and never falls back to a catalog garment ID", () => {
    expect(ready({ variants: [{ ...variant(redId, "Red"), syncVariantId: "" }] })).toMatchObject({ ok: false, reason: "cost_unverified" });
    expect(ready({ variants: [{ ...variant(redId, "Red"), syncVariantId: "9999999999999999999" }] })).toMatchObject({ ok: false, reason: "cost_unverified" });
  });

  it("rejects ranged, mismatched, incomplete, ignored, and inactive variants", () => {
    expect(ready({ variants: [{ ...variant(redId, "Red"), ignored: true }] })).toMatchObject({ ok: false, reason: "variant_not_available" });
    expect(ready({ variants: [{ ...variant(redId, "Red"), availabilityStatus: "temporarily_out_of_stock", available: false }] })).toMatchObject({ ok: false, reason: "variant_not_available" });
    expect(ready({ variants: [{ ...variant(redId, "Red"), configurationComplete: false }] })).toMatchObject({ ok: false, reason: "configuration_unverified" });
    expect(ready({ variants: [{ ...variant(redId, "Red"), productionCostMaxCents: 1250 }] })).toMatchObject({ ok: false, reason: "cost_unverified" });
    expect(ready({ variants: [{ ...variant(redId, "Red"), productionCostConfigurationFingerprint: "b".repeat(64) }] })).toMatchObject({ ok: false, reason: "cost_unverified" });
    expect(ready({ variants: [{ ...variant(redId, "Red"), productionCostObservedAt: "2026-11-21T11:00:00.000Z" }] })).toMatchObject({ ok: true });
  });

  it("lets a fresh exact order estimate refresh stale scalar UI approval evidence, but never a range or missing quote", () => {
    const staleObservation = { ...variant(redId, "Red"), productionCostObservedAt: "2026-11-21T11:00:00.000Z" };
    expect(ready({ variants: [staleObservation] })).toMatchObject({ ok: true });
    expect(ready({ variants: [{ ...staleObservation, productionCostMaxCents: 1250 }] })).toMatchObject({ ok: false, reason: "cost_unverified" });
    expect(ready({ variants: [{ ...staleObservation, productionCostSource: "unknown" }] })).toMatchObject({ ok: false, reason: "cost_unverified" });
    expect(ready({ quote: quote(redId, { observedAt: "2026-11-22T11:40:00.000Z" }) })).toMatchObject({ ok: false, reason: "quote_cost_invalid" });
    expect(ready({ quote: quote(redId, { source: "admin-reviewed-printful-ui" }) })).toMatchObject({ ok: false, reason: "quote_cost_invalid" });
    expect(ready({ quote: null })).toMatchObject({ ok: false, reason: "quote_required" });
  });

  it("binds quotes to the full US address, catalog revision, variant, approval, and expiry", () => {
    expect(normalizeApparelShippingAddress(address)).toBe(normalizeApparelShippingAddress({ ...address, state: "NY", country: "US" }));
    expect(normalizeApparelShippingAddress({ ...address, country: "CA" })).toBeNull();
    expect(ready({ address: { ...address, postalCode: "10001" } })).toMatchObject({ ok: false, reason: "quote_address_mismatch" });
    expect(ready({ quote: quote(redId, { expiresAt: "2026-11-22T11:59:00.000Z" }) })).toMatchObject({ ok: false, reason: "quote_expired" });
    expect(ready({ quote: quote(redId, { catalogRevision: "18" }) })).toMatchObject({ ok: false, reason: "quote_configuration_changed" });
    expect(ready({ quote: quote(redId, { totalCents: null }) })).toMatchObject({ ok: false, reason: "quote_cost_invalid" });
    expect(ready({ quote: quote(redId, { costFactsComplete: false }) })).toMatchObject({ ok: false, reason: "quote_cost_invalid" });
    expect(ready({ quote: quote(redId, { status: "pending" }) })).toMatchObject({ ok: false, reason: "quote_required" });
  });
});

describe("Printful apparel order authorization", () => {
  const confirmation = (overrides: Record<string, unknown> = {}) => authorizeApparelOrderConfirmation({
    state: "draft_created",
    providerOrderStatus: "draft",
    providerStoreId: "19050731",
    providerExternalId: "03f2bc0b8c0243caaebc18a285fa24d2",
    expectedExternalId: "03f2bc0b8c0243caaebc18a285fa24d2",
    providerSyncVariantId: "5635838147",
    expectedSyncVariantId: "5635838147",
    currentConfigurationFingerprint: fingerprint,
    expectedConfigurationFingerprint: fingerprint,
    currency: "USD",
    finalVendorCostCents: 2150,
    vendorQuoteCapCents: 2150,
    finalQuoteCostCents: 2150,
    finalQuoteCostFactsComplete: true,
    finalQuoteCurrency: "USD",
    finalQuoteMatchesRecipient: true,
    finalQuoteMatchesVariant: true,
    finalQuoteMatchesConfiguration: true,
    stripeNetRevenueCents: 3192,
    hasRefundRequest: false,
    stripeLivemode: true,
    ...overrides,
  });

  it("confirms only the matching live USD draft within both the exact quote cap and settled net", () => {
    expect(confirmation()).toEqual({ allowed: true });
    expect(confirmation({ finalVendorCostCents: 2151 })).toMatchObject({ allowed: false, reason: "vendor_quote_exceeded" });
    expect(confirmation({ stripeNetRevenueCents: 2149 })).toMatchObject({ allowed: false, reason: "stripe_net_exceeded" });
    expect(confirmation({ stripeNetRevenueCents: null })).toMatchObject({ allowed: false, reason: "cost_facts_missing" });
    expect(confirmation({ currency: "CAD" })).toMatchObject({ allowed: false, reason: "wrong_currency" });
    expect(confirmation({ stripeLivemode: false })).toMatchObject({ allowed: false, reason: "test_mode_never_confirms" });
    expect(confirmation({ providerStoreId: "19050732" })).toMatchObject({ allowed: false, reason: "wrong_provider_store" });
    expect(confirmation({ providerSyncVariantId: "5635838148" })).toMatchObject({ allowed: false, reason: "variant_mismatch" });
    expect(confirmation({ currentConfigurationFingerprint: "b".repeat(64) })).toMatchObject({ allowed: false, reason: "design_mismatch" });
    expect(confirmation({ finalQuoteMatchesRecipient: false })).toMatchObject({ allowed: false, reason: "final_quote_mismatch" });
    expect(confirmation({ finalQuoteCostFactsComplete: false })).toMatchObject({ allowed: false, reason: "cost_facts_missing" });
    expect(confirmation({ finalQuoteCostCents: 2151 })).toMatchObject({ allowed: false, reason: "vendor_quote_exceeded" });
    expect(confirmation({ finalVendorCostCents: 2200, finalQuoteCostCents: 2200 })).toMatchObject({ allowed: false, reason: "vendor_quote_exceeded" });
    expect(confirmation({ hasRefundRequest: true })).toMatchObject({ allowed: false, reason: "invalid_order_state" });
  });

  it("does not authorize refunds until provider absence or cancellation is definitive", () => {
    expect(transitionApparelOrder("create_unknown", "refund_requested")).toBeNull();
    expect(transitionApparelOrder("confirm_unknown", "refund_requested")).toBeNull();
    expect(transitionApparelOrder("confirmed", "refund_requested")).toBeNull();
    expect(transitionApparelOrder("fulfilled", "refund_requested")).toBeNull();
    expect(transitionApparelOrder("create_unknown", "provider_no_order_reconciled")).toBe("definitive_unfulfilled");
    expect(transitionApparelOrder("definitive_unfulfilled", "refund_requested")).toBe("refund_pending");
    expect(transitionApparelOrder("refund_pending", "refund_succeeded")).toBe("refunded");
  });

  it("reuses one stable 32-character provider external ID for retries", () => {
    const id = "03f2bc0b-8c02-43ca-aebc-18a285fa24d2";
    expect(printfulExternalIdFromOrderId(id)).toBe("03f2bc0b8c0243caaebc18a285fa24d2");
    expect(printfulExternalIdFromOrderId("not-a-uuid")).toBeNull();
  });
});
