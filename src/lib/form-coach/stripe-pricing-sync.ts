import { createHash } from "node:crypto";
import type { PricingCandidate } from "@/lib/form-coach/pricing-admin-server";

const FEATURE_KEY = "form_coach";
const SAFE_CREATE_AGE_MS = 23 * 60 * 60 * 1000;
const MAX_RUN_MS = 45_000;
const MAX_PROVIDER_CALL_MS = 7_000;
const SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 20;
const MAX_SEARCH_RESULTS = SEARCH_PAGE_SIZE * MAX_SEARCH_PAGES;

export type PricingSyncParentState = "reserved" | "unknown" | "verified" | "cas_applied" | "cas_stale" | "failed";
export type PricingSyncObjectKind = "product" | "price";
export type PricingSyncObjectState = "reserved" | "unknown" | "bound" | "verified" | "failed";

export type PricingSyncRequest = {
  request_id: string;
  feature_key: string;
  expected_revision: number;
  requested_by: string;
  request_digest: string;
  candidate_payload: unknown;
  state: PricingSyncParentState;
  state_revision: number;
  published_revision: number | null;
};

export type PricingSyncObject = {
  id: string;
  request_id: string;
  object_kind: PricingSyncObjectKind;
  price_key: string | null;
  idempotency_key: string;
  payload_digest: string;
  state: PricingSyncObjectState;
  provider_object_id: string | null;
  verified_payload_digest: string | null;
  state_revision: number;
  created_at: string;
};

export type PricingSyncSnapshot = {
  request: PricingSyncRequest | null;
  objects: PricingSyncObject[];
  currentRevision: number | null;
};

export type PricingSyncIdentity = {
  requestId: string;
  adminId: string;
  expectedRevision: number;
  requestDigest: string;
  candidate: PricingCandidate;
};

export type PricingSyncStore = {
  readSnapshot(requestId: string): Promise<PricingSyncSnapshot>;
  reserveObject(input: {
    requestId: string;
    objectKind: PricingSyncObjectKind;
    priceKey: string | null;
    idempotencyKey: string;
    payloadDigest: string;
  }): Promise<"reserved" | "existing" | "request_unavailable">;
  advanceObject(input: {
    objectId: string;
    expectedStateRevision: number;
    nextState: "unknown" | "bound" | "verified";
    providerObjectId: string | null;
    verifiedPayloadDigest: string | null;
  }): Promise<"unknown" | "bound" | "verified" | "cas_stale" | "request_unavailable" | "missing" | "identity_conflict">;
  fenceRequest(input: {
    requestId: string;
    requestedBy: string;
    featureKey: "form_coach";
    requestDigest: string;
    expectedRevision: number;
    expectedStateRevision: number;
  }): Promise<"failed" | "already_failed" | "already_published" | "cas_stale" | "identity_mismatch" | "missing" | "request_unavailable">;
};

export type ProviderRequestOptions = {
  timeout: number;
  maxNetworkRetries: 0;
  idempotencyKey?: string;
};

export type ProviderProduct = {
  id: string;
  active: boolean;
  name: string;
  description: string | null;
  metadata: Record<string, string>;
  livemode: boolean;
};

export type ProviderPrice = {
  id: string;
  active: boolean;
  billing_scheme: string;
  currency: string;
  custom_unit_amount: unknown | null;
  livemode: boolean;
  metadata: Record<string, string>;
  product: string | { id: string };
  recurring: { interval: string; interval_count: number; usage_type: string } | null;
  transform_quantity: unknown | null;
  type: string;
  unit_amount: number | null;
  unit_amount_decimal: string | null;
};

export type ProviderSearchPage<T> = {
  data: T[];
  hasMore: boolean;
  nextPage: string | null;
};

