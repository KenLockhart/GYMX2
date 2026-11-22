import "server-only";
import { randomUUID } from "node:crypto";
import { EXPECTED_PRINTFUL_STORE_ID, parseCatalogId, type CatalogId } from "./catalog";

const MAX_PRODUCTS = 2_000;
const MAX_VARIANTS = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PrivateCatalogDraftVariant = Readonly<{
  localVariantId: string;
  externalVariantId: CatalogId;
  providerName: string;
  color: string | null;
  size: string | null;
  catalogVariantId: CatalogId | null;
  synced: boolean | null;
  ignored: boolean | null;
  availabilityStatus: string | null;
  available: boolean;
  manualImagePath: string | null;
}>;

/** Local simulation record. This is not an Armory row or a persisted schema. */
export type PrivateCatalogDraft = Readonly<{
  localItemId: string;
  kind: "preview";
  category: "gear";
  private: true;
  purchaseBlocked: true;
  liveImportAllowed: false;
  title: string | null;
  description: string | null;
  priceCents: number | null;
  shippingCents: number | null;
  imagePath: string | null;
  visibleToAll: boolean;
  published: boolean;
  variants: readonly PrivateCatalogDraftVariant[];
  revision: number;
}>;

export type PrivateCatalogDraftLink = Readonly<{
  storeId: typeof EXPECTED_PRINTFUL_STORE_ID;
  productId: CatalogId;
  localItemId: string;
  snapshotRevision: string;
}>;

export type PrivateCatalogDraftState = Readonly<{
  revision: number;
  drafts: readonly PrivateCatalogDraft[];
  links: readonly PrivateCatalogDraftLink[];
  /** Ordinary existing items are inspected only to reject an unsafe target. */
  ordinaryItems: readonly Readonly<{ localItemId: string; kind: string }>[];
}>;

/** Repository seam for a private local transaction. No provider or network method exists. */
export interface PrivateCatalogDraftRepository {
  readDraftState(): Promise<PrivateCatalogDraftState>;
  commitDraftState(expectedRevision: number, nextState: PrivateCatalogDraftState): Promise<"committed" | "stale">;
}

export type PrivateCatalogDraftSelectionResult =
  | {
      status: "simulated_private_draft";
      operation: "created" | "linked" | "refreshed";
      draftId: string;
      draftRevision: number;
      repositoryRevision: number;
      variantCount: number;
      availableVariantCount: number;
      purchaseBlocked: true;
      liveImportAllowed: false;
    }
  | {
      status:
        | "invalid_snapshot"
        | "wrong_store"
        | "stale_snapshot"
        | "invalid_selection"
        | "product_not_found"
        | "variant_id_required"
        | "ambiguous_variant_selection"
        | "variant_not_found"
        | "variant_selection_mismatch"
        | "stale_repository"
        | "stale_draft"
        | "target_not_found"
        | "target_not_private_preview"
        | "product_link_conflict"
        | "variant_link_conflict"
        | "repository_failed";
    };

type SnapshotVariant = Readonly<{
  id: CatalogId;
  parentProductId: CatalogId | null;
  name: string;
  color: string | null;
  size: string | null;
  catalogVariantId: CatalogId | null;
  synced: boolean | null;
  ignored: boolean | null;
  availabilityStatus: string | null;
}>;

type SnapshotProduct = Readonly<{
  id: CatalogId;
  name: string;
  ignored: boolean | null;
  variants: readonly SnapshotVariant[];
}>;

type ValidatedSnapshot = Readonly<{
  revision: string;
  products: readonly SnapshotProduct[];
}>;

type DraftFailureStatus = Exclude<PrivateCatalogDraftSelectionResult, { status: "simulated_private_draft" }>["status"];

type ResolvedSelection = Readonly<{
  snapshotRevision: string;
  expectedRepositoryRevision: number;
  expectedDraftRevision: number | null;
  productId: CatalogId;
  localTargetItemId: string | null;
  variants: readonly SnapshotVariant[];
}>;

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

