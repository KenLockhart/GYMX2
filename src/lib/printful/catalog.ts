import "server-only";
import { randomUUID } from "node:crypto";

export const EXPECTED_PRINTFUL_STORE_ID = "19050731" as const;
export const PRINTFUL_CATALOG_MAX_VARIANTS = 100;
export const PRINTFUL_CATALOG_MAX_STORED_VARIANTS = 500;
export const PRINTFUL_MARKUP_CENTS = 2_000;

const MAX_PG_BIGINT = BigInt("9223372036854775807");
const MAX_BASE_COST_CENTS = 9_998_000;
const MAX_ITEM_PRICE_CENTS = 10_000_000;
const MAX_SHIPPING_CENTS = 100_000;
const ID_PATTERN = /^[1-9][0-9]{0,18}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const LOCAL_IMAGE_PATH_PATTERN = /^[0-9a-f-]{36}\/[-\w.]{1,200}$/i;

declare const catalogIdBrand: unique symbol;
export type CatalogId = string & { readonly [catalogIdBrand]: true };

/**
 * Provider IDs stay canonical decimal strings. Numeric JSON IDs are accepted only
 * while they are exactly representable as JavaScript safe integers.
 */
export function parseCatalogId(value: unknown): CatalogId {
  let decimal: string;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Catalog ID is not an exact positive integer.");
    }
    decimal = String(value);
  } else if (typeof value === "string") {
    decimal = value;
  } else {
    throw new Error("Catalog ID must be a decimal string or a safe integer.");
  }

  if (!ID_PATTERN.test(decimal) || BigInt(decimal) > MAX_PG_BIGINT) {
    throw new Error("Catalog ID is outside the supported canonical range.");
  }
  return decimal as CatalogId;
}

export type ProviderVariantObservation = Readonly<{
  externalVariantId: unknown;
  name: unknown;
  catalogVariantId: unknown;
  synced: unknown;
  ignored: unknown;
  availabilityStatus: unknown;
}>;

/** This complete snapshot is accepted only from the injected server-side provider. */
export type CompleteCatalogSnapshot = Readonly<{
  storeId: unknown;
  productId: unknown;
  productName: unknown;
  productIgnored: unknown;
  completeness: unknown;
  expectedVariantCount: unknown;
  observedVariantCount: unknown;
  variants: unknown;
}>;

export interface CompleteCatalogProvider {
  /** The implementation must return a complete, store-verified server-side read. */
  readCompleteProduct(productId: CatalogId): Promise<CompleteCatalogSnapshot>;
}

export type ManualBaseCostApproval = Readonly<{
  revision: string;
  storeId: string;
  productId: CatalogId;
  currency: "USD";
  source: "operator-confirmed-manual";
  /** This source is explicitly not a provider-verified price. */
  providerVerified: false;
  costs: readonly Readonly<{
    variantId: CatalogId;
    baseCostCents: number;
  }>[];
}>;

export type ManagedCatalogVariant = Readonly<{
  localVariantId: string;
  externalVariantId: CatalogId;
  providerName: string;
  catalogVariantId: CatalogId | null;
  synced: boolean | null;
  ignored: boolean | null;
  availabilityStatus: string | null;
  available: boolean;
  baseCostCents: number | null;
  /** A separately approved operator image mapping, never sourced from the provider read. */
  manualImagePath: string | null;
}>;

export type ManagedCatalogItem = Readonly<{
  localItemId: string;
  kind: string;
  category: string;
  title: string;
  description: string;
  priceCents: number;
  shippingCents: number;
  visibleToAll: boolean;
  printfulPublished: boolean;
  purchaseBlocked: boolean;
  imagePath: string | null;
}>;

export type ManagedCatalogProduct = Readonly<{
  storeId: string;
  productId: CatalogId;
  item: ManagedCatalogItem;
  variants: readonly ManagedCatalogVariant[];
  revision: string;
}>;

export type CatalogPriceApprovalRead = Readonly<{
  /** Revision of the private approval record set read with this approval. */
  revision: string | null;
  approval: ManualBaseCostApproval | null;
}>;

export type CatalogCommitResult = "committed" | "stale" | "product-conflict" | "variant-conflict";

export type CatalogCommit = Readonly<{
  expectedRevision: string | null;
  /** Undefined means approval data was not read and need not be compared. */
  expectedApprovalRevision?: string | null;
  next: ManagedCatalogProduct;
}>;

/**
 * Persistence contract only. A future database adapter must implement this as one
 * atomic CAS/upsert under private service access; this slice intentionally provides
 * no SQL or database implementation.
 */
