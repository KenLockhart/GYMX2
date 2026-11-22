import "server-only";
import { createHash } from "node:crypto";
import { EXPECTED_PRINTFUL_STORE_ID, parseCatalogId, type CatalogId } from "./catalog";

const PRINTFUL_ORIGIN = "https://api.printful.com";
const EXPECTED_STORE_NAME = "GYMX2";
const EXPECTED_STORE_TYPE = "native";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PRODUCTS = 500;
const MAX_VARIANTS_PER_PRODUCT = 100;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_CONFIG_DEPTH = 5;

export type PrintfulCatalogVariant = Readonly<{
  syncVariantId: CatalogId;
  externalId: string | null;
  catalogVariantId: CatalogId | null;
  name: string;
  color: string | null;
  size: string | null;
  synced: boolean;
  ignored: boolean | null;
  availabilityStatus: string | null;
  configurationFingerprint: string;
  configurationComplete: boolean;
  placementTypes: readonly string[];
  optionNames: readonly string[];
}>;

export type PrintfulCatalogProduct = Readonly<{
  syncProductId: CatalogId;
  name: string;
  ignored: boolean | null;
  syncedVariantCount: number;
  variants: readonly PrintfulCatalogVariant[];
}>;

export type CompletePrintfulStoreRead = Readonly<{
  storeId: typeof EXPECTED_PRINTFUL_STORE_ID;
  storeName: typeof EXPECTED_STORE_NAME;
  storeType: typeof EXPECTED_STORE_TYPE;
  completeness: "consistent_paginated_read";
  atomicProviderSnapshotProven: false;
  listTotal: number;
  pageCount: number;
  readStartedAt: string;
  readCompletedAt: string;
  observedAt: string;
  products: readonly PrintfulCatalogProduct[];
}>;

export type PrintfulStoreReadResult =
  | { status: "disabled" | "missing_credentials" | "missing_fetcher" | "provider_failed" }
  | { status: "complete"; snapshot: CompletePrintfulStoreRead };

export type PrintfulStoreReaderOptions = Readonly<{
  enabled?: boolean;
  token?: string;
  fetcher?: typeof fetch;
  pageSize?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown, maximum: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function readOptionalBoolean(value: unknown): boolean | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "boolean" ? value : undefined;
}

function readCatalogId(value: unknown): CatalogId | null {
  try {
    return parseCatalogId(value);
  } catch {
    return null;
  }
}

function readCount(value: unknown, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
    ? Number(value)
    : null;
}

function stableJsonValue(value: unknown, depth = 0): unknown | undefined {
  if (depth > MAX_CONFIG_DEPTH) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return readText(value, 4096, true) === null ? undefined : value;
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= 1_000_000_000 ? value : undefined;
  if (Array.isArray(value)) {
    if (value.length > 32) return undefined;
    const result = value.map((entry) => stableJsonValue(entry, depth + 1));
    return result.some((entry) => entry === undefined) ? undefined : result;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length > 32) return undefined;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (!readText(key, 64)) return undefined;
      const entry = stableJsonValue(value[key], depth + 1);
      if (entry === undefined) return undefined;
      result[key] = entry;
    }
    return result;
  }
  return undefined;
}

