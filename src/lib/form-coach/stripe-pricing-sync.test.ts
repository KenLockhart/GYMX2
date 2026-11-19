import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PricingCandidate } from "@/lib/form-coach/pricing-admin-server";
import {
  pricingSyncObjectIdempotencyKey,
  pricingSyncCandidateDigest,
  syncStripePricingRequest,
  type PricingSyncIdentity,
  type PricingSyncObject,
  type PricingSyncSnapshot,
  type PricingSyncStore,
  type ProviderPrice,
  type ProviderProduct,
  type ProviderRequestOptions,
  type StripePricingProvider,
} from "./stripe-pricing-sync";

const NOW = Date.parse("2026-11-19T20:00:00.000Z");
const ADMIN_ID = "91100000-0000-0000-0000-000000000001";
const REQUEST_ID = "92100000-0000-0000-0000-000000000001";

function candidate(overrides: Partial<PricingCandidate> = {}): PricingCandidate {
  const value = {
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
    ...overrides,
  };
  return Object.freeze({
    ...value,
    ...overrides,
    price_options: Object.freeze([...(overrides.price_options ?? value.price_options)]),
  }) as PricingCandidate;
}

function createFixture(inputCandidate = candidate(), options: { requestState?: PricingSyncSnapshot["request"] extends infer T ? T extends { state: infer S } ? S : never : never; currentRevision?: number; objects?: PricingSyncObject[]; createdAt?: string } = {}) {
  const digest = pricingSyncCandidateDigest(inputCandidate);
  const request: NonNullable<PricingSyncSnapshot["request"]> = {
    request_id: REQUEST_ID,
    feature_key: "form_coach",
    expected_revision: 1,
    requested_by: ADMIN_ID,
    request_digest: digest,
    candidate_payload: inputCandidate,
    state: options.requestState ?? "reserved",
    state_revision: options.requestState === "unknown" ? 1 : options.requestState === "verified" ? 2 : options.requestState === "cas_applied" ? 3 : 0,
    published_revision: options.requestState === "cas_applied" ? 2 : null,
  };
  let objectNumber = 0;
  const objects = structuredClone(options.objects ?? []);
  const snapshot = (): PricingSyncSnapshot => structuredClone({ request, objects, currentRevision: options.currentRevision ?? 1 });
  const store: PricingSyncStore = {
    readSnapshot: vi.fn(async () => snapshot()),
    reserveObject: vi.fn(async (input) => {
      if (request.state !== "reserved" && request.state !== "unknown") return "request_unavailable";
      const existing = objects.find((object) => object.object_kind === input.objectKind && object.price_key === input.priceKey);
      if (existing) {
        if (existing.idempotency_key !== input.idempotencyKey || existing.payload_digest !== input.payloadDigest) {
          throw new Error("immutable object identity conflict");
        }
        return "existing";
      }
      if (objects.some((object) => object.idempotency_key === input.idempotencyKey)) {
        throw new Error("idempotency key must be unique across object kinds");
      }
      objectNumber += 1;
      objects.push({
        id: `object-${objectNumber}`,
        request_id: REQUEST_ID,
        object_kind: input.objectKind,
        price_key: input.priceKey,
        idempotency_key: input.idempotencyKey,
        payload_digest: input.payloadDigest,
        state: "reserved",
        provider_object_id: null,
        verified_payload_digest: null,
        state_revision: 0,
        created_at: options.createdAt ?? new Date(NOW).toISOString(),
      });
      return "reserved";
    }),
    advanceObject: vi.fn(async (input) => {
      const object = objects.find((row) => row.id === input.objectId);
      if (!object) return "missing";
      if (request.state !== "reserved" && request.state !== "unknown") return "request_unavailable";
      if (object.state_revision !== input.expectedStateRevision) return "cas_stale";
      if (object.state === "reserved" && !["unknown", "bound"].includes(input.nextState)) return "request_unavailable";
      if (object.state === "unknown" && !["bound"].includes(input.nextState)) return "request_unavailable";
      if (object.state === "bound" && input.nextState !== "verified") return "request_unavailable";
      object.state = input.nextState;
      if (input.nextState === "bound" && input.providerObjectId) object.provider_object_id = input.providerObjectId;
      if (input.nextState === "verified") object.verified_payload_digest = input.verifiedPayloadDigest;
      object.state_revision += 1;
      return input.nextState;
    }),
    fenceRequest: vi.fn(async (input) => {
      if (request.request_id !== input.requestId || request.requested_by !== input.requestedBy
        || request.feature_key !== input.featureKey || request.request_digest !== input.requestDigest
        || request.expected_revision !== input.expectedRevision) return "identity_mismatch";
      if (request.state === "cas_applied" || request.published_revision !== null) return "already_published";
      if (request.state === "failed") return "already_failed";
      if ((options.currentRevision ?? 1) !== input.expectedRevision || request.state_revision !== input.expectedStateRevision) return "cas_stale";
      request.state = "failed";
      request.state_revision += 1;
      return "failed";
    }),
  };

  const productObjects = new Map<string, ProviderProduct>();
  const priceObjects = new Map<string, ProviderPrice>();
  let nextProduct = 0;
  let nextPrice = 0;
  const provider: StripePricingProvider = {
    createProduct: vi.fn(async (params, options: ProviderRequestOptions) => {
      void options;
      nextProduct += 1;
      const product = {
        id: `prod-${nextProduct}`,
        active: params.active,
        name: params.name,
        description: params.description ?? null,
        metadata: params.metadata,
        livemode: true,
      } satisfies ProviderProduct;
      productObjects.set(product.id, product);
      return product;
    }),
    retrieveProduct: vi.fn(async (id) => {
      const product = productObjects.get(id);
      if (!product) throw Object.assign(new Error("not found"), { statusCode: 404 });
      return product;
    }),
    searchProducts: vi.fn(async () => ({ data: [], hasMore: false, nextPage: null })),
    createPrice: vi.fn(async (params, options: ProviderRequestOptions) => {
      void options;
      nextPrice += 1;
      const price: ProviderPrice = {
        id: `price-${nextPrice}`,
        active: params.active,
        billing_scheme: params.billing_scheme,
        currency: params.currency,
        custom_unit_amount: null,
        livemode: true,
        metadata: params.metadata,
        product: params.product,
        recurring: params.recurring ?? null,
        transform_quantity: null,
        type: params.recurring ? "recurring" : "one_time",
        unit_amount: params.unit_amount,
        unit_amount_decimal: String(params.unit_amount),
      };
      priceObjects.set(price.id, price);
      return price;
    }),
    retrievePrice: vi.fn(async (id) => {
      const price = priceObjects.get(id);
      if (!price) throw Object.assign(new Error("not found"), { statusCode: 404 });
      return price;
    }),
    searchPrices: vi.fn(async () => ({ data: [], hasMore: false, nextPage: null })),
  };

  const identity: PricingSyncIdentity = {
    requestId: REQUEST_ID,
    adminId: ADMIN_ID,
    expectedRevision: 1,
    requestDigest: digest,
    candidate: inputCandidate,
  };
  return { identity, store, provider, snapshot, request, objects, productObjects, priceObjects };
}