export type StripePricingProvider = {
  createProduct(params: {
    active: true;
    name: string;
    description?: string;
    metadata: Record<string, string>;
  }, options: ProviderRequestOptions): Promise<ProviderProduct>;
  retrieveProduct(id: string, options: ProviderRequestOptions): Promise<ProviderProduct>;
  searchProducts(params: { query: string; limit: number; page?: string }, options: ProviderRequestOptions): Promise<ProviderSearchPage<ProviderProduct>>;
  createPrice(params: {
    active: true;
    billing_scheme: "per_unit";
    currency: string;
    metadata: Record<string, string>;
    product: string;
    recurring?: { interval: "month" | "year"; interval_count: 1; usage_type: "licensed" };
    unit_amount: number;
  }, options: ProviderRequestOptions): Promise<ProviderPrice>;
  retrievePrice(id: string, options: ProviderRequestOptions): Promise<ProviderPrice>;
  searchPrices(params: { query: string; limit: number; page?: string }, options: ProviderRequestOptions): Promise<ProviderSearchPage<ProviderPrice>>;
};

export type PricingSyncOutcome =
  | { status: "ready_to_publish" }
  | { status: "already_applied" }
  | { status: "failed" }
  | { status: "stale" }
  | { status: "missing" }
  | { status: "identity_mismatch" }
  | { status: "in_progress" }
  | { status: "unresolved" }
  | { status: "fenced_failed" }
  | { status: "fence_pending" }
  | { status: "published_mismatch" };

type SyncDependencies = {
  store: PricingSyncStore;
  provider: StripePricingProvider;
  livemode: boolean;
  now?: () => number;
  runTimeoutMs?: number;
  providerCallTimeoutMs?: number;
};

type ObjectSpec = {
  kind: PricingSyncObjectKind;
  requestId: string;
  priceKey: string | null;
  payloadDigest: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
  productParams?: Parameters<StripePricingProvider["createProduct"]>[0];
  priceParams?: Omit<Parameters<StripePricingProvider["createPrice"]>[0], "product">;
};

type CoreContext = {
  identity: PricingSyncIdentity;
  dependencies: SyncDependencies;
  now: () => number;
  deadline: number;
  providerCallTimeoutMs: number;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function pricingSyncCandidateDigest(candidate: PricingCandidate): string {
  return sha256(candidate);
}

function canonicalCandidate(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return stableJson(value);
}

export function pricingSyncObjectIdempotencyKey(requestId: string, kind: PricingSyncObjectKind, priceKey: string | null): string {
  const suffix = kind === "product" ? ":product" : `:price:${priceKey ?? ""}`;
  return `form-coach-price-sync:${requestId}${suffix}`;
}

function metadataFor(input: {
  identity: PricingSyncIdentity;
  kind: PricingSyncObjectKind;
  priceKey: string | null;
  payloadDigest: string;
  livemode: boolean;
}): Record<string, string> {
  return {
    form_coach_feature_key: FEATURE_KEY,
    form_coach_sync_request_id: input.identity.requestId,
    form_coach_config_revision: String(input.identity.expectedRevision),
    form_coach_request_digest: input.identity.requestDigest,
    form_coach_object_kind: input.kind,
    form_coach_payload_digest: input.payloadDigest,
    form_coach_livemode: String(input.livemode),
    ...(input.priceKey === null ? {} : { form_coach_price_key: input.priceKey }),
  };
}

function productSpec(identity: PricingSyncIdentity, livemode: boolean): ObjectSpec {
  const body = {
    featureKey: FEATURE_KEY,
    requestId: identity.requestId,
    configRevision: identity.expectedRevision,
    requestDigest: identity.requestDigest,
    livemode,
    name: identity.candidate.display_name,
    description: identity.candidate.description,
  };
  const payloadDigest = sha256(body);
  const metadata = metadataFor({ identity, kind: "product", priceKey: null, payloadDigest, livemode });
  return {
    kind: "product",
    requestId: identity.requestId,
    priceKey: null,
    payloadDigest,
    idempotencyKey: pricingSyncObjectIdempotencyKey(identity.requestId, "product", null),
    metadata,
    productParams: {
      active: true,
      name: identity.candidate.display_name,
      ...(identity.candidate.description ? { description: identity.candidate.description } : {}),
      metadata,
    },
  };
}

function priceSpec(identity: PricingSyncIdentity, option: PricingCandidate["price_options"][number], productId: string, livemode: boolean): ObjectSpec {
  const body = {
    featureKey: FEATURE_KEY,
    requestId: identity.requestId,
    configRevision: identity.expectedRevision,
    requestDigest: identity.requestDigest,
    livemode,
    priceKey: option.price_key,
    amountCents: option.amount_cents,
    currency: option.currency.toLowerCase(),
    interval: option.interval,
    creditsPerPack: option.credits_per_pack,
    productId,
  };
  const payloadDigest = sha256(body);
  const metadata = metadataFor({ identity, kind: "price", priceKey: option.price_key, payloadDigest, livemode });
  return {
    kind: "price",
    requestId: identity.requestId,
    priceKey: option.price_key,
    payloadDigest,
    idempotencyKey: pricingSyncObjectIdempotencyKey(identity.requestId, "price", option.price_key),
    metadata,
    priceParams: {
      active: true,
      billing_scheme: "per_unit",
      currency: option.currency.toLowerCase(),
      metadata,
      unit_amount: option.amount_cents,
      ...(option.interval === null ? {} : {
        recurring: { interval: option.interval, interval_count: 1, usage_type: "licensed" },
      }),
    },
  };
}

function metadataMatches(actual: Record<string, string>, expected: Record<string, string>): boolean {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

function productMatches(product: ProviderProduct, spec: ObjectSpec, identity: PricingSyncIdentity, livemode: boolean): boolean {
  const expectedDescription = identity.candidate.description || null;
  return product.active === true
    && product.name === identity.candidate.display_name
    && product.description === expectedDescription
    && product.livemode === livemode
    && metadataMatches(product.metadata, spec.metadata);
}

function exactIntegerDecimal(value: string | null, expected: number): boolean {
  if (value === null) return true;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,12}))?$/.exec(value);
  if (!match || Number(match[1]) !== expected) return false;
  return !match[2] || /^0+$/.test(match[2]);
}

