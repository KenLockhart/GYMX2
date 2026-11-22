import { describe, expect, it, vi } from "vitest";
import {
  EXPECTED_PRINTFUL_STORE_ID,
  type CatalogId,
} from "./catalog";
import {
  applySyntheticCatalogAdminSelection,
  type PrivateCatalogDraft,
  type PrivateCatalogDraftLink,
  type PrivateCatalogDraftRepository,
  type PrivateCatalogDraftState,
} from "./catalog-admin-drafts";

vi.mock("server-only", () => ({}));

type FixtureVariant = Readonly<{
  variantId: string;
  parentProductId?: string;
  name: string;
  color: string;
  size: string;
  catalogVariantId: string;
  synced: boolean;
  ignored: boolean;
  availabilityStatus: string;
}>;

type FixtureProduct = Readonly<{
  productId: string;
  name: string;
  ignored: boolean;
  variants: readonly FixtureVariant[];
  retailPrice?: string;
  thumbnailUrl?: string;
}>;

function tee(id = "10001", variants?: readonly FixtureVariant[]): FixtureProduct {
  return {
    productId: id,
    name: "Synthetic T-shirt",
    ignored: false,
    retailPrice: "99.99",
    thumbnailUrl: "https://example.invalid/not-imported.png",
    variants: variants ?? [
      { variantId: "20001", name: "T-shirt small red", color: "Red", size: "S", catalogVariantId: "30001", synced: true, ignored: false, availabilityStatus: "active" },
      { variantId: "20002", name: "T-shirt small blue", color: "Blue", size: "S", catalogVariantId: "30002", synced: true, ignored: false, availabilityStatus: "active" },
    ],
  };
}

function snapshot(products: readonly FixtureProduct[] = [tee()], revision = "snapshot-1", overrides: Record<string, unknown> = {}) {
  return {
    sourceKind: "synthetic-complete-catalog",
    storeId: EXPECTED_PRINTFUL_STORE_ID,
    revision,
    complete: true,
    expectedProductCount: products.length,
    observedProductCount: products.length,
    products: products.map((entry) => ({
      ...entry,
      expectedVariantCount: entry.variants.length,
      observedVariantCount: entry.variants.length,
      variants: entry.variants.map((variant) => ({ parentProductId: entry.productId, ...variant })),
    })),
    ...overrides,
  };
}

const LOCAL_ITEM_ID = "11111111-1111-4111-8111-111111111111";
const LOCAL_VARIANT_ID = "22222222-2222-4222-8222-222222222222";

function existingPrivateDraft(variantId = "20001"): PrivateCatalogDraft {
  return {
    localItemId: LOCAL_ITEM_ID,
    kind: "preview",
    category: "gear",
    private: true,
    purchaseBlocked: true,
    liveImportAllowed: false,
    title: "Approved local title",
    description: "Approved local description",
    priceCents: 4_799,
    shippingCents: 825,
    imagePath: "33333333-3333-4333-8333-333333333333/curated.webp",
    visibleToAll: true,
    published: true,
    variants: [{
      localVariantId: LOCAL_VARIANT_ID,
      externalVariantId: variantId as CatalogId,
      providerName: "Approved red small",
      color: "Red",
      size: "S",
      catalogVariantId: "30001" as CatalogId,
      synced: true,
      ignored: false,
      availabilityStatus: "active",
      available: true,
      manualImagePath: "44444444-4444-4444-8444-444444444444/red-small.webp",
    }],
    revision: 4,
  };
}

function initialState(overrides: Partial<PrivateCatalogDraftState> = {}): PrivateCatalogDraftState {
  return {
    revision: 0,
    drafts: [],
    links: [],
    ordinaryItems: [],
    ...overrides,
  };
}

class FakeDraftRepository implements PrivateCatalogDraftRepository {
  state: PrivateCatalogDraftState;
  readCount = 0;
  commitCount = 0;
  forceStaleCommit = false;
  failRead = false;

  constructor(state = initialState()) {
    this.state = structuredClone(state);
  }

  async readDraftState() {
    this.readCount += 1;
    if (this.failRead) throw new Error("synthetic repo read failure");
    return structuredClone(this.state);
  }