describe("Form Coach Stripe pricing sync", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("persists stable reservations before creating and verifies an exact Product and Price", async () => {
    const fixture = createFixture();
    const outcome = await syncStripePricingRequest(fixture.identity, {
      store: fixture.store,
      provider: fixture.provider,
      livemode: true,
      now: () => NOW,
    });

    expect(outcome).toEqual({ status: "ready_to_publish" });
    expect(fixture.store.reserveObject).toHaveBeenCalledTimes(2);
    expect(fixture.provider.createProduct).toHaveBeenCalledWith(expect.objectContaining({ active: true, name: "Form Coach" }), expect.objectContaining({ maxNetworkRetries: 0, idempotencyKey: pricingSyncObjectIdempotencyKey(REQUEST_ID, "product", null) }));
    expect(fixture.provider.createPrice).toHaveBeenCalledWith(expect.objectContaining({
      active: true,
      billing_scheme: "per_unit",
      currency: "usd",
      unit_amount: 1200,
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    }), expect.objectContaining({ maxNetworkRetries: 0, idempotencyKey: pricingSyncObjectIdempotencyKey(REQUEST_ID, "price", "monthly") }));
    expect(vi.mocked(fixture.provider.createProduct).mock.calls[0]?.[1].timeout).toBeLessThanOrEqual(7000);
    expect(vi.mocked(fixture.provider.createPrice).mock.calls[0]?.[1].timeout).toBeLessThanOrEqual(7000);
    expect(fixture.objects.map((object) => object.state)).toEqual(["verified", "verified"]);
    expect(fixture.objects.every((object) => object.verified_payload_digest === object.payload_digest)).toBe(true);
  });

  it("creates fixed one-time pack prices without recurring or customer-adjustable fields", async () => {
    const packCandidate = candidate({
      billing_model: "per_assessment",
      price_options: [{ price_key: "pack_5", amount_cents: 5000, currency: "USD", interval: null, credits_per_pack: 5 }],
    });
    const fixture = createFixture(packCandidate);
    expect(await syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    })).toEqual({ status: "ready_to_publish" });
    const call = vi.mocked(fixture.provider.createPrice).mock.calls[0];
    expect(call[0]).toMatchObject({ billing_scheme: "per_unit", unit_amount: 5000, currency: "usd" });
    expect(call[0]).not.toHaveProperty("recurring");
    expect(call[0]).not.toHaveProperty("custom_unit_amount");
    expect(call[0]).not.toHaveProperty("transform_quantity");
  });

  it("uses a kind-namespaced Price key when the valid price key is product", async () => {
    const keyCandidate = candidate({
      price_options: [{ price_key: "product", amount_cents: 1200, currency: "USD", interval: "month", credits_per_pack: null }],
    });
    const fixture = createFixture(keyCandidate);

    await expect(syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "ready_to_publish" });

    expect(fixture.objects.map((object) => object.idempotency_key)).toEqual([
      `form-coach-price-sync:${REQUEST_ID}:product`,
      `form-coach-price-sync:${REQUEST_ID}:price:product`,
    ]);
    expect(new Set(fixture.objects.map((object) => object.idempotency_key)).size).toBe(2);
  });

  it("resumes a known legacy Price key without rewriting the persisted idempotency key", async () => {
    const fixture = createFixture();
    const reserve = vi.mocked(fixture.store.reserveObject);
    const defaultReserve = reserve.getMockImplementation();
    reserve.mockImplementation(async (input) => {
      if (input.objectKind !== "price") return defaultReserve!(input);
      fixture.objects.push({
        id: "legacy-price-row",
        request_id: REQUEST_ID,
        object_kind: "price",
        price_key: "monthly",
        idempotency_key: `form-coach-price-sync:${REQUEST_ID}:monthly`,
        payload_digest: input.payloadDigest,
        state: "reserved",
        provider_object_id: null,
        verified_payload_digest: null,
        state_revision: 0,
        created_at: new Date(NOW).toISOString(),
      });
      throw new Error("a concurrent legacy reservation won the insert");
    });

    await expect(syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "ready_to_publish" });

    expect(fixture.provider.createPrice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: `form-coach-price-sync:${REQUEST_ID}:monthly` }),
    );
    expect(fixture.objects.find((object) => object.object_kind === "price")?.idempotency_key)
      .toBe(`form-coach-price-sync:${REQUEST_ID}:monthly`);
  });

  it.each(["product", "price"] as const)(
    "binds the cached %s create ID then rejects the now-inactive retrieved object",
    async (kind) => {
      const fixture = createFixture();
      if (kind === "product") {
        const create = vi.mocked(fixture.provider.createProduct);
        const defaultCreate = create.getMockImplementation();
        create.mockImplementationOnce(async (params, options) => {
          const cachedReply = await defaultCreate!(params, options);
          fixture.productObjects.set(cachedReply.id, { ...cachedReply, active: false });
          return { ...cachedReply, active: true };
        });
      } else {
        const create = vi.mocked(fixture.provider.createPrice);
        const defaultCreate = create.getMockImplementation();
        create.mockImplementationOnce(async (params, options) => {
          const cachedReply = await defaultCreate!(params, options);
          fixture.priceObjects.set(cachedReply.id, { ...cachedReply, active: false });
          return { ...cachedReply, active: true };
        });
      }

      await expect(syncStripePricingRequest(fixture.identity, {
        store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
      })).resolves.toEqual({ status: "fenced_failed" });

      expect(fixture.request.state).toBe("failed");
      if (kind === "product") {
        expect(fixture.provider.retrieveProduct).toHaveBeenCalledWith("prod-1", expect.anything());
        expect(fixture.objects[0]).toMatchObject({ state: "bound", provider_object_id: "prod-1" });
        expect(fixture.provider.createPrice).not.toHaveBeenCalled();
      } else {
        expect(fixture.provider.retrievePrice).toHaveBeenCalledWith("price-1", expect.anything());
        expect(fixture.objects.find((object) => object.object_kind === "price"))
          .toMatchObject({ state: "bound", provider_object_id: "price-1" });
      }
    },
  );

  it("keeps a returned object ID bound and pending when exact-ID retrieval is uncertain", async () => {
    const fixture = createFixture();
    vi.mocked(fixture.provider.retrieveProduct).mockRejectedValueOnce(new Error("provider read timed out"));

    await expect(syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "in_progress" });

    expect(fixture.objects[0]).toMatchObject({ state: "bound", provider_object_id: "prod-1" });
    expect(fixture.provider.createProduct).toHaveBeenCalledTimes(1);
    expect(fixture.provider.createPrice).not.toHaveBeenCalled();
  });

  it.each([
    ["billing scheme", (price: ProviderPrice) => ({ ...price, billing_scheme: "tiered" })],
    ["transform quantity", (price: ProviderPrice) => ({ ...price, transform_quantity: { divide_by: 2, round: "up" } })],
    ["customer-adjustable amount", (price: ProviderPrice) => ({ ...price, custom_unit_amount: { enabled: true } })],
    ["interval count", (price: ProviderPrice) => ({ ...price, recurring: { ...price.recurring!, interval_count: 2 } })],
    ["licensed recurring mode", (price: ProviderPrice) => ({ ...price, recurring: { ...price.recurring!, usage_type: "metered" } })],
    ["decimal amount", (price: ProviderPrice) => ({ ...price, unit_amount_decimal: "1200.5" })],
    ["test/live mode", (price: ProviderPrice) => ({ ...price, livemode: false })],
  ])("fences the parent when retrieved Price has a definitive %s mismatch", async (_label, mutate) => {
    const fixture = createFixture();
    const createPrice = vi.mocked(fixture.provider.createPrice);
    const defaultCreate = createPrice.getMockImplementation();
    createPrice.mockImplementationOnce(async (params, options) => {
      const price = await defaultCreate!(params, options);
      const invalid = mutate(price);
      fixture.priceObjects.set(price.id, invalid);
      return invalid;
    });

    await expect(syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "fenced_failed" });
    expect(fixture.request.state).toBe("failed");
    expect(fixture.objects.find((object) => object.object_kind === "price")?.provider_object_id).toBe("price-1");
    expect(fixture.provider.createPrice).toHaveBeenCalledTimes(1);
  });

  it("does not claim a mismatch is resolved when the parent-fence CAS fails", async () => {
    const fixture = createFixture();
    vi.mocked(fixture.provider.createPrice).mockImplementationOnce(async (params) => {
      const current = {
        id: "price-mismatch",
        active: params.active,
        billing_scheme: "tiered",
        currency: params.currency,
        custom_unit_amount: null,
        livemode: true,
        metadata: params.metadata,
        product: params.product,
        recurring: params.recurring ?? null,
        transform_quantity: null,
        type: "recurring",
        unit_amount: params.unit_amount,
        unit_amount_decimal: String(params.unit_amount),
      } satisfies ProviderPrice;
      fixture.priceObjects.set(current.id, current);
      return current;
    });
    vi.mocked(fixture.store.fenceRequest).mockResolvedValueOnce("cas_stale").mockResolvedValueOnce("request_unavailable");

    await expect(syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "fence_pending" });
    expect(fixture.request.state).toBe("reserved");
  });

  it("turns a definitive provider object-ID ownership conflict into a parent fence", async () => {
    const fixture = createFixture();
    vi.mocked(fixture.store.advanceObject).mockResolvedValueOnce("identity_conflict");

    await expect(syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "fenced_failed" });
    expect(fixture.request.state).toBe("failed");
    expect(fixture.provider.createPrice).not.toHaveBeenCalled();
  });

  it("fences an exact Product field or metadata mismatch while retaining its provider ID", async () => {
    const fixture = createFixture();
    const createProduct = vi.mocked(fixture.provider.createProduct);
    const defaultCreate = createProduct.getMockImplementation();
    createProduct.mockImplementationOnce(async (params, options) => {
      const product = await defaultCreate!(params, options);
      const invalid = { ...product, name: "Different Product" };
      fixture.productObjects.set(product.id, invalid);
      return invalid;
    });

    await expect(syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "fenced_failed" });
    expect(fixture.request.state).toBe("failed");
    expect(fixture.objects[0]?.provider_object_id).toBe("prod-1");
    expect(fixture.provider.createPrice).not.toHaveBeenCalled();
  });

  it("rechecks request ownership, digest and current revision before provider calls", async () => {
    const stale = createFixture(candidate(), { currentRevision: 2 });
    await expect(syncStripePricingRequest(stale.identity, {
      store: stale.store, provider: stale.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "stale" });
    expect(stale.provider.createProduct).not.toHaveBeenCalled();

    const changed = createFixture();
    changed.identity = { ...changed.identity, adminId: "91100000-0000-0000-0000-000000000099" };
    await expect(syncStripePricingRequest(changed.identity, {
      store: changed.store, provider: changed.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "identity_mismatch" });
    expect(changed.provider.createProduct).not.toHaveBeenCalled();
  });

  it("can re-verify a parent that is already in verified state without reserving new objects", async () => {
    const fixture = createFixture();
    await expect(syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "ready_to_publish" });
    fixture.request.state = "verified";
    fixture.request.state_revision += 1;

    await expect(syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW + 1000,
    })).resolves.toEqual({ status: "ready_to_publish" });
    expect(fixture.store.reserveObject).toHaveBeenCalledTimes(2);
  });

  it("paginates an unknown-object search and retrieves a unique exact match without creating again", async () => {
    const fixture = createFixture();
    const createProduct = vi.mocked(fixture.provider.createProduct);
    const defaultCreate = createProduct.getMockImplementation();
    createProduct.mockImplementationOnce(async (params, options) => {
      await defaultCreate!(params, options);
      throw Object.assign(new Error("response lost"), { code: "ETIMEDOUT" });
    });
    await expect(syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "unresolved" });
    let pages = 0;
    vi.mocked(fixture.provider.searchProducts).mockImplementation(async () => {
      pages += 1;
      return pages === 1
        ? { data: [], hasMore: true, nextPage: "page-2" }
        : { data: [...fixture.productObjects.values()], hasMore: false, nextPage: null };
    });

    const outcome = await syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    });
    expect(outcome).toEqual({ status: "ready_to_publish" });
    expect(fixture.provider.searchProducts).toHaveBeenCalledTimes(2);
    expect(fixture.provider.createProduct).toHaveBeenCalledTimes(1);
    expect(fixture.request.state).toBe("reserved");
  });

  it("leaves empty or ambiguous eventual-consistency searches unresolved", async () => {
    const empty = createFixture();
    const emptyCreate = vi.mocked(empty.provider.createProduct);
    const emptyDefault = emptyCreate.getMockImplementation();
    emptyCreate.mockImplementationOnce(async (params, options) => {
      await emptyDefault!(params, options);
      throw new Error("response lost");
    });
    await syncStripePricingRequest(empty.identity, {
      store: empty.store, provider: empty.provider, livemode: true, now: () => NOW,
    });
    await expect(syncStripePricingRequest(empty.identity, {
      store: empty.store, provider: empty.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "unresolved" });
    expect(empty.provider.createProduct).toHaveBeenCalledTimes(1);

    const ambiguous = createFixture();
    const ambiguousCreate = vi.mocked(ambiguous.provider.createProduct);
    const ambiguousDefault = ambiguousCreate.getMockImplementation();
    ambiguousCreate.mockImplementationOnce(async (params, options) => {
      await ambiguousDefault!(params, options);
      throw new Error("response lost");
    });
    await syncStripePricingRequest(ambiguous.identity, {
      store: ambiguous.store, provider: ambiguous.provider, livemode: true, now: () => NOW,
    });
    vi.mocked(ambiguous.provider.searchProducts).mockResolvedValueOnce({
      data: [
        { id: "prod-a", active: true, name: "Form Coach", description: "Movement feedback", metadata: {}, livemode: true },
        { id: "prod-b", active: true, name: "Form Coach", description: "Movement feedback", metadata: {}, livemode: true },
      ], hasMore: false, nextPage: null,
    });
    await expect(syncStripePricingRequest(ambiguous.identity, {
      store: ambiguous.store, provider: ambiguous.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "unresolved" });
    expect(ambiguous.provider.retrieveProduct).not.toHaveBeenCalled();
    expect(ambiguous.provider.createProduct).toHaveBeenCalledTimes(1);
  });

  it("never blindly creates an aged reserved object after the Stripe idempotency safety window", async () => {
    const aged = createFixture(candidate(), { createdAt: new Date(NOW - 24 * 60 * 60 * 1000).toISOString() });
    await expect(syncStripePricingRequest(aged.identity, {
      store: aged.store, provider: aged.provider, livemode: true, now: () => NOW,
    })).resolves.toEqual({ status: "unresolved" });
    expect(aged.provider.createProduct).not.toHaveBeenCalled();
    expect(aged.objects[0].state).toBe("unknown");
    expect(aged.objects[0].idempotency_key).toBe(pricingSyncObjectIdempotencyKey(REQUEST_ID, "product", null));
  });

  it("bounds the provider timeout to the remaining idempotency-safe window", async () => {
    const safeWindow = 23 * 60 * 60 * 1000;
    const fixture = createFixture(candidate(), { createdAt: new Date(NOW - safeWindow + 1200).toISOString() });
    await syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    });
    expect(vi.mocked(fixture.provider.createProduct).mock.calls[0]?.[1].timeout).toBeLessThanOrEqual(1200);
  });

  it("recovers a lost create response with the same persisted key and no retry create", async () => {
    const fixture = createFixture();
    const create = vi.mocked(fixture.provider.createProduct);
    create.mockImplementationOnce(async (params, options) => {
      const response = await create.getMockImplementation()?.(params, options);
      throw Object.assign(new Error("connection closed after create"), { code: "ETIMEDOUT", created: response });
    });
    vi.mocked(fixture.provider.searchProducts).mockImplementation(async () => {
      const created = [...fixture.productObjects.values()];
      return { data: created, hasMore: false, nextPage: null };
    });

    const first = await syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW,
    });
    expect(first).toEqual({ status: "unresolved" });
    expect(fixture.objects[0].state).toBe("unknown");
    expect(create.mock.calls[0]?.[1]).toMatchObject({ maxNetworkRetries: 0, idempotencyKey: pricingSyncObjectIdempotencyKey(REQUEST_ID, "product", null) });

    const second = await syncStripePricingRequest(fixture.identity, {
      store: fixture.store, provider: fixture.provider, livemode: true, now: () => NOW + 1000,
    });
    expect(second).toEqual({ status: "ready_to_publish" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(fixture.provider.searchProducts).toHaveBeenCalled();
  });
});
