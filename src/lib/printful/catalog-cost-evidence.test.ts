import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { bindPrintfulUiCostEvidence, isReviewablePrintfulCostProduct } from "./catalog-cost-evidence";
import type { CompletePrintfulStoreRead } from "./catalog-provider";

const observedAt = "2026-11-22T19:30:00.000Z";
const beforeStartedAt = "2026-11-22T18:59:00.000Z";
const beforeAt = "2026-11-22T19:00:00.000Z";
const afterAt = "2026-11-22T19:45:00.000Z";
const afterCompletedAt = "2026-11-22T19:46:00.000Z";

function snapshot(readStartedAt: string, readCompletedAt: string, changed = false, incomplete = false): CompletePrintfulStoreRead {
  const products: CompletePrintfulStoreRead["products"] = [{
    syncProductId: "492658670" as never,
    name: "Synthetic tee",
    ignored: false,
    syncedVariantCount: 2,
    variants: [
      {
        syncVariantId: "5635837988" as never,
        externalId: "external-blue",
        catalogVariantId: "401" as never,
        name: "Blue / M",
        color: "Blue",
        size: "M",
        synced: true,
        ignored: false,
        availabilityStatus: "active",
        configurationFingerprint: changed ? "b".repeat(64) : "a".repeat(64),
        configurationComplete: !incomplete,
        placementTypes: ["front"],
        optionNames: ["technique"],
      },
      {
        syncVariantId: "5635837989" as never,
        externalId: "external-red",
        catalogVariantId: "402" as never,
        name: "Red / M",
        color: "Red",
        size: "M",
        synced: true,
        ignored: false,
        availabilityStatus: "active",
        configurationFingerprint: "c".repeat(64),
        configurationComplete: !incomplete,
        placementTypes: ["front"],
        optionNames: ["technique"],
      },
    ],
  }];
  return {
    storeId: "19050731",
    storeName: "GYMX2",
    storeType: "native",
    completeness: "consistent_paginated_read",
    atomicProviderSnapshotProven: false,
    listTotal: 1,
    pageCount: 1,
    readStartedAt,
    readCompletedAt,
    observedAt: readCompletedAt,
    products,
  };
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    source: "official_printful_ui_edit_retail_prices",
    storeId: "19050731",
    currency: "USD",
    currencyContext: "USD",
    observedAt,
    readOnly: true,
    priceChangesSaved: false,
    products: [{
      syncProductId: "492658670",
      selectedSyncVariantIds: ["5635837989", "5635837988"],
      priceRows: [
        { externalId: "external-red", printfulPrice: "$13.92" },
        { externalId: "external-blue", printfulPrice: "$11.92 - $12.25" },
      ],
    }],
    ...overrides,
  };
}

function bind(value: unknown, before = snapshot(beforeStartedAt, beforeAt), after = snapshot(afterAt, afterCompletedAt), now = new Date("2026-11-22T19:50:00.000Z")) {
  const rawEvidenceText = JSON.stringify(value);
  return bindPrintfulUiCostEvidence({ rawEvidenceText, adminAttestedOfficialUi: true, before, after, now });
}

