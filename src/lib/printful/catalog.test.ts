import { describe, expect, it, vi } from "vitest";
import {
  EXPECTED_PRINTFUL_STORE_ID,
  parseCatalogId,
  reconcileCatalogProduct,
  toPublicCatalogPreview,
  type CatalogCommit,
  type CatalogCommitResult,
  type CatalogId,
  type CatalogPriceApprovalRead,
  type CatalogRepository,
  type CompleteCatalogProvider,
  type CompleteCatalogSnapshot,
  type ManagedCatalogProduct,
  type ManualBaseCostApproval,
} from "./catalog";
import { createPrintfulCatalogReader } from "./catalog-client";

vi.mock("server-only", () => ({}));

const PRODUCT_ID = "501001" as CatalogId;
const VARIANT_ID = "701001" as CatalogId;

function providerVariant(overrides: Record<string, unknown> = {}) {
  return {
    externalVariantId: VARIANT_ID,
    name: "Black / Medium",
    catalogVariantId: "1001",
    synced: true,
    ignored: false,
    availabilityStatus: "active",
    ...overrides,
  };
}

function snapshot(
  variants: readonly Record<string, unknown>[] = [providerVariant()],
  overrides: Record<string, unknown> = {},
): CompleteCatalogSnapshot {
  return {
    storeId: EXPECTED_PRINTFUL_STORE_ID,
    productId: PRODUCT_ID,
    productName: "Synthetic Gym Tee",
    productIgnored: false,
    completeness: "complete",
    expectedVariantCount: variants.length,
    observedVariantCount: variants.length,
    variants,
    ...overrides,
  };
}

function fixedProvider(value: CompleteCatalogSnapshot): CompleteCatalogProvider {
  return { readCompleteProduct: vi.fn(async () => value) };
}

function manualApproval(
  costs: readonly { variantId: CatalogId; baseCostCents: number }[] = [{ variantId: VARIANT_ID, baseCostCents: 1_800 }],
  productId: CatalogId = PRODUCT_ID,
  revision = "approval-1",
): ManualBaseCostApproval {
  return {
    revision,
    storeId: EXPECTED_PRINTFUL_STORE_ID,
    productId,
    currency: "USD",
    source: "operator-confirmed-manual",
    providerVerified: false,
    costs,
  };
}

function key(storeId: string, productId: string) {
  return `${storeId}:${productId}`;
}

class FakeCatalogRepository implements CatalogRepository {
  readonly products = new Map<string, ManagedCatalogProduct>();
  readonly approvals = new Map<string, ManualBaseCostApproval>();
  readonly approvalRevisions = new Map<string, string>();
  writes = 0;
  reads = 0;

  async readManagedProduct(storeId: string, productId: CatalogId) {
    this.reads += 1;
    const value = this.products.get(key(storeId, productId));
    return value ? structuredClone(value) : null;
  }

  async readManualBaseCostApproval(
    storeId: string,
    productId: CatalogId,
    variantIds: readonly CatalogId[],
  ): Promise<CatalogPriceApprovalRead> {
    const recordKey = key(storeId, productId);
    const approval = this.approvals.get(recordKey);
    const requested = new Set(variantIds);
    return {
      revision: this.approvalRevisions.get(recordKey) ?? null,
      approval: approval
        ? { ...structuredClone(approval), costs: approval.costs.filter((cost) => requested.has(cost.variantId)) }
        : null,
    };
  }

  async commitManagedProduct(commit: CatalogCommit): Promise<CatalogCommitResult> {
    const recordKey = key(commit.next.storeId, commit.next.productId);
    const current = this.products.get(recordKey);
    if ((current?.revision ?? null) !== commit.expectedRevision) return "stale";
    if (
      commit.expectedApprovalRevision !== undefined &&
      (this.approvalRevisions.get(recordKey) ?? null) !== commit.expectedApprovalRevision
    ) return "stale";

    for (const [otherKey, product] of this.products) {
      if (otherKey === recordKey) continue;
      if (product.storeId === commit.next.storeId && product.productId === commit.next.productId) return "product-conflict";
      const existingExternalIds = new Set(product.variants.map((variant) => variant.externalVariantId));
      if (commit.next.variants.some((variant) => existingExternalIds.has(variant.externalVariantId))) {
        return "variant-conflict";
      }
    }

    this.products.set(recordKey, structuredClone(commit.next));
    this.writes += 1;
    return "committed";
  }

