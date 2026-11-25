import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/components/armory-public-header", () => ({
  ArmoryPublicHeader: () => createElement("header", null, "Armory"),
}));
vi.mock("./apparel-order-form", () => ({
  ApparelOrderForm: () => createElement("form", { "data-purchase-form": "true" }),
}));

import PrintfulApparelPage from "./page";

const catalogProduct = {
  product_id: "11111111-1111-4111-8111-111111111111",
  title: "Test apparel",
  description: "Synthetic catalog row",
  image_path: null,
  price_cents: 2999,
  shipping_cents: 0,
  variants: [{
    id: "22222222-2222-4222-8222-222222222222",
    name: "Black / M",
    color: "Black",
    size: "M",
    available: true,
  }],
};

describe("Printful apparel page feature gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PRINTFUL_APPAREL_CHECKOUT_ENABLED", "true");
    vi.stubEnv("PRINTFUL_APPAREL_FULFILLMENT_ENABLED", "true");
    mocks.rpc.mockResolvedValue({ data: [catalogProduct], error: null });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    "PRINTFUL_APPAREL_CHECKOUT_ENABLED",
    "PRINTFUL_APPAREL_FULFILLMENT_ENABLED",
  ])("does not query or render the catalog when %s is disabled", async (flag) => {
    vi.stubEnv(flag, "false");

    const html = renderToStaticMarkup(await PrintfulApparelPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Apparel checkout is unavailable right now.");
    expect(html).not.toContain("Test apparel");
    expect(html).not.toContain("data-purchase-form");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("loads the catalog and renders purchase controls only when both flags are enabled", async () => {
    const html = renderToStaticMarkup(await PrintfulApparelPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("list_printful_apparel_catalog");
    expect(html).toContain("Test apparel");
    expect(html).toContain("data-purchase-form");
  });
});
