import { describe, expect, it, vi } from "vitest";
import {
  processPrintfulApparelJob,
  type ApparelFulfillmentDependencies,
  type ApparelFulfillmentJob,
} from "./apparel-fulfillment-core";
import type { PrintfulOrderObservation } from "./apparel-orders-client";

const ADDRESS = {
  name: "Synthetic Buyer",
  address1: "1 Test Way",
  address2: "",
  city: "Albany",
  stateCode: "NY",
  countryCode: "US",
  zip: "12207",
  phone: null,
  email: "buyer@example.test",
};
const RECIPIENT = {
  name: "Synthetic Buyer",
  address1: "1 Test Way",
  city: "Albany",
  state_code: "NY",
  country_code: "US" as const,
  zip: "12207",
  email: "buyer@example.test",
};
const ORDER_ID = "123e4567-e89b-42d3-a456-426614174000";
const SYNC_VARIANT = "5635838147";
const EXTERNAL_ID = "123e4567e89b42d3a456426614174000";
const CONFIGURATION = "a".repeat(64);
const DESIGN = "b".repeat(64);

function job(status: ApparelFulfillmentJob["status"] = "queued"): ApparelFulfillmentJob {
  return {
    orderId: ORDER_ID,
    workerId: "worker-synthetic",
    leaseGeneration: 3,
    status,
    variantId: "123e4567-e89b-42d3-a456-426614174001",
    providerExternalId: EXTERNAL_ID,
    providerOrderId: status === "queued" || status === "paid_waiting_net" || status === "paid_waiting_address_quote" ? null : "987654321",
    syncVariantId: SYNC_VARIANT,
    externalProductId: "492658670",
    externalVariantId: "6af522103b23d5",
    catalogVariantId: "12345",
    configurationFingerprint: CONFIGURATION,
    designIdentityFingerprint: DESIGN,
    itemTitle: "Synthetic shirt",
    variantLabel: "Blue / M",
    quantity: 1,
    guestEmail: "buyer@example.test",
    address: ADDRESS,
    customerPriceCents: 5000,
    stripeSessionId: "cs_synthetic12345678",
    stripeEventId: "evt_synthetic12345678",
    stripePaymentIntentId: "pi_synthetic12345678",
    stripePaidCents: 5000,
    stripeNetRevenueCents: 4700,
    stripeLivemode: true,
    quoteTotalCents: 2000,
    finalQuoteTotalCents: 1500,
    catalogRevision: "4",
    approvalVersion: 2,
    finalStripeAddressVerified: true,
  };
}

function order(status = "draft", costFactsComplete = true) {
  return {
    id: "987654321",
    storeId: "19050731",
    externalId: EXTERNAL_ID,
    status,
    currency: costFactsComplete ? "USD" : null,
    totalCents: costFactsComplete ? 1500 : null,
    costFactsComplete,
    syncVariantIds: [SYNC_VARIANT],
    designIdentityFingerprints: [DESIGN],
    externalLineIds: [EXTERNAL_ID],
    recipient: RECIPIENT,
    shipments: [],
  } as const;
}

function acceptedObservation(overrides: Partial<PrintfulOrderObservation> = {}): PrintfulOrderObservation {
  return { ...order("fulfilled"), ...overrides } as unknown as PrintfulOrderObservation;
}