export interface CatalogRepository {
  readManagedProduct(storeId: string, productId: CatalogId): Promise<ManagedCatalogProduct | null>;
  readManualBaseCostApproval(
    storeId: string,
    productId: CatalogId,
    variantIds: readonly CatalogId[],
  ): Promise<CatalogPriceApprovalRead>;
  commitManagedProduct(commit: CatalogCommit): Promise<CatalogCommitResult>;
}

export type CatalogSyncResult =
  | { status: "created" | "refreshed"; itemId: string; variantCount: number; availableVariantCount: number }
  | { status: "needs_manual_price_confirmation" }
  | { status: "no_available_variants" }
  | { status: "invalid_product_id" | "invalid_snapshot" | "invalid_existing_state" | "invalid_price_approval" }
  | { status: "provider_failed" | "repository_failed" | "stale_write" | "product_conflict" | "variant_conflict" };

type NormalizedProviderVariant = Readonly<{
  externalVariantId: CatalogId;
  name: string;
  catalogVariantId: CatalogId | null;
  synced: boolean | null;
  ignored: boolean | null;
  availabilityStatus: string | null;
}>;

type NormalizedSnapshot = Readonly<{
  storeId: typeof EXPECTED_PRINTFUL_STORE_ID;
  productId: CatalogId;
  productName: string;
  productIgnored: boolean | null;
  variants: readonly NormalizedProviderVariant[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > maximum || CONTROL_CHARACTERS.test(text)) return null;
  return text;
}

function isLocalImagePath(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && LOCAL_IMAGE_PATH_PATTERN.test(value));
}

function parseNullableCatalogId(value: unknown): CatalogId | null {
  if (value === null || value === undefined) return null;
  return parseCatalogId(value);
}

function parseNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") throw new Error("Catalog boolean field is malformed.");
  return value;
}

function parseSnapshot(
  raw: CompleteCatalogSnapshot,
  requestedProductId: CatalogId,
): NormalizedSnapshot | null {
  if (!isRecord(raw) || raw.storeId !== EXPECTED_PRINTFUL_STORE_ID || raw.completeness !== "complete") {
    return null;
  }

  let productId: CatalogId;
  try {
    productId = parseCatalogId(raw.productId);
  } catch {
    return null;
  }
  if (productId !== requestedProductId) return null;

  const productName = boundedText(raw.productName, 120);
  if (!productName) return null;
  let productIgnored: boolean | null;
  try {
    productIgnored = parseNullableBoolean(raw.productIgnored);
  } catch {
    return null;
  }
  if (!Array.isArray(raw.variants) || raw.variants.length > PRINTFUL_CATALOG_MAX_VARIANTS) return null;
  if (
    !Number.isSafeInteger(raw.expectedVariantCount) ||
    !Number.isSafeInteger(raw.observedVariantCount) ||
    raw.expectedVariantCount !== raw.variants.length ||
    raw.observedVariantCount !== raw.variants.length
  ) {
    return null;
  }

  const variants: NormalizedProviderVariant[] = [];
  const ids = new Set<string>();
  try {
    for (const value of raw.variants) {
      if (!isRecord(value)) return null;
      const externalVariantId = parseCatalogId(value.externalVariantId);
      const name = boundedText(value.name, 200);
      if (!name || ids.has(externalVariantId)) return null;
      const catalogVariantId = parseNullableCatalogId(value.catalogVariantId);
      const synced = parseNullableBoolean(value.synced);
      const ignored = parseNullableBoolean(value.ignored);
      const availabilityStatus = value.availabilityStatus === null || value.availabilityStatus === undefined
        ? null
        : boundedText(value.availabilityStatus, 64, true);
      if (value.availabilityStatus !== null && value.availabilityStatus !== undefined && availabilityStatus === null) {
        return null;
      }
      ids.add(externalVariantId);
      variants.push({
        externalVariantId,
        name,
        catalogVariantId,
        synced,
        ignored,
        availabilityStatus,
      });
    }
  } catch {
    return null;
  }

  return {
    storeId: EXPECTED_PRINTFUL_STORE_ID,
    productId,
    productName,
    productIgnored,
    variants,
  };
}

function providerAvailable(product: NormalizedSnapshot, variant: NormalizedProviderVariant): boolean {
  return product.productIgnored === false &&
    variant.catalogVariantId !== null &&
    variant.synced === true &&
    variant.ignored === false &&
    variant.availabilityStatus === "active";
}

