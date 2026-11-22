import "server-only";

import type Stripe from "stripe";
import { requireAdmin } from "@/lib/auth";
import { getStripe, isStripeTestMode } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizePricingCandidate,
  pricingCandidateDigest,
  type ExistingPricingRequest,
} from "@/lib/form-coach/pricing-admin-server";
import {
  syncStripePricingRequest,
  type PricingSyncIdentity,
  type PricingSyncObject,
  type PricingSyncSnapshot,
  type PricingSyncStore,
  type ProviderPrice,
  type ProviderProduct,
  type ProviderSearchPage,
  type ProviderRequestOptions,
  type PricingSyncObjectKind,
  type StripePricingProvider,
} from "@/lib/form-coach/stripe-pricing-sync";

const MAX_SYNC_OBJECTS = 51;

type Raw = Record<string, unknown>;

function record(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Raw
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function requestFrom(value: unknown): PricingSyncSnapshot["request"] {
  const row = record(value);
  if (!row) return null;
  const requestId = text(row.request_id);
  const featureKey = text(row.feature_key);
  const expectedRevision = integer(row.expected_revision);
  const requestedBy = text(row.requested_by);
  const digest = text(row.request_digest);
  const state = text(row.state);
  const stateRevision = integer(row.state_revision);
  const publishedRevision = row.published_revision === null ? null : integer(row.published_revision);
  if (!requestId || !featureKey || expectedRevision === null || !requestedBy || !digest
    || !state || stateRevision === null || (publishedRevision === null && row.published_revision !== null)) return null;
  if (!(["reserved", "unknown", "verified", "cas_applied", "cas_stale", "failed"] as string[]).includes(state)) return null;
  return {
    request_id: requestId,
    feature_key: featureKey,
    expected_revision: expectedRevision,
    requested_by: requestedBy,
    request_digest: digest,
    candidate_payload: row.candidate_payload,
    state: state as NonNullable<PricingSyncSnapshot["request"]>["state"],
    state_revision: stateRevision,
    published_revision: publishedRevision,
  };
}

function objectsFrom(value: unknown): PricingSyncObject[] {
  if (!Array.isArray(value)) throw new Error("Pricing sync object read returned an invalid page");
  if (value.length > MAX_SYNC_OBJECTS) throw new Error("Pricing sync object list exceeded its bounded request size");
  return value.map((entry) => {
    const row = record(entry);
    if (!row) throw new Error("Pricing sync object row is malformed");
    const id = text(row.id);
    const requestId = text(row.request_id);
    const kind = text(row.object_kind);
    const priceKey = row.price_key === null ? null : text(row.price_key);
    const idempotencyKey = text(row.idempotency_key);
    const payloadDigest = text(row.payload_digest);
    const state = text(row.state);
    const providerObjectId = row.provider_object_id === null ? null : text(row.provider_object_id);
    const verifiedDigest = row.verified_payload_digest === null ? null : text(row.verified_payload_digest);
    const stateRevision = integer(row.state_revision);
    const createdAt = text(row.created_at);
    if (!id || !requestId || (kind !== "product" && kind !== "price")
      || (kind === "product" && priceKey !== null) || (kind === "price" && !priceKey)
      || !idempotencyKey || !payloadDigest
      || !(["reserved", "unknown", "bound", "verified", "failed"] as string[]).includes(state ?? "")
      || (providerObjectId === null && row.provider_object_id !== null)
      || (verifiedDigest === null && row.verified_payload_digest !== null)
      || stateRevision === null || !createdAt) {
      throw new Error("Pricing sync object row is malformed");
    }
    return {
      id,
      request_id: requestId,
      object_kind: kind as PricingSyncObjectKind,
      price_key: priceKey,
      idempotency_key: idempotencyKey,
      payload_digest: payloadDigest,
      state: state as PricingSyncObject["state"],
      provider_object_id: providerObjectId,
      verified_payload_digest: verifiedDigest,
      state_revision: stateRevision,
      created_at: createdAt,
    };
  });
}

function firstRow(value: unknown): Raw | null {
  const first = Array.isArray(value) ? value[0] : value;
  return record(first);
}

function createStore(): PricingSyncStore {
  const db = createAdminClient();
  return {
    async readSnapshot(requestId): Promise<PricingSyncSnapshot> {
      const [requestResult, objectResult, currentResult] = await Promise.all([
        db.from("feature_pricing_sync_requests")
          .select("request_id,feature_key,expected_revision,requested_by,request_digest,candidate_payload,state,state_revision,published_revision")
          .eq("request_id", requestId)
          .maybeSingle(),
        db.from("feature_pricing_sync_objects")
          .select("id,request_id,object_kind,price_key,idempotency_key,payload_digest,state,provider_object_id,verified_payload_digest,state_revision,created_at")
          .eq("request_id", requestId)
          .order("created_at", { ascending: true })
          .limit(MAX_SYNC_OBJECTS + 1),
        db.from("feature_pricing_current")
          .select("revision")
          .eq("feature_key", "form_coach")
          .maybeSingle(),
      ]);
      if (requestResult.error || objectResult.error || currentResult.error) throw new Error("Pricing sync state is unavailable");
      const currentRow = record(currentResult.data);
      const currentRevision = integer(currentRow?.revision);
      return {
        request: requestFrom(requestResult.data),
        objects: objectsFrom(objectResult.data),
        currentRevision,
      };
    },
    async reserveObject(input) {
      const { data, error } = await db.rpc("reserve_feature_pricing_sync_object", {
        p_request_id: input.requestId,
        p_object_kind: input.objectKind,
        p_price_key: input.priceKey,
        p_idempotency_key: input.idempotencyKey,
        p_payload_digest: input.payloadDigest,
      });
      if (error) throw error;
      const outcome = firstRow(data)?.outcome;
      if (outcome === "reserved" || outcome === "existing") return outcome;
      if (outcome === "request_unavailable") return outcome;
      throw new Error("Pricing sync reservation returned an unknown outcome");
    },
    async advanceObject(input) {
      const { data, error } = await db.rpc("advance_feature_pricing_sync_object", {
        p_object_id: input.objectId,
        p_expected_state_revision: input.expectedStateRevision,
        p_next_state: input.nextState,
        p_provider_object_id: input.providerObjectId,
        p_verified_payload_digest: input.verifiedPayloadDigest,
      });
      if (error?.code === "23505") return "identity_conflict";
      if (error) throw error;
      if (["unknown", "bound", "verified", "cas_stale", "request_unavailable", "missing", "identity_conflict"].includes(String(data))) {
        return data as Awaited<ReturnType<PricingSyncStore["advanceObject"]>>;
      }
      throw new Error("Pricing sync transition returned an unknown outcome");
    },
    async fenceRequest(input) {
      const { data, error } = await db.rpc("service_fence_feature_pricing_sync_failure", {
        p_request_id: input.requestId,
        p_requested_by: input.requestedBy,
        p_feature_key: input.featureKey,
        p_request_digest: input.requestDigest,
        p_expected_revision: input.expectedRevision,
        p_expected_state_revision: input.expectedStateRevision,
      });
      if (error) throw error;
      const outcome = typeof data === "string" ? data : firstRow(data)?.outcome;
      if (["failed", "already_failed", "already_published", "cas_stale", "identity_mismatch", "missing", "request_unavailable"].includes(String(outcome))) {
        return outcome as Awaited<ReturnType<PricingSyncStore["fenceRequest"]>>;
      }
      throw new Error("Pricing sync failure fence returned an unknown outcome");
    },
  };
}

function toProduct(value: Stripe.Product): ProviderProduct {
  return {
    id: value.id,
    active: value.active,
    name: value.name,
    description: value.description,
    metadata: value.metadata,
    livemode: value.livemode,
  };
}

function toPrice(value: Stripe.Price): ProviderPrice {
  return {
    id: value.id,
    active: value.active,
    billing_scheme: value.billing_scheme,
    currency: value.currency,
    custom_unit_amount: value.custom_unit_amount,
    livemode: value.livemode,
    metadata: value.metadata,
    product: typeof value.product === "string" ? value.product : { id: value.product.id },
    recurring: value.recurring ? {
      interval: value.recurring.interval,
      interval_count: value.recurring.interval_count,
      usage_type: value.recurring.usage_type,
    } : null,
    transform_quantity: value.transform_quantity,
    type: value.type,
    unit_amount: value.unit_amount,
    unit_amount_decimal: value.unit_amount_decimal,
  };
}

function requestOptions(options: ProviderRequestOptions): Stripe.RequestOptions {
  return {
    timeout: options.timeout,
    maxNetworkRetries: options.maxNetworkRetries,
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
  };
}

export function stripePricingProvider(stripe: Stripe): StripePricingProvider {
  return {
    async createProduct(params, options) {
      return toProduct(await stripe.products.create(params, requestOptions(options)));
    },
    async retrieveProduct(id, options) {
      return toProduct(await stripe.products.retrieve(id, requestOptions(options)));
    },
    async searchProducts(params, options): Promise<ProviderSearchPage<ProviderProduct>> {
      const response = await stripe.products.search(params, requestOptions(options));
      return { data: response.data.map(toProduct), hasMore: response.has_more, nextPage: response.next_page };
    },
    async createPrice(params, options) {
      return toPrice(await stripe.prices.create(params, requestOptions(options)));
    },
    async retrievePrice(id, options) {
      return toPrice(await stripe.prices.retrieve(id, requestOptions(options)));
    },
    async searchPrices(params, options): Promise<ProviderSearchPage<ProviderPrice>> {
      const response = await stripe.prices.search(params, requestOptions(options));
      return { data: response.data.map(toPrice), hasMore: response.has_more, nextPage: response.next_page };
    },
  };
}

/** Resolve an admin's persisted candidate and run only its reserved provider sync. */
export async function syncCurrentAdminPricingRequest(input: {
  requestId: string;
  expectedRevision: number;
}) {
  const { profile } = await requireAdmin();
  const store = createStore();
  let snapshot: PricingSyncSnapshot;
  try {
    snapshot = await store.readSnapshot(input.requestId);
  } catch {
    return { status: "in_progress" as const };
  }
  const request = snapshot.request as ExistingPricingRequest | null;
  if (!request) return { status: "missing" as const };
  if (request.requested_by !== profile.id || request.feature_key !== "form_coach"
    || request.expected_revision !== input.expectedRevision) {
    return { status: "identity_mismatch" as const };
  }

  let candidate;
  try {
    candidate = normalizePricingCandidate(request.candidate_payload);
  } catch {
    return { status: "identity_mismatch" as const };
  }
  const requestDigest = pricingCandidateDigest(candidate);
  if (requestDigest !== request.request_digest || candidate.status !== "live") {
    return { status: "identity_mismatch" as const };
  }
  if (request.state === "cas_applied" || request.published_revision !== null) return { status: "already_applied" as const };
  if (request.state === "failed") return { status: "failed" as const };
  if (request.state === "cas_stale" || snapshot.currentRevision !== input.expectedRevision) return { status: "stale" as const };

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    return { status: "in_progress" as const };
  }
  const identity: PricingSyncIdentity = {
    requestId: input.requestId,
    adminId: profile.id,
    expectedRevision: input.expectedRevision,
    requestDigest,
    candidate,
  };
  return syncStripePricingRequest(identity, {
    store,
    provider: stripePricingProvider(stripe),
    livemode: !isStripeTestMode(),
  });
}