function dependencies(overrides: Partial<ApparelFulfillmentDependencies> = {}) {
  const updates: unknown[] = [];
  const actions: unknown[] = [];
  const defer = vi.fn(async () => true);
  const update = vi.fn(async (_job, value) => { updates.push(value); return true; });
  const recordAction = vi.fn(async (_job, key, kind, state, safeCode, providerOrderId, hash) => {
    actions.push({ key, kind, state, safeCode, providerOrderId, hash });
    return true;
  });
  const context = {
    salesMode: "printful_apparel_only",
    fulfillmentEnabled: true,
    approvalEnabled: true,
    classification: "apparel",
    approvalVersion: 2,
    storeId: "19050731",
    productId: "492658670",
    productIgnored: false,
    variantId: "123e4567-e89b-42d3-a456-426614174001",
    syncVariantId: SYNC_VARIANT,
    externalVariantId: "6af522103b23d5",
    catalogVariantId: "12345",
    synced: true,
    variantIgnored: false,
    availabilityStatus: "active",
    configurationComplete: true,
    configurationFingerprint: CONFIGURATION,
  };
  const estimate = {
    currency: "USD" as const,
    subtotalCents: 1200,
    discountCents: 0,
    shippingCents: 300,
    additionalFeeCents: 0,
    fulfillmentFeeCents: 0,
    taxCents: 0,
    vatCents: 0,
    digitizationCents: 0,
    totalCents: 1500,
  };
  const readProduct = vi.fn(async () => ({
    status: "complete" as const,
    storeId: "19050731" as const,
    storeName: "GYMX2" as const,
    storeType: "native" as const,
    readStartedAt: "2026-11-22T12:00:00.000Z",
    readCompletedAt: "2026-11-22T12:00:01.000Z",
    atomicProviderSnapshotProven: false as const,
    product: {
      syncProductId: "492658670",
      name: "Synthetic shirt",
      ignored: false,
      syncedVariantCount: 1,
      variants: [{
        syncVariantId: SYNC_VARIANT,
        externalId: "6af522103b23d5",
        catalogVariantId: "12345",
        name: "Blue / M",
        color: "Blue",
        size: "M",
        synced: true,
        ignored: false,
        availabilityStatus: "active",
        configurationFingerprint: CONFIGURATION,
        designIdentityFingerprint: DESIGN,
        configurationComplete: true,
        placementTypes: ["front"],
        optionNames: [],
      }],
    },
  }));
  const findOrder = vi.fn(async () => ({ ok: true as const, value: order() }));
  const createDraft = vi.fn(async () => ({ ok: true as const, value: order() }));
  const confirmDraft = vi.fn(async () => ({ ok: true as const, value: order("pending") }));
  const bindFinalQuote = vi.fn(async () => true);
  const getStripeFacts = vi.fn(async () => ({ verifiedPaid: true, netRevenueCents: 4700, refundOrDispute: false }));
  const recoverFinalAddress = vi.fn(async () => true);
  const recordCostException = vi.fn(async () => true);
  const deps = {
    getContext: vi.fn(async () => context),
    getStripeFacts,
    recoverFinalAddress,
    recordCostException,
    readProduct,
    estimate: vi.fn(async () => ({ ok: true as const, value: estimate })),
    createDraft,
    findOrder,
    confirmDraft,
    recordAction,
    recordNet: vi.fn(async () => true),
    bindFinalQuote,
    update,
    defer,
    now: () => new Date("2026-11-22T12:00:00.000Z"),
    ...overrides,
  } as unknown as ApparelFulfillmentDependencies;
  return { deps, updates, actions, defer, update, recordAction, readProduct,
    findOrder: deps.findOrder as unknown as ReturnType<typeof vi.fn>,
    createDraft: deps.createDraft as unknown as ReturnType<typeof vi.fn>,
    confirmDraft: deps.confirmDraft as unknown as ReturnType<typeof vi.fn>,
    bindFinalQuote, recoverFinalAddress, recordCostException,
    getContext: deps.getContext, getStripeFacts: deps.getStripeFacts };
}