function priceMatches(price: ProviderPrice, spec: ObjectSpec, option: PricingCandidate["price_options"][number], productId: string, livemode: boolean): boolean {
  const priceProductId = typeof price.product === "string" ? price.product : price.product?.id;
  const recurringExpected = option.interval !== null;
  return price.active === true
    && price.livemode === livemode
    && price.billing_scheme === "per_unit"
    && price.currency.toLowerCase() === option.currency.toLowerCase()
    && price.unit_amount === option.amount_cents
    && exactIntegerDecimal(price.unit_amount_decimal, option.amount_cents)
    && price.custom_unit_amount === null
    && price.transform_quantity === null
    && price.type === (recurringExpected ? "recurring" : "one_time")
    && priceProductId === productId
    && (recurringExpected
      ? price.recurring?.interval === option.interval
        && price.recurring.interval_count === 1
        && price.recurring.usage_type === "licensed"
      : price.recurring === null)
    && metadataMatches(price.metadata, spec.metadata);
}

function requestMatches(snapshot: PricingSyncSnapshot, identity: PricingSyncIdentity): boolean {
  const request = snapshot.request;
  return request !== null
    && request.request_id === identity.requestId
    && request.feature_key === FEATURE_KEY
    && request.expected_revision === identity.expectedRevision
    && request.requested_by === identity.adminId
    && request.request_digest === identity.requestDigest
    && pricingSyncCandidateDigest(identity.candidate) === identity.requestDigest
    && canonicalCandidate(request.candidate_payload) === canonicalCandidate(identity.candidate);
}

function outcomeForParent(snapshot: PricingSyncSnapshot): PricingSyncOutcome | null {
  const request = snapshot.request;
  if (!request) return { status: "missing" };
  if (request.state === "cas_applied" || request.published_revision !== null) return { status: "already_applied" };
  if (request.state === "failed") return { status: "failed" };
  if (request.state === "cas_stale") return { status: "stale" };
  if (request.state !== "reserved" && request.state !== "unknown" && request.state !== "verified") {
    return { status: "in_progress" };
  }
  return null;
}