function parseStoredProduct(
  value: ManagedCatalogProduct | null,
  storeId: string,
  productId: CatalogId,
): ManagedCatalogProduct | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || value.storeId !== storeId) return undefined;

  let parsedProductId: CatalogId;
  try {
    parsedProductId = parseCatalogId(value.productId);
  } catch {
    return undefined;
  }
  if (parsedProductId !== productId || !boundedText(value.revision, 120)) return undefined;
  if (!isRecord(value.item) || !Array.isArray(value.variants) || value.variants.length > PRINTFUL_CATALOG_MAX_STORED_VARIANTS) {
    return undefined;
  }

  const item = value.item;
  const localItemId = boundedText(item.localItemId, 80);
  const title = boundedText(item.title, 120, true);
  const description = boundedText(item.description, 4_000, true);
  if (
    !localItemId || title === null || description === null || typeof item.kind !== "string" ||
    typeof item.category !== "string" || !Number.isSafeInteger(item.priceCents) ||
    Number(item.priceCents) < 100 || Number(item.priceCents) > MAX_ITEM_PRICE_CENTS ||
    !Number.isSafeInteger(item.shippingCents) || Number(item.shippingCents) < 0 ||
    Number(item.shippingCents) > MAX_SHIPPING_CENTS || typeof item.visibleToAll !== "boolean" ||
    typeof item.printfulPublished !== "boolean" || typeof item.purchaseBlocked !== "boolean" ||
    !isLocalImagePath(item.imagePath)
  ) {
    return undefined;
  }

  const localIds = new Set<string>();
  const externalIds = new Set<string>();
  const variants: ManagedCatalogVariant[] = [];
  try {
    for (const candidate of value.variants) {
      if (!isRecord(candidate)) return undefined;
      const localVariantId = boundedText(candidate.localVariantId, 80);
      const externalVariantId = parseCatalogId(candidate.externalVariantId);
      const providerName = boundedText(candidate.providerName, 200);
      const catalogVariantId = parseNullableCatalogId(candidate.catalogVariantId);
      const synced = parseNullableBoolean(candidate.synced);
      const ignored = parseNullableBoolean(candidate.ignored);
      const availabilityStatus = candidate.availabilityStatus === null
        ? null
        : boundedText(candidate.availabilityStatus, 64, true);
      if (
        !localVariantId || !providerName || typeof candidate.available !== "boolean" ||
        !(candidate.baseCostCents === null || (
          Number.isSafeInteger(candidate.baseCostCents) && Number(candidate.baseCostCents) >= 1 &&
          Number(candidate.baseCostCents) <= MAX_BASE_COST_CENTS
        )) ||
        !isLocalImagePath(candidate.manualImagePath) ||
        localIds.has(localVariantId) || externalIds.has(externalVariantId) ||
        (candidate.availabilityStatus !== null && availabilityStatus === null)
      ) {
        return undefined;
      }
      localIds.add(localVariantId);
      externalIds.add(externalVariantId);
      variants.push({
        localVariantId,
        externalVariantId,
        providerName,
        catalogVariantId,
        synced,
        ignored,
        availabilityStatus,
        available: candidate.available,
        baseCostCents: candidate.baseCostCents as number | null,
        manualImagePath: candidate.manualImagePath as string | null,
      });
    }
  } catch {
    return undefined;
  }

  return {
    storeId,
    productId,
    item: {
      localItemId,
      kind: item.kind,
      category: item.category,
      title,
      description,
      priceCents: Number(item.priceCents),
      shippingCents: Number(item.shippingCents),
      visibleToAll: item.visibleToAll,
      printfulPublished: item.printfulPublished,
      purchaseBlocked: item.purchaseBlocked,
      imagePath: item.imagePath as string | null,
    },
    variants,
    revision: value.revision as string,
  };
}

function parseManualApproval(
  value: ManualBaseCostApproval | null,
  storeId: string,
  productId: CatalogId,
  requestedVariantIds: readonly CatalogId[],
): { valid: true; revision: string | null; costs: ReadonlyMap<string, number> } | { valid: false } {
  if (value === null) return { valid: true, revision: null, costs: new Map() };
  if (
    !isRecord(value) || !boundedText(value.revision, 120) || value.storeId !== storeId ||
    value.productId !== productId || value.currency !== "USD" ||
    value.source !== "operator-confirmed-manual" || value.providerVerified !== false ||
    !Array.isArray(value.costs) || value.costs.length > PRINTFUL_CATALOG_MAX_VARIANTS
  ) {
    return { valid: false };
  }

  const requested = new Set(requestedVariantIds);
  const costs = new Map<string, number>();
  for (const cost of value.costs) {
    if (!isRecord(cost)) return { valid: false };
    let variantId: CatalogId;
    try {
      variantId = parseCatalogId(cost.variantId);
    } catch {
      return { valid: false };
    }
    if (
      !requested.has(variantId) || costs.has(variantId) ||
      !Number.isSafeInteger(cost.baseCostCents) || Number(cost.baseCostCents) < 1 ||
      Number(cost.baseCostCents) > MAX_BASE_COST_CENTS
    ) {
      return { valid: false };
    }
    costs.set(variantId, Number(cost.baseCostCents));
  }
  return { valid: true, revision: value.revision, costs };
}

