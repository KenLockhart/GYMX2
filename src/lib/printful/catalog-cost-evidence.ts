import "server-only";
import { createHash } from "node:crypto";
import { EXPECTED_PRINTFUL_STORE_ID, parseCatalogId } from "./catalog";
import type { CompletePrintfulStoreRead } from "./catalog-provider";

const MAX_PRODUCTS = 500;
const MAX_VARIANTS = 100;
const MAX_COST_CENTS = 10_000_000;
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

export type BoundPrintfulUiCost = Readonly<{
  syncProductId: string;
  syncVariantId: string;
  externalId: string;
  catalogVariantId: string;
  productionCostMinCents: number;
  productionCostMaxCents: number;
  currency: "USD";
  source: "admin-reviewed-printful-ui";
  observedAt: string;
  configurationFingerprint: string;
  evidenceSha256: string;
}>;

export type PrintfulUiCostBindingResult =
  | { status: "bound"; costs: readonly BoundPrintfulUiCost[]; evidenceSha256: string }
  | {
      status:
        | "invalid_evidence"
        | "wrong_store"
        | "wrong_currency"
        | "stale_evidence"
        | "incomplete_evidence"
        | "ambiguous_external_id"
        | "configuration_changed"
        | "variant_set_mismatch";
    };

/** Shared selector so ignored or incomplete products have no hidden required form fields. */
export function isReviewablePrintfulCostProduct(value: unknown): boolean {
  if (!isRecord(value) || value.ignored !== false || !Array.isArray(value.variants) || value.variants.length === 0) return false;
  return value.variants.every((entry) => isRecord(entry) && entry.configurationComplete === true &&
    typeof entry.externalId === "string" && entry.externalId.length > 0 &&
    typeof entry.catalogVariantId === "string" && /^[1-9][0-9]{0,18}$/.test(entry.catalogVariantId) &&
    typeof entry.localVariantId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.localVariantId));
}

type CostCell = Readonly<{ externalId: string; printfulPrice: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readShortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

function readId(value: unknown): string | null {
  try {
    return parseCatalogId(value);
  } catch {
    return null;
  }
}

function parsePrintfulPrice(value: unknown): { min: number; max: number } | null {
  if (typeof value !== "string") return null;
  const match = /^\s*\$([0-9]{1,8})\.([0-9]{2})(?:\s*(?:-|–|—)\s*\$([0-9]{1,8})\.([0-9]{2}))?\s*$/.exec(value);
  if (!match) return null;
  const toCents = (dollars: string, cents: string) => Number(dollars) * 100 + Number(cents);
  const min = toCents(match[1], match[2]);
  const max = match[3] === undefined ? min : toCents(match[3], match[4]);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min || max > MAX_COST_CENTS) return null;
  return { min, max };
}

function validateEvidence(value: unknown):
  | { ok: true; observedAt: string; products: Array<{ productId: string; selectedVariantIds: string[]; rows: CostCell[] }> }
  | { ok: false; status: "invalid_evidence" | "wrong_store" | "wrong_currency" | "incomplete_evidence" } {
  if (!isRecord(value) || value.source !== "official_printful_ui_edit_retail_prices" || value.readOnly !== true || value.priceChangesSaved !== false) {
    return { ok: false, status: "invalid_evidence" };
  }
  if (value.storeId !== EXPECTED_PRINTFUL_STORE_ID) return { ok: false, status: "wrong_store" };
  if (value.currency !== "USD" || typeof value.currencyContext !== "string" || !/^USD\b/.test(value.currencyContext)) {
    return { ok: false, status: "wrong_currency" };
  }
  const observedAt = readShortText(value.observedAt, 40);
  const observedMs = observedAt ? Date.parse(observedAt) : NaN;
  if (!Number.isFinite(observedMs) || new Date(observedMs).toISOString() !== observedAt) {
    return { ok: false, status: "invalid_evidence" };
  }
  if (!Array.isArray(value.products) || value.products.length === 0 || value.products.length > MAX_PRODUCTS) {
    return { ok: false, status: "incomplete_evidence" };
  }
  const products: Array<{ productId: string; selectedVariantIds: string[]; rows: CostCell[] }> = [];
  const productIds = new Set<string>();
  for (const rawProduct of value.products) {
    if (!isRecord(rawProduct)) return { ok: false, status: "invalid_evidence" };
    const productId = readId(rawProduct.syncProductId);
    if (!productId) return { ok: false, status: "invalid_evidence" };
    if (productIds.has(productId)) return { ok: false, status: "invalid_evidence" };
    productIds.add(productId);
    if (!Array.isArray(rawProduct.selectedSyncVariantIds) || !Array.isArray(rawProduct.priceRows) ||
      rawProduct.selectedSyncVariantIds.length === 0 || rawProduct.selectedSyncVariantIds.length > MAX_VARIANTS ||
      rawProduct.priceRows.length !== rawProduct.selectedSyncVariantIds.length) {
      return { ok: false, status: "incomplete_evidence" };
    }
    const selectedVariantIds = rawProduct.selectedSyncVariantIds.map(readId);
    if (selectedVariantIds.some((id) => id === null) || new Set(selectedVariantIds).size !== selectedVariantIds.length) {
      return { ok: false, status: "invalid_evidence" };
    }
    const rowExternalIds = new Set<string>();
    const rows: CostCell[] = [];
    for (const rawRow of rawProduct.priceRows) {
      if (!isRecord(rawRow)) return { ok: false, status: "invalid_evidence" };
      const externalId = readShortText(rawRow.externalId, 128);
      if (!externalId || rowExternalIds.has(externalId) || !parsePrintfulPrice(rawRow.printfulPrice)) {
        return { ok: false, status: "invalid_evidence" };
      }
      rowExternalIds.add(externalId);
      rows.push({ externalId, printfulPrice: rawRow.printfulPrice as string });
    }
    products.push({ productId, selectedVariantIds: selectedVariantIds as string[], rows });
  }
  return { ok: true, observedAt, products };
}

