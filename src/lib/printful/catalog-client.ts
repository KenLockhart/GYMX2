import "server-only";
import {
  EXPECTED_PRINTFUL_STORE_ID,
  PRINTFUL_CATALOG_MAX_VARIANTS,
  parseCatalogId,
  type CatalogId,
} from "./catalog";

const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_STATUS_LENGTH = 64;
const PRINTFUL_ORIGIN = "https://api.printful.com";

export type PrintfulCatalogVariantObservation = Readonly<{
  externalVariantId: CatalogId;
  parentProductId: CatalogId | null;
  name: string;
  color: string | null;
  size: string | null;
  catalogVariantId: CatalogId | null;
  synced: boolean | null;
  ignored: boolean | null;
  availabilityStatus: string | null;
}>;

export type PrintfulCatalogObservation = Readonly<{
  productId: CatalogId;
  productName: string;
  productIgnored: boolean | null;
  variantCount: number;
  variants: readonly PrintfulCatalogVariantObservation[];
}>;

export type PrintfulCatalogProductSummary = Readonly<{
  productId: CatalogId;
  productName: string;
  variantCount: number;
  syncedVariantCount: number;
  productIgnored: boolean | null;
}>;

export type PrintfulCatalogReadResult =
  | { status: "disabled" | "invalid_product_id" | "invalid_pagination" | "missing_credentials" | "missing_fetcher" }
  | { status: "provider_failed" }
  | {
      status: "unverified_observation";
      requestedStoreId: typeof EXPECTED_PRINTFUL_STORE_ID;
      storeVerification: "unverified";
      completeness: "unverified";
      observation: PrintfulCatalogObservation;
    };

export type PrintfulCatalogPageReadResult =
  | { status: "disabled" | "invalid_pagination" | "missing_credentials" | "missing_fetcher" }
  | { status: "provider_failed" }
  | {
      status: "unverified_page";
      requestedStoreId: typeof EXPECTED_PRINTFUL_STORE_ID;
      storeVerification: "unverified";
      completeness: "unverified";
      page: Readonly<{
        offset: number;
        limit: number;
        total: number;
        products: readonly PrintfulCatalogProductSummary[];
      }>;
    };

export type PrintfulCatalogReaderOptions = Readonly<{
  enabled?: boolean;
  token?: string;
  fetcher?: typeof fetch;
}>;

type JsonReadResult = { status: "ok"; value: unknown } | { status: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown, maximum: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((!allowEmpty && text.length === 0) || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function readCount(value: unknown, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : null;
}

function readBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "boolean" ? value : undefined;
}

function readId(value: unknown): CatalogId | null {
  try {
    return parseCatalogId(value);
  } catch {
    return null;
  }
}

function parseEnvelope(value: unknown): { result: unknown } | null {
  if (!isRecord(value) || value.code !== 200 || !("result" in value)) return null;
  return { result: value.result };
}

function parseProductSummary(value: unknown): PrintfulCatalogProductSummary | null {
  if (!isRecord(value)) return null;
  const productId = readId(value.id);
  const productName = readText(value.name, MAX_NAME_LENGTH);
  const variantCount = readCount(value.variants, PRINTFUL_CATALOG_MAX_VARIANTS);
  const syncedVariantCount = readCount(value.synced, PRINTFUL_CATALOG_MAX_VARIANTS);
  const productIgnored = readBoolean(value.is_ignored);
  if (
    !productId || !productName || variantCount === null || syncedVariantCount === null ||
    syncedVariantCount > variantCount || productIgnored === undefined
  ) return null;
  return { productId, productName, variantCount, syncedVariantCount, productIgnored };
}

function parsePageEnvelope(
  value: unknown,
  requestedOffset: number,
  requestedLimit: number,
): PrintfulCatalogPageReadResult | null {
  if (!isRecord(value)) return null;
  const envelope = parseEnvelope(value);
  if (!envelope || !Array.isArray(envelope.result) || !isRecord(value.paging)) return null;
  const paging = value.paging;
  const total = readCount(paging.total, 2_000);
  const offset = readCount(paging.offset, 2_000);
  const limit = readCount(paging.limit, 100);
  if (total === null || offset !== requestedOffset || limit !== requestedLimit) return null;
  const products: PrintfulCatalogProductSummary[] = [];
  const ids = new Set<string>();
  for (const rawProduct of envelope.result) {
    const product = parseProductSummary(rawProduct);
    if (!product || ids.has(product.productId)) return null;
    ids.add(product.productId);
    products.push(product);
  }
  return {
    status: "unverified_page",
    requestedStoreId: EXPECTED_PRINTFUL_STORE_ID,
    storeVerification: "unverified",
    completeness: "unverified",
    page: { offset, limit, total, products },
  };
}

function parseProductEnvelope(value: unknown, requestedProductId: CatalogId): PrintfulCatalogObservation | null {
  const envelope = parseEnvelope(value);
  if (!envelope || !isRecord(envelope.result)) return null;
  const result = envelope.result;
  if (!isRecord(result.sync_product) || !Array.isArray(result.sync_variants)) return null;
  const product = result.sync_product;
  const productId = readId(product.id);
  const productName = readText(product.name, MAX_NAME_LENGTH);
  const productIgnored = readBoolean(product.is_ignored);
  const variantCount = readCount(product.variants, PRINTFUL_CATALOG_MAX_VARIANTS);
  if (
    productId !== requestedProductId || !productName || productIgnored === undefined ||
    variantCount === null || variantCount !== result.sync_variants.length
  ) return null;

  const seen = new Set<string>();
  const variants: PrintfulCatalogVariantObservation[] = [];
  for (const rawVariant of result.sync_variants) {
    if (!isRecord(rawVariant)) return null;
    const externalVariantId = readId(rawVariant.id);
    const parentProductId = rawVariant.sync_product_id === undefined || rawVariant.sync_product_id === null
      ? null
      : readId(rawVariant.sync_product_id);
    const name = readText(rawVariant.name, MAX_NAME_LENGTH);
    const color = rawVariant.color === undefined || rawVariant.color === null ? null : readText(rawVariant.color, 80, true);
    const size = rawVariant.size === undefined || rawVariant.size === null ? null : readText(rawVariant.size, 80, true);
    const catalogVariantId = rawVariant.variant_id === undefined || rawVariant.variant_id === null
      ? null
      : readId(rawVariant.variant_id);
    const synced = readBoolean(rawVariant.synced);
    const ignored = readBoolean(rawVariant.is_ignored);
    const availabilityStatus = rawVariant.availability_status === undefined || rawVariant.availability_status === null
      ? null
      : readText(rawVariant.availability_status, MAX_STATUS_LENGTH, true);
    if (
      !externalVariantId || !name || seen.has(externalVariantId) ||
      (parentProductId !== null && parentProductId !== productId) ||
      (rawVariant.sync_product_id !== undefined && rawVariant.sync_product_id !== null && parentProductId === null) ||
      (rawVariant.variant_id !== undefined && rawVariant.variant_id !== null && !catalogVariantId) ||
      (rawVariant.color !== undefined && rawVariant.color !== null && color === null) ||
      (rawVariant.size !== undefined && rawVariant.size !== null && size === null) ||
      synced === undefined || ignored === undefined ||
      (rawVariant.availability_status !== undefined && rawVariant.availability_status !== null && availabilityStatus === null)
    ) return null;
    seen.add(externalVariantId);
    variants.push({
      externalVariantId,
      parentProductId,
      name,
      color,
      size,
      catalogVariantId,
      synced: synced ?? null,
      ignored: ignored ?? null,
      availabilityStatus,
    });
  }
  return { productId, productName, productIgnored: productIgnored ?? null, variantCount, variants };
}

async function readBoundedBody(response: Response): Promise<Uint8Array | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES) return null;
  }
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