function callOptions(context: CoreContext, idempotencyKey?: string): ProviderRequestOptions | null {
  const remaining = context.deadline - context.now();
  if (remaining <= 0) return null;
  return {
    timeout: Math.max(1, Math.min(context.providerCallTimeoutMs, remaining)),
    maxNetworkRetries: 0,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function createCallOptions(context: CoreContext, object: PricingSyncObject): ProviderRequestOptions | null {
  const createdAt = Date.parse(object.created_at);
  const age = context.now() - createdAt;
  const remainingIdempotencyWindow = SAFE_CREATE_AGE_MS - age;
  if (!Number.isFinite(createdAt) || age < 0 || remainingIdempotencyWindow < 1) return null;
  const options = callOptions(context, object.idempotency_key);
  if (!options) return null;
  const timeout = Math.min(options.timeout, Math.floor(remainingIdempotencyWindow));
  return timeout > 0 ? { ...options, timeout } : null;
}

async function readChecked(context: CoreContext): Promise<{ snapshot: PricingSyncSnapshot; failure: PricingSyncOutcome | null }> {
  const snapshot = await context.dependencies.store.readSnapshot(context.identity.requestId);
  if (!requestMatches(snapshot, context.identity)) return { snapshot, failure: snapshot.request ? { status: "identity_mismatch" } : { status: "missing" } };
  if (snapshot.currentRevision !== context.identity.expectedRevision) return { snapshot, failure: { status: "stale" } };
  return { snapshot, failure: outcomeForParent(snapshot) };
}

async function fenceDefinitiveMismatch(context: CoreContext): Promise<PricingSyncOutcome> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let snapshot: PricingSyncSnapshot;
    try {
      const checked = await readChecked(context);
      snapshot = checked.snapshot;
      if (!requestMatches(snapshot, context.identity)) return { status: "fence_pending" };
      const parentOutcome = outcomeForParent(snapshot);
      if (parentOutcome?.status === "already_applied") return { status: "published_mismatch" };
      if (parentOutcome?.status === "failed") return { status: "fenced_failed" };
      if (parentOutcome?.status === "stale") return { status: "fence_pending" };
      if (snapshot.currentRevision !== context.identity.expectedRevision || !snapshot.request) return { status: "fence_pending" };
      const result = await context.dependencies.store.fenceRequest({
        requestId: context.identity.requestId,
        requestedBy: context.identity.adminId,
        featureKey: FEATURE_KEY,
        requestDigest: context.identity.requestDigest,
        expectedRevision: context.identity.expectedRevision,
        expectedStateRevision: snapshot.request.state_revision,
      });
      if (result === "failed" || result === "already_failed") return { status: "fenced_failed" };
      if (result === "already_published") return { status: "published_mismatch" };
      if (result === "cas_stale") continue;
      return { status: "fence_pending" };
    } catch {
      return { status: "fence_pending" };
    }
  }
  return { status: "fence_pending" };
}

function lookupObject(snapshot: PricingSyncSnapshot, spec: ObjectSpec): PricingSyncObject | null {
  return snapshot.objects.find((object) => object.object_kind === spec.kind && object.price_key === spec.priceKey) ?? null;
}

function objectIdentityMatches(object: PricingSyncObject, spec: ObjectSpec): boolean {
  const isCurrentKey = object.idempotency_key === spec.idempotencyKey;
  const isKnownLegacyPriceKey = spec.kind === "price"
    && object.idempotency_key === `form-coach-price-sync:${spec.requestId}:${spec.priceKey}`;
  return object.request_id === spec.requestId
    && object.payload_digest === spec.payloadDigest
    && (isCurrentKey || isKnownLegacyPriceKey);
}

async function advanceObject(
  context: CoreContext,
  object: PricingSyncObject,
  nextState: "unknown" | "bound" | "verified",
  providerObjectId: string | null,
  verifiedPayloadDigest: string | null,
): Promise<boolean | "identity_conflict"> {
  const checked = await readChecked(context);
  if (checked.failure || !checked.snapshot.request) return false;
  const current = checked.snapshot.objects.find((row) => row.id === object.id);
  if (!current || !objectIdentityMatches(current, {
    kind: current.object_kind,
    requestId: current.request_id,
    priceKey: current.price_key,
    payloadDigest: object.payload_digest,
    idempotencyKey: object.idempotency_key,
    metadata: {},
  })) return false;
  let result: Awaited<ReturnType<PricingSyncStore["advanceObject"]>>;
  try {
    result = await context.dependencies.store.advanceObject({
      objectId: current.id,
      expectedStateRevision: current.state_revision,
      nextState,
      providerObjectId,
      verifiedPayloadDigest,
    });
  } catch {
    return false;
  }
  if (result === "identity_conflict") return result;
  return result === nextState;
}