function boundedText(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function readOptionalBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalId(value: unknown): CatalogId | null | undefined {
  if (value === undefined || value === null) return null;
  return readId(value) ?? undefined;
}

function validateSnapshot(value: unknown):
  | { ok: true; snapshot: ValidatedSnapshot }
  | { ok: false; reason: "wrong_store" | "invalid_snapshot" } {
  if (!isRecord(value) || value.sourceKind !== "synthetic-complete-catalog") return { ok: false, reason: "invalid_snapshot" };
  if (value.storeId !== EXPECTED_PRINTFUL_STORE_ID) return { ok: false, reason: "wrong_store" };
  const revision = boundedText(value.revision, 120);
  if (
    value.complete !== true || !revision || !Array.isArray(value.products) ||
    value.products.length > MAX_PRODUCTS ||
    value.expectedProductCount !== value.products.length || value.observedProductCount !== value.products.length
  ) return { ok: false, reason: "invalid_snapshot" };

  const products: SnapshotProduct[] = [];
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const rawProduct of value.products) {
    if (!isRecord(rawProduct)) return { ok: false, reason: "invalid_snapshot" };
    const id = readId(rawProduct.productId);
    const name = boundedText(rawProduct.name, 200);
    const ignored = readOptionalBoolean(rawProduct.ignored);
    if (
      !id || !name || ignored === undefined || productIds.has(id) ||
      !Array.isArray(rawProduct.variants) || rawProduct.variants.length > MAX_VARIANTS ||
      rawProduct.expectedVariantCount !== rawProduct.variants.length || rawProduct.observedVariantCount !== rawProduct.variants.length
    ) return { ok: false, reason: "invalid_snapshot" };
    productIds.add(id);
    const variants: SnapshotVariant[] = [];
    for (const rawVariant of rawProduct.variants) {
      if (!isRecord(rawVariant)) return { ok: false, reason: "invalid_snapshot" };
      const variantId = readId(rawVariant.variantId);
      const parentProductId = readOptionalId(rawVariant.parentProductId);
      const variantName = boundedText(rawVariant.name, 200);
      const color = rawVariant.color === undefined || rawVariant.color === null ? null : boundedText(rawVariant.color, 80);
      const size = rawVariant.size === undefined || rawVariant.size === null ? null : boundedText(rawVariant.size, 80);
      const catalogVariantId = readOptionalId(rawVariant.catalogVariantId);
      const synced = readOptionalBoolean(rawVariant.synced);
      const variantIgnored = readOptionalBoolean(rawVariant.ignored);
      const availabilityStatus = rawVariant.availabilityStatus === undefined || rawVariant.availabilityStatus === null
        ? null
        : boundedText(rawVariant.availabilityStatus, 64, true);
      if (
        !variantId || !variantName || variantIds.has(variantId) ||
        (rawVariant.parentProductId !== undefined && rawVariant.parentProductId !== null && parentProductId === undefined) ||
        (parentProductId !== null && parentProductId !== undefined && parentProductId !== id) ||
        (rawVariant.catalogVariantId !== undefined && rawVariant.catalogVariantId !== null && catalogVariantId === undefined) ||
        (rawVariant.color !== undefined && rawVariant.color !== null && color === null) ||
        (rawVariant.size !== undefined && rawVariant.size !== null && size === null) ||
        synced === undefined || variantIgnored === undefined ||
        (rawVariant.availabilityStatus !== undefined && rawVariant.availabilityStatus !== null && availabilityStatus === null)
      ) return { ok: false, reason: "invalid_snapshot" };
      variantIds.add(variantId);
      variants.push({
        id: variantId,
        parentProductId: parentProductId ?? null,
        name: variantName,
        color,
        size,
        catalogVariantId: catalogVariantId ?? null,
        synced,
        ignored: variantIgnored,
        availabilityStatus,
      });
    }
    products.push({ id, name, ignored, variants });
  }
  return { ok: true, snapshot: { revision, products } };
}