function createSnapshotIndex(snapshot: CompletePrintfulStoreRead): Map<string, Map<string, CompletePrintfulStoreRead["products"][number]["variants"][number]>> | null {
  const index = new Map<string, Map<string, CompletePrintfulStoreRead["products"][number]["variants"][number]>>();
  for (const product of snapshot.products) {
    if (index.has(product.syncProductId)) return null;
    const variants = new Map<string, CompletePrintfulStoreRead["products"][number]["variants"][number]>();
    for (const variant of product.variants) {
      if (!variant.externalId || variants.has(variant.syncVariantId)) return null;
      if ([...variants.values()].some((existing) => existing.externalId === variant.externalId)) return null;
      variants.set(variant.syncVariantId, variant);
    }
    index.set(product.syncProductId, variants);
  }
  return index;
}

/**
 * Bind a read-only Printful UI observation to exact IDs and to a configuration
 * fingerprint observed before and after the UI review. UI evidence is never
 * inferred from retail price and never accepted against a single stale read.
 */
export function bindPrintfulUiCostEvidence(input: {
  rawEvidenceText: string;
  adminAttestedOfficialUi: boolean;
  before: CompletePrintfulStoreRead;
  after: CompletePrintfulStoreRead;
  now?: Date;
}): PrintfulUiCostBindingResult {
  if (input.adminAttestedOfficialUi !== true || typeof input.rawEvidenceText !== "string" || input.rawEvidenceText.length > 1_000_000) {
    return { status: "invalid_evidence" };
  }
  let evidence: unknown;
  try {
    evidence = JSON.parse(input.rawEvidenceText) as unknown;
  } catch {
    return { status: "invalid_evidence" };
  }
  const parsed = validateEvidence(evidence);
  if (!parsed.ok) return { status: parsed.status };
  if (input.before.storeId !== EXPECTED_PRINTFUL_STORE_ID || input.after.storeId !== EXPECTED_PRINTFUL_STORE_ID) return { status: "wrong_store" };
  const now = input.now ?? new Date();
  const observedMs = Date.parse(parsed.observedAt);
  if (observedMs > now.getTime() || now.getTime() - observedMs > MAX_EVIDENCE_AGE_MS ||
    observedMs < Date.parse(input.before.readCompletedAt) || observedMs > Date.parse(input.after.readStartedAt) ||
    Date.parse(input.before.readStartedAt) > Date.parse(input.before.readCompletedAt) ||
    Date.parse(input.after.readStartedAt) > Date.parse(input.after.readCompletedAt)) {
    return { status: "stale_evidence" };
  }
  const before = createSnapshotIndex(input.before);
  const after = createSnapshotIndex(input.after);
  if (!before || !after) return { status: "incomplete_evidence" };
  const evidenceHash = createHash("sha256").update(input.rawEvidenceText, "utf8").digest("hex");
  const bound: BoundPrintfulUiCost[] = [];
  for (const observedProduct of parsed.products) {
    const beforeVariants = before.get(observedProduct.productId);
    const afterVariants = after.get(observedProduct.productId);
    if (!beforeVariants || !afterVariants || beforeVariants.size !== afterVariants.size) return { status: "variant_set_mismatch" };
    if ([...beforeVariants.values(), ...afterVariants.values()].some((variant) =>
      !variant.configurationComplete || !variant.catalogVariantId)) return { status: "incomplete_evidence" };
    const expectedIds = [...beforeVariants.keys()].sort();
    if (expectedIds.join("\0") !== [...afterVariants.keys()].sort().join("\0") ||
      expectedIds.join("\0") !== [...observedProduct.selectedVariantIds].sort().join("\0")) {
      return { status: "variant_set_mismatch" };
    }
    const beforeExternal = new Map<string, string>();
    for (const [variantId, variant] of beforeVariants) {
      if (!variant.externalId || beforeExternal.has(variant.externalId)) return { status: "ambiguous_external_id" };
      beforeExternal.set(variant.externalId, variantId);
      const current = afterVariants.get(variantId);
      if (!current || current.externalId !== variant.externalId || current.catalogVariantId !== variant.catalogVariantId ||
        current.configurationFingerprint !== variant.configurationFingerprint) {
        return { status: "configuration_changed" };
      }
    }
    const mappedIds = new Set<string>();
    for (const row of observedProduct.rows) {
      const variantId = beforeExternal.get(row.externalId);
      if (!variantId || !observedProduct.selectedVariantIds.includes(variantId) || mappedIds.has(variantId)) {
        return { status: "ambiguous_external_id" };
      }
      mappedIds.add(variantId);
      const cost = parsePrintfulPrice(row.printfulPrice);
      const variant = afterVariants.get(variantId);
      if (!cost || !variant) return { status: "invalid_evidence" };
      bound.push({
        syncProductId: observedProduct.productId,
        syncVariantId: variantId,
        externalId: row.externalId,
        catalogVariantId: variant.catalogVariantId!,
        productionCostMinCents: cost.min,
        productionCostMaxCents: cost.max,
        currency: "USD",
        source: "admin-reviewed-printful-ui",
        observedAt: parsed.observedAt,
        configurationFingerprint: variant.configurationFingerprint,
        evidenceSha256: evidenceHash,
      });
    }
    if (mappedIds.size !== observedProduct.selectedVariantIds.length) return { status: "incomplete_evidence" };
  }
  return { status: "bound", costs: bound, evidenceSha256: evidenceHash };
}