describe("Printful apparel fulfillment orchestration with injected fakes", () => {
  it("runs the exact variant and address from paid quote through draft, confirmation, and tracking", async () => {
    const fake = dependencies();
    const created = await processPrintfulApparelJob(job("queued"), fake.deps);
    expect(created).toBe("updated");
    expect(fake.createDraft).toHaveBeenCalledTimes(1);
    expect(fake.createDraft.mock.calls[0][1]).toMatchObject({ syncVariantId: SYNC_VARIANT, quantity: 1 });
    expect(fake.createDraft.mock.calls[0][0]).toMatchObject({ country_code: "US", state_code: "NY", zip: "12207" });
    expect(fake.bindFinalQuote).toHaveBeenCalledTimes(1);
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "draft_created", jobStatus: "draft_created" });

    const drafted = await processPrintfulApparelJob({ ...job("draft_created"), providerOrderId: "987654321" }, fake.deps);
    expect(drafted).toBe("updated");
    expect(fake.confirmDraft).toHaveBeenCalledTimes(1);
    expect(fake.confirmDraft.mock.calls[0][0]).toBe("987654321");
    expect(fake.confirmDraft.mock.calls[0][1]).toBe(EXTERNAL_ID);
    expect(fake.confirmDraft.mock.calls[0][2]).toMatchObject({ syncVariantId: SYNC_VARIANT });
    expect(fake.getStripeFacts).toHaveBeenCalledTimes(3);
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "confirmed", jobStatus: "confirmed" });

    fake.findOrder.mockResolvedValueOnce({ ok: true, value: order("fulfilled") });
    const tracked = await processPrintfulApparelJob({ ...job("confirmed"), providerOrderId: "987654321" }, fake.deps);
    expect(tracked).toBe("updated");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "fulfilled", jobStatus: "fulfilled" });
  });

  it("never repeats create after an unknown outcome and reconciles only its stable external ID", async () => {
    const fake = dependencies({
      createDraft: vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const })),
      findOrder: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const })),
    });
    expect(await processPrintfulApparelJob(job("queued"), fake.deps)).toBe("deferred");
    expect(fake.createDraft).toHaveBeenCalledTimes(1);
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "create_unknown", jobStatus: "create_unknown" });
    const reconciled = await processPrintfulApparelJob({ ...job("create_unknown"), providerOrderId: null }, fake.deps);
    expect(reconciled).toBe("deferred");
    expect(fake.findOrder).toHaveBeenCalledWith(EXTERNAL_ID, expect.objectContaining({ syncVariantId: SYNC_VARIANT }), DESIGN, expect.any(Object));
    expect(fake.createDraft).toHaveBeenCalledTimes(1);
  });

  it("does not repeat confirmation after an unknown confirm result; it only reconciles by external ID", async () => {
    const fake = dependencies({
      confirmDraft: vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const })),
    });
    expect(await processPrintfulApparelJob({ ...job("draft_created"), providerOrderId: "987654321" }, fake.deps)).toBe("deferred");
    expect(fake.confirmDraft).toHaveBeenCalledTimes(1);
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "confirm_unknown", jobStatus: "confirm_unknown" });
    fake.findOrder.mockResolvedValueOnce({ ok: true, value: order("draft") });
    expect(await processPrintfulApparelJob({ ...job("confirm_unknown"), providerOrderId: "987654321" }, fake.deps)).toBe("held");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "resolution_hold", providerOrderId: "987654321" });
    expect(fake.findOrder).toHaveBeenCalledWith(EXTERNAL_ID, expect.any(Object), DESIGN, expect.any(Object));
    expect(fake.confirmDraft).toHaveBeenCalledTimes(1);
  });

  it("holds when the exact same-size color variant or approved design changed", async () => {
    const fake = dependencies({
      readProduct: vi.fn(async () => ({
        status: "complete" as const,
        storeId: "19050731" as const,
        storeName: "GYMX2" as const,
        storeType: "native" as const,
        readStartedAt: "2026-11-22T12:00:00.000Z",
        readCompletedAt: "2026-11-22T12:00:01.000Z",
        atomicProviderSnapshotProven: false as const,
        product: {
          syncProductId: "492658670", name: "Synthetic shirt", ignored: false, syncedVariantCount: 1,
          variants: [{
            syncVariantId: "5635838148", externalId: "other-color-same-size", catalogVariantId: "12346",
            name: "Red / M", color: "Red", size: "M", synced: true, ignored: false,
            availabilityStatus: "active", configurationFingerprint: CONFIGURATION,
            designIdentityFingerprint: DESIGN, configurationComplete: true, placementTypes: [], optionNames: [],
          }],
        },
      })) as unknown as ApparelFulfillmentDependencies["readProduct"],
    });
    expect(await processPrintfulApparelJob(job("queued"), fake.deps)).toBe("deferred");
    expect(fake.createDraft).not.toHaveBeenCalled();
  });

  it("never confirms when a refund or dispute is observed", async () => {
    const fake = dependencies({
      getStripeFacts: vi.fn(async () => ({ verifiedPaid: true, netRevenueCents: 4700, refundOrDispute: true })),
    });
    expect(await processPrintfulApparelJob({ ...job("draft_created"), providerOrderId: "987654321" }, fake.deps)).toBe("held");
    expect(fake.confirmDraft).not.toHaveBeenCalled();
  });

  it("continues tracking an accepted order after approval or stock changes", async () => {
    const fake = dependencies({
      getContext: vi.fn(async () => null),
      getStripeFacts: vi.fn(async () => ({ verifiedPaid: false, netRevenueCents: null, refundOrDispute: false })),
      findOrder: vi.fn(async () => ({ ok: true as const, value: order("partial") })),
    });
    expect(await processPrintfulApparelJob(job("confirmed"), fake.deps)).toBe("updated");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "partial", providerStatus: "partial" });
    expect(fake.getContext).not.toHaveBeenCalled();
    expect(fake.getStripeFacts).not.toHaveBeenCalled();
  });

  it("reconciles an unknown create before checking changed approval and never creates twice", async () => {
    const fake = dependencies({
      getContext: vi.fn(async () => null),
      findOrder: vi.fn(async () => ({ ok: true as const, value: order("pending") })),
    });
    expect(await processPrintfulApparelJob({ ...job("create_unknown"), providerOrderId: null }, fake.deps)).toBe("updated");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "confirmed", providerOrderId: "987654321" });
    expect(fake.getContext).not.toHaveBeenCalled();
    expect(fake.createDraft).not.toHaveBeenCalled();
  });

  it("does not treat provider on-hold status as confirmed or try to confirm it", async () => {
    const fake = dependencies({
      findOrder: vi.fn(async () => ({ ok: true as const, value: order("onhold") })),
    });
    expect(await processPrintfulApparelJob({ ...job("draft_created"), providerOrderId: "987654321" }, fake.deps)).toBe("deferred");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "quote_pending", jobStatus: "quote_pending", providerStatus: "onhold" });
    expect(fake.confirmDraft).not.toHaveBeenCalled();
  });

  it("keeps an accepted order in its monotonic state when a later provider read says on-hold", async () => {
    const fake = dependencies({ findOrder: vi.fn(async () => ({ ok: true as const, value: order("onhold", false) })) });
    expect(await processPrintfulApparelJob(job("confirmed"), fake.deps)).toBe("deferred");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "confirmed", jobStatus: "confirmed", providerStatus: "onhold" });
    expect(fake.recordCostException).toHaveBeenCalledWith(expect.anything(), "provider_cost_facts_unverified");
    expect(Date.parse(String((fake.updates.at(-1) as { retryAt: string }).retryAt)) - Date.parse("2026-11-22T12:00:00.000Z"))
      .toBe(12 * 60 * 60_000);
  });

  it("records cost exceptions while continuing accepted-order tracking", async () => {
    const fake = dependencies({ findOrder: vi.fn(async () => ({ ok: true as const, value: order("pending", false) })) });
    expect(await processPrintfulApparelJob(job("confirmed"), fake.deps)).toBe("updated");
    expect(fake.recordCostException).toHaveBeenCalledWith(expect.anything(), "provider_cost_facts_unverified");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "confirmed", providerStatus: "pending" });
  });

  it("records unverified cost and funding facts before a confirm-unknown fulfilled observation becomes terminal", async () => {
    const fake = dependencies({
      findOrder: vi.fn(async () => ({ ok: true as const, value: acceptedObservation() })),
    });
    const result = await processPrintfulApparelJob({ ...job("confirm_unknown"), stripeNetRevenueCents: null }, fake.deps);
    expect(result).toBe("updated");
    expect(fake.recordCostException).toHaveBeenCalledWith(expect.anything(), "provider_cost_facts_unverified");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "fulfilled", jobStatus: "fulfilled" });
    expect(fake.confirmDraft).not.toHaveBeenCalled();
  });

  it("records cost exception before saving an immediately observed terminal confirm response", async () => {
    const fake = dependencies({
      confirmDraft: vi.fn(async () => ({ ok: true as const, value: order("fulfilled", false) })),
    });
    const result = await processPrintfulApparelJob({ ...job("draft_created"), providerOrderId: "987654321" }, fake.deps);
    expect(result).toBe("updated");
    expect(fake.recordCostException).toHaveBeenCalledWith(expect.anything(), "provider_cost_facts_unverified");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "fulfilled", jobStatus: "fulfilled" });
    expect(fake.recordCostException.mock.invocationCallOrder[0]).toBeLessThan(fake.update.mock.invocationCallOrder[0]);
  });

  it.each(["draft_created", "quote_pending"] as const)(
    "records accepted %s cost exceptions before a terminal fulfillment state write",
    async (status) => {
      const cases: ReadonlyArray<Readonly<{
        name: string;
        observation: PrintfulOrderObservation;
        stripeNetRevenueCents: number | null;
        expected: string;
      }>> = [
        { name: "missing cost facts", observation: acceptedObservation({ costFactsComplete: false, currency: null, totalCents: null }), stripeNetRevenueCents: 4700, expected: "provider_cost_facts_unverified" },
        { name: "non-USD cost", observation: acceptedObservation({ currency: "EUR" }), stripeNetRevenueCents: 4700, expected: "provider_cost_facts_unverified" },
        { name: "over cap", observation: acceptedObservation({ totalCents: 2500 }), stripeNetRevenueCents: 4700, expected: "provider_cost_above_cap" },
        { name: "over payment net", observation: acceptedObservation(), stripeNetRevenueCents: 1400, expected: "provider_cost_above_net" },
        { name: "missing payment net", observation: acceptedObservation(), stripeNetRevenueCents: null, expected: "provider_cost_facts_unverified" },
      ];

      for (const testCase of cases) {
        const fake = dependencies({
          findOrder: vi.fn(async () => ({ ok: true as const, value: testCase.observation })),
        });
        const result = await processPrintfulApparelJob({ ...job(status), stripeNetRevenueCents: testCase.stripeNetRevenueCents }, fake.deps);
        expect(result, testCase.name).toBe("updated");
        expect(fake.recordCostException, testCase.name).toHaveBeenCalledWith(expect.anything(), testCase.expected);
        expect(fake.updates.at(-1), testCase.name).toMatchObject({ orderStatus: "fulfilled", jobStatus: "fulfilled" });
        expect(fake.recordCostException.mock.invocationCallOrder[0], testCase.name)
          .toBeLessThan(fake.update.mock.invocationCallOrder[0]);
      }
    },
  );

  it("does not save a terminal accepted state if the required cost exception write fails", async () => {
    const recordCostException = vi.fn(async () => false);
    const fake = dependencies({
      findOrder: vi.fn(async () => ({ ok: true as const, value: acceptedObservation({ totalCents: 2500 }) })),
      recordCostException,
    });
    expect(await processPrintfulApparelJob(job("quote_pending"), fake.deps)).toBe("stale_lease");
    expect(recordCostException).toHaveBeenCalledWith(expect.anything(), "provider_cost_above_cap");
    expect(fake.update).not.toHaveBeenCalled();
  });

  it("recovers a later verified shipping address for a paid order without holding it forever", async () => {
    const finalStripeAddress = { name: "Synthetic Buyer", address1: "2 Test Way", city: "Albany", stateCode: "NY", countryCode: "US", zip: "12207", email: "buyer@example.test" };
    const fake = dependencies({
      getStripeFacts: vi.fn(async () => ({ verifiedPaid: true, netRevenueCents: 4700, refundOrDispute: false, finalStripeAddress })),
    });
    expect(await processPrintfulApparelJob({ ...job("paid_waiting_address_quote"), finalStripeAddressVerified: false }, fake.deps)).toBe("deferred");
    expect(fake.recoverFinalAddress).toHaveBeenCalledWith(expect.objectContaining({ stripeEventId: "evt_synthetic12345678" }), finalStripeAddress);
    expect(fake.defer).toHaveBeenCalledWith(expect.anything(), "shipping_address_recovered", 15, false);
    expect(fake.getContext).not.toHaveBeenCalled();
  });

  it("allows an already-created draft observed pending to advance into confirmed tracking", async () => {
    const fake = dependencies({ findOrder: vi.fn(async () => ({ ok: true as const, value: order("pending") })) });
    expect(await processPrintfulApparelJob(job("draft_created"), fake.deps)).toBe("updated");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "confirmed", jobStatus: "confirmed" });
  });

  it("reconciles confirm-unknown accepted work even after the listing is revoked", async () => {
    const fake = dependencies({
      getContext: vi.fn(async () => null),
      findOrder: vi.fn(async () => ({ ok: true as const, value: order("inprocess") })),
    });
    expect(await processPrintfulApparelJob({ ...job("confirm_unknown"), providerOrderId: "987654321" }, fake.deps)).toBe("updated");
    expect(fake.updates.at(-1)).toMatchObject({ orderStatus: "confirmed", providerOrderId: "987654321" });
    expect(fake.getContext).not.toHaveBeenCalled();
    expect(fake.confirmDraft).not.toHaveBeenCalled();
  });
});
