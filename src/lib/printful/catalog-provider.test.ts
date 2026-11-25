import { describe, expect, it, vi, type Mock } from "vitest";
vi.mock("server-only", () => ({}));
import { createPrintfulStoreCatalogReader, getPrintfulCatalogSyncConfig } from "./catalog-provider";

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const storeId = "19050731";
const productIds = ["9007199254740993", "9007199254740994"];
const variantIds = ["9007199254741001", "9007199254741002"];
type TestFetch = Mock<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>;

function productDetail(
  productIndex: number,
  optionValue: unknown = "flat",
  fileOptionValue = "standard",
  ignored = false,
  extra: {
    changedPosition?: boolean;
    changedTechnique?: boolean;
    changedMetadata?: boolean;
    changedFileMessage?: boolean;
    changedStitchCountTier?: boolean;
    unknownFileField?: boolean;
    invalidFileMessage?: boolean;
    oversizedMessage?: boolean;
    controlFileMessage?: boolean;
    oversizedStitchCountTier?: boolean;
    controlStitchCountTier?: boolean;
    noFileIdentity?: boolean;
    malformedIdentity?: boolean;
    missingOptionValue?: boolean;
    emptyOptions?: boolean;
    protoOptionCollision?: boolean;
  } = {},
) {
  const productId = productIds[productIndex];
  const variantId = variantIds[productIndex];
  return {
    code: 200,
    result: {
      sync_product: { id: productId, name: `Synthetic ${productIndex}`, variants: 1, synced: 1, is_ignored: ignored },
      sync_variants: [{
        id: variantId,
        external_id: `external-${productIndex}`,
        sync_product_id: productId,
        variant_id: String(12345 + productIndex),
        name: `Synthetic variant ${productIndex}`,
        color: "Blue",
        size: "M",
        synced: true,
        is_ignored: false,
        availability_status: "active",
        technique: extra.changedTechnique ? "dtfilm" : "embroidery",
        files: [
          {
            id: extra.noFileIdentity ? null : extra.malformedIdentity ? "file-not-numeric" : 8,
            type: "embroidery_front_large",
            hash: extra.noFileIdentity || extra.malformedIdentity ? null : "a".repeat(32),
            url: "https://example.invalid/file-a",
            filename: extra.changedMetadata ? "renamed.png" : "design.png",
            status: extra.changedMetadata ? "processed" : "ready",
            created: "2026-11-20T12:00:00Z",
            visible: true,
            is_temporary: false,
            message: extra.oversizedMessage ? " ".repeat(4097)
              : extra.controlFileMessage ? "Synthetic note\n"
                : extra.changedFileMessage ? "Synthetic changed note" : "Synthetic note",
            stitch_count_tier: extra.oversizedStitchCountTier ? " ".repeat(101)
              : extra.controlStitchCountTier ? "tier_1\t"
                : extra.changedStitchCountTier ? "stitch_tier_2" : null,
            ...(extra.invalidFileMessage ? { message: { nested: true } } : {}),
            ...(extra.unknownFileField ? { unmodeled_cost_field: true } : {}),
            options: [{ id: "layer", value: fileOptionValue }],
            position: { x: extra.changedPosition ? 10 : 0, y: 0 },
          },
          { type: "preview", url: "https://example.invalid/preview-a" },
        ],
        options: extra.emptyOptions ? [] : [{ id: "embroidery_type", ...(extra.missingOptionValue ? {} : {
          value: extra.protoOptionCollision ? JSON.parse('{"__proto__":{"x":1}}') : optionValue,
        }) }],
      }],
    },
  };
}

