import "server-only";
import {
  EXPECTED_PRINTFUL_STORE_ID,
  PRINTFUL_CATALOG_MAX_VARIANTS,
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
  type PublicCatalogPreview,
} from "./catalog";

export const PRINTFUL_STORE_DRY_RUN_PAGE_SIZE = 50;
export const PRINTFUL_STORE_DRY_RUN_MAX_PRODUCTS = 2_000;
export const PRINTFUL_STORE_DRY_RUN_MAX_PAGES = 40;

const MAX_PRODUCT_NAME_LENGTH = 200;
const MAX_VARIANT_NAME_LENGTH = 200;
const MAX_STATUS_LENGTH = 64;

/** Synthetic-only input. This contract is not implemented by the HTTP reader. */
export type SyntheticPrintfulStoreSource = Readonly<{
  sourceKind: "synthetic-fake-provider";
  requestedStoreId: unknown;
  readProductsPage(offset: number, limit: number, status: "all"): Promise<unknown>;
  readProduct(productId: CatalogId): Promise<unknown>;
}>;

export type PrintfulCatalogPreviewItem = Readonly<{
  item: PublicCatalogPreview & { purchaseBlocked: true };
  variants: readonly Readonly<{
    localId: string;
    name: string;
    available: boolean;
    manualImagePath: string | null;
  }>[];
}>;

export type PrintfulStoreDryRunResult =
  | {
      status: "simulated_preview";
      evidence: "synthetic_fixture_consistent_pagination_only";
      pageCount: number;
      productCount: number;
      detailReadCount: number;
      createdOrRefreshedCount: number;
      needsManualPriceCount: number;
      noAvailableVariantCount: number;
      retainedUnlistedProductCount: number;
      previewItems: readonly PrintfulCatalogPreviewItem[];
    }
  | {
      status: "rejected";
      reason:
        | "invalid_synthetic_source"
        | "list_read_failed"
        | "invalid_page"
        | "unstable_pagination"
        | "duplicate_product_id"
        | "detail_read_failed"
        | "detail_mismatch"
        | "duplicate_variant_id"
        | "reconciliation_failed";
      pageCount: number;
      detailReadCount: number;
    };

type ProductSummary = Readonly<{
  id: CatalogId;
  name: string;
  variantCount: number;
  syncedCount: number;
  ignored: boolean | null;
}>;

type ValidatedPage = Readonly<{
  offset: number;
  limit: number;
  total: number;
  products: readonly ProductSummary[];
}>;

type ValidatedDetail = Readonly<{
  snapshot: CompleteCatalogSnapshot;
  productId: CatalogId;
  variants: readonly Readonly<{
    id: CatalogId;
    parentProductId: CatalogId | null;
    name: string;
  }>[];
}>;

type DryRunRejectionReason = Extract<PrintfulStoreDryRunResult, { status: "rejected" }> extends infer Rejected
  ? Rejected extends { reason: infer Reason }
    ? Reason
    : never
  : never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readId(value: unknown): CatalogId | null {
  try {
    return parseCatalogId(value);
  } catch {
    return null;
  }
}

function readCount(value: unknown, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : null;
}

function readText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

function readOptionalBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "boolean" ? value : undefined;
}

function validateSummary(value: unknown): ProductSummary | null {
  if (!isRecord(value)) return null;
  const id = readId(value.id);
  const name = readText(value.name, MAX_PRODUCT_NAME_LENGTH);
  const variantCount = readCount(value.variants, PRINTFUL_CATALOG_MAX_VARIANTS);
  const syncedCount = readCount(value.synced, PRINTFUL_CATALOG_MAX_VARIANTS);
  const ignored = readOptionalBoolean(value.is_ignored);
  if (!id || !name || variantCount === null || syncedCount === null || syncedCount > variantCount || ignored === undefined) {
    return null;
  }
  return { id, name, variantCount, syncedCount, ignored };
}

function validatePage(value: unknown, requestedOffset: number, requestedLimit: number): ValidatedPage | null {
  if (!isRecord(value) || value.status !== "synthetic_page" || value.requestedStoreId !== EXPECTED_PRINTFUL_STORE_ID) {
    return null;
  }
  const offset = readCount(value.offset, PRINTFUL_STORE_DRY_RUN_MAX_PRODUCTS);
  const limit = readCount(value.limit, requestedLimit);
  const total = readCount(value.total, PRINTFUL_STORE_DRY_RUN_MAX_PRODUCTS);
  if (!Array.isArray(value.products) || offset !== requestedOffset || limit !== requestedLimit || total === null) {
    return null;
  }
  const expectedCount = total === 0 ? 0 : Math.min(requestedLimit, Math.max(0, total - requestedOffset));
  if (value.products.length !== expectedCount) return null;
  const products: ProductSummary[] = [];
  for (const raw of value.products) {
    const product = validateSummary(raw);
    if (!product) return null;
    products.push(product);
  }
  return { offset, limit, total, products };
}