function resolveSelection(value: unknown, snapshot: ValidatedSnapshot):
  | { ok: true; selection: ResolvedSelection; product: SnapshotProduct }
  | { ok: false; reason: DraftFailureStatus } {
  if (!isRecord(value)) return { ok: false, reason: "invalid_selection" };
  const snapshotRevision = boundedText(value.snapshotRevision, 120);
  if (!snapshotRevision || snapshotRevision !== snapshot.revision) return { ok: false, reason: "stale_snapshot" };
  const expectedRepositoryRevision = value.expectedRepositoryRevision;
  if (!Number.isSafeInteger(expectedRepositoryRevision) || Number(expectedRepositoryRevision) < 0) {
    return { ok: false, reason: "invalid_selection" };
  }
  const expectedDraftRevision = value.expectedDraftRevision;
  if (!(expectedDraftRevision === null || (Number.isSafeInteger(expectedDraftRevision) && Number(expectedDraftRevision) >= 1))) {
    return { ok: false, reason: "invalid_selection" };
  }
  const productId = readId(value.productId);
  if (!productId) return { ok: false, reason: "invalid_selection" };
  const product = snapshot.products.find((candidate) => candidate.id === productId);
  if (!product) return { ok: false, reason: "product_not_found" };
  const localTargetItemId = value.localTargetItemId === undefined || value.localTargetItemId === null
    ? null
    : typeof value.localTargetItemId === "string" && UUID_PATTERN.test(value.localTargetItemId)
      ? value.localTargetItemId
      : undefined;
  if (localTargetItemId === undefined) return { ok: false, reason: "invalid_selection" };
  if (!Array.isArray(value.variants) || value.variants.length > MAX_VARIANTS) {
    return { ok: false, reason: "invalid_selection" };
  }

  const selected: SnapshotVariant[] = [];
  const selectedIds = new Set<string>();
  for (const rawChoice of value.variants) {
    if (!isRecord(rawChoice)) return { ok: false, reason: "invalid_selection" };
    const size = rawChoice.size === undefined || rawChoice.size === null ? null : boundedText(rawChoice.size, 80);
    const color = rawChoice.color === undefined || rawChoice.color === null ? null : boundedText(rawChoice.color, 80);
    if ((rawChoice.size !== undefined && rawChoice.size !== null && size === null) || (rawChoice.color !== undefined && rawChoice.color !== null && color === null)) {
      return { ok: false, reason: "invalid_selection" };
    }
    let variant: SnapshotVariant | undefined;
    if (rawChoice.variantId !== undefined && rawChoice.variantId !== null) {
      const variantId = readId(rawChoice.variantId);
      if (!variantId) return { ok: false, reason: "invalid_selection" };
      variant = product.variants.find((candidate) => candidate.id === variantId);
      if (!variant) return { ok: false, reason: "variant_not_found" };
      if ((size !== null && size !== variant.size) || (color !== null && color !== variant.color)) {
        return { ok: false, reason: "variant_selection_mismatch" };
      }
    } else {
      if (size === null && color === null) return { ok: false, reason: "variant_id_required" };
      const matches = product.variants.filter((candidate) =>
        (size === null || candidate.size === size) && (color === null || candidate.color === color));
      if (matches.length === 0) return { ok: false, reason: "variant_not_found" };
      if (matches.length > 1) return { ok: false, reason: "ambiguous_variant_selection" };
      variant = matches[0];
    }
    if (!variant || selectedIds.has(variant.id)) return { ok: false, reason: "invalid_selection" };
    selectedIds.add(variant.id);
    selected.push(variant);
  }

  return {
    ok: true,
    product,
    selection: {
      snapshotRevision,
      expectedRepositoryRevision: Number(expectedRepositoryRevision),
      expectedDraftRevision: expectedDraftRevision === null ? null : Number(expectedDraftRevision),
      productId,
      localTargetItemId,
      variants: selected,
    },
  };
}

function variantAvailable(product: SnapshotProduct, variant: SnapshotVariant): boolean {
  return product.ignored === false && variant.synced === true && variant.ignored === false &&
    variant.availabilityStatus === "active" && variant.catalogVariantId !== null;
}

function createDraft(product: SnapshotProduct, itemId: string, selected: readonly SnapshotVariant[]): PrivateCatalogDraft {
  return {
    localItemId: itemId,
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
    variants: selected.map((variant) => ({
      localVariantId: randomUUID(),
      externalVariantId: variant.id,
      providerName: variant.name,
      color: variant.color,
      size: variant.size,
      catalogVariantId: variant.catalogVariantId,
      synced: variant.synced,
      ignored: variant.ignored,
      availabilityStatus: variant.availabilityStatus,
      available: variantAvailable(product, variant),
      manualImagePath: null,
    })),
    revision: 1,
  };
}

