import { describe, expect, it, vi } from "vitest";
import { createPrintfulCatalogReader } from "./catalog-client";

vi.mock("server-only", () => ({}));

function response(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function recoveredEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    code: 200,
    result: {
      sync_product: { id: 501001, name: "Synthetic Tee", is_ignored: false, variants: 1 },
      sync_variants: [{
        id: 701001,
        sync_product_id: 501001,
        variant_id: 1001,
        name: "Black / Medium",
        color: "Black",
        size: "M",
        synced: true,
        is_ignored: false,
        availability_status: "active",
        retail_price: "29.99",
        files: [{ type: "preview", url: "https://example.invalid/fake.png" }],
      }],
    },
    ...overrides,
  };
}

describe("fail-closed Printful catalog reader", () => {
  it("is disabled by default before reading credentials or calling fetch", async () => {
    const fetcher = vi.fn();
    const options = {
      get token(): string { throw new Error("must not read token"); },
      get fetcher(): typeof fetch { throw new Error("must not read fetcher"); },
    };
    const reader = createPrintfulCatalogReader(options);
    expect(await reader.readProduct("not-an-id")).toEqual({ status: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires explicitly injected fake credentials and fetcher", async () => {
    const enabledWithoutCredentials = createPrintfulCatalogReader({ enabled: true, fetcher: vi.fn() });
    expect(await enabledWithoutCredentials.readProduct("501001")).toEqual({ status: "missing_credentials" });
    const enabledWithoutFetch = createPrintfulCatalogReader({ enabled: true, token: "fake-token" });
    expect(await enabledWithoutFetch.readProduct("501001")).toEqual({ status: "missing_fetcher" });
  });

  it("reads the recovered schema with fixed store header but reports store and completeness as unverified", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(recoveredEnvelope()));
    const reader = createPrintfulCatalogReader({ enabled: true, token: "synthetic-token", fetcher });
    const result = await reader.readProduct("501001");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.printful.com/store/products/501001");
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: "Bearer synthetic-token",
        "X-PF-Store-Id": "19050731",
        Accept: "application/json",
      },
    });
    expect(result).toMatchObject({
      status: "unverified_observation",
      requestedStoreId: "19050731",
      storeVerification: "unverified",
      completeness: "unverified",
      observation: {
        productId: "501001",
        productName: "Synthetic Tee",
        variantCount: 1,
        variants: [{
          externalVariantId: "701001",
          parentProductId: "501001",
          catalogVariantId: "1001",
          name: "Black / Medium",
          color: "Black",
          size: "M",
          synced: true,
          ignored: false,
          availabilityStatus: "active",
        }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("synthetic-token");
  });

  it.each([
    ["unsafe numeric product ID", recoveredEnvelope({ result: { sync_product: { id: Number.MAX_SAFE_INTEGER + 1, name: "Tee", variants: 0 }, sync_variants: [] } })],
    ["requested product mismatch", recoveredEnvelope({ result: { sync_product: { id: 501002, name: "Tee", variants: 0 }, sync_variants: [] } })],
    ["duplicate variant IDs", recoveredEnvelope({ result: { sync_product: { id: 501001, name: "Tee", variants: 2 }, sync_variants: [
      { id: 701001, sync_product_id: 501001, name: "A" }, { id: 701001, sync_product_id: 501001, name: "B" },
    ] } })],
    ["wrong variant parent", recoveredEnvelope({ result: { sync_product: { id: 501001, name: "Tee", variants: 1 }, sync_variants: [
      { id: 701001, sync_product_id: 501002, name: "A" },
    ] } })],
    ["variant count drift", recoveredEnvelope({ result: { sync_product: { id: 501001, name: "Tee", variants: 2 }, sync_variants: [
      { id: 701001, sync_product_id: 501001, name: "A" },
    ] } })],
  ])("rejects %s with no usable observation", async (_label, payload) => {
    const fetcher = vi.fn(async () => response(payload));
    const reader = createPrintfulCatalogReader({ enabled: true, token: "synthetic-token", fetcher });
    expect(await reader.readProduct("501001")).toEqual({ status: "provider_failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reads the manual-orders store listing with status all and selects only safe summary fields", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({
      code: 200,
      result: [{
        id: 501001,
        name: "Synthetic Tee",
        variants: 3,
        synced: 2,
        external_id: "private-external-id",
        thumbnail_url: "https://example.invalid/private-thumbnail.png",
        is_ignored: false,
        retail_price: "29.99",
      }],
      paging: { total: 1, offset: 0, limit: 50 },
    }));
    const reader = createPrintfulCatalogReader({ enabled: true, token: "synthetic-token", fetcher });
    const result = await reader.readProductsPage(0, 50);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.printful.com/store/products?offset=0&limit=50&status=all");
    expect(init?.headers).toMatchObject({ "X-PF-Store-Id": "19050731" });
    expect(result).toMatchObject({
      status: "unverified_page",
      requestedStoreId: "19050731",
      storeVerification: "unverified",
      completeness: "unverified",
      page: {
        offset: 0,
        limit: 50,
        total: 1,
        products: [{
          productId: "501001",
          productName: "Synthetic Tee",
          variantCount: 3,
          syncedVariantCount: 2,
          productIgnored: false,
        }],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private-external-id");
    expect(serialized).not.toContain("private-thumbnail");
    expect(serialized).not.toContain("29.99");
  });

  it("drops benign detail extras instead of returning the raw provider payload", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({
      ...recoveredEnvelope({ extra_envelope_field: "drop" }),
      result: {
        ...(recoveredEnvelope().result as Record<string, unknown>),
        sync_product: { id: 501001, name: "Synthetic Tee", is_ignored: false, variants: 1, external_id: "drop" },
        sync_variants: [{ ...recoveredEnvelope().result.sync_variants[0], vendor_secret_field: "drop" }],
      },
    }));
    const reader = createPrintfulCatalogReader({ enabled: true, token: "synthetic-token", fetcher });
    const result = await reader.readProduct("501001");
    expect(result.status).toBe("unverified_observation");
    expect(JSON.stringify(result)).not.toContain("drop");
  });

  it("rejects malformed, non-JSON, oversized, and invalid UTF-8 response bodies", async () => {
    const bodies: Array<() => Response> = [
      () => new Response("{bad json", { status: 200, headers: { "content-type": "application/json" } }),
      () => response(recoveredEnvelope(), { headers: { "content-type": "text/plain" } }),
      () => new Response(new Uint8Array([0xff, 0xfe]), { status: 200, headers: { "content-type": "application/json" } }),
      () => new Response(new Uint8Array(128 * 1024 + 1), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(128 * 1024 + 1) },
      }),
    ];
    for (const makeResponse of bodies) {
      const fetcher = vi.fn(async () => makeResponse());
      const reader = createPrintfulCatalogReader({ enabled: true, token: "synthetic-token", fetcher });
      expect(await reader.readProduct("501001")).toEqual({ status: "provider_failed" });
    }
  });

  it("fails closed on HTTP errors, redirects, and thrown network errors without retries", async () => {
    const cases = [
      vi.fn(async () => new Response("", { status: 503, headers: { "content-type": "application/json" } })),
      vi.fn(async () => new Response("", { status: 302, headers: { "content-type": "application/json" } })),
      vi.fn(async () => { throw new Error("synthetic transport error"); }),
    ];
    for (const fetcher of cases) {
      const reader = createPrintfulCatalogReader({ enabled: true, token: "synthetic-token", fetcher });
      expect(await reader.readProduct("501001")).toEqual({ status: "provider_failed" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
