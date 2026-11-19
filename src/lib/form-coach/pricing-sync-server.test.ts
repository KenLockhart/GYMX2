import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { normalizePricingCandidate, pricingCandidateDigest } from "@/lib/form-coach/pricing-admin-server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  getStripe: vi.fn(),
  isStripeTestMode: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/stripe", () => ({ getStripe: mocks.getStripe, isStripeTestMode: mocks.isStripeTestMode }));

import { stripePricingProvider, syncCurrentAdminPricingRequest } from "./pricing-sync-server";

const adminId = "91100000-0000-0000-0000-000000000001";
const requestId = "92100000-0000-0000-0000-000000000001";
const candidate = normalizePricingCandidate({
  status: "live",
  payer: "coach",
  currency: "USD",
  display_name: "Form Coach",
  description: "Movement feedback",
  marketing_copy: "Practice with feedback.",
  trial_days: 0,
  trial_assessments: 0,
  billing_model: "subscription",
  price_options: [{ price_key: "monthly", amount_cents: 1200, currency: "USD", interval: "month", credits_per_pack: null }],
});

function createQueryRows(input: {
  request?: Record<string, unknown> | null;
  objects?: Record<string, unknown>[];
  current?: Record<string, unknown> | null;
}) {
  const query = (table: string) => {
    const data = table === "feature_pricing_sync_requests"
      ? input.request ?? null
      : table === "feature_pricing_sync_objects"
        ? input.objects ?? []
        : input.current ?? null;
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(async () => ({ data, error: null }));
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return builder;
  };
  return { from: vi.fn(query) };
}

function savedRequest(overrides: Record<string, unknown> = {}) {
  return {
    request_id: requestId,
    feature_key: "form_coach",
    expected_revision: 1,
    requested_by: adminId,
    request_digest: pricingCandidateDigest(candidate),
    candidate_payload: candidate,
    state: "reserved",
    state_revision: 0,
    published_revision: null,
    ...overrides,
  };
}

function providerStripe() {
  const product = {
    id: "prod_private",
    active: true,
    name: "Form Coach",
    description: "Movement feedback",
    metadata: { feature_key: "form_coach" },
    livemode: false,
  };
  const price = {
    id: "price_private",
    active: true,
    billing_scheme: "per_unit",
    currency: "usd",
    custom_unit_amount: null,
    livemode: false,
    metadata: { feature_key: "form_coach" },
    product: "prod_private",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    transform_quantity: null,
    type: "recurring",
    unit_amount: 1200,
    unit_amount_decimal: "1200",
  };
  return {
    products: {
      create: vi.fn(async () => product),
      retrieve: vi.fn(async () => product),
      search: vi.fn(async () => ({ data: [product], has_more: true, next_page: "page-2" })),
    },
    prices: {
      create: vi.fn(async () => price),
      retrieve: vi.fn(async () => price),
      search: vi.fn(async () => ({ data: [price], has_more: false, next_page: null })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ profile: { id: adminId, role: "admin" } });
  mocks.isStripeTestMode.mockReturnValue(true);
});

describe("Form Coach pricing sync server boundary", () => {
  it("maps pinned Stripe responses and search cursors without losing the next page", async () => {
    const stripe = providerStripe();
    const provider = stripePricingProvider(stripe as unknown as Stripe);
    const options = { timeout: 5000, maxNetworkRetries: 0 as const, idempotencyKey: "persisted-key" };
    const productPage = await provider.searchProducts({ query: "metadata['form_coach_sync_request_id']:'request'", limit: 100 }, options);
    const pricePage = await provider.searchPrices({ query: "metadata['form_coach_price_key']:'monthly'", limit: 100, page: "page-2" }, options);

    expect(productPage).toMatchObject({ hasMore: true, nextPage: "page-2", data: [{ id: "prod_private", livemode: false }] });
    expect(pricePage).toMatchObject({ hasMore: false, nextPage: null, data: [{ id: "price_private", unit_amount: 1200, recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } }] });
    expect(stripe.products.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }), expect.objectContaining({ timeout: 5000, maxNetworkRetries: 0, idempotencyKey: "persisted-key" }));
    expect(stripe.prices.search).toHaveBeenCalledWith(expect.objectContaining({ page: "page-2" }), expect.objectContaining({ maxNetworkRetries: 0 }));
  });

  it("checks current admin ownership before obtaining the Stripe adapter", async () => {
    mocks.createAdminClient.mockReturnValue(createQueryRows({
      request: savedRequest({ requested_by: "91100000-0000-0000-0000-000000000099" }),
      current: { revision: 1 },
      objects: [],
    }));

    await expect(syncCurrentAdminPricingRequest({ requestId, expectedRevision: 1 })).resolves.toEqual({ status: "identity_mismatch" });
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("does not contact Stripe for terminal saved requests and returns no provider identifiers", async () => {
    const stripe = providerStripe();
    mocks.getStripe.mockReturnValue(stripe as unknown as Stripe);
    mocks.createAdminClient.mockReturnValue(createQueryRows({
      request: savedRequest({ state: "failed", state_revision: 2 }),
      current: { revision: 1 },
      objects: [{
        id: "private-row-id", request_id: requestId, object_kind: "product", price_key: null,
        idempotency_key: `form-coach-price-sync:${requestId}:product`, payload_digest: "a".repeat(64),
        state: "bound", provider_object_id: "prod_private", verified_payload_digest: null,
        state_revision: 1, created_at: "2026-11-19T00:00:00Z",
      }],
    }));

    const result = await syncCurrentAdminPricingRequest({ requestId, expectedRevision: 1 });
    expect(result).toEqual({ status: "failed" });
    expect(mocks.getStripe).not.toHaveBeenCalled();
    expect(stripe.products.create).not.toHaveBeenCalled();
    expect(stripe.products.retrieve).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("prod_private");
    expect(JSON.stringify(result)).not.toContain("private-row-id");
  });

  it("rejects a stale current revision before contacting Stripe", async () => {
    const stripe = providerStripe();
    mocks.getStripe.mockReturnValue(stripe as unknown as Stripe);
    mocks.createAdminClient.mockReturnValue(createQueryRows({
      request: savedRequest(),
      current: { revision: 2 },
      objects: [],
    }));

    await expect(syncCurrentAdminPricingRequest({ requestId, expectedRevision: 1 })).resolves.toEqual({ status: "stale" });
    expect(stripe.products.create).not.toHaveBeenCalled();
  });

  it("reconciles a previously published exact request without requiring the old current revision", async () => {
    mocks.createAdminClient.mockReturnValue(createQueryRows({
      request: savedRequest({ state: "cas_applied", state_revision: 2, published_revision: 2 }),
      current: { revision: 2 },
      objects: [],
    }));

    await expect(syncCurrentAdminPricingRequest({ requestId, expectedRevision: 1 })).resolves.toEqual({ status: "already_applied" });
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });
});