async function reserveSpec(context: CoreContext, spec: ObjectSpec): Promise<PricingSyncObject | PricingSyncOutcome> {
  const checked = await readChecked(context);
  if (checked.failure) return checked.failure;
  if (!checked.snapshot.request) return { status: "missing" };
  const existing = lookupObject(checked.snapshot, spec);
  if (existing) {
    if (!objectIdentityMatches(existing, spec)) return fenceDefinitiveMismatch(context);
    return existing;
  }
  if (checked.snapshot.request.state === "verified") return { status: "in_progress" };
  try {
    await context.dependencies.store.reserveObject({
      requestId: context.identity.requestId,
      objectKind: spec.kind,
      priceKey: spec.priceKey,
      idempotencyKey: spec.idempotencyKey,
      payloadDigest: spec.payloadDigest,
    });
  } catch {
    const afterFailure = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
    const row = afterFailure && lookupObject(afterFailure, spec);
    if (row) return objectIdentityMatches(row, spec) ? row : fenceDefinitiveMismatch(context);
    return { status: "in_progress" };
  }
  const afterReserve = await readChecked(context);
  if (afterReserve.failure) return afterReserve.failure;
  const row = lookupObject(afterReserve.snapshot, spec);
  if (!row) return { status: "in_progress" };
  return objectIdentityMatches(row, spec) ? row : fenceDefinitiveMismatch(context);
}

function productSearchQuery(identity: PricingSyncIdentity): string {
  return `metadata['form_coach_sync_request_id']:'${identity.requestId}' AND metadata['form_coach_object_kind']:'product'`;
}

function priceSearchQuery(identity: PricingSyncIdentity, priceKey: string): string {
  return `metadata['form_coach_sync_request_id']:'${identity.requestId}' AND metadata['form_coach_object_kind']:'price' AND metadata['form_coach_price_key']:'${priceKey}'`;
}

async function searchUniqueCandidate<T extends { id: string }>(input: {
  context: CoreContext;
  query: string;
  search: (page: string | undefined, options: ProviderRequestOptions) => Promise<ProviderSearchPage<T>>;
  retrieve: (id: string, options: ProviderRequestOptions) => Promise<T>;
}): Promise<{ kind: "none" } | { kind: "one"; item: T } | { kind: "ambiguous" } | { kind: "in_progress" }> {
  const candidates = new Map<string, T>();
  let page: string | undefined;
  for (let pageIndex = 0; pageIndex < MAX_SEARCH_PAGES; pageIndex += 1) {
    const options = callOptions(input.context);
    if (!options) return { kind: "in_progress" };
    let response: ProviderSearchPage<T>;
    try {
      response = await input.search(page, options);
    } catch {
      return { kind: "in_progress" };
    }
    if (!Array.isArray(response.data) || (response.hasMore && !response.nextPage)) return { kind: "ambiguous" };
    for (const item of response.data) {
      if (item && typeof item.id === "string" && item.id) candidates.set(item.id, item);
      if (candidates.size > MAX_SEARCH_RESULTS) return { kind: "ambiguous" };
    }
    if (!response.hasMore) {
      if (candidates.size === 0) return { kind: "none" };
      if (candidates.size !== 1) return { kind: "ambiguous" };
      const id = candidates.keys().next().value as string;
      const options = callOptions(input.context);
      if (!options) return { kind: "in_progress" };
      try {
        return { kind: "one", item: await input.retrieve(id, options) };
      } catch {
        return { kind: "in_progress" };
      }
    }
    if (pageIndex === MAX_SEARCH_PAGES - 1) return { kind: "ambiguous" };
    page = response.nextPage ?? undefined;
  }
  return { kind: "ambiguous" };
}