  async commitDraftState(expectedRevision: number, nextState: PrivateCatalogDraftState): Promise<"committed" | "stale"> {
    this.commitCount += 1;
    if (this.forceStaleCommit || this.state.revision !== expectedRevision) return "stale";
    const linkKeys = nextState.links.map((link) => `${link.storeId}:${link.productId}`);
    const draftIds = nextState.drafts.map((draft) => draft.localItemId);
    if (new Set(linkKeys).size !== linkKeys.length || new Set(draftIds).size !== draftIds.length) return "stale";
    this.state = structuredClone(nextState);
    return "committed";
  }

  bytes() {
    return JSON.stringify(this.state);
  }
}

function select(
  catalog: ReturnType<typeof snapshot>,
  repository: FakeDraftRepository,
  variants: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return {
    snapshotRevision: catalog.revision,
    expectedRepositoryRevision: repository.state.revision,
    expectedDraftRevision: null,
    productId: "10001",
    variants,
    ...extra,
  };
}

describe("synthetic private Printful catalog drafts", () => {
  it("selects an exact existing product and color variant into an incomplete private draft", async () => {
    const catalog = snapshot([tee(), {
      productId: "10002",
      name: "Synthetic Cap",
      ignored: false,
      variants: [{ variantId: "20003", name: "Cap one size", color: "Black", size: "OS", catalogVariantId: "30003", synced: true, ignored: false, availabilityStatus: "active" }],
    }]);
    const repository = new FakeDraftRepository();
    const result = await applySyntheticCatalogAdminSelection(
      catalog,
      select(catalog, repository, [{ variantId: "20002", size: "S", color: "Blue" }]),
      repository,
    );

    expect(result).toMatchObject({
      status: "simulated_private_draft",
      operation: "created",
      variantCount: 1,
      availableVariantCount: 1,
      purchaseBlocked: true,
      liveImportAllowed: false,
    });
    expect(repository.state.drafts).toHaveLength(1);
    expect(repository.state.links).toHaveLength(1);
    expect(repository.state.links[0]).toMatchObject({ storeId: EXPECTED_PRINTFUL_STORE_ID, productId: "10001" });
    const draft = repository.state.drafts[0];
    expect(draft.variants).toHaveLength(1);
    expect(draft.variants[0]).toMatchObject({ externalVariantId: "20002", color: "Blue", size: "S", available: true });
    expect(draft).toMatchObject({
      kind: "preview",
      category: "gear",
      private: true,
      purchaseBlocked: true,
      liveImportAllowed: false,
      title: null,
      description: null,
      priceCents: null,
      shippingCents: null,
      imagePath: null,
      visibleToAll: false,
      published: false,
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of ["19050731", "10001", "20002", "30002", "99.99", "not-imported.png"]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("rejects ambiguous same-size color selection and stale or unknown choices before repository reads", async () => {
    const catalog = snapshot();
    const repository = new FakeDraftRepository();
    const ambiguous = await applySyntheticCatalogAdminSelection(catalog, select(catalog, repository, [{ size: "S" }]), repository);
    expect(ambiguous).toEqual({ status: "ambiguous_variant_selection" });
    expect(repository.readCount).toBe(0);
    expect(repository.commitCount).toBe(0);

    const stale = await applySyntheticCatalogAdminSelection(
      catalog,
      { ...select(catalog, repository, [{ variantId: "20002" }]), snapshotRevision: "older-snapshot" },
      repository,
    );
    expect(stale).toEqual({ status: "stale_snapshot" });
    expect(repository.readCount).toBe(0);

    const unknown = await applySyntheticCatalogAdminSelection(
      catalog,
      select(catalog, repository, [{ variantId: "29999" }]),
      repository,
    );
    expect(unknown).toEqual({ status: "variant_not_found" });
    expect(repository.readCount).toBe(0);
  });

  it("repeats link/refresh idempotently and preserves curated fields and stable local IDs", async () => {
    const catalog = snapshot();
    const repository = new FakeDraftRepository();
    const first = await applySyntheticCatalogAdminSelection(
      catalog,
      select(catalog, repository, [{ variantId: "20001", color: "Red", size: "S" }]),
      repository,
    );
    expect(first.status).toBe("simulated_private_draft");
    const firstDraft = repository.state.drafts[0];
    const firstLink = repository.state.links[0];
    const curatedDraft: PrivateCatalogDraft = {
      ...firstDraft,
      title: "Curated tee title",
      description: "Curated description",
      priceCents: 5_250,
      shippingCents: 675,
      imagePath: "33333333-3333-4333-8333-333333333333/approved-tee.webp",
      visibleToAll: true,
      published: true,
      variants: [{ ...firstDraft.variants[0], manualImagePath: "44444444-4444-4444-8444-444444444444/approved-red.webp" }],
    };
    repository.state = {
      ...repository.state,
      revision: repository.state.revision + 1,
      drafts: [curatedDraft],
      links: [firstLink],
    };
    const secondCatalog = snapshot([tee("10001", [
      { variantId: "20001", name: "Updated vendor label", color: "Red", size: "S", catalogVariantId: "30001", synced: true, ignored: false, availabilityStatus: "active" },
      tee().variants[1],
    ])], "snapshot-2");
    const secondSelection = {
      ...select(secondCatalog, repository, [{ variantId: "20001", color: "Red", size: "S" }]),
      expectedDraftRevision: curatedDraft.revision,
    };
    const refreshed = await applySyntheticCatalogAdminSelection(secondCatalog, secondSelection, repository);
    expect(refreshed).toMatchObject({ status: "simulated_private_draft", operation: "refreshed" });
    expect(repository.state.drafts).toHaveLength(1);
    expect(repository.state.links).toHaveLength(1);
    const after = repository.state.drafts[0];
    expect(after.localItemId).toBe(firstDraft.localItemId);
    expect(after.variants[0].localVariantId).toBe(firstDraft.variants[0].localVariantId);
    expect(after.variants[0]).toMatchObject({ providerName: "Updated vendor label", manualImagePath: curatedDraft.variants[0].manualImagePath });
    expect(after).toMatchObject({
      title: "Curated tee title",
      description: "Curated description",
      priceCents: 5_250,
      shippingCents: 675,
      imagePath: "33333333-3333-4333-8333-333333333333/approved-tee.webp",
      visibleToAll: true,
      published: true,
      purchaseBlocked: true,
      liveImportAllowed: false,
    });
  });

  it("marks a missing mapped variant unavailable and reuses its UUID when it returns", async () => {
    const catalog = snapshot();
    const repository = new FakeDraftRepository();
    await applySyntheticCatalogAdminSelection(
      catalog,
      select(catalog, repository, [{ variantId: "20001" }, { variantId: "20002" }]),
      repository,
    );
    const blueBefore = repository.state.drafts[0].variants.find((variant) => variant.externalVariantId === "20002")!;

    const withoutBlue = snapshot([tee("10001", [tee().variants[0]])], "snapshot-2");
    const omitted = await applySyntheticCatalogAdminSelection(
      withoutBlue,
      { ...select(withoutBlue, repository, []), expectedDraftRevision: 1 },
      repository,
    );
    expect(omitted).toMatchObject({ status: "simulated_private_draft", variantCount: 2, availableVariantCount: 1 });
    const blueUnavailable = repository.state.drafts[0].variants.find((variant) => variant.externalVariantId === "20002")!;
    expect(blueUnavailable).toMatchObject({ localVariantId: blueBefore.localVariantId, available: false, availabilityStatus: "missing" });

    const restoredSnapshot = snapshot([tee()], "snapshot-3");
    const restored = await applySyntheticCatalogAdminSelection(
      restoredSnapshot,
      { ...select(restoredSnapshot, repository, [{ variantId: "20002" }]), expectedDraftRevision: 2 },
      repository,
    );
    expect(restored.status).toBe("simulated_private_draft");
    const blueAfter = repository.state.drafts[0].variants.find((variant) => variant.externalVariantId === "20002")!;
    expect(blueAfter).toMatchObject({ localVariantId: blueBefore.localVariantId, available: true, color: "Blue" });
  });

  it("requires an explicit private preview target and rejects an ordinary sellable item", async () => {
    const catalog = snapshot();
    const ordinaryId = "55555555-5555-4555-8555-555555555555";
    const repository = new FakeDraftRepository(initialState({
      ordinaryItems: [{ localItemId: ordinaryId, kind: "product" }],
    }));
    const before = repository.bytes();
    const result = await applySyntheticCatalogAdminSelection(
      catalog,
      select(catalog, repository, [{ variantId: "20001" }], { localTargetItemId: ordinaryId }),
      repository,
    );
    expect(result).toEqual({ status: "target_not_private_preview" });
    expect(repository.bytes()).toBe(before);
  });

  it("links only the explicitly selected existing private preview and preserves it", async () => {
    const catalog = snapshot();
    const privateDraft = existingPrivateDraft();
    const repository = new FakeDraftRepository(initialState({ drafts: [privateDraft] }));
    const result = await applySyntheticCatalogAdminSelection(
      catalog,
      select(catalog, repository, [{ variantId: "20001" }], {
        localTargetItemId: privateDraft.localItemId,
        expectedDraftRevision: privateDraft.revision,
      }),
      repository,
    );
    expect(result).toMatchObject({ status: "simulated_private_draft", operation: "linked", draftId: privateDraft.localItemId });
    expect(repository.state.drafts).toHaveLength(1);
    expect(repository.state.links).toHaveLength(1);
    expect(repository.state.drafts[0]).toMatchObject({
      title: privateDraft.title,
      description: privateDraft.description,
      priceCents: privateDraft.priceCents,
      shippingCents: privateDraft.shippingCents,
      imagePath: privateDraft.imagePath,
    });
  });

  it("rejects wrong-store, partial, parent-mismatched, and stale repository snapshots atomically", async () => {
    const valid = snapshot();
    const cases: Array<{ input: unknown; expected: string }> = [
      { input: snapshot([tee()], "snapshot-1", { storeId: "19050732" }), expected: "wrong_store" },
      { input: snapshot([tee()], "snapshot-1", { complete: false }), expected: "invalid_snapshot" },
      { input: snapshot([tee("10001", [{ ...tee().variants[0], parentProductId: "10002" }])]), expected: "invalid_snapshot" },
    ];
    for (const testCase of cases) {
      const repository = new FakeDraftRepository();
      const before = repository.bytes();
      const result = await applySyntheticCatalogAdminSelection(
        testCase.input,
        select(valid, repository, [{ variantId: "20001" }]),
        repository,
      );
      expect(result).toEqual({ status: testCase.expected });
      expect(repository.bytes()).toBe(before);
    }

    const staleRepository = new FakeDraftRepository();
    staleRepository.forceStaleCommit = true;
    const before = staleRepository.bytes();
    const stale = await applySyntheticCatalogAdminSelection(
      valid,
      select(valid, staleRepository, [{ variantId: "20001" }]),
      staleRepository,
    );
    expect(stale).toEqual({ status: "stale_repository" });
    expect(staleRepository.bytes()).toBe(before);
  });

  it("rejects a variant already privately linked to a different product", async () => {
    const existing = existingPrivateDraft("20001");
    const link: PrivateCatalogDraftLink = {
      storeId: EXPECTED_PRINTFUL_STORE_ID,
      productId: "10001" as CatalogId,
      localItemId: existing.localItemId,
      snapshotRevision: "snapshot-old",
    };
    const repository = new FakeDraftRepository(initialState({ drafts: [existing], links: [link] }));
    const otherProduct = tee("10002", [{
      variantId: "20001",
      name: "Reassigned variant",
      color: "Red",
      size: "S",
      catalogVariantId: "30001",
      synced: true,
      ignored: false,
      availabilityStatus: "active",
    }]);
    const catalog = snapshot([otherProduct], "snapshot-new");
    const result = await applySyntheticCatalogAdminSelection(
      catalog,
      {
        ...select(catalog, repository, [{ variantId: "20001" }]),
        productId: "10002",
      },
      repository,
    );
    expect(result).toEqual({ status: "variant_link_conflict" });
    expect(repository.state.drafts).toHaveLength(1);
    expect(repository.state.links).toEqual([link]);
  });
});