function parseConfiguration(raw: Record<string, unknown>): {
  fingerprint: string;
  complete: boolean;
  placementTypes: string[];
  optionNames: string[];
} {
  const files = raw.files;
  const options = raw.options;
  let complete = Array.isArray(files) && files.length > 0 && Array.isArray(options);
  let hasProductionFile = false;
  const canonicalFiles: Array<{ type: string; identity: string }> = [];
  const placementTypes: string[] = [];

  if (Array.isArray(files) && files.length <= 16) {
    for (const file of files) {
      if (!isRecord(file)) return { fingerprint: "", complete: false, placementTypes: [], optionNames: [] };
      const type = file.type === undefined || file.type === null ? "default" : readText(file.type, 100);
      if (!type) return { fingerprint: "", complete: false, placementTypes: [], optionNames: [] };
      placementTypes.push(type);
      if (type.toLowerCase() === "preview") continue;
      hasProductionFile = true;
      const stableFields = [
        "id", "type", "hash", "options", "placement", "position", "technique", "layers",
        "message", "stitch_count_tier",
      ] as const;
      const nonConfigurationMetadata = new Set([
        "url", "preview_url", "thumbnail_url", "filename", "mime_type", "size", "width", "height",
        "dpi", "bytes", "status", "created", "created_at", "updated_at", "is_active", "is_default",
        "visible", "is_temporary",
      ]);
      if (Object.keys(file).some((key) =>
        !stableFields.includes(key as (typeof stableFields)[number]) && !nonConfigurationMetadata.has(key))) {
        complete = false;
      }
      const canonicalFile: Record<string, unknown> = {};
      const fileId = file.id === undefined || file.id === null ? null : readCatalogId(file.id);
      const fileHash = file.hash === undefined || file.hash === null
        ? null
        : typeof file.hash === "string" && /^[0-9a-f]{32}$/i.test(file.hash) ? file.hash.toLowerCase() : null;
      if ((file.id !== undefined && file.id !== null && fileId === null) ||
        (file.hash !== undefined && file.hash !== null && fileHash === null) || (!fileId && !fileHash)) {
        complete = false;
      }
      if (fileId) canonicalFile.id = fileId;
      if (fileHash) canonicalFile.hash = fileHash;
      for (const key of ["type", "options", "placement", "position", "technique", "layers"] as const) {
        if (!(key in file)) continue;
        const value = stableJsonValue(file[key]);
        if (value === undefined) {
          complete = false;
          canonicalFile[key] = createHash("sha256").update(JSON.stringify(file[key])).digest("hex");
        } else {
          canonicalFile[key] = value;
        }
      }
      for (const [key, maximumLength] of [["message", 4096], ["stitch_count_tier", 100]] as const) {
        if (!(key in file)) continue;
        const value = file[key];
        const valid = value === null || (typeof value === "string" &&
          value.length <= maximumLength && !/[\u0000-\u001f\u007f]/.test(value));
        if (!valid) complete = false;
        canonicalFile[key] = valid ? value : createHash("sha256").update(JSON.stringify(value)).digest("hex");
      }
      canonicalFiles.push({
        type,
        identity: createHash("sha256").update(JSON.stringify(canonicalFile)).digest("hex"),
      });
    }
  } else if (Array.isArray(files)) {
    return { fingerprint: "", complete: false, placementTypes: [], optionNames: [] };
  }

  const canonicalOptions: Array<{ id: string; value: unknown }> = [];
  const optionNames: string[] = [];
  if (Array.isArray(options) && options.length <= 64) {
    for (const option of options) {
      if (!isRecord(option)) return { fingerprint: "", complete: false, placementTypes: [], optionNames: [] };
      const id = readText(option.id, 100);
      const canonical = stableJsonValue(option);
      if (!id || !("value" in option) || canonical === undefined) complete = false;
      canonicalOptions.push({ id: id ?? "invalid", value: canonical ?? createHash("sha256").update(JSON.stringify(option)).digest("hex") });
      if (id) optionNames.push(id);
    }
  } else if (Array.isArray(options)) {
    return { fingerprint: "", complete: false, placementTypes: [], optionNames: [] };
  }

  canonicalFiles.sort((a, b) => a.type.localeCompare(b.type) || a.identity.localeCompare(b.identity));
  canonicalOptions.sort((a, b) => a.id.localeCompare(b.id) || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)));
  const canonicalContext: Record<string, unknown> = {};
  for (const key of ["technique", "placement", "placements", "position", "layers"]) {
    if (!(key in raw)) continue;
    const value = stableJsonValue(raw[key]);
    if (value === undefined) complete = false;
    canonicalContext[key] = value ?? createHash("sha256").update(JSON.stringify(raw[key])).digest("hex");
  }
  complete = complete && hasProductionFile;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ files: canonicalFiles, options: canonicalOptions, context: canonicalContext }))
    .digest("hex");
  return {
    fingerprint,
    complete,
    placementTypes: [...new Set(placementTypes)].sort(),
    optionNames: [...new Set(optionNames)].sort(),
  };
}

function parseEnvelope(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || value.code !== 200 || !("result" in value)) return null;
  return value;
}