function validateDetail(value: unknown, summary: ProductSummary): ValidatedDetail | null {
  if (!isRecord(value) || value.status !== "synthetic_detail" || value.requestedStoreId !== EXPECTED_PRINTFUL_STORE_ID) {
    return null;
  }
  const product = value.sync_product;
  const rawVariants = value.sync_variants;
  if (!isRecord(product) || !Array.isArray(rawVariants)) return null;
  const productId = readId(product.id);
  const name = readText(product.name, MAX_PRODUCT_NAME_LENGTH);
  const ignored = readOptionalBoolean(product.is_ignored);
  const providerVariantCount = readCount(product.variants, PRINTFUL_CATALOG_MAX_VARIANTS);
  if (
    productId !== summary.id || name !== summary.name || ignored === undefined ||
    providerVariantCount !== summary.variantCount || rawVariants.length !== summary.variantCount ||
    (summary.ignored !== null && ignored !== null && summary.ignored !== ignored)
  ) return null;

  const variants: {
    id: CatalogId;
    parentProductId: CatalogId | null;
    name: string;
    catalogVariantId: CatalogId | null;
    synced: boolean;
    ignored: boolean | null;
    availabilityStatus: string | null;
  }[] = [];
  let syncedCount = 0;
  for (const rawVariant of rawVariants) {
    if (!isRecord(rawVariant)) return null;
    const id = readId(rawVariant.id);
    const parentProductId = rawVariant.sync_product_id === undefined || rawVariant.sync_product_id === null
      ? null
      : readId(rawVariant.sync_product_id);
    const variantName = readText(rawVariant.name, MAX_VARIANT_NAME_LENGTH);
    const catalogVariantId = rawVariant.variant_id === undefined || rawVariant.variant_id === null
      ? null
      : readId(rawVariant.variant_id);
    const synced = rawVariant.synced;
    const variantIgnored = readOptionalBoolean(rawVariant.is_ignored);
    const availabilityStatus = rawVariant.availability_status === undefined || rawVariant.availability_status === null
      ? null
      : readText(rawVariant.availability_status, MAX_STATUS_LENGTH);
    if (
      !id || !variantName || typeof synced !== "boolean" || variantIgnored === undefined ||
      (rawVariant.sync_product_id !== undefined && rawVariant.sync_product_id !== null && parentProductId === null) ||
      (parentProductId !== null && parentProductId !== productId) ||
      (rawVariant.variant_id !== undefined && rawVariant.variant_id !== null && !catalogVariantId) ||
      (rawVariant.availability_status !== undefined && rawVariant.availability_status !== null && availabilityStatus === null)
    ) return null;
    if (synced) syncedCount += 1;
    variants.push({ id, parentProductId, name: variantName, catalogVariantId, synced, ignored: variantIgnored, availabilityStatus });
  }
  if (syncedCount !== summary.syncedCount) return null;

  const snapshot: CompleteCatalogSnapshot = {
    storeId: EXPECTED_PRINTFUL_STORE_ID,
    productId,
    productName: name,
    productIgnored: ignored ?? summary.ignored,
    completeness: "complete",
    expectedVariantCount: rawVariants.length,
    observedVariantCount: rawVariants.length,
    variants: variants.map((variant) => ({
      externalVariantId: variant.id,
      name: variant.name,
      catalogVariantId: variant.catalogVariantId,
      synced: variant.synced,
      ignored: variant.ignored,
      availabilityStatus: variant.availabilityStatus,
    })),
  };
  return { snapshot, productId, variants };
}

class MemoryCatalogRepository implements CatalogRepository {
  private products: Map<string, ManagedCatalogProduct>;
  private approvals: Map<string, ManualBaseCostApproval>;

  constructor(products: readonly ManagedCatalogProduct[], approvals: readonly ManualBaseCostApproval[]) {
    this.products = new Map(products.map((product) => [this.productKey(product.storeId, product.productId), structuredClone(product)]));
    this.approvals = new Map(approvals.map((approval) => [this.productKey(approval.storeId, approval.productId), structuredClone(approval)]));
  }

  clone(): MemoryCatalogRepository {
    return new MemoryCatalogRepository([...this.products.values()], [...this.approvals.values()]);
  }