async function bindAndVerifyProduct(
  context: CoreContext,
  spec: ObjectSpec,
  object: PricingSyncObject,
  product: ProviderProduct,
): Promise<{ productId: string } | PricingSyncOutcome> {
  if (!product.id) return { status: "unresolved" };
  let current = object;
  if (current.provider_object_id !== product.id) {
    const bound = await advanceObject(context, current, "bound", product.id, null);
    if (bound === "identity_conflict") return fenceDefinitiveMismatch(context);
    if (!bound) {
      const fresh = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
      const refreshed = fresh && lookupObject(fresh, spec);
      if (!refreshed || refreshed.provider_object_id !== product.id) return { status: "in_progress" };
      current = refreshed;
    } else {
      const fresh = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
      const refreshed = fresh && lookupObject(fresh, spec);
      if (!refreshed) return { status: "in_progress" };
      current = refreshed;
    }
  }
  if (!productMatches(product, spec, context.identity, context.dependencies.livemode)) {
    return fenceDefinitiveMismatch(context);
  }
  if (current.state === "verified") {
    return current.verified_payload_digest === spec.payloadDigest
      ? { productId: product.id }
      : fenceDefinitiveMismatch(context);
  }
  const verified = await advanceObject(context, current, "verified", product.id, spec.payloadDigest);
  if (!verified) {
    const fresh = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
    const refreshed = fresh && lookupObject(fresh, spec);
    if (refreshed?.state === "verified" && refreshed.provider_object_id === product.id
      && refreshed.verified_payload_digest === spec.payloadDigest) return { productId: product.id };
    return { status: "in_progress" };
  }
  return { productId: product.id };
}

async function bindCreatedProductAndVerifyCurrent(
  context: CoreContext,
  spec: ObjectSpec,
  object: PricingSyncObject,
  createReply: ProviderProduct,
): Promise<{ productId: string } | PricingSyncOutcome> {
  if (!createReply.id) return { status: "unresolved" };
  const bound = await advanceObject(context, object, "bound", createReply.id, null);
  if (bound === "identity_conflict") return fenceDefinitiveMismatch(context);
  const snapshot = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
  const current = snapshot && lookupObject(snapshot, spec);
  if (!current || current.provider_object_id !== createReply.id || !["bound", "verified"].includes(current.state)) {
    return { status: "in_progress" };
  }
  if (bound === false && current.state !== "verified") return { status: "in_progress" };
  const options = callOptions(context);
  if (!options) return { status: "in_progress" };
  try {
    const retrieved = await context.dependencies.provider.retrieveProduct(createReply.id, options);
    return bindAndVerifyProduct(context, spec, current, retrieved);
  } catch {
    // The ID stays durably bound; retrieval uncertainty is not a reason to retry create.
    return { status: "in_progress" };
  }
}

async function bindAndVerifyPrice(
  context: CoreContext,
  spec: ObjectSpec,
  object: PricingSyncObject,
  price: ProviderPrice,
  option: PricingCandidate["price_options"][number],
  productId: string,
): Promise<"verified" | PricingSyncOutcome> {
  if (!price.id) return { status: "unresolved" };
  let current = object;
  if (current.provider_object_id !== price.id) {
    const bound = await advanceObject(context, current, "bound", price.id, null);
    if (bound === "identity_conflict") return fenceDefinitiveMismatch(context);
    if (!bound) {
      const fresh = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
      const refreshed = fresh && lookupObject(fresh, spec);
      if (!refreshed || refreshed.provider_object_id !== price.id) return { status: "in_progress" };
      current = refreshed;
    } else {
      const fresh = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
      const refreshed = fresh && lookupObject(fresh, spec);
      if (!refreshed) return { status: "in_progress" };
      current = refreshed;
    }
  }
  if (!priceMatches(price, spec, option, productId, context.dependencies.livemode)) {
    return fenceDefinitiveMismatch(context);
  }
  if (current.state === "verified") {
    return current.verified_payload_digest === spec.payloadDigest ? "verified" : fenceDefinitiveMismatch(context);
  }
  const verified = await advanceObject(context, current, "verified", price.id, spec.payloadDigest);
  if (!verified) {
    const fresh = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
    const refreshed = fresh && lookupObject(fresh, spec);
    if (refreshed?.state === "verified" && refreshed.provider_object_id === price.id
      && refreshed.verified_payload_digest === spec.payloadDigest) return "verified";
    return { status: "in_progress" };
  }
  return "verified";
}

