import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messages } from "@/i18n/messages";
import type { PricingAdminDashboard } from "@/lib/form-coach/pricing-admin-server";

vi.mock("@/app/(app)/admin/monetization/feature-pricing/actions", () => ({
  grantFeatureComp: vi.fn(),
  revokeFeatureComp: vi.fn(),
  searchFeatureCompRecipients: vi.fn(),
  saveFeaturePricingRevision: vi.fn(),
  syncFeaturePricingRequest: vi.fn(),
}));

import { AdminFeaturePricing, centsToUsdInput, discardAdminPricingRetry, generatedPriceKey, isoToUtcLocalInput, pricingOperationStorageKey, readAdminPendingOperations, usdInputToCents, utcLocalInputToIso } from "./admin-feature-pricing";

const dashboard: PricingAdminDashboard = {
  current: {
    revision: 2,
    status: "pricing_pending",
    payer: "coach",
    billingModel: null,
    currency: "USD",
    displayName: "Form Coach",
    description: "Private movement feedback.",
    marketingCopy: "Practice with coach review.",
    trialDays: 0,
    trialAssessments: 0,
    createdAt: "2026-11-19T12:00:00Z",
    priceOptions: [],
  },
  revisions: [],
  changes: [],
  syncRequests: [],
  comps: [],
  legacyContractCount: 1,
  moveStateCounts: { reserved: 1 },
  readErrors: [],
};