function refreshDraft(
  current: PrivateCatalogDraft,
  product: SnapshotProduct,
  selected: readonly SnapshotVariant[],
): PrivateCatalogDraft {
  const latest = new Map(product.variants.map((variant) => [variant.id, variant]));
  const variants = current.variants.map((variant) => {
    const observed = latest.get(variant.externalVariantId);
    if (!observed) return { ...variant, available: false, availabilityStatus: "missing" };
    return {
      ...variant,
      providerName: observed.name,
      color: observed.color,
      size: observed.size,
      catalogVariantId: observed.catalogVariantId,
      synced: observed.synced,
      ignored: observed.ignored,
      availabilityStatus: observed.availabilityStatus,
      available: variantAvailable(product, observed),
    };
  });
  const knownIds = new Set(variants.map((variant) => variant.externalVariantId));
  for (const observed of selected) {
    if (knownIds.has(observed.id)) continue;
    variants.push({
      localVariantId: randomUUID(),
      externalVariantId: observed.id,
      providerName: observed.name,
      color: observed.color,
      size: observed.size,
      catalogVariantId: observed.catalogVariantId,
      synced: observed.synced,
      ignored: observed.ignored,
      availabilityStatus: observed.availabilityStatus,
      available: variantAvailable(product, observed),
      manualImagePath: null,
    });
  }
  return {
    ...current,
    kind: "preview",
    category: "gear",
    private: true,
    purchaseBlocked: true,
    liveImportAllowed: false,
    variants,
    revision: current.revision + 1,
  };
}

function validatePrivateTarget(draft: PrivateCatalogDraft): boolean {
  if (!isRecord(draft) || !Array.isArray(draft.variants)) return false;
  const localVariantIds = new Set<string>();
  const externalVariantIds = new Set<string>();
  const variantsValid = draft.variants.every((variant: PrivateCatalogDraftVariant) => {
    if (!isRecord(variant) || typeof variant.localVariantId !== "string" || !UUID_PATTERN.test(variant.localVariantId)) return false;
    const externalVariantId = readId(variant.externalVariantId);
    const valid = externalVariantId !== null && externalVariantId === variant.externalVariantId &&
      !localVariantIds.has(variant.localVariantId) && !externalVariantIds.has(externalVariantId) &&
      typeof variant.available === "boolean" && typeof variant.providerName === "string" &&
      (variant.manualImagePath === null || typeof variant.manualImagePath === "string");
    localVariantIds.add(variant.localVariantId);
    if (externalVariantId) externalVariantIds.add(externalVariantId);
    return valid;
  });
  return draft.kind === "preview" && draft.category === "gear" && draft.private === true &&
    draft.purchaseBlocked === true && draft.liveImportAllowed === false &&
    Number.isSafeInteger(draft.revision) && draft.revision >= 1 &&
    variantsValid &&
    (draft.title === null || typeof draft.title === "string") &&
    (draft.description === null || typeof draft.description === "string") &&
    (draft.priceCents === null || (Number.isSafeInteger(draft.priceCents) && draft.priceCents >= 0)) &&
    (draft.shippingCents === null || (Number.isSafeInteger(draft.shippingCents) && draft.shippingCents >= 0)) &&
    (draft.imagePath === null || typeof draft.imagePath === "string") &&
    typeof draft.visibleToAll === "boolean" && typeof draft.published === "boolean";
}

/**
 * Creates or refreshes only a local private draft from a synthetic validated
 * snapshot. This helper has no Printful client, fetch, provider write, DB, or
 * checkout dependency; it is not a live admin action.
 */