describe("admin-reviewed Printful UI cost evidence", () => {
  it("uses one reviewable product selector for both displayed and submitted rows", () => {
    const variant = {
      configurationComplete: true,
      externalId: "external-one",
      catalogVariantId: "401",
      localVariantId: "00000000-0000-4000-8000-000000000001",
    };
    expect(isReviewablePrintfulCostProduct({ ignored: false, variants: [variant] })).toBe(true);
    expect(isReviewablePrintfulCostProduct({ ignored: true, variants: [variant] })).toBe(false);
    expect(isReviewablePrintfulCostProduct({ ignored: false, variants: [{ ...variant, configurationComplete: false }] })).toBe(false);
    expect(isReviewablePrintfulCostProduct({ ignored: false, variants: [{ ...variant, localVariantId: undefined }] })).toBe(false);
  });

  it("binds exact costs by unique external ID and preserves ranges without relying on row order", () => {
    const result = bind(evidence());
    expect(result.status).toBe("bound");
    if (result.status !== "bound") return;
    expect(result.costs.map((cost) => [cost.syncVariantId, cost.productionCostMinCents, cost.productionCostMaxCents])).toEqual([
      ["5635837989", 1392, 1392],
      ["5635837988", 1192, 1225],
    ]);
    expect(result.costs[0].source).toBe("admin-reviewed-printful-ui");
    expect(result.costs[0].evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects non-USD evidence and malformed decimal cells", () => {
    expect(bind(evidence({ currency: "CAD" })).status).toBe("wrong_currency");
    const badPrice = evidence({
      products: [{
        syncProductId: "492658670",
        selectedSyncVariantIds: ["5635837988", "5635837989"],
        priceRows: [
          { externalId: "external-blue", printfulPrice: "$11.92 USD" },
          { externalId: "external-red", printfulPrice: "$13.92" },
        ],
      }],
    });
    expect(bind(badPrice).status).toBe("invalid_evidence");
  });

  it("rejects duplicate, missing, or foreign external-ID mapping", () => {
    const duplicate = evidence({
      products: [{
        syncProductId: "492658670",
        selectedSyncVariantIds: ["5635837988", "5635837989"],
        priceRows: [
          { externalId: "external-blue", printfulPrice: "$11.92" },
          { externalId: "external-blue", printfulPrice: "$13.92" },
        ],
      }],
    });
    expect(bind(duplicate).status).toBe("invalid_evidence");
    const foreign = evidence({
      products: [{
        syncProductId: "492658670",
        selectedSyncVariantIds: ["5635837988", "5635837989"],
        priceRows: [
          { externalId: "wrong", printfulPrice: "$11.92" },
          { externalId: "external-red", printfulPrice: "$13.92" },
        ],
      }],
    });
    expect(bind(foreign).status).toBe("ambiguous_external_id");
  });

  it("requires an unchanged exact variant and configuration set across the review", () => {
    expect(bind(evidence(), snapshot(beforeStartedAt, beforeAt), snapshot(afterAt, afterCompletedAt, true)).status).toBe("configuration_changed");
    const current = snapshot(afterAt, afterCompletedAt);
    const missing: CompletePrintfulStoreRead = {
      ...current,
      products: [{ ...current.products[0], variants: current.products[0].variants.slice(0, 1) }],
    };
    expect(bind(evidence(), snapshot(beforeStartedAt, beforeAt), missing).status).toBe("variant_set_mismatch");
  });

  it("expires after 24 hours and a later unchanged API read does not renew the UI observation", () => {
    const laterAfter = snapshot("2026-11-24T20:00:00.000Z", "2026-11-24T20:01:00.000Z");
    expect(bind(evidence(), snapshot(beforeStartedAt, beforeAt), laterAfter, new Date("2026-11-24T20:01:01.000Z")).status).toBe("stale_evidence");
  });

  it("rejects an observation outside the before and after read interval", () => {
    const tooEarly = evidence({ observedAt: "2026-11-22T18:59:00.000Z" });
    expect(bind(tooEarly).status).toBe("stale_evidence");
  });

  it("requires an explicit authenticated-admin UI attestation and complete configured variants", () => {
    const rawEvidenceText = JSON.stringify(evidence());
    expect(bindPrintfulUiCostEvidence({
      rawEvidenceText,
      adminAttestedOfficialUi: false,
      before: snapshot(beforeStartedAt, beforeAt),
      after: snapshot(afterAt, afterCompletedAt),
      now: new Date("2026-11-22T19:50:00.000Z"),
    }).status).toBe("invalid_evidence");
    expect(bind(evidence(), snapshot(beforeStartedAt, beforeAt, false, true)).status).toBe("incomplete_evidence");
  });

  it("parses and hashes the same exact evidence bytes, ignoring a mismatched structured object", () => {
    const original = evidence();
    const rawEvidenceText = JSON.stringify(original);
    const mismatched = evidence({
      products: [{
        syncProductId: "492658670",
        selectedSyncVariantIds: ["5635837988", "5635837989"],
        priceRows: [
          { externalId: "external-red", printfulPrice: "$99.99" },
          { externalId: "external-blue", printfulPrice: "$99.99" },
        ],
      }],
    });
    const extraInput = {
      evidence: mismatched,
      rawEvidenceText,
      adminAttestedOfficialUi: true,
      before: snapshot(beforeStartedAt, beforeAt),
      after: snapshot(afterAt, afterCompletedAt),
      now: new Date("2026-11-22T19:50:00.000Z"),
    };
    const result = bindPrintfulUiCostEvidence(extraInput);
    expect(result.status).toBe("bound");
    if (result.status === "bound") {
      expect(result.costs.map((cost) => cost.productionCostMinCents)).toEqual([1392, 1192]);
      expect(result.evidenceSha256).toBe((bind(original) as { evidenceSha256: string }).evidenceSha256);
    }
  });
});
