import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPrintfulOrdersClient } from "./apparel-orders-client";
import { printfulCommonDesignIdentity } from "./design-identity";

const ADDRESS = {
  name: "Synthetic Customer",
  address1: "100 Test Avenue",
  city: "Albany",
  state_code: "NY",
  country_code: "US" as const,
  zip: "12207",
  email: "synthetic@example.test",
};
const LINE = { syncVariantId: "5635838147", externalId: "0123456789abcdef0123456789abcdef", quantity: 1 as const };
const DESIGN = printfulCommonDesignIdentity({
  syncVariantId: LINE.syncVariantId,
  catalogVariantId: "12345",
  files: [{ id: 8, hash: "a".repeat(32), type: "front" }],
  options: [{ id: "color", value: "black" }],
})!;

function response(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ code: status, result }), { status, headers: { "content-type": "application/json" } });
}

function costs(overrides: Record<string, unknown> = {}) {
  return {
    currency: "USD",
    subtotal: 10.25,
    discount: 0,
    shipping: 4.59,
    additional_fee: 0,
    fulfillment_fee: 0,
    tax: 1.03,
    vat: 0,
    digitization: "0.00",
    total: 15.87,
    ...overrides,
  };
}

function orderCosts() {
  return {
    currency: "USD", subtotal: "10.25", discount: "0.00", shipping: "4.59", digitization: "0.00",
    additional_fee: "0.00", fulfillment_fee: "0.00", retail_delivery_fee: "0.00",
    tax: "1.03", vat: "0.00", total: "15.87",
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 987654321,
    store: 19050731,
    external_id: LINE.externalId,
    status: "draft",
    recipient: ADDRESS,
    costs: orderCosts(),
    items: [{ sync_variant_id: 5635838147, variant_id: 12345, external_id: LINE.externalId, quantity: 1,
      files: [{ id: 8, hash: "a".repeat(32), type: "front" }], options: [{ id: "color", value: "black" }] }],
    ...overrides,
  };
}

describe("Printful apparel Orders client", () => {
  let fetcher: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: ReturnType<typeof createPrintfulOrdersClient>;

  beforeEach(() => {
    fetchMock = vi.fn();
    fetcher = fetchMock as unknown as (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
    client = createPrintfulOrdersClient({ token: "synthetic-token", storeId: "19050731", fetcher });
  });

  it("estimates one exact sync variant without creating an order", async () => {
    fetchMock.mockResolvedValue(response({ costs: costs() }));

    const result = await client.estimateCosts(ADDRESS, LINE);

    expect(result).toEqual({ ok: true, value: {
      currency: "USD", subtotalCents: 1025, discountCents: 0, shippingCents: 459,
      additionalFeeCents: 0, fulfillmentFeeCents: 0, taxCents: 103, vatCents: 0,
      digitizationCents: 0, totalCents: 1587,
    } });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("https://api.printful.com/orders/estimate-costs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ shipping: "STANDARD", items: [{ sync_variant_id: 5635838147, quantity: 1 }] });
    expect(JSON.stringify(init.body)).not.toMatch(/catalog_variant_id|retail_price/);
  });

  it("rejects incomplete, inconsistent, non-USD, and fractional-cent estimates", async () => {
    for (const value of [
      costs({ currency: "CAD" }),
      costs({ digitization: undefined }),
      costs({ tax: 0.001 }),
    ]) {
      fetchMock.mockResolvedValueOnce(response({ costs: value }));
      expect(await client.estimateCosts(ADDRESS, LINE)).toEqual({ ok: false, reason: "invalid_response" });
    }
  });

  it("treats the provider's documented total as authoritative when other fees are separate", async () => {
    fetchMock.mockResolvedValue(response({ costs: costs({ total: 16.11 }) }));
    const result = await client.estimateCosts(ADDRESS, LINE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.totalCents).toBe(1611);
  });

  it("creates drafts with explicit confirm=0 and update_existing=0 and validates exact response identity", async () => {
    fetchMock.mockResolvedValue(response(order()));

    const result = await client.createDraft(ADDRESS, LINE, DESIGN);

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("https://api.printful.com/orders?confirm=0&update_existing=0");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.items).toEqual([{ sync_variant_id: 5635838147, quantity: 1, external_id: LINE.externalId }]);
    expect(body).not.toHaveProperty("catalog_variant_id");
    expect(body).not.toHaveProperty("retail_price");
  });

  it("uses the external ID for reconciliation and confirms only the named draft endpoint", async () => {
    fetchMock.mockResolvedValueOnce(response(order())).mockResolvedValueOnce(response(order({ status: "pending" })));

    expect((await client.findByExternalId(LINE.externalId, LINE, DESIGN)).ok).toBe(true);
    expect((await client.confirmDraft("987654321", LINE.externalId, LINE, ADDRESS, DESIGN)).ok).toBe(true);
    expect((fetchMock.mock.calls[0] as [URL])[0].href).toBe(`https://api.printful.com/orders/@${LINE.externalId}`);
    expect((fetchMock.mock.calls[1] as [URL, RequestInit])[0].href).toBe("https://api.printful.com/orders/987654321/confirm");
  });

  it("keeps exact order identity when asynchronous order costs are not yet complete", async () => {
    fetchMock.mockResolvedValue(response(order({ costs: { currency: "USD", subtotal: "10.25" } })));
    const result = await client.findByExternalId(LINE.externalId, LINE, DESIGN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("draft");
      expect(result.value.costFactsComplete).toBe(false);
      expect(result.value.totalCents).toBeNull();
    }
  });

  it("rejects an oversized response while streaming instead of allocating it whole", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(1_000_001), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    expect(await client.findByExternalId(LINE.externalId, LINE, DESIGN)).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("rejects foreign store, wrong variant, malformed IDs, and unsafe integer conversion", async () => {
    fetchMock.mockResolvedValueOnce(response(order({ store: 19050732 })));
    expect(await client.createDraft(ADDRESS, LINE, DESIGN)).toEqual({ ok: false, reason: "invalid_response" });
    fetchMock.mockResolvedValueOnce(response(order({ items: [{ sync_variant_id: 999, external_id: LINE.externalId, quantity: 1 }] })));
    expect(await client.createDraft(ADDRESS, LINE, DESIGN)).toEqual({ ok: false, reason: "invalid_response" });
    fetchMock.mockResolvedValueOnce(response(order({ recipient: { ...ADDRESS, zip: "10001" } })));
    expect(await client.createDraft(ADDRESS, LINE, DESIGN)).toEqual({ ok: false, reason: "invalid_response" });
    expect(await client.createDraft(ADDRESS, { ...LINE, syncVariantId: "9007199254740993" }, DESIGN)).toEqual({ ok: false, reason: "invalid_response" });
    expect(await client.findByExternalId("not-an-id", LINE, DESIGN)).toEqual({ ok: false, reason: "invalid_response" });
    expect(await client.confirmDraft("9223372036854775807", LINE.externalId, LINE, ADDRESS, DESIGN)).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("does not follow redirects, retry, or expose provider response bodies", async () => {
    fetchMock.mockResolvedValueOnce(new Response("sensitive provider detail", { status: 500 }));
    expect(await client.findByExternalId(LINE.externalId, LINE, DESIGN)).toEqual({ ok: false, reason: "provider_rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [URL, RequestInit])[1].redirect).toBe("error");
  });
});