export async function applySyntheticCatalogAdminSelection(
  snapshotInput: unknown,
  selectionInput: unknown,
  repository: PrivateCatalogDraftRepository,
): Promise<PrivateCatalogDraftSelectionResult> {
  const parsedSnapshot = validateSnapshot(snapshotInput);
  if (!parsedSnapshot.ok) return { status: parsedSnapshot.reason };
  const resolved = resolveSelection(selectionInput, parsedSnapshot.snapshot);
  if (!resolved.ok) return { status: resolved.reason };

  let current: PrivateCatalogDraftState;
  try {
    current = await repository.readDraftState();
  } catch {
    return { status: "repository_failed" };
  }
  if (!isRecord(current) || !Number.isSafeInteger(current.revision) || current.revision !== resolved.selection.expectedRepositoryRevision) {
    return { status: "stale_repository" };
  }
  if (!Array.isArray(current.drafts) || !Array.isArray(current.links) || !Array.isArray(current.ordinaryItems)) {
    return { status: "repository_failed" };
  }

  const { product, selection } = resolved;
  const matchingProductLinks = current.links.filter((link) => link.storeId === EXPECTED_PRINTFUL_STORE_ID && link.productId === product.id);
  if (matchingProductLinks.length > 1) return { status: "repository_failed" };
  const productLink = matchingProductLinks[0];
  if (productLink && selection.localTargetItemId !== null && selection.localTargetItemId !== productLink.localItemId) {
    return { status: "product_link_conflict" };
  }
  const targetItemId = productLink?.localItemId ?? selection.localTargetItemId;
  const currentDraft = targetItemId ? current.drafts.find((draft) => draft.localItemId === targetItemId) : undefined;
  if (targetItemId && !currentDraft) {
    if (current.ordinaryItems.some((item) => item.localItemId === targetItemId)) return { status: "target_not_private_preview" };
    return { status: "target_not_found" };
  }
  if (currentDraft && !validatePrivateTarget(currentDraft)) return { status: "target_not_private_preview" };
  if (currentDraft && currentDraft.revision !== selection.expectedDraftRevision) return { status: "stale_draft" };
  if (!currentDraft && selection.expectedDraftRevision !== null) return { status: "stale_draft" };
  if (!currentDraft && selection.variants.length === 0) return { status: "invalid_selection" };

  const otherLink = current.links.find((link) => link.storeId === EXPECTED_PRINTFUL_STORE_ID && link.productId !== product.id && link.localItemId === currentDraft?.localItemId);
  if (otherLink) return { status: "product_link_conflict" };
  const selectedIds = new Set(selection.variants.map((variant) => variant.id));
  const foreignVariantLink = current.links.some((link) =>
    link.storeId === EXPECTED_PRINTFUL_STORE_ID && link.productId !== product.id &&
    current.drafts.find((draft) => draft.localItemId === link.localItemId)?.variants.some((variant) => selectedIds.has(variant.externalVariantId)));
  if (foreignVariantLink) return { status: "variant_link_conflict" };

  const staged = structuredClone(current) as PrivateCatalogDraftState;
  const drafts = [...staged.drafts];
  const links = [...staged.links];
  const existingIndex = currentDraft ? drafts.findIndex((draft) => draft.localItemId === currentDraft!.localItemId) : -1;
  const created = !currentDraft;
  const draft = currentDraft
    ? refreshDraft(currentDraft, product, selection.variants)
    : createDraft(product, randomUUID(), selection.variants);
  if (existingIndex >= 0) drafts[existingIndex] = draft;
  else drafts.push(draft);
  if (!productLink) {
    links.push({
      storeId: EXPECTED_PRINTFUL_STORE_ID,
      productId: product.id,
      localItemId: draft.localItemId,
      snapshotRevision: selection.snapshotRevision,
    });
  } else {
    const linkIndex = links.findIndex((link) => link.storeId === productLink.storeId && link.productId === productLink.productId);
    links[linkIndex] = { ...productLink, snapshotRevision: selection.snapshotRevision };
  }
  const nextState: PrivateCatalogDraftState = {
    revision: current.revision + 1,
    drafts,
    links,
    ordinaryItems: staged.ordinaryItems,
  };

  let committed: "committed" | "stale";
  try {
    committed = await repository.commitDraftState(current.revision, nextState);
  } catch {
    return { status: "repository_failed" };
  }
  if (committed === "stale") return { status: "stale_repository" };
  const operation = created ? "created" : productLink ? "refreshed" : "linked";
  return {
    status: "simulated_private_draft",
    operation,
    draftId: draft.localItemId,
    draftRevision: draft.revision,
    repositoryRevision: nextState.revision,
    variantCount: draft.variants.length,
    availableVariantCount: draft.variants.filter((variant) => variant.available).length,
    purchaseBlocked: true,
    liveImportAllowed: false,
  };
}