async function bindCreatedPriceAndVerifyCurrent(
  context: CoreContext,
  spec: ObjectSpec,
  object: PricingSyncObject,
  createReply: ProviderPrice,
  option: PricingCandidate["price_options"][number],
  productId: string,
): Promise<"verified" | PricingSyncOutcome> {
  if (!createReply.id) return { status: "unresolved" };
  const bound = await advanceObject(context, object, "bound", createReply.id, null);
  if (bound === "identity_conflict") return fenceDefinitiveMismatch(context);
  const snapshot = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
  const current = snapshot && lookupObject(snapshot, spec);
  if (!current || current.provider_object_id !== createReply.id || !["bound", "verified"].includes(current.state)) {
    return { status: "in_progress" };
  }
  if (bound === false && current.state !== "verified") return { status: "in_progress" };
  const options = callOptions(context);
  if (!options) return { status: "in_progress" };
  try {
    const retrieved = await context.dependencies.provider.retrievePrice(createReply.id, options);
    return bindAndVerifyPrice(context, spec, current, retrieved, option, productId);
  } catch {
    // The ID stays durably bound; retrieval uncertainty is not a reason to retry create.
    return { status: "in_progress" };
  }
}

async function resolveProduct(context: CoreContext, spec: ObjectSpec): Promise<{ productId: string } | PricingSyncOutcome> {
  const value = await reserveSpec(context, spec);
  if ("status" in value) return value;
  if (value.state === "failed") return fenceDefinitiveMismatch(context);
  const provider = context.dependencies.provider;

  if (value.state === "bound" || value.state === "verified") {
    if (!value.provider_object_id) return fenceDefinitiveMismatch(context);
    const options = callOptions(context);
    if (!options) return { status: "in_progress" };
    try {
      const product = await provider.retrieveProduct(value.provider_object_id, options);
      return bindAndVerifyProduct(context, spec, value, product);
    } catch {
      return { status: "in_progress" };
    }
  }

  const now = context.now();
  const createdAt = Date.parse(value.created_at);
  const isFreshReserved = value.state === "reserved"
    && Number.isFinite(createdAt)
    && createdAt <= now
    && now - createdAt < SAFE_CREATE_AGE_MS;

  if (isFreshReserved) {
    const options = createCallOptions(context, value);
    if (!options || !spec.productParams) return { status: "in_progress" };
    let product: ProviderProduct;
    try {
      product = await provider.createProduct(spec.productParams, options);
    } catch {
      await advanceObject(context, value, "unknown", null, null).catch(() => false);
      return { status: "unresolved" };
    }
    return bindCreatedProductAndVerifyCurrent(context, spec, value, product);
  }

  if (value.state === "reserved") {
    const advanced = await advanceObject(context, value, "unknown", null, null).catch(() => false);
    if (!advanced) return { status: "in_progress" };
  }
  const search = await searchUniqueCandidate({
    context,
    query: productSearchQuery(context.identity),
    search: (page, options) => provider.searchProducts({ query: productSearchQuery(context.identity), limit: SEARCH_PAGE_SIZE, ...(page ? { page } : {}) }, options),
    retrieve: (id, options) => provider.retrieveProduct(id, options),
  });
  if (search.kind === "in_progress") return { status: "in_progress" };
  if (search.kind === "none" || search.kind === "ambiguous") return { status: "unresolved" };
  const fresh = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
  const current = fresh && lookupObject(fresh, spec);
  if (!current) return { status: "in_progress" };
  return bindAndVerifyProduct(context, spec, current, search.item);
}