describe("admin Form Coach pricing form", () => {
  it("renders authorized pricing controls, non-live and subscriber-move boundaries, and accessible comp fields", () => {
    const markup = renderToStaticMarkup(createElement(AdminFeaturePricing, {
      dashboard,
      adminId: "admin-1",
      initialRequestId: "2e03ea57-5212-4f2e-8a48-e421d2c959c3",
      initialCompRequestId: "3e03ea57-5212-4f2e-8a48-e421d2c959c3",
    }));
    expect(markup).toContain("Save pricing revision");
    expect(markup).toContain("Pricing pending blocks paid bundles");
    expect(markup).toContain("Moving an existing subscriber requires a separate confirmed migration flow");
    expect(markup).toContain("Search accounts by name or email");
    expect(markup).not.toContain("Account ID (UUID)");
    expect(markup).toContain("Reason");
    expect(markup).not.toContain("stripe_price_id");
    expect(markup).not.toContain("customer_secret");
    expect(markup).not.toContain("Price key");
  });

  it("makes live candidates explicitly pending verification rather than showing activation", () => {
    const liveDashboard: PricingAdminDashboard = {
      ...dashboard,
      current: {
        ...dashboard.current!,
        status: "live",
        billingModel: "per_assessment",
        priceOptions: [{ priceKey: "pack_3", amountCents: 1200, currency: "USD", interval: null, creditsPerPack: 3 }],
      },
    };
    const markup = renderToStaticMarkup(createElement(AdminFeaturePricing, {
      dashboard: liveDashboard,
      adminId: "admin-1",
      initialRequestId: "2e03ea57-5212-4f2e-8a48-e421d2c959c3",
      initialCompRequestId: "3e03ea57-5212-4f2e-8a48-e421d2c959c3",
    }));
    expect(markup).toContain("only reserved");
    expect(markup).not.toContain("Price key");
    expect(markup).toContain("Amount (USD)");
    expect(markup).toContain('value="12.00"');
    expect(markup).toContain("Credits per pack");
  });

  it("offers resume only for an unpublished saved sync request without exposing provider IDs", () => {
    const liveDashboard: PricingAdminDashboard = {
      ...dashboard,
      syncRequests: [{
        requestId: "2e03ea57-5212-4f2e-8a48-e421d2c959c3",
        expectedRevision: 3,
        publishedRevision: null,
        state: "unknown",
        updatedAt: "2026-11-19T12:00:00Z",
        objects: [{ kind: "product", priceKey: null, state: "unknown" }],
      }],
    };
    const markup = renderToStaticMarkup(createElement(AdminFeaturePricing, {
      dashboard: liveDashboard,
      adminId: "admin-1",
      initialRequestId: "2e03ea57-5212-4f2e-8a48-e421d2c959c3",
      initialCompRequestId: "3e03ea57-5212-4f2e-8a48-e421d2c959c3",
    }));
    expect(markup).toContain("Resume sync and publish");
    expect(markup).toContain('name="request_id" value="2e03ea57-5212-4f2e-8a48-e421d2c959c3"');
    expect(markup).toContain('name="expected_revision" value="3"');
    expect(markup).not.toContain("stripe_price_id");
    expect(markup).not.toContain("prod_");
  });

  it("shows unsupported existing currency as read only without treating its minor units as USD", () => {
    const euroRevision: PricingAdminDashboard["current"] = {
      ...dashboard.current!,
      currency: "EUR",
      status: "live",
      billingModel: "per_assessment",
      priceOptions: [{ priceKey: "pack_3", amountCents: 100, currency: "EUR", interval: null, creditsPerPack: 3 }],
    };
    const markup = renderToStaticMarkup(createElement(AdminFeaturePricing, {
      dashboard: { ...dashboard, current: euroRevision, revisions: [euroRevision!] },
      adminId: "admin-1",
      initialRequestId: "2e03ea57-5212-4f2e-8a48-e421d2c959c3",
      initialCompRequestId: "3e03ea57-5212-4f2e-8a48-e421d2c959c3",
    }));
    expect(markup).toContain("This configuration uses a currency this editor cannot change");
    expect(markup).toContain("€1.00");
    expect(markup).not.toContain("Save pricing revision");
  });

  it("disables edits when a safe admin read is incomplete", () => {
    const markup = renderToStaticMarkup(createElement(AdminFeaturePricing, {
      dashboard: { ...dashboard, readErrors: ["pricing revisions"] },
      adminId: "admin-1",
      initialRequestId: "2e03ea57-5212-4f2e-8a48-e421d2c959c3",
      initialCompRequestId: "3e03ea57-5212-4f2e-8a48-e421d2c959c3",
    }));
    expect(markup).toContain("Some history could not be loaded");
    expect(markup).toContain("Changes are disabled");
    expect(markup).toContain('disabled=""');
  });

  it("formats dollars from cents and creates hidden stable keys for new option types", () => {
    expect(centsToUsdInput(100)).toBe("1.00");
    expect(centsToUsdInput(100, ",")).toBe("1,00");
    expect(usdInputToCents("1.00")).toBe(100);
    expect(usdInputToCents("1,25")).toBe(125);
    expect(usdInputToCents("21474836.48")).toBeNull();
    expect(generatedPriceKey("subscription", [])).toBe("subscription");
    expect(generatedPriceKey("per_assessment", [])).toBe("pack_3");
    expect(generatedPriceKey("per_assessment", [
      { price_key: "pack_3", amount_cents: 300, currency: "USD", interval: null, credits_per_pack: 3 },
    ])).toBe("pack_3_2");
    expect(messages.en.featurePricing.optionSummary(100, "USD", null, null)).toBe("$1.00");
  });

  it("keeps exact retries on ordinary refresh and discards only this admin's stale pricing draft", () => {
    const adminAPricingKey = pricingOperationStorageKey("admin-a", "pricing");
    const adminACompKey = pricingOperationStorageKey("admin-a", "comp");
    const adminBPricingKey = pricingOperationStorageKey("admin-b", "pricing");
    const staleOperation = JSON.stringify({
      requestId: "2e03ea57-5212-4f2e-8a48-e421d2c959c3",
      expectedRevision: 2,
      candidate: {
        status: "pricing_pending",
        payer: "coach",
        currency: "USD",
        display_name: "Form Coach",
        description: "",
        marketing_copy: "",
        trial_days: 0,
        trial_assessments: 0,
        billing_model: null,
        price_options: [],
      },
    });
    const storage = new Map([
      [adminAPricingKey, staleOperation],
      [adminACompKey, "admin-a comp draft"],
      [adminBPricingKey, "admin-b pricing draft"],
    ]);
    const read = (key: string) => storage.get(key) ?? null;
    // A normal refresh only restores the same request; it doesn't discard it.
    expect(readAdminPendingOperations("admin-a", read).pricing).toBe(staleOperation);

    discardAdminPricingRetry("admin-a", (key) => { storage.delete(key); });
    expect(readAdminPendingOperations("admin-a", read)).toEqual({ pricing: null, comp: "admin-a comp draft" });
    expect(readAdminPendingOperations("admin-b", read)).toEqual({ pricing: "admin-b pricing draft", comp: null });

    const refreshedMarkup = renderToStaticMarkup(createElement(AdminFeaturePricing, {
      dashboard: { ...dashboard, current: { ...dashboard.current!, revision: 3 } },
      adminId: "admin-a",
      initialRequestId: "4e03ea57-5212-4f2e-8a48-e421d2c959c3",
      initialCompRequestId: "5e03ea57-5212-4f2e-8a48-e421d2c959c3",
    }));
    expect(refreshedMarkup).toContain('name="expected_revision" value="3"');
    expect(refreshedMarkup).toContain('name="request_id" value="4e03ea57-5212-4f2e-8a48-e421d2c959c3"');
  });

  it("normalizes native UTC date-time input without device timezone or DST ambiguity", () => {
    const normalized = utcLocalInputToIso("2026-11-01T01:30");
    expect(normalized).toBe("2026-11-01T01:30:00.000Z");
    expect(isoToUtcLocalInput(normalized!)).toBe("2026-11-01T01:30");
    expect(utcLocalInputToIso("2026-02-30T10:00")).toBeNull();
  });
});