function makeLocalItemId(): string {
  return randomUUID();
}

function makeLocalVariantId(): string {
  return randomUUID();
}

function newItem(snapshot: NormalizedSnapshot, priceCents: number): ManagedCatalogItem {
  return {
    localItemId: makeLocalItemId(),
    kind: "preview",
    category: "gear",
    title: snapshot.productName,
    description: "",
    priceCents,
    shippingCents: 0,
    visibleToAll: false,
    printfulPublished: false,
    purchaseBlocked: true,
    imagePath: null,
  };
}

function withProviderFacts(
  snapshot: NormalizedSnapshot,
  existing: ManagedCatalogProduct | null,
  approvalCosts: ReadonlyMap<string, number>,
  initialPriceCents: number | null,
): ManagedCatalogProduct {
  const existingVariants = new Map((existing?.variants ?? []).map((variant) => [variant.externalVariantId, variant]));
  const snapshotVariants = new Map(snapshot.variants.map((variant) => [variant.externalVariantId, variant]));
  const allIds = new Set([...existingVariants.keys(), ...snapshotVariants.keys()]);
  const variants: ManagedCatalogVariant[] = [];

  for (const externalVariantId of allIds) {
    const previous = existingVariants.get(externalVariantId);
    const observed = snapshotVariants.get(externalVariantId);
    if (!observed) {
      variants.push({ ...previous!, available: false, availabilityStatus: "missing" });
      continue;
    }

    const baseCostCents = previous?.baseCostCents ?? approvalCosts.get(externalVariantId) ?? null;
    variants.push({
      localVariantId: previous?.localVariantId ?? makeLocalVariantId(),
      externalVariantId,
      providerName: observed.name,
      catalogVariantId: observed.catalogVariantId,
      synced: observed.synced,
      ignored: observed.ignored,
      availabilityStatus: observed.availabilityStatus,
      available: providerAvailable(snapshot, observed) && baseCostCents !== null,
      baseCostCents,
      manualImagePath: previous?.manualImagePath ?? null,
    });
  }

  const item = existing
    ? {
        ...existing.item,
        // These are catalog invariants; seller-controlled copy, image, price,
        // shipping, visibility, and publication are preserved on refresh.
        kind: "preview",
        category: "gear",
        purchaseBlocked: true,
      }
    : newItem(snapshot, initialPriceCents!);

  return {
    storeId: EXPECTED_PRINTFUL_STORE_ID,
    productId: snapshot.productId,
    item,
    variants,
    revision: randomUUID(),
  };
}

function validateApprovalForInitialImport(
  approval: ReturnType<typeof parseManualApproval>,
  requiredVariantIds: readonly CatalogId[],
): { valid: true; priceCents: number } | { valid: false } {
  if (!approval.valid || requiredVariantIds.length === 0) return { valid: false };
  const costs = requiredVariantIds.map((id) => approval.costs.get(id));
  if (costs.some((cost) => cost === undefined)) return { valid: false };
  const minimum = Math.min(...costs as number[]);
  const priceCents = minimum + PRINTFUL_MARKUP_CENTS;
  if (priceCents < 100 || priceCents > MAX_ITEM_PRICE_CENTS) return { valid: false };
  return { valid: true, priceCents };
}

/**
 * Reconcile one server-provided complete snapshot. This function never accepts
 * FormData or provider responses directly from a browser. No catalog persistence
 * adapter or application route is included in this slice.
 */
