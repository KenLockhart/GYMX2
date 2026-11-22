import { describe, expect, it, vi } from "vitest";
import {
  EXPECTED_PRINTFUL_STORE_ID,
  type CatalogId,
  type ManagedCatalogProduct,
  type ManualBaseCostApproval,
} from "./catalog";
import {
  createSyntheticPrintfulCatalogDryRun,
  PRINTFUL_STORE_DRY_RUN_PAGE_SIZE,
  type SyntheticPrintfulStoreSource,
} from "./catalog-store-dry-run";

vi.mock("server-only", () => ({}));

type FixtureVariant = Readonly<{
  id: string;
  name: string;
  synced?: boolean;
  ignored?: boolean;
  availabilityStatus?: string;
  parentId?: string;
}>;

type FixtureProduct = Readonly<{
  id: string;
  name: string;
  variants: readonly FixtureVariant[];
  ignored?: boolean;
}>;

function product(id: string, variantId: string, name = `Gear ${id}`): FixtureProduct {
  return {
    id,
    name,
    ignored: false,
    variants: [{
      id: variantId,
      name: `Color and size for ${name}`,
      synced: true,
      ignored: false,
      availabilityStatus: "active",
    }],
  };
}

function pageFor(products: readonly FixtureProduct[], offset: number, limit: number) {
  return {
    status: "synthetic_page",
    requestedStoreId: EXPECTED_PRINTFUL_STORE_ID,
    offset,
    limit,
    total: products.length,
    products: products.slice(offset, offset + limit).map((entry) => ({
      id: entry.id,
      name: entry.name,
      variants: entry.variants.length,
      synced: entry.variants.filter((variant) => variant.synced === true).length,
      is_ignored: entry.ignored ?? false,
      external_id: `private-external-${entry.id}`,
      thumbnail_url: `https://example.invalid/private-${entry.id}.png`,
    })),
  };
}

function detailFor(entry: FixtureProduct) {
  return {
    status: "synthetic_detail",
    requestedStoreId: EXPECTED_PRINTFUL_STORE_ID,
    sync_product: {
      id: entry.id,
      name: entry.name,
      is_ignored: entry.ignored ?? false,
      variants: entry.variants.length,
      retail_price: "99.99",
      files: [{ url: "https://example.invalid/ignored-vendor-image.png" }],
    },
    sync_variants: entry.variants.map((variant) => ({
      id: variant.id,
      sync_product_id: variant.parentId ?? entry.id,
      variant_id: "7001",
      name: variant.name,
      color: "Blue",
      size: "M",
      synced: variant.synced ?? true,
      is_ignored: variant.ignored ?? false,
      availability_status: variant.availabilityStatus ?? "active",
      retail_price: "99.99",
      files: [{ url: "https://example.invalid/ignored-variant-image.png" }],
    })),
  };
}

type FakeSource = SyntheticPrintfulStoreSource & {
  calls: { pages: { offset: number; limit: number; status: string }[]; details: string[] };
};

function fakeSource(
  products: readonly FixtureProduct[],
  overrides: Readonly<{
    page?: (offset: number, limit: number, value: ReturnType<typeof pageFor>) => unknown;
    detail?: (id: string, value: ReturnType<typeof detailFor>) => unknown;
    failDetailId?: string;
  }> = {},
): FakeSource {
  const calls = { pages: [] as { offset: number; limit: number; status: string }[], details: [] as string[] };
  return {
    sourceKind: "synthetic-fake-provider",
    requestedStoreId: EXPECTED_PRINTFUL_STORE_ID,
    calls,
    async readProductsPage(offset, limit, status) {
      calls.pages.push({ offset, limit, status });
      const value = pageFor(products, offset, limit);
      return overrides.page ? overrides.page(offset, limit, value) : value;
    },
    async readProduct(productId) {
      calls.details.push(productId);
      if (productId === overrides.failDetailId) throw new Error("fake detail failure");
      const entry = products.find((candidate) => candidate.id === productId);
      if (!entry) return null;
      const value = detailFor(entry);
      return overrides.detail ? overrides.detail(productId, value) : value;
    },
  };
}

function approval(productId: string, variantId: string): ManualBaseCostApproval {
  return {
    revision: `approval-${productId}`,
    storeId: EXPECTED_PRINTFUL_STORE_ID,
    productId: productId as CatalogId,
    currency: "USD",
    source: "operator-confirmed-manual",
    providerVerified: false,
    costs: [{ variantId: variantId as CatalogId, baseCostCents: 1_800 }],
  };
}

function managedProduct(productId: string, variantId: string, title = "Approved seller title"): ManagedCatalogProduct {
  return {
    storeId: EXPECTED_PRINTFUL_STORE_ID,
    productId: productId as CatalogId,
    item: {
      localItemId: `11111111-1111-4111-8111-${productId.padStart(12, "0")}`,
      kind: "preview",
      category: "gear",
      title,
      description: "Approved copy",
      priceCents: 4_499,
      shippingCents: 725,
      visibleToAll: true,
      printfulPublished: true,
      purchaseBlocked: true,
      imagePath: "22222222-2222-4222-8222-222222222222/approved.webp",
    },
    variants: [{
      localVariantId: `33333333-3333-4333-8333-${variantId.padStart(12, "0")}`,
      externalVariantId: variantId as CatalogId,
      providerName: "Approved variant label",
      catalogVariantId: "7001" as CatalogId,
      synced: true,
      ignored: false,
      availabilityStatus: "active",
      available: true,
      baseCostCents: 1_800,
      manualImagePath: "44444444-4444-4444-8444-444444444444/variant.webp",
    }],
    revision: `revision-${productId}`,
  };
}