  listManagedProducts(): ManagedCatalogProduct[] {
    return [...this.products.values()].map((product) => structuredClone(product));
  }

  replaceWith(candidate: MemoryCatalogRepository): void {
    this.products = new Map(candidate.listManagedProducts().map((product) => [this.productKey(product.storeId, product.productId), product]));
  }

  async readManagedProduct(storeId: string, productId: CatalogId): Promise<ManagedCatalogProduct | null> {
    const value = this.products.get(this.productKey(storeId, productId));
    return value ? structuredClone(value) : null;
  }

  async readManualBaseCostApproval(
    storeId: string,
    productId: CatalogId,
    variantIds: readonly CatalogId[],
  ): Promise<CatalogPriceApprovalRead> {
    const approval = this.approvals.get(this.productKey(storeId, productId));
    const requested = new Set(variantIds);
    return {
      revision: approval?.revision ?? null,
      approval: approval
        ? { ...structuredClone(approval), costs: approval.costs.filter((cost) => requested.has(cost.variantId)) }
        : null,
    };
  }

  async commitManagedProduct(commit: CatalogCommit): Promise<CatalogCommitResult> {
    const key = this.productKey(commit.next.storeId, commit.next.productId);
    const current = this.products.get(key);
    if ((current?.revision ?? null) !== commit.expectedRevision) return "stale";
    const approval = this.approvals.get(key);
    if (commit.expectedApprovalRevision !== undefined && (approval?.revision ?? null) !== commit.expectedApprovalRevision) return "stale";

    for (const [otherKey, product] of this.products) {
      if (otherKey === key || product.storeId !== commit.next.storeId) continue;
      if (commit.next.variants.some((variant) => product.variants.some((other) => other.externalVariantId === variant.externalVariantId))) {
        return "variant-conflict";
      }
    }
    this.products.set(key, structuredClone(commit.next));
    return "committed";
  }

  private productKey(storeId: string, productId: CatalogId): string {
    return `${storeId}:${productId}`;
  }
}

function safePreviewItems(repository: MemoryCatalogRepository): PrintfulCatalogPreviewItem[] {
  return repository.listManagedProducts()
    .sort((a, b) => a.item.localItemId.localeCompare(b.item.localItemId))
    .map((product) => ({
      item: { ...toPublicCatalogPreview(product), purchaseBlocked: true },
      variants: product.variants.map((variant) => ({
        localId: variant.localVariantId,
        name: variant.providerName,
        available: variant.available,
        manualImagePath: variant.manualImagePath,
      })),
    }));
}

async function collectCatalog(source: SyntheticPrintfulStoreSource, pageSize: number): Promise<
  | { valid: true; pageCount: number; summaries: ProductSummary[]; details: ValidatedDetail[] }
  | { valid: false; reason: DryRunRejectionReason; pageCount: number; detailReadCount: number }
> {
  let offset = 0;
  let total: number | null = null;
  let pageCount = 0;
  const summaries: ProductSummary[] = [];
  const productIds = new Set<string>();

  while (true) {
    if (pageCount >= PRINTFUL_STORE_DRY_RUN_MAX_PAGES) {
      return { valid: false, reason: "unstable_pagination", pageCount, detailReadCount: 0 };
    }
    let rawPage: unknown;
    try {
      rawPage = await source.readProductsPage(offset, pageSize, "all");
    } catch {
      return { valid: false, reason: "list_read_failed", pageCount, detailReadCount: 0 };
    }
    const page = validatePage(rawPage, offset, pageSize);
    pageCount += 1;
    if (!page) return { valid: false, reason: "invalid_page", pageCount, detailReadCount: 0 };
    if (total === null) total = page.total;
    else if (page.total !== total) return { valid: false, reason: "unstable_pagination", pageCount, detailReadCount: 0 };

    for (const product of page.products) {
      if (productIds.has(product.id)) return { valid: false, reason: "duplicate_product_id", pageCount, detailReadCount: 0 };
      productIds.add(product.id);
      summaries.push(product);
    }
    if (summaries.length > PRINTFUL_STORE_DRY_RUN_MAX_PRODUCTS) {
      return { valid: false, reason: "invalid_page", pageCount, detailReadCount: 0 };
    }
    offset += page.products.length;
    if (page.total === 0 || offset === page.total) break;
    if (offset > page.total || page.products.length !== pageSize) {
      return { valid: false, reason: "unstable_pagination", pageCount, detailReadCount: 0 };
    }
  }
  if (total === null || summaries.length !== total) {
    return { valid: false, reason: "unstable_pagination", pageCount, detailReadCount: 0 };
  }

  const details: ValidatedDetail[] = [];
  const seenVariants = new Set<string>();
  for (const summary of summaries) {
    let rawDetail: unknown;
    try {
      rawDetail = await source.readProduct(summary.id);
    } catch {
      return { valid: false, reason: "detail_read_failed", pageCount, detailReadCount: details.length };
    }
    const detail = validateDetail(rawDetail, summary);
    if (!detail) return { valid: false, reason: "detail_mismatch", pageCount, detailReadCount: details.length + 1 };
    for (const variant of detail.variants) {
      if (seenVariants.has(variant.id)) {
        return { valid: false, reason: "duplicate_variant_id", pageCount, detailReadCount: details.length + 1 };
      }
      seenVariants.add(variant.id);
    }
    details.push(detail);
  }
  return { valid: true, pageCount, summaries, details };
}