async function resolvePrice(
  context: CoreContext,
  spec: ObjectSpec,
  option: PricingCandidate["price_options"][number],
  productId: string,
): Promise<"verified" | PricingSyncOutcome> {
  const value = await reserveSpec(context, spec);
  if ("status" in value) return value;
  if (value.state === "failed") return fenceDefinitiveMismatch(context);
  const provider = context.dependencies.provider;

  if (value.state === "bound" || value.state === "verified") {
    if (!value.provider_object_id) return fenceDefinitiveMismatch(context);
    const options = callOptions(context);
    if (!options) return { status: "in_progress" };
    try {
      const price = await provider.retrievePrice(value.provider_object_id, options);
      return bindAndVerifyPrice(context, spec, value, price, option, productId);
    } catch {
      return { status: "in_progress" };
    }
  }

  const now = context.now();
  const createdAt = Date.parse(value.created_at);
  const isFreshReserved = value.state === "reserved"
    && Number.isFinite(createdAt)
    && createdAt <= now
    && now - createdAt < SAFE_CREATE_AGE_MS;

  if (isFreshReserved) {
    const options = createCallOptions(context, value);
    if (!options || !spec.priceParams) return { status: "in_progress" };
    let price: ProviderPrice;
    try {
      price = await provider.createPrice({ ...spec.priceParams, product: productId }, options);
    } catch {
      await advanceObject(context, value, "unknown", null, null).catch(() => false);
      return { status: "unresolved" };
    }
    return bindCreatedPriceAndVerifyCurrent(context, spec, value, price, option, productId);
  }

  if (value.state === "reserved") {
    const advanced = await advanceObject(context, value, "unknown", null, null).catch(() => false);
    if (!advanced) return { status: "in_progress" };
  }
  const query = priceSearchQuery(context.identity, option.price_key);
  const search = await searchUniqueCandidate({
    context,
    query,
    search: (page, options) => provider.searchPrices({ query, limit: SEARCH_PAGE_SIZE, ...(page ? { page } : {}) }, options),
    retrieve: (id, options) => provider.retrievePrice(id, options),
  });
  if (search.kind === "in_progress") return { status: "in_progress" };
  if (search.kind === "none" || search.kind === "ambiguous") return { status: "unresolved" };
  const fresh = await context.dependencies.store.readSnapshot(context.identity.requestId).catch(() => null);
  const current = fresh && lookupObject(fresh, spec);
  if (!current) return { status: "in_progress" };
  return bindAndVerifyPrice(context, spec, current, search.item, option, productId);
}

/**
 * Resumes one persisted Product/Price sync request. Unknown or aged reservations
 * only search and retrieve; they never create a new provider object or key.
 */
export async function syncStripePricingRequest(
  identity: PricingSyncIdentity,
  dependencies: SyncDependencies,
): Promise<PricingSyncOutcome> {
  const now = dependencies.now ?? Date.now;
  const runTimeoutMs = dependencies.runTimeoutMs ?? MAX_RUN_MS;
  const context: CoreContext = {
    identity,
    dependencies,
    now,
    deadline: now() + Math.max(1, Math.min(runTimeoutMs, MAX_RUN_MS)),
    providerCallTimeoutMs: Math.max(1, Math.min(dependencies.providerCallTimeoutMs ?? MAX_PROVIDER_CALL_MS, MAX_PROVIDER_CALL_MS)),
  };

  let checked: { snapshot: PricingSyncSnapshot; failure: PricingSyncOutcome | null };
  try {
    checked = await readChecked(context);
  } catch {
    return { status: "in_progress" };
  }
  if (checked.failure) return checked.failure;
  if (identity.candidate.status !== "live" || identity.candidate.currency !== "USD") return { status: "identity_mismatch" };

  const product = await resolveProduct(context, productSpec(identity, dependencies.livemode));
  if ("status" in product) return product;

  for (const option of identity.candidate.price_options) {
    if (context.now() >= context.deadline) return { status: "in_progress" };
    const result = await resolvePrice(context, priceSpec(identity, option, product.productId, dependencies.livemode), option, product.productId);
    if (result !== "verified") return result;
  }

  const final = await readChecked(context).catch(() => null);
  if (!final || final.failure || !final.snapshot.request) return final?.failure ?? { status: "in_progress" };
  const expectedCount = 1 + identity.candidate.price_options.length;
  const verified = final.snapshot.objects.filter((object) => object.state === "verified");
  if (verified.length !== expectedCount || final.snapshot.objects.length !== expectedCount) return { status: "in_progress" };
  return { status: "ready_to_publish" };
}