function createFakeReader(options: {
  wrongStore?: boolean;
  duplicatePage?: boolean;
  changedOption?: boolean;
  changedFileOption?: boolean;
  changedCatalogVariant?: boolean;
  detailIgnored?: boolean;
  ignoredDrift?: boolean;
  productAddedOnFinal?: boolean;
  volatileUrlChanged?: boolean;
  previewChanged?: boolean;
  changedPosition?: boolean;
  changedTechnique?: boolean;
  changedMetadata?: boolean;
  changedFileMessage?: boolean;
  changedStitchCountTier?: boolean;
  unknownFileField?: boolean;
  invalidFileMessage?: boolean;
  oversizedMessage?: boolean;
  controlFileMessage?: boolean;
  oversizedStitchCountTier?: boolean;
  controlStitchCountTier?: boolean;
  noFileIdentity?: boolean;
  malformedIdentity?: boolean;
  missingOptionValue?: boolean;
  emptyOptions?: boolean;
  protoOptionCollision?: boolean;
} = {}) {
  let listCalls = 0;
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/stores") {
      return json({ code: 200, result: [{ id: storeId, name: options.wrongStore ? "Other" : "GYMX2", type: "native" }] });
    }
    if (url.pathname === "/store/products") {
      listCalls += 1;
      const finalPass = listCalls > 2;
      const total = finalPass && options.productAddedOnFinal ? 3 : 2;
      const offset = url.searchParams.get("offset");
      if (offset === "0") return json({
        code: 200,
        paging: { total, offset: 0, limit: 1 },
        result: [{ id: productIds[0], name: "Synthetic 0", variants: 1, synced: 1, is_ignored: finalPass && options.ignoredDrift ? true : false }],
      });
      if (offset === "2" && finalPass && options.productAddedOnFinal) return json({
        code: 200,
        paging: { total, offset: 2, limit: 1 },
        result: [{ id: "9007199254740995", name: "Added during read", variants: 0, synced: 0, is_ignored: false }],
      });
      return json({
        code: 200,
        paging: { total, offset: 1, limit: 1 },
        result: [{ id: options.duplicatePage ? productIds[0] : productIds[1], name: "Synthetic 1", variants: 1, synced: 1, is_ignored: false }],
      });
    }
    if (url.pathname === `/store/products/${productIds[0]}`) {
      const detail = productDetail(0, options.changedOption ? "puff" : "flat", options.changedFileOption ? "3d_puff" : "standard", options.detailIgnored, options);
      if (options.changedCatalogVariant) detail.result.sync_variants[0].variant_id = "99999";
      if (options.volatileUrlChanged) detail.result.sync_variants[0].files[0].url = "https://example.invalid/rotated-url";
      if (options.previewChanged) detail.result.sync_variants[0].files[1].url = "https://example.invalid/new-preview";
      return json(detail);
    }
    if (url.pathname === `/store/products/${productIds[1]}`) return json(productDetail(1));
    return new Response(null, { status: 404 });
  });
  return { fetcher: fetcher as unknown as typeof fetch & TestFetch };
}