function itemByTitle<T extends { previewItems: readonly { item: { title: string } }[] }>(result: T, title: string): T["previewItems"][number] {
  const found = result.previewItems.find((entry) => entry.item.title === title);
  if (!found) throw new Error(`Missing preview item ${title}`);
  return found;
}

describe("synthetic paged Printful store dry-run", () => {
  it("reads multiple status=all pages then every exact product detail once before safe preview", async () => {
    const products = [product("9001", "9101", "Synthetic Shirt"), product("9002", "9102", "Synthetic Cap")];
    const source = fakeSource(products);
    const dryRun = createSyntheticPrintfulCatalogDryRun([], [approval("9001", "9101"), approval("9002", "9102")], { pageSize: 1 });
    const result = await dryRun.run(source);

    expect(source.calls.pages).toEqual([
      { offset: 0, limit: 1, status: "all" },
      { offset: 1, limit: 1, status: "all" },
    ]);
    expect(source.calls.details).toEqual(["9001", "9002"]);
    expect(result).toMatchObject({
      status: "simulated_preview",
      evidence: "synthetic_fixture_consistent_pagination_only",
      pageCount: 2,
      productCount: 2,
      detailReadCount: 2,
      createdOrRefreshedCount: 2,
    });
    if (result.status !== "simulated_preview") throw new Error("Expected a synthetic preview.");
    const shirt = itemByTitle(result, "Synthetic Shirt");
    expect(shirt.item).toMatchObject({
      kind: "preview",
      category: "gear",
      purchaseBlocked: true,
      priceCents: 3_800,
      shippingCents: 0,
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of ["19050731", "9001", "9101", "7001", "1800", "99.99", "private-external", "private-thumbnail", "ignored-vendor-image"]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("repeats dry-run imports with the same local item and variant IDs", async () => {
    const source = fakeSource([product("9010", "9110", "Repeat Tee")]);
    const dryRun = createSyntheticPrintfulCatalogDryRun([], [approval("9010", "9110")], { pageSize: 1 });
    const first = await dryRun.run(source);
    const second = await dryRun.run(source);
    expect(first.status).toBe("simulated_preview");
    expect(second.status).toBe("simulated_preview");
    if (first.status !== "simulated_preview" || second.status !== "simulated_preview") return;
    expect(first.createdOrRefreshedCount).toBe(1);
    expect(second.createdOrRefreshedCount).toBe(1);
    expect(first.previewItems).toHaveLength(1);
    expect(second.previewItems).toHaveLength(1);
    expect(second.previewItems[0].item.id).toBe(first.previewItems[0].item.id);
    expect(second.previewItems[0].variants[0].localId).toBe(first.previewItems[0].variants[0].localId);
    expect(second.previewItems[0].item.purchaseBlocked).toBe(true);
    expect(source.calls.details).toEqual(["9010", "9010"]);
  });

  it("preserves curated display and manual image data across missing and restocked variants", async () => {
    const existing = managedProduct("9200", "9220");
    const unlisted = managedProduct("9300", "9330", "Keep unlisted item");
    const dryRun = createSyntheticPrintfulCatalogDryRun([existing, unlisted], [], { pageSize: 1 });

    const active = await dryRun.run(fakeSource([product("9200", "9220", "Provider name") ]));
    expect(active.status).toBe("simulated_preview");
    if (active.status !== "simulated_preview") return;
    const curated = itemByTitle(active, "Approved seller title");
    expect(curated.item).toMatchObject({
      kind: "preview",
      category: "gear",
      purchaseBlocked: true,
      description: "Approved copy",
      priceCents: 4_499,
      shippingCents: 725,
      visibleToAll: true,
      published: true,
      imagePath: "22222222-2222-4222-8222-222222222222/approved.webp",
    });
    expect(curated.variants[0].manualImagePath).toBe("44444444-4444-4444-8444-444444444444/variant.webp");
    const variantLocalId = curated.variants[0].localId;
    expect(active.retainedUnlistedProductCount).toBe(1);

    const missingProduct: FixtureProduct = { id: "9200", name: "Provider name", ignored: false, variants: [] };
    const missing = await dryRun.run(fakeSource([missingProduct]));
    expect(missing.status).toBe("simulated_preview");
    if (missing.status !== "simulated_preview") return;
    const unavailable = itemByTitle(missing, "Approved seller title").variants[0];
    expect(unavailable).toMatchObject({ localId: variantLocalId, available: false });

    const restored = await dryRun.run(fakeSource([product("9200", "9220", "Provider name again")]));
    expect(restored.status).toBe("simulated_preview");
    if (restored.status !== "simulated_preview") return;
    expect(itemByTitle(restored, "Approved seller title").variants[0]).toMatchObject({
      localId: variantLocalId,
      available: true,
      manualImagePath: "44444444-4444-4444-8444-444444444444/variant.webp",
    });
  });

  it.each([
    ["partial first page", (offset: number, _limit: number, page: ReturnType<typeof pageFor>) => offset === 0 ? { ...page, products: [] } : page, undefined, "invalid_page"],
    ["bad offset", (offset: number, _limit: number, page: ReturnType<typeof pageFor>) => ({ ...page, offset: offset + 1 }), undefined, "invalid_page"],
    ["duplicate product across pages", (offset: number, _limit: number, page: ReturnType<typeof pageFor>) => offset === 1 ? { ...page, products: pageFor([product("9400", "9410"), product("9401", "9411")], 0, 1).products } : page, undefined, "duplicate_product_id"],
    ["changed total", (offset: number, _limit: number, page: ReturnType<typeof pageFor>) => offset === 1 ? { ...page, total: 3 } : page, undefined, "unstable_pagination"],
  ] as const)("rejects %s before touching preview state", async (_label, pageOverride, detailOverride, expectedReason) => {
    const initial = managedProduct("9500", "9510", "Keep unchanged");
    const dryRun = createSyntheticPrintfulCatalogDryRun([initial], [], { pageSize: 1 });
    const before = JSON.stringify(dryRun.preview());
    const source = fakeSource([product("9400", "9410"), product("9401", "9411")], {
      page: pageOverride,
      detail: detailOverride,
    });
    const result = await dryRun.run(source);
    expect(result).toMatchObject({ status: "rejected", reason: expectedReason });
    expect(JSON.stringify(dryRun.preview())).toBe(before);
  });

  it("rejects missing details, count drift, parent mismatch, and duplicate variant IDs atomically", async () => {
    const scenarios: Array<{
      products: readonly FixtureProduct[];
      overrides: Parameters<typeof fakeSource>[1];
      expected: string;
    }> = [
      { products: [product("9600", "9610")], overrides: { failDetailId: "9600" }, expected: "detail_read_failed" },
      {
        products: [product("9600", "9610")],
        overrides: { detail: (_id, detail) => ({ ...detail, sync_product: { ...detail.sync_product, variants: 2 } }) },
        expected: "detail_mismatch",
      },
      {
        products: [product("9600", "9610")],
        overrides: { detail: (_id, detail) => ({ ...detail, sync_variants: detail.sync_variants.map((variant) => ({ ...variant, sync_product_id: "9601" })) }) },
        expected: "detail_mismatch",
      },
      {
        products: [product("9600", "9610"), product("9601", "9610")],
        overrides: {},
        expected: "duplicate_variant_id",
      },
    ];
    for (const scenario of scenarios) {
      const dryRun = createSyntheticPrintfulCatalogDryRun([managedProduct("9700", "9710", "Keep unchanged")], [], { pageSize: 1 });
      const before = JSON.stringify(dryRun.preview());
      const result = await dryRun.run(fakeSource(scenario.products, scenario.overrides));
      expect(result).toMatchObject({ status: "rejected", reason: scenario.expected });
      expect(JSON.stringify(dryRun.preview())).toBe(before);
    }
  });

  it("serializes overlapping preview runs so a stale detail cannot overwrite a newer preview", async () => {
    const fixture = product("9800", "9810", "Overlap Tee");
    const firstSource = fakeSource([fixture]);
    const secondSource = fakeSource([fixture]);
    let releaseFirstPage!: () => void;
    const pageGate = new Promise<void>((resolve) => { releaseFirstPage = resolve; });
    const delayedSource: SyntheticPrintfulStoreSource = {
      ...firstSource,
      async readProductsPage(offset, limit, status) {
        await pageGate;
        return firstSource.readProductsPage(offset, limit, status);
      },
    };
    const dryRun = createSyntheticPrintfulCatalogDryRun([], [approval("9800", "9810")], { pageSize: 1 });
    const firstPromise = dryRun.run(delayedSource);
    const secondPromise = dryRun.run(secondSource);
    for (let tick = 0; tick < 8 && firstSource.calls.pages.length === 0; tick += 1) await Promise.resolve();
    expect(secondSource.calls.pages).toHaveLength(0);
    releaseFirstPage();
    const first = await firstPromise;
    const second = await secondPromise;
    expect(first.status).toBe("simulated_preview");
    expect(second.status).toBe("simulated_preview");
    if (first.status !== "simulated_preview" || second.status !== "simulated_preview") return;
    expect(second.previewItems[0].item.id).toBe(first.previewItems[0].item.id);
    expect(second.previewItems[0].variants[0].localId).toBe(first.previewItems[0].variants[0].localId);
    expect(firstSource.calls.details).toEqual(["9800"]);
    expect(secondSource.calls.details).toEqual(["9800"]);
    expect(PRINTFUL_STORE_DRY_RUN_PAGE_SIZE).toBe(50);
  });
});