  setApproval(approval: ManualBaseCostApproval) {
    const recordKey = key(approval.storeId, approval.productId);
    this.approvals.set(recordKey, structuredClone(approval));
    this.approvalRevisions.set(recordKey, approval.revision);
  }

  stateBytes() {
    return JSON.stringify({
      products: [...this.products.entries()].sort(([a], [b]) => a.localeCompare(b)),
      approvals: [...this.approvals.entries()].sort(([a], [b]) => a.localeCompare(b)),
      approvalRevisions: [...this.approvalRevisions.entries()].sort(([a], [b]) => a.localeCompare(b)),
      writes: this.writes,
    });
  }
}

async function createOne(repository = new FakeCatalogRepository()) {
  repository.setApproval(manualApproval());
  const result = await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot()), repository);
  return { repository, result };
}

describe("Printful catalog identity and safe reconciliation", () => {
  it("uses exact positive decimal IDs and rejects lossy or noncanonical IDs", () => {
    expect(parseCatalogId("9223372036854775807")).toBe("9223372036854775807");
    expect(parseCatalogId(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "000123", "9223372036854775808", "1e3"]) {
      expect(() => parseCatalogId(value)).toThrow();
    }
  });

  it("requires explicit manually confirmed base cost and never treats retail price as cost", async () => {
    const repository = new FakeCatalogRepository();
    const result = await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot()), repository);
    expect(result).toEqual({ status: "needs_manual_price_confirmation" });
    expect(repository.writes).toBe(0);
    expect(repository.products.size).toBe(0);

    repository.setApproval(manualApproval([{ variantId: VARIANT_ID, baseCostCents: 1_800 }]));
    const created = await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot()), repository);
    expect(created.status).toBe("created");
    const stored = repository.products.get(key(EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID))!;
    expect(stored.item.priceCents).toBe(3_800);
    expect(stored.item.shippingCents).toBe(0);
    expect(stored.variants[0].baseCostCents).toBe(1_800);
    expect(stored.item.kind).toBe("preview");
    expect(stored.item.category).toBe("gear");
    expect(stored.item.purchaseBlocked).toBe(true);
    expect(stored.item.visibleToAll).toBe(false);
    expect(stored.item.printfulPublished).toBe(false);
  });

  it("does not request a manual price when a new product has no active synced variants", async () => {
    const repository = new FakeCatalogRepository();
    const result = await reconcileCatalogProduct(
      PRODUCT_ID,
      fixedProvider(snapshot([providerVariant({ ignored: true })])),
      repository,
    );
    expect(result).toEqual({ status: "no_available_variants" });
    expect(repository.writes).toBe(0);
  });

  it("repeats imports without duplicate item or variant cards and keeps local UUIDs", async () => {
    const repository = new FakeCatalogRepository();
    repository.setApproval(manualApproval());
    const first = await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot()), repository);
    const before = repository.products.get(key(EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID))!;
    const second = await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot()), repository);
    const after = repository.products.get(key(EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID))!;

    expect(first.status).toBe("created");
    expect(second.status).toBe("refreshed");
    expect(repository.products.size).toBe(1);
    expect(repository.writes).toBe(2);
    expect(after.item.localItemId).toBe(before.item.localItemId);
    expect(after.variants).toHaveLength(1);
    expect(after.variants[0].localVariantId).toBe(before.variants[0].localVariantId);
  });

  it.each([
    ["unknown store", { storeId: "19050732" }],
    ["wrong product", { productId: "501002" }],
    ["partial read", { completeness: "partial" }],
    ["wrong expected count", { expectedVariantCount: 2 }],
    ["wrong observed count", { observedVariantCount: 0 }],
  ])("rejects %s before any write", async (_label, overrides) => {
    const repository = new FakeCatalogRepository();
    const before = repository.stateBytes();
    const result = await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot([providerVariant()], overrides)), repository);
    expect(result).toEqual({ status: "invalid_snapshot" });
    expect(repository.stateBytes()).toBe(before);
    expect(repository.writes).toBe(0);
  });

  it("rejects duplicate IDs, malformed variants, and untrusted numeric IDs without mutation", async () => {
    const repository = new FakeCatalogRepository();
    const duplicate = providerVariant();
    const before = repository.stateBytes();
    for (const variants of [
      [providerVariant(), duplicate],
      [providerVariant({ externalVariantId: Number.MAX_SAFE_INTEGER + 1 })],
    ]) {
      const result = await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot(variants)), repository);
      expect(result).toEqual({ status: "invalid_snapshot" });
      expect(repository.stateBytes()).toBe(before);
    }
  });

  it("leaves repository state unchanged when provider read fails", async () => {
    const { repository } = await createOne();
    const before = repository.stateBytes();
    const provider: CompleteCatalogProvider = {
      readCompleteProduct: vi.fn(async () => { throw new Error("synthetic failure"); }),
    };
    expect(await reconcileCatalogProduct(PRODUCT_ID, provider, repository)).toEqual({ status: "provider_failed" });
    expect(repository.stateBytes()).toBe(before);
  });

  it("marks omitted variants unavailable, then restores the same UUID when they return", async () => {
    const { repository } = await createOne();
    const recordKey = key(EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID);
    const original = repository.products.get(recordKey)!;
    const omitted = await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot([])), repository);
    const unavailable = repository.products.get(recordKey)!;
    expect(omitted.status).toBe("refreshed");
    expect(unavailable.variants).toHaveLength(1);
    expect(unavailable.variants[0].available).toBe(false);
    expect(unavailable.variants[0].availabilityStatus).toBe("missing");
    expect(unavailable.variants[0].localVariantId).toBe(original.variants[0].localVariantId);

    const restored = await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot()), repository);
    const available = repository.products.get(recordKey)!;
    expect(restored.status).toBe("refreshed");
    expect(available.variants).toHaveLength(1);
    expect(available.variants[0].available).toBe(true);
    expect(available.variants[0].localVariantId).toBe(original.variants[0].localVariantId);
  });

  it("keeps the private product link and all variants when every observed variant is inactive", async () => {
    const { repository } = await createOne();
    const recordKey = key(EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID);
    const before = repository.products.get(recordKey)!;
    const result = await reconcileCatalogProduct(
      PRODUCT_ID,
      fixedProvider(snapshot([providerVariant({ ignored: true, availabilityStatus: "unavailable" })])),
      repository,
    );
    const after = repository.products.get(recordKey)!;
    expect(result.status).toBe("refreshed");
    expect(after.productId).toBe(before.productId);
    expect(after.item.localItemId).toBe(before.item.localItemId);
    expect(after.variants[0].available).toBe(false);
  });

  it("preserves curated copy, image, price, nonzero shipping, visibility, publication and local IDs", async () => {
    const { repository } = await createOne();
    const recordKey = key(EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID);
    const before = repository.products.get(recordKey)!;
    repository.products.set(recordKey, {
      ...before,
      item: {
        ...before.item,
        kind: "product", // Defensive normalization must return it to the preview invariant.
        title: "Approved title",
        description: "Approved seller copy",
        priceCents: 5_499,
        shippingCents: 725,
        visibleToAll: true,
        printfulPublished: true,
        purchaseBlocked: false,
        imagePath: "11111111-1111-4111-8111-111111111111/approved-shirt.webp",
      },
      variants: [{ ...before.variants[0], manualImagePath: "11111111-1111-4111-8111-111111111111/variant-black.webp" }],
    });
    const curated = repository.products.get(recordKey)!;
    const result = await reconcileCatalogProduct(
      PRODUCT_ID,
      fixedProvider(snapshot([providerVariant({ name: "Updated provider label" })], { productName: "New provider title" })),
      repository,
    );
    const after = repository.products.get(recordKey)!;
    expect(result.status).toBe("refreshed");
    expect(after.item).toMatchObject({
      localItemId: curated.item.localItemId,
      kind: "preview",
      category: "gear",
      title: "Approved title",
      description: "Approved seller copy",
      priceCents: 5_499,
      shippingCents: 725,
      visibleToAll: true,
      printfulPublished: true,
      purchaseBlocked: true,
      imagePath: "11111111-1111-4111-8111-111111111111/approved-shirt.webp",
    });
    expect(after.variants[0]).toMatchObject({
      localVariantId: curated.variants[0].localVariantId,
      providerName: "Updated provider label",
      manualImagePath: "11111111-1111-4111-8111-111111111111/variant-black.webp",
    });
  });

  it("leaves a new variant unavailable until its own manual cost approval exists", async () => {
    const { repository } = await createOne();
    const recordKey = key(EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID);
    const before = repository.products.get(recordKey)!;
    const added = providerVariant({ externalVariantId: "701002", name: "Black / Large" });
    const result = await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot([providerVariant(), added])), repository);
    const after = repository.products.get(recordKey)!;
    expect(result.status).toBe("refreshed");
    expect(after.item.priceCents).toBe(before.item.priceCents);
    expect(after.variants).toHaveLength(2);
    expect(after.variants.find((variant) => variant.externalVariantId === "701002")).toMatchObject({
      available: false,
      baseCostCents: null,
    });
  });

  it("rejects a provider variant already privately linked to another product", async () => {
    const repository = new FakeCatalogRepository();
    repository.setApproval(manualApproval());
    await reconcileCatalogProduct(PRODUCT_ID, fixedProvider(snapshot()), repository);
    const secondProductId = "501002" as CatalogId;
    repository.setApproval(manualApproval([{ variantId: VARIANT_ID, baseCostCents: 1_800 }], secondProductId, "approval-2"));
    const before = repository.stateBytes();
    const result = await reconcileCatalogProduct(
      secondProductId,
      fixedProvider(snapshot([providerVariant()], { productId: secondProductId })),
      repository,
    );
    expect(result).toEqual({ status: "variant_conflict" });
    expect(repository.products.size).toBe(1);
    expect(repository.writes).toBe(1);
    expect(repository.stateBytes()).toBe(before);
  });

  it("rejects an overlapping stale refresh without replaying the older snapshot", async () => {
    const { repository } = await createOne();
    const pending: ((value: CompleteCatalogSnapshot) => void)[] = [];
    const provider: CompleteCatalogProvider = {
      readCompleteProduct: () => new Promise((resolve) => pending.push(resolve)),
    };
    const older = reconcileCatalogProduct(PRODUCT_ID, provider, repository);
    const newer = reconcileCatalogProduct(PRODUCT_ID, provider, repository);
    for (let turn = 0; turn < 8 && pending.length < 2; turn += 1) await Promise.resolve();
    expect(pending).toHaveLength(2);

    pending[1](snapshot([providerVariant({ name: "Newer observation" })]));
    expect((await newer).status).toBe("refreshed");
    pending[0](snapshot([providerVariant({ name: "Older observation" })]));
    expect(await older).toEqual({ status: "stale_write" });
    const stored = repository.products.get(key(EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID))!;
    expect(stored.variants[0].providerName).toBe("Newer observation");
    expect(repository.writes).toBe(2); // Initial import and exactly one refresh.
  });

  it("allows only one simultaneous first import to create the private product card", async () => {
    const repository = new FakeCatalogRepository();
    repository.setApproval(manualApproval());
    const pending: ((value: CompleteCatalogSnapshot) => void)[] = [];
    const provider: CompleteCatalogProvider = {
      readCompleteProduct: () => new Promise((resolve) => pending.push(resolve)),
    };
    const first = reconcileCatalogProduct(PRODUCT_ID, provider, repository);
    const second = reconcileCatalogProduct(PRODUCT_ID, provider, repository);
    for (let turn = 0; turn < 8 && pending.length < 2; turn += 1) await Promise.resolve();
    expect(pending).toHaveLength(2);
    pending[0](snapshot());
    expect((await first).status).toBe("created");
    pending[1](snapshot());
    expect(await second).toEqual({ status: "stale_write" });
    expect(repository.products.size).toBe(1);
    expect(repository.writes).toBe(1);
  });

  it("projects only public preview fields and omits all provider IDs and private costs", async () => {
    const { repository } = await createOne();
    const managed = repository.products.get(key(EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID))!;
    const serialized = JSON.stringify(toPublicCatalogPreview(managed));
    expect(serialized).toContain(managed.item.localItemId);
    for (const privateValue of [EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID, VARIANT_ID, "1001", "1800"]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(toPublicCatalogPreview({
      ...managed,
      item: { ...managed.item, imagePath: `https://api.printful.com/${PRODUCT_ID}/${VARIANT_ID}.png` },
    }).imagePath).toBeNull();
    expect(toPublicCatalogPreview(managed)).toEqual({
      id: managed.item.localItemId,
      kind: "preview",
      category: "gear",
      title: "Synthetic Gym Tee",
      description: "",
      priceCents: 3_800,
      shippingCents: 0,
      visibleToAll: false,
      published: false,
      imagePath: null,
    });
  });

  it("keeps manually approved variant-image mapping separate from provider facts", async () => {
    const { repository } = await createOne();
    const recordKey = key(EXPECTED_PRINTFUL_STORE_ID, PRODUCT_ID);
    const before = repository.products.get(recordKey)!;
    repository.products.set(recordKey, {
      ...before,
      variants: [{ ...before.variants[0], manualImagePath: "11111111-1111-4111-8111-111111111111/variant-image.webp" }],
    });
    await reconcileCatalogProduct(
      PRODUCT_ID,
      fixedProvider(snapshot([providerVariant({ image: "https://not-a-provider-contract.invalid/fake.png" })])),
      repository,
    );
    expect(repository.products.get(recordKey)?.variants[0].manualImagePath)
      .toBe("11111111-1111-4111-8111-111111111111/variant-image.webp");
  });

  it("does not mistake an unverified recovered HTTP observation for a complete trusted snapshot", async () => {
    const reader = createPrintfulCatalogReader({
      enabled: true,
      token: "synthetic-test-token",
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        code: 200,
        result: {
          sync_product: { id: PRODUCT_ID, name: "Synthetic Gym Tee", variants: 1, is_ignored: false },
          sync_variants: [{ id: VARIANT_ID, variant_id: 1001, name: "Black / Medium", synced: true, is_ignored: false, availability_status: "active" }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } })),
    });
    const observation = await reader.readProduct(PRODUCT_ID);
    expect(observation.status).toBe("unverified_observation");
    if (observation.status !== "unverified_observation") throw new Error("Expected a parsed observation.");
    expect(observation.storeVerification).toBe("unverified");
    expect(observation.completeness).toBe("unverified");

    const repository = new FakeCatalogRepository();
    repository.setApproval(manualApproval());
    const forcedAdapter: CompleteCatalogProvider = {
      readCompleteProduct: async () => observation as unknown as CompleteCatalogSnapshot,
    };
    expect(await reconcileCatalogProduct(PRODUCT_ID, forcedAdapter, repository)).toEqual({ status: "invalid_snapshot" });
    expect(repository.writes).toBe(0);
    expect(repository.products.size).toBe(0);
  });
});