describe("Printful live catalog reader", () => {
  it("reads only the selected native product while independently proving the configured store", async () => {
    const { fetcher } = createFakeReader();
    const reader = createPrintfulStoreCatalogReader({ enabled: true, token: "synthetic-token", fetcher, pageSize: 1 });
    const result = await reader.readProduct(productIds[0]);
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.storeId).toBe(storeId);
      expect(result.product.syncProductId).toBe(productIds[0]);
      expect(result.product.variants).toHaveLength(1);
      expect(result.atomicProviderSnapshotProven).toBe(false);
    }
    const paths = fetcher.mock.calls.map(([input]) => new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url).pathname);
    expect(paths).toEqual(["/stores", `/store/products/${productIds[0]}`]);
  });

  it("verifies the expected store and collects a complete paginated read with exact decimal IDs", async () => {
    const { fetcher } = createFakeReader();
    const reader = createPrintfulStoreCatalogReader({ enabled: true, token: "synthetic-token", fetcher, pageSize: 1 });
    const result = await reader.readCompleteStore();

    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.snapshot.storeId).toBe(storeId);
    expect(result.snapshot.atomicProviderSnapshotProven).toBe(false);
    expect(result.snapshot.listTotal).toBe(2);
    expect(result.snapshot.pageCount).toBe(2);
    expect(result.snapshot.products.map((product) => product.syncProductId)).toEqual(productIds);
    expect(result.snapshot.products[0].variants[0].syncVariantId).toBe(variantIds[0]);
    expect(result.snapshot.products[0].variants[0].externalId).toBe("external-0");
    expect(result.snapshot.products[0].variants[0].configurationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.snapshot.products[0].variants[0].designIdentityFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.snapshot.products[0].variants[0].placementTypes).toEqual(["embroidery_front_large", "preview"]);
    expect(result.snapshot.readStartedAt).toBeTruthy();
    expect(result.snapshot.readCompletedAt).toBe(result.snapshot.observedAt);
    expect(fetcher).toHaveBeenCalledTimes(7);
    for (const call of fetcher.mock.calls) {
      expect(call[1]?.method).toBe("GET");
      expect(new Headers(call[1]?.headers).get("Authorization")).toBe("Bearer synthetic-token");
    }
  });

  it("stops after identity mismatch before reading the product list", async () => {
    const { fetcher } = createFakeReader({ wrongStore: true });
    const result = await createPrintfulStoreCatalogReader({ enabled: true, token: "synthetic-token", fetcher }).readCompleteStore();
    expect(result).toEqual({ status: "provider_failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate IDs and incomplete pages before product details", async () => {
    const { fetcher } = createFakeReader({ duplicatePage: true });
    const result = await createPrintfulStoreCatalogReader({ enabled: true, token: "synthetic-token", fetcher, pageSize: 1 }).readCompleteStore();
    expect(result).toEqual({ status: "provider_failed" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("changes the opaque configuration fingerprint when a Printful option changes", async () => {
    const first = createFakeReader();
    const second = createFakeReader({ changedOption: true });
    const firstResult = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: first.fetcher, pageSize: 1 }).readCompleteStore();
    const secondResult = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: second.fetcher, pageSize: 1 }).readCompleteStore();
    expect(firstResult.status).toBe("complete");
    expect(secondResult.status).toBe("complete");
    if (firstResult.status === "complete" && secondResult.status === "complete") {
      expect(firstResult.snapshot.products[0].variants[0].configurationFingerprint)
        .not.toBe(secondResult.snapshot.products[0].variants[0].configurationFingerprint);
    }
  });

  it("preserves own __proto__ option keys in the configuration fingerprint", async () => {
    const ordinary = createFakeReader();
    const withProtoKey = createFakeReader({ protoOptionCollision: true });
    const a = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: ordinary.fetcher, pageSize: 1 }).readCompleteStore();
    const b = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: withProtoKey.fetcher, pageSize: 1 }).readCompleteStore();
    expect(a.status).toBe("complete");
    expect(b.status).toBe("complete");
    if (a.status === "complete" && b.status === "complete") {
      expect(a.snapshot.products[0].variants[0].configurationFingerprint)
        .not.toBe(b.snapshot.products[0].variants[0].configurationFingerprint);
    }
  });

  it("changes the configuration fingerprint for nested file placement options", async () => {
    const first = createFakeReader();
    const second = createFakeReader({ changedFileOption: true });
    const firstResult = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: first.fetcher, pageSize: 1 }).readCompleteStore();
    const secondResult = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: second.fetcher, pageSize: 1 }).readCompleteStore();
    expect(firstResult.status).toBe("complete");
    expect(secondResult.status).toBe("complete");
    if (firstResult.status === "complete" && secondResult.status === "complete") {
      expect(firstResult.snapshot.products[0].variants[0].configurationFingerprint)
        .not.toBe(secondResult.snapshot.products[0].variants[0].configurationFingerprint);
    }
  });

  it("invalidates cost evidence when a variant maps to a different catalog garment", async () => {
    const first = createFakeReader();
    const second = createFakeReader({ changedCatalogVariant: true });
    const a = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: first.fetcher, pageSize: 1 }).readCompleteStore();
    const b = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: second.fetcher, pageSize: 1 }).readCompleteStore();
    expect(a.status).toBe("complete");
    expect(b.status).toBe("complete");
    if (a.status === "complete" && b.status === "complete") {
      expect(a.snapshot.products[0].variants[0].configurationFingerprint).not.toBe(b.snapshot.products[0].variants[0].configurationFingerprint);
      expect(a.snapshot.products[0].variants[0].designIdentityFingerprint).not.toBe(b.snapshot.products[0].variants[0].designIdentityFingerprint);
    }
  });

  it("ignores rotated transport and preview URLs in production configuration identity", async () => {
    const first = createFakeReader();
    const second = createFakeReader({ volatileUrlChanged: true, previewChanged: true });
    const a = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: first.fetcher, pageSize: 1 }).readCompleteStore();
    const b = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: second.fetcher, pageSize: 1 }).readCompleteStore();
    expect(a.status).toBe("complete");
    expect(b.status).toBe("complete");
    if (a.status === "complete" && b.status === "complete") {
      expect(a.snapshot.products[0].variants[0].configurationFingerprint).toBe(b.snapshot.products[0].variants[0].configurationFingerprint);
    }
  });

  it("ignores non-configuration file metadata while keeping validated production identity", async () => {
    const first = createFakeReader();
    const metadata = createFakeReader({ changedMetadata: true });
    const a = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: first.fetcher, pageSize: 1 }).readCompleteStore();
    const b = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: metadata.fetcher, pageSize: 1 }).readCompleteStore();
    expect(a.status).toBe("complete");
    expect(b.status).toBe("complete");
    if (a.status === "complete" && b.status === "complete") {
      expect(a.snapshot.products[0].variants[0].configurationComplete).toBe(true);
      expect(b.snapshot.products[0].variants[0].configurationComplete).toBe(true);
      expect(a.snapshot.products[0].variants[0].configurationFingerprint).toBe(b.snapshot.products[0].variants[0].configurationFingerprint);
    }
  });

  it("models documented file message and stitch tier as influential configuration fields", async () => {
    const base = createFakeReader();
    const changedMessage = createFakeReader({ changedFileMessage: true });
    const changedTier = createFakeReader({ changedStitchCountTier: true });
    const unknown = createFakeReader({ unknownFileField: true });
    const invalidScalar = createFakeReader({ invalidFileMessage: true });
    const oversizedMessage = createFakeReader({ oversizedMessage: true });
    const controlMessage = createFakeReader({ controlFileMessage: true });
    const oversizedTier = createFakeReader({ oversizedStitchCountTier: true });
    const controlTier = createFakeReader({ controlStitchCountTier: true });
    const results = await Promise.all([base, changedMessage, changedTier, unknown, invalidScalar,
      oversizedMessage, controlMessage, oversizedTier, controlTier].map(({ fetcher }) =>
      createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher, pageSize: 1 }).readCompleteStore()));
    expect(results.every((result) => result.status === "complete")).toBe(true);
    if (results.some((result) => result.status !== "complete")) return;
    const [a, message, tier, unknownField, invalid, longMessage, controlMessageResult, longTier, controlTierResult] = results.map((result) =>
      result.status === "complete" ? result.snapshot.products[0].variants[0] : null);
    expect(a?.configurationComplete).toBe(true);
    expect(message?.configurationComplete).toBe(true);
    expect(tier?.configurationComplete).toBe(true);
    expect(unknownField?.configurationComplete).toBe(false);
    expect(invalid?.configurationComplete).toBe(false);
    expect(longMessage?.configurationComplete).toBe(false);
    expect(controlMessageResult?.configurationComplete).toBe(false);
    expect(longTier?.configurationComplete).toBe(false);
    expect(controlTierResult?.configurationComplete).toBe(false);
    expect(message?.configurationFingerprint).not.toBe(a?.configurationFingerprint);
    expect(tier?.configurationFingerprint).not.toBe(a?.configurationFingerprint);
  });

  it("invalidates design position and technique changes", async () => {
    const base = createFakeReader();
    const position = createFakeReader({ changedPosition: true });
    const technique = createFakeReader({ changedTechnique: true });
    const [a, b, c] = await Promise.all([base, position, technique].map(({ fetcher }) =>
      createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher, pageSize: 1 }).readCompleteStore()));
    expect(a.status).toBe("complete");
    expect(b.status).toBe("complete");
    expect(c.status).toBe("complete");
    if (a.status === "complete" && b.status === "complete" && c.status === "complete") {
      expect(a.snapshot.products[0].variants[0].configurationFingerprint).not.toBe(b.snapshot.products[0].variants[0].configurationFingerprint);
      expect(a.snapshot.products[0].variants[0].configurationFingerprint).not.toBe(c.snapshot.products[0].variants[0].configurationFingerprint);
    }
  });

  it("requires a stable production file ID or hash and explicit values for configuration options", async () => {
    const noIdentity = createFakeReader({ noFileIdentity: true });
    const malformedIdentity = createFakeReader({ malformedIdentity: true });
    const missingOption = createFakeReader({ missingOptionValue: true });
    const [a, malformed, b] = await Promise.all([noIdentity, malformedIdentity, missingOption].map(({ fetcher }) =>
      createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher, pageSize: 1 }).readCompleteStore()));
    expect(a.status).toBe("complete");
    expect(malformed.status).toBe("complete");
    expect(b.status).toBe("complete");
    if (a.status === "complete" && malformed.status === "complete" && b.status === "complete") {
      expect(a.snapshot.products[0].variants[0].configurationComplete).toBe(false);
      expect(malformed.snapshot.products[0].variants[0].configurationComplete).toBe(false);
      expect(b.snapshot.products[0].variants[0].configurationComplete).toBe(false);
    }
  });

  it("allows an explicitly empty options array when a stable production file is identified", async () => {
    const noOptions = createFakeReader({ emptyOptions: true });
    const result = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: noOptions.fetcher, pageSize: 1 }).readCompleteStore();
    expect(result.status).toBe("complete");
    if (result.status === "complete") expect(result.snapshot.products[0].variants[0].configurationComplete).toBe(true);
  });

  it("rejects detail/list ignored mismatch and product/ignored drift in the final listing", async () => {
    const detailMismatch = createFakeReader({ detailIgnored: true });
    expect((await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: detailMismatch.fetcher, pageSize: 1 }).readCompleteStore()).status)
      .toBe("provider_failed");
    const ignoredDrift = createFakeReader({ ignoredDrift: true });
    expect((await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: ignoredDrift.fetcher, pageSize: 1 }).readCompleteStore()).status)
      .toBe("provider_failed");
    const productAdded = createFakeReader({ productAddedOnFinal: true });
    expect((await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: productAdded.fetcher, pageSize: 1 }).readCompleteStore()).status)
      .toBe("provider_failed");
  });

  it("marks empty and preview-only configurations ineligible for reviewed production costs", async () => {
    const emptyConfigFetcher = createFakeReader().fetcher;
    const original = emptyConfigFetcher.getMockImplementation();
    emptyConfigFetcher.mockImplementation(async (input) => {
      const response = await original!(input);
      const requestUrl = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
      if (requestUrl.pathname === `/store/products/${productIds[0]}`) {
        const data = await response.json() as { result: { sync_variants: Array<Record<string, unknown>> } };
        data.result.sync_variants[0].files = [];
        data.result.sync_variants[0].options = [];
        return json(data);
      }
      return response;
    });
    const empty = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: emptyConfigFetcher, pageSize: 1 }).readCompleteStore();
    expect(empty.status).toBe("complete");
    if (empty.status === "complete") expect(empty.snapshot.products[0].variants[0].configurationComplete).toBe(false);

    const previewFetcher = createFakeReader().fetcher;
    const previewImplementation = previewFetcher.getMockImplementation();
    previewFetcher.mockImplementation(async (input) => {
      const response = await previewImplementation!(input);
      const requestUrl = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
      if (requestUrl.pathname === `/store/products/${productIds[0]}`) {
        const data = await response.json() as { result: { sync_variants: Array<Record<string, unknown>> } };
        data.result.sync_variants[0].files = [{ type: "preview", url: "https://example.invalid/preview" }];
        data.result.sync_variants[0].options = [];
        return json(data);
      }
      return response;
    });
    const previewOnly = await createPrintfulStoreCatalogReader({ enabled: true, token: "x", fetcher: previewFetcher, pageSize: 1 }).readCompleteStore();
    expect(previewOnly.status).toBe("complete");
    if (previewOnly.status === "complete") expect(previewOnly.snapshot.products[0].variants[0].configurationComplete).toBe(false);
  });
});

describe("Printful catalog sync configuration", () => {
  it("is default-off and requires the expected store and a token", () => {
    expect(getPrintfulCatalogSyncConfig({ NODE_ENV: "test" })).toEqual({ enabled: false, reason: "disabled" });
    expect(getPrintfulCatalogSyncConfig({ NODE_ENV: "test", PRINTFUL_CATALOG_SYNC_ENABLED: "true", PRINTFUL_STORE_ID: storeId }))
      .toEqual({ enabled: false, reason: "missing_credentials" });
    expect(getPrintfulCatalogSyncConfig({ NODE_ENV: "test", PRINTFUL_CATALOG_SYNC_ENABLED: "true", PRINTFUL_STORE_ID: "wrong", PRINTFUL_ACCESS_TOKEN: "x" }))
      .toEqual({ enabled: false, reason: "wrong_store" });
  });
});