/**
 * Full store read and import into an isolated in-memory preview. The only accepted
 * source is explicitly synthetic; the HTTP client returns unverified observations
 * and cannot be passed here. All pages and details validate before preview state is
 * cloned or any core reconciliation runs.
 */
export function createSyntheticPrintfulCatalogDryRun(
  initialProducts: readonly ManagedCatalogProduct[] = [],
  manualApprovals: readonly ManualBaseCostApproval[] = [],
  options: Readonly<{ pageSize?: number }> = {},
) {
  const pageSize = options.pageSize ?? PRINTFUL_STORE_DRY_RUN_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > PRINTFUL_STORE_DRY_RUN_PAGE_SIZE) {
    throw new Error("Synthetic dry-run page size is outside the supported bound.");
  }
  const repository = new MemoryCatalogRepository(initialProducts, manualApprovals);
  let queue = Promise.resolve();

  async function runSerial(source: SyntheticPrintfulStoreSource): Promise<PrintfulStoreDryRunResult> {
    if (
      !isRecord(source) || source.sourceKind !== "synthetic-fake-provider" ||
      source.requestedStoreId !== EXPECTED_PRINTFUL_STORE_ID ||
      typeof source.readProductsPage !== "function" || typeof source.readProduct !== "function"
    ) {
      return { status: "rejected", reason: "invalid_synthetic_source", pageCount: 0, detailReadCount: 0 };
    }

    const initialProducts = repository.listManagedProducts();
    const existingKeys = new Set(initialProducts.map((product) => product.productId));
    const collected = await collectCatalog(source, pageSize);
    if (!collected.valid) {
      return {
        status: "rejected",
        reason: collected.reason,
        pageCount: collected.pageCount,
        detailReadCount: collected.detailReadCount,
      };
    }

    const candidate = repository.clone();
    let createdOrRefreshedCount = 0;
    let needsManualPriceCount = 0;
    let noAvailableVariantCount = 0;
    for (const detail of collected.details) {
      const provider: CompleteCatalogProvider = {
        readCompleteProduct: async () => detail.snapshot,
      };
      const result = await reconcileCatalogProduct(detail.productId, provider, candidate);
      if (result.status === "created" || result.status === "refreshed") {
        createdOrRefreshedCount += 1;
      } else if (result.status === "needs_manual_price_confirmation") {
        needsManualPriceCount += 1;
      } else if (result.status === "no_available_variants") {
        noAvailableVariantCount += 1;
      } else {
        return {
          status: "rejected",
          reason: "reconciliation_failed",
          pageCount: collected.pageCount,
          detailReadCount: collected.details.length,
        };
      }
    }

    repository.replaceWith(candidate);
    const listedIds = new Set(collected.summaries.map((summary) => summary.id));
    const retainedUnlistedProductCount = [...existingKeys].filter((id) => !listedIds.has(id)).length;
    return {
      status: "simulated_preview",
      evidence: "synthetic_fixture_consistent_pagination_only",
      pageCount: collected.pageCount,
      productCount: collected.summaries.length,
      detailReadCount: collected.details.length,
      createdOrRefreshedCount,
      needsManualPriceCount,
      noAvailableVariantCount,
      retainedUnlistedProductCount,
      previewItems: safePreviewItems(repository),
    };
  }

  function run(source: SyntheticPrintfulStoreSource): Promise<PrintfulStoreDryRunResult> {
    // Serialize the entire read/preview transaction so a detail snapshot can never
    // be committed against a revision read after a newer overlapping preview.
    const current = queue.then(() => runSerial(source));
    queue = current.then(() => undefined, () => undefined);
    return current;
  }

  function preview(): readonly PrintfulCatalogPreviewItem[] {
    return safePreviewItems(repository);
  }

  return { run, preview };
}