function parseSummary(value: unknown): {
  syncProductId: CatalogId;
  name: string;
  ignored: boolean | null;
  variants: number;
  synced: number;
} | null {
  if (!isRecord(value)) return null;
  const syncProductId = readCatalogId(value.id);
  const name = readText(value.name, 200);
  const variants = readCount(value.variants, MAX_VARIANTS_PER_PRODUCT);
  const synced = readCount(value.synced, MAX_VARIANTS_PER_PRODUCT);
  const ignored = readOptionalBoolean(value.is_ignored);
  if (!syncProductId || !name || variants === null || synced === null || synced > variants || ignored === undefined) return null;
  return { syncProductId, name, ignored, variants, synced };
}

async function readBoundedBody(response: Response): Promise<Uint8Array | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && (!/^(0|[1-9][0-9]*)$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function createPrintfulStoreCatalogReader(options: PrintfulStoreReaderOptions = {}) {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  async function getJson(path: string): Promise<unknown | null> {
    if (options.enabled !== true || typeof options.token !== "string" || !options.token.trim() || /[\r\n]/.test(options.token)) return null;
    if (typeof options.fetcher !== "function") return null;
    let response: Response;
    try {
      response = await options.fetcher(`${PRINTFUL_ORIGIN}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "X-PF-Store-Id": EXPECTED_PRINTFUL_STORE_ID,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return null;
    }
    if (!response.ok || response.status !== 200 || response.redirected) return null;
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) return null;
    const bytes = await readBoundedBody(response);
    if (!bytes) return null;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  function unavailableStatus(): "disabled" | "missing_credentials" | "missing_fetcher" | null {
    if (options.enabled !== true) return "disabled";
    if (typeof options.token !== "string" || !options.token.trim() || /[\r\n]/.test(options.token)) return "missing_credentials";
    if (typeof options.fetcher !== "function") return "missing_fetcher";
    return null;
  }

  return {
    async readCompleteStore(): Promise<PrintfulStoreReadResult> {
      const unavailable = unavailableStatus();
      if (unavailable) return { status: unavailable };
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > DEFAULT_PAGE_SIZE) return { status: "provider_failed" };
      const readStartedAt = new Date().toISOString();

      const identityEnvelope = parseEnvelope(await getJson("/stores"));
      if (!identityEnvelope || !Array.isArray(identityEnvelope.result)) return { status: "provider_failed" };
      const storeMatches = identityEnvelope.result.filter((entry) => {
        if (!isRecord(entry)) return false;
        return readCatalogId(entry.id) === EXPECTED_PRINTFUL_STORE_ID &&
          entry.name === EXPECTED_STORE_NAME && entry.type === EXPECTED_STORE_TYPE;
      });
      if (storeMatches.length !== 1) return { status: "provider_failed" };

      const summaries: NonNullable<ReturnType<typeof parseSummary>>[] = [];
      const productIds = new Set<string>();
      let total: number | null = null;
      let offset = 0;
      let pageCount = 0;
      while (total === null || offset < total) {
        if (pageCount >= 10) return { status: "provider_failed" };
        const pageEnvelope = parseEnvelope(await getJson(`/store/products?offset=${offset}&limit=${pageSize}&status=all`));
        if (!pageEnvelope || !Array.isArray(pageEnvelope.result) || !isRecord(pageEnvelope.paging)) return { status: "provider_failed" };
        const pageTotal = readCount(pageEnvelope.paging.total, MAX_PRODUCTS);
        const pageOffset = readCount(pageEnvelope.paging.offset, MAX_PRODUCTS);
        const pageLimit = readCount(pageEnvelope.paging.limit, DEFAULT_PAGE_SIZE);
        if (pageTotal === null || pageOffset !== offset || pageLimit !== pageSize || (total !== null && total !== pageTotal)) return { status: "provider_failed" };
        if (total === null) total = pageTotal;
        const expectedRows = Math.min(pageSize, total - offset);
        if (pageEnvelope.result.length !== expectedRows) return { status: "provider_failed" };
        for (const value of pageEnvelope.result) {
          const summary = parseSummary(value);
          if (!summary || productIds.has(summary.syncProductId)) return { status: "provider_failed" };
          productIds.add(summary.syncProductId);
          summaries.push(summary);
        }
        offset += expectedRows;
        pageCount += 1;
        if (total === 0) break;
      }
      if (summaries.length !== total) return { status: "provider_failed" };

      const products: PrintfulCatalogProduct[] = [];
      const variantIds = new Set<string>();
      for (const summary of summaries) {
        const detailEnvelope = parseEnvelope(await getJson(`/store/products/${summary.syncProductId}`));
        if (!detailEnvelope || !isRecord(detailEnvelope.result)) return { status: "provider_failed" };
        const detail = detailEnvelope.result;
        if (!isRecord(detail.sync_product) || !Array.isArray(detail.sync_variants)) return { status: "provider_failed" };
        const product = detail.sync_product;
        const productId = readCatalogId(product.id);
        const productName = readText(product.name, 200);
        const variantCount = readCount(product.variants, MAX_VARIANTS_PER_PRODUCT);
        const syncedVariantCount = readCount(product.synced, MAX_VARIANTS_PER_PRODUCT);
        const productIgnored = readOptionalBoolean(product.is_ignored);
        if (
          productId !== summary.syncProductId || productName !== summary.name ||
          variantCount !== summary.variants || syncedVariantCount !== summary.synced ||
          detail.sync_variants.length !== summary.variants ||
          productIgnored === undefined || productIgnored !== summary.ignored || detail.sync_variants.length > MAX_VARIANTS_PER_PRODUCT
        ) return { status: "provider_failed" };
        const variants: PrintfulCatalogVariant[] = [];
        let syncedCount = 0;
        for (const rawVariant of detail.sync_variants) {
          if (!isRecord(rawVariant)) return { status: "provider_failed" };
          const syncVariantId = readCatalogId(rawVariant.id);
          const externalId = rawVariant.external_id === undefined || rawVariant.external_id === null
            ? null
            : readText(rawVariant.external_id, 128);
          const parentId = rawVariant.sync_product_id === undefined || rawVariant.sync_product_id === null
            ? null
            : readCatalogId(rawVariant.sync_product_id);
          const catalogVariantId = rawVariant.variant_id === undefined || rawVariant.variant_id === null
            ? null
            : readCatalogId(rawVariant.variant_id);
          const name = readText(rawVariant.name, 200);
          const color = rawVariant.color === undefined || rawVariant.color === null ? null : readText(rawVariant.color, 80);
          const size = rawVariant.size === undefined || rawVariant.size === null ? null : readText(rawVariant.size, 80);
          const synced = rawVariant.synced;
          const ignored = readOptionalBoolean(rawVariant.is_ignored);
          const availabilityStatus = rawVariant.availability_status === undefined || rawVariant.availability_status === null
            ? null
            : readText(rawVariant.availability_status, 64, true);
          const configuration = parseConfiguration(rawVariant);
          const configurationFingerprint = createHash("sha256")
            .update(JSON.stringify({ parsed: configuration.fingerprint, catalogVariantId }))
            .digest("hex");
          if (
            !syncVariantId || variantIds.has(syncVariantId) || !name || typeof synced !== "boolean" || ignored === undefined ||
            (rawVariant.external_id !== undefined && rawVariant.external_id !== null && !externalId) ||
            (rawVariant.sync_product_id !== undefined && rawVariant.sync_product_id !== null && parentId === null) ||
            (parentId !== null && parentId !== summary.syncProductId) ||
            (rawVariant.variant_id !== undefined && rawVariant.variant_id !== null && catalogVariantId === null) ||
            (rawVariant.color !== undefined && rawVariant.color !== null && color === null) ||
            (rawVariant.size !== undefined && rawVariant.size !== null && size === null) ||
            (rawVariant.availability_status !== undefined && rawVariant.availability_status !== null && availabilityStatus === null) ||
            !configuration.fingerprint
          ) return { status: "provider_failed" };
          variantIds.add(syncVariantId);
          if (synced) syncedCount += 1;
          variants.push({
            syncVariantId,
            externalId,
            catalogVariantId,
            name,
            color,
            size,
            synced,
            ignored,
            availabilityStatus,
            configurationFingerprint,
            configurationComplete: configuration.complete && catalogVariantId !== null,
            placementTypes: configuration.placementTypes,
            optionNames: configuration.optionNames,
          });
        }
        if (syncedCount !== summary.synced) return { status: "provider_failed" };
        products.push({
          syncProductId: summary.syncProductId,
          name: summary.name,
          ignored: productIgnored,
          syncedVariantCount,
          variants,
        });
      }

      // A final bounded listing catches products/count/state drift during detail collection.
      const finalSummaries: NonNullable<ReturnType<typeof parseSummary>>[] = [];
      const finalIds = new Set<string>();
      let finalTotal: number | null = null;
      let finalOffset = 0;
      let finalPageCount = 0;
      while (finalTotal === null || finalOffset < finalTotal) {
        if (finalPageCount >= 10) return { status: "provider_failed" };
        const pageEnvelope = parseEnvelope(await getJson(`/store/products?offset=${finalOffset}&limit=${pageSize}&status=all`));
        if (!pageEnvelope || !Array.isArray(pageEnvelope.result) || !isRecord(pageEnvelope.paging)) return { status: "provider_failed" };
        const pageTotal = readCount(pageEnvelope.paging.total, MAX_PRODUCTS);
        const pageOffset = readCount(pageEnvelope.paging.offset, MAX_PRODUCTS);
        const pageLimit = readCount(pageEnvelope.paging.limit, DEFAULT_PAGE_SIZE);
        if (pageTotal === null || pageOffset !== finalOffset || pageLimit !== pageSize ||
          (finalTotal !== null && finalTotal !== pageTotal) || pageTotal !== total) return { status: "provider_failed" };
        if (finalTotal === null) finalTotal = pageTotal;
        const expectedRows = Math.min(pageSize, finalTotal - finalOffset);
        if (pageEnvelope.result.length !== expectedRows) return { status: "provider_failed" };
        for (const value of pageEnvelope.result) {
          const summary = parseSummary(value);
          if (!summary || finalIds.has(summary.syncProductId)) return { status: "provider_failed" };
          finalIds.add(summary.syncProductId);
          finalSummaries.push(summary);
        }
        finalOffset += expectedRows;
        finalPageCount += 1;
        if (finalTotal === 0) break;
      }
      if (finalSummaries.length !== summaries.length) return { status: "provider_failed" };
      const initialById = new Map(summaries.map((summary) => [summary.syncProductId, summary]));
      for (const final of finalSummaries) {
        const initial = initialById.get(final.syncProductId);
        if (!initial || final.name !== initial.name || final.variants !== initial.variants ||
          final.synced !== initial.synced || final.ignored !== initial.ignored) return { status: "provider_failed" };
      }

      const readCompletedAt = new Date().toISOString();
      return {
        status: "complete",
        snapshot: {
          storeId: EXPECTED_PRINTFUL_STORE_ID,
          storeName: EXPECTED_STORE_NAME,
          storeType: EXPECTED_STORE_TYPE,
          completeness: "consistent_paginated_read",
          atomicProviderSnapshotProven: false,
          listTotal: summaries.length,
          pageCount,
          readStartedAt,
          readCompletedAt,
          observedAt: readCompletedAt,
          products,
        },
      };
    },
  };
}

export function getPrintfulCatalogSyncConfig(environment: NodeJS.ProcessEnv = process.env):
  | { enabled: false; reason: "disabled" | "missing_credentials" | "wrong_store" }
  | { enabled: true; token: string; storeId: typeof EXPECTED_PRINTFUL_STORE_ID } {
  if (environment.PRINTFUL_CATALOG_SYNC_ENABLED !== "true") return { enabled: false, reason: "disabled" };
  const token = environment.PRINTFUL_ACCESS_TOKEN?.trim();
  if (!token || /[\r\n]/.test(token)) return { enabled: false, reason: "missing_credentials" };
  if (environment.PRINTFUL_STORE_ID !== EXPECTED_PRINTFUL_STORE_ID) return { enabled: false, reason: "wrong_store" };
  return { enabled: true, token, storeId: EXPECTED_PRINTFUL_STORE_ID };
}