export async function reconcileCatalogProduct(
  productIdInput: unknown,
  provider: CompleteCatalogProvider,
  repository: CatalogRepository,
): Promise<CatalogSyncResult> {
  let productId: CatalogId;
  try {
    productId = parseCatalogId(productIdInput);
  } catch {
    return { status: "invalid_product_id" };
  }

  let storedValue: ManagedCatalogProduct | null;
  try {
    storedValue = await repository.readManagedProduct(EXPECTED_PRINTFUL_STORE_ID, productId);
  } catch {
    return { status: "repository_failed" };
  }
  const existing = parseStoredProduct(storedValue, EXPECTED_PRINTFUL_STORE_ID, productId);
  if (existing === undefined) return { status: "invalid_existing_state" };

  let rawSnapshot: CompleteCatalogSnapshot;
  try {
    rawSnapshot = await provider.readCompleteProduct(productId);
  } catch {
    return { status: "provider_failed" };
  }
  const snapshot = parseSnapshot(rawSnapshot, productId);
  if (!snapshot) return { status: "invalid_snapshot" };
  if (snapshot.variants.length === 0 && !existing) return { status: "no_available_variants" };

  const currentVariants = new Map((existing?.variants ?? []).map((variant) => [variant.externalVariantId, variant]));
  const providerActiveVariants = snapshot.variants.filter((variant) => providerAvailable(snapshot, variant));
  if (providerActiveVariants.length === 0 && !existing) return { status: "no_available_variants" };
  const variantsNeedingApproval = existing
    ? providerActiveVariants
        .filter((variant) => !currentVariants.get(variant.externalVariantId)?.baseCostCents)
        .map((variant) => variant.externalVariantId)
    : providerActiveVariants.map((variant) => variant.externalVariantId);

  let priceRead: CatalogPriceApprovalRead = { revision: null, approval: null };
  const approvalReadRequired = variantsNeedingApproval.length > 0;
  if (approvalReadRequired) {
    try {
      priceRead = await repository.readManualBaseCostApproval(
        EXPECTED_PRINTFUL_STORE_ID,
        productId,
        variantsNeedingApproval,
      );
    } catch {
      return { status: "repository_failed" };
    }
  }
  const parsedApproval = parseManualApproval(
    priceRead.approval,
    EXPECTED_PRINTFUL_STORE_ID,
    productId,
    variantsNeedingApproval,
  );
  if (!parsedApproval.valid || (priceRead.approval && parsedApproval.revision !== priceRead.approval.revision)) {
    return { status: "invalid_price_approval" };
  }

  let initialPriceCents: number | null = null;
  if (!existing) {
    const approval = validateApprovalForInitialImport(parsedApproval, providerActiveVariants.map((variant) => variant.externalVariantId));
    if (!approval.valid) return { status: "needs_manual_price_confirmation" };
    initialPriceCents = approval.priceCents;
  }

  if ((existing?.variants.length ?? 0) + snapshot.variants.filter((variant) => !currentVariants.has(variant.externalVariantId)).length > PRINTFUL_CATALOG_MAX_STORED_VARIANTS) {
    return { status: "invalid_snapshot" };
  }

  const next = withProviderFacts(snapshot, existing, parsedApproval.costs, initialPriceCents);
  let commitResult: CatalogCommitResult;
  try {
    commitResult = await repository.commitManagedProduct({
      expectedRevision: existing?.revision ?? null,
      ...(approvalReadRequired ? { expectedApprovalRevision: priceRead.revision } : {}),
      next,
    });
  } catch {
    return { status: "repository_failed" };
  }

  if (commitResult === "stale") return { status: "stale_write" };
  if (commitResult === "product-conflict") return { status: "product_conflict" };
  if (commitResult === "variant-conflict") return { status: "variant_conflict" };
  if (commitResult !== "committed") return { status: "repository_failed" };

  return {
    status: existing ? "refreshed" : "created",
    itemId: next.item.localItemId,
    variantCount: next.variants.length,
    availableVariantCount: next.variants.filter((variant) => variant.available).length,
  };
}

export type PublicCatalogPreview = Readonly<{
  id: string;
  kind: "preview";
  category: "gear";
  title: string;
  description: string;
  priceCents: number;
  shippingCents: number;
  visibleToAll: boolean;
  published: boolean;
  imagePath: string | null;
}>;

/** Safe value projection for a future public display; it is not wired to the DB view. */
export function toPublicCatalogPreview(product: ManagedCatalogProduct): PublicCatalogPreview {
  return {
    id: product.item.localItemId,
    kind: "preview",
    category: "gear",
    title: product.item.title,
    description: product.item.description,
    priceCents: product.item.priceCents,
    shippingCents: product.item.shippingCents,
    visibleToAll: product.item.visibleToAll,
    published: product.item.printfulPublished,
    imagePath: isLocalImagePath(product.item.imagePath) ? product.item.imagePath : null,
  };
}