export function createPrintfulCatalogReader(options: PrintfulCatalogReaderOptions = {}) {
  async function readJson(path: string): Promise<JsonReadResult> {
    if (options.enabled !== true || typeof options.token !== "string" || !options.token.trim() || /[\r\n]/.test(options.token)) {
      return { status: "unavailable" };
    }
    if (typeof options.fetcher !== "function") return { status: "unavailable" };

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
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { status: "unavailable" };
    }
    if (!response.ok || response.status !== 200 || response.redirected) return { status: "unavailable" };
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      return { status: "unavailable" };
    }
    const bytes = await readBoundedBody(response);
    if (!bytes) return { status: "unavailable" };
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { status: "ok", value: JSON.parse(text) as unknown };
    } catch {
      return { status: "unavailable" };
    }
  }

  return {
    async readProductsPage(offset: number, limit: number): Promise<PrintfulCatalogPageReadResult> {
      if (options.enabled !== true) return { status: "disabled" };
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return { status: "invalid_pagination" };
      }
      if (typeof options.token !== "string" || !options.token.trim() || /[\r\n]/.test(options.token)) {
        return { status: "missing_credentials" };
      }
      if (typeof options.fetcher !== "function") return { status: "missing_fetcher" };
      const request = await readJson(`/store/products?offset=${offset}&limit=${limit}&status=all`);
      if (request.status !== "ok") return { status: "provider_failed" };
      return parsePageEnvelope(request.value, offset, limit) ?? { status: "provider_failed" };
    },

    async readProduct(productIdInput: unknown): Promise<PrintfulCatalogReadResult> {
      if (options.enabled !== true) return { status: "disabled" };
      const productId = readId(productIdInput);
      if (!productId) return { status: "invalid_product_id" };
      if (typeof options.token !== "string" || !options.token.trim() || /[\r\n]/.test(options.token)) {
        return { status: "missing_credentials" };
      }
      if (typeof options.fetcher !== "function") return { status: "missing_fetcher" };
      const request = await readJson(`/store/products/${productId}`);
      if (request.status !== "ok") return { status: "provider_failed" };
      const observation = parseProductEnvelope(request.value, productId);
      if (!observation) return { status: "provider_failed" };
      return {
        status: "unverified_observation",
        requestedStoreId: EXPECTED_PRINTFUL_STORE_ID,
        storeVerification: "unverified",
        completeness: "unverified",
        observation,
      };
    },
  };
}
