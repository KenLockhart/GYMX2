import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { parsePrintfulApparelClaimRow } from "./apparel-fulfillment-runtime";

const claimRow = {
  order_id: "123e4567-e89b-42d3-a456-426614174000",
  lease_generation: 3,
  status: "paid_waiting_address_quote",
  provider_external_id: "123e4567e89b42d3a456426614174000",
  provider_order_id: null,
  sync_variant_id: "5635838147",
  external_product_id: "492658670",
  provider_external_variant_id: "6af522103b23d5",
  catalog_variant_id: "12345",
  variant_id: "123e4567-e89b-42d3-a456-426614174001",
  configuration_fingerprint: "a".repeat(64),
  design_identity_fingerprint: "b".repeat(64),
  item_title: "Synthetic shirt",
  variant_label: "Blue / M",
  quantity: 1,
  guest_email: "buyer@example.test",
  address: { name: "Synthetic Buyer", address1: "1 Test Way", city: "Albany", stateCode: "NY", countryCode: "US", zip: "12207" },
  customer_price_cents: 5000,
  stripe_net_revenue_cents: null,
  quote_total_cents: 2000,
  final_quote_total_cents: null,
  stripe_payment_intent_id: "pi_synthetic12345678",
  stripe_session_id: "cs_synthetic12345678",
  stripe_event_id: "evt_synthetic12345678",
  stripe_paid_cents: 5000,
  stripe_livemode: true,
  final_stripe_address: null,
  final_stripe_address_verified: false,
  quote_expires_at: "2026-11-22T12:45:00.000Z",
  approval_version: 2,
  catalog_revision: 4,
};

describe("Printful fulfillment claim row contract", () => {
  it("parses SQL claim outputs including approval/catalog revisions and verified-address presence", () => {
    expect(parsePrintfulApparelClaimRow(claimRow, "worker-synthetic")).toMatchObject({
      approvalVersion: 2,
      catalogRevision: "4",
      stripeEventId: "evt_synthetic12345678",
      finalStripeAddressVerified: false,
      status: "paid_waiting_address_quote",
    });
  });

  it("rejects claim rows missing their SQL revision or address-presence fields", () => {
    expect(parsePrintfulApparelClaimRow({ ...claimRow, approval_version: undefined }, "worker-synthetic")).toBeNull();
    expect(parsePrintfulApparelClaimRow({ ...claimRow, final_stripe_address_verified: undefined }, "worker-synthetic")).toBeNull();
  });

  const actualSqlClaimJson = process.env.PRINTFUL_APPAREL_CLAIM_ROW_JSON;
  if (actualSqlClaimJson) {
    it("parses the exact row emitted by the local SQL claim RPC", () => {
      const actualRow: unknown = JSON.parse(actualSqlClaimJson);
      expect(parsePrintfulApparelClaimRow(actualRow, "worker-synthetic")).toMatchObject({
        approvalVersion: 1,
        catalogRevision: "1",
        stripeEventId: "evt_syntheticredorder123",
        finalStripeAddressVerified: true,
        status: "queued",
      });
    });
  }
});
