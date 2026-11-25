import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  contextResults: [] as unknown[],
  readProduct: vi.fn(),
  estimateCosts: vi.fn(),
  createSession: vi.fn(),
  stripeAccountRetrieve: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ accounts: { retrieve: mocks.stripeAccountRetrieve } }),
  isStripeConfigured: () => true,
  isStripeTestMode: () => false,
}));
vi.mock("@/lib/supabase/env", () => ({ getSiteUrl: () => "https://gymx2.example" }));
vi.mock("./catalog-provider", () => ({
  createPrintfulStoreCatalogReader: () => ({ readProduct: mocks.readProduct }),
  getPrintfulCatalogSyncConfig: () => ({ enabled: true, token: "synthetic-catalog-token", storeId: "19050731" }),
}));
vi.mock("./apparel-orders-client", () => ({ createPrintfulOrdersClient: () => ({ estimateCosts: mocks.estimateCosts }) }));
vi.mock("./apparel-stripe-session", () => ({ createOrRecoverPrintfulApparelStripeSession: mocks.createSession }));

import { startPrintfulApparelCheckout } from "./apparel-checkout";

const productId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const orderId = "44444444-4444-4444-8444-444444444444";
const fingerprint = "a".repeat(64);
const designFingerprint = "b".repeat(64);

function checkoutContext(revision: unknown, productRevision: unknown = 10, variantRevision: unknown = 10) {
  return {
    state: { mode: "printful_apparel_only", salesEnabled: true, fulfillmentEnabled: true, refundPolicy: "admin_review" },
    revision,
    product: { id: productId, storeId: "19050731", externalProductId: "492658691", ignored: false, lastSeenRevision: productRevision },
    approval: { productId, itemId, classification: "apparel", enabled: true, approvalVersion: 1 },
    variant: {
      id: variantId,
      productId,
      storeId: "19050731",
      syncVariantId: "5635838147",
      catalogVariantId: "7854",
      color: "Black",
      size: "M",
      synced: true,
      ignored: false,
      availabilityStatus: "active",
      available: true,
      configurationComplete: true,
      configurationFingerprint: fingerprint,
      approvedForSale: true,
      productionCostMinCents: 1844,
      productionCostMaxCents: 1844,
      productionCostCurrency: "USD",
      productionCostSource: "admin-reviewed-printful-ui",
      productionCostObservedAt: "2026-11-24T15:00:00.000Z",
      productionCostConfigurationFingerprint: fingerprint,
      lastSeenRevision: variantRevision,
    },
    draft: {
      title: "Test shirt",
      description: "Synthetic product",
      imagePath: "approved/test-shirt.webp",
      priceCents: 3192,
      shippingCents: 0,
      visibleToAll: true,
      curationApprovedAt: "2026-11-24T15:00:00.000Z",
      publishedAt: "2026-11-24T15:00:00.000Z",
    },
  };
}

const publicCatalog = [{ product_id: productId, variants: [{ id: variantId, available: true }] }];

function rpcResult(name: string, args: Record<string, unknown> | undefined) {
  if (name === "get_printful_apparel_checkout_context") {
    const data = mocks.contextResults.shift();
    return Promise.resolve({ data, error: null });
  }
  if (name === "list_printful_apparel_catalog") return Promise.resolve({ data: publicCatalog, error: null });
  if (name === "create_printful_apparel_checkout_intent") return Promise.resolve({ data: args?.target_order_id, error: null });
  if (name === "get_printful_apparel_checkout_session_state") {
    return Promise.resolve({ data: {
      status: "quoted",
      sessionId: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      email: "buyer@example.com",
      priceCents: 3192,
      productTitle: "Test shirt",
      variantLabel: "Black / M",
    }, error: null });
  }
  if (name === "bind_printful_apparel_checkout_session") return Promise.resolve({ data: true, error: null });
  throw new Error(`Unexpected RPC in test: ${name}`);
}

async function startCheckout() {
  return startPrintfulApparelCheckout({
    productId,
    variantId,
    orderId,
    statusToken: "s".repeat(43),
    email: "buyer@example.com",
    address: {
      name: "Synthetic Buyer",
      address1: "1 Test Street",
      address2: "",
      city: "Albany",
      state: "NY",
      postalCode: "12207",
      country: "US",
    },
  });
}

describe("startPrintfulApparelCheckout RPC revision boundary", () => {
  beforeEach(() => {
    vi.stubEnv("PRINTFUL_APPAREL_CHECKOUT_ENABLED", "true");
    vi.stubEnv("PRINTFUL_APPAREL_FULFILLMENT_ENABLED", "true");
    vi.stubEnv("PRINTFUL_CATALOG_SYNC_ENABLED", "true");
    vi.stubEnv("PRINTFUL_ACCESS_TOKEN", "synthetic-read-token");
    vi.stubEnv("PRINTFUL_STORE_ID", "19050731");
    vi.stubEnv("PRINTFUL_ORDER_ACCESS_TOKEN", "synthetic-order-token");
    vi.stubEnv("PRINTFUL_APPAREL_STRIPE_ACCOUNT_ID", "acct_synthetic");
    vi.clearAllMocks();
    mocks.contextResults = [checkoutContext(10), checkoutContext(10)];
    mocks.rpc.mockImplementation(rpcResult);
    mocks.stripeAccountRetrieve.mockResolvedValue({ id: "acct_synthetic" });
    mocks.readProduct.mockResolvedValue({
      status: "complete",
      product: {
        syncProductId: "492658691",
        ignored: false,
        variants: [{
          syncVariantId: "5635838147",
          synced: true,
          ignored: false,
          availabilityStatus: "active",
          configurationComplete: true,
          catalogVariantId: "7854",
          configurationFingerprint: fingerprint,
          designIdentityFingerprint: designFingerprint,
        }],
      },
    });
    mocks.estimateCosts.mockResolvedValue({ ok: true, value: {
      currency: "USD",
      subtotalCents: 1200,
      discountCents: 0,
      shippingCents: 500,
      additionalFeeCents: 0,
      fulfillmentFeeCents: 0,
      taxCents: 0,
      vatCents: 0,
      digitizationCents: 0,
      totalCents: 1700,
    } });
    mocks.createSession.mockResolvedValue({ ok: true, url: "https://checkout.example/session", sessionId: "cs_test_synthetic" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the SQL JSON scalar revision and passes the same exact revision into checkout intent", async () => {
    const result = await startCheckout();

    expect(result).toEqual({ ok: true, url: "https://checkout.example/session" });
    expect(mocks.estimateCosts).toHaveBeenCalledOnce();
    const intentCall = mocks.rpc.mock.calls.find(([name]) => name === "create_printful_apparel_checkout_intent");
    expect(intentCall?.[1]).toMatchObject({ target_catalog_revision: 10, target_approval_version: 1 });
  });

  it("rejects a changed scalar revision after the provider read before estimating or creating an intent", async () => {
    mocks.contextResults = [checkoutContext(10), checkoutContext(11, 11, 11)];

    const result = await startCheckout();

    expect(result).toEqual({ ok: false, reason: "variant_unavailable" });
    expect(mocks.readProduct).toHaveBeenCalledOnce();
    expect(mocks.estimateCosts).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.some(([name]) => name === "create_printful_apparel_checkout_intent")).toBe(false);
  });

  it.each([0, -1, 10.5, Number.MAX_SAFE_INTEGER + 1, "010", "9007199254740992", null])(
    "fails closed for invalid RPC scalar revision %s",
    async (revision) => {
      mocks.contextResults = [checkoutContext(revision)];

      const result = await startCheckout();

      expect(result).toEqual({ ok: false, reason: "variant_unavailable" });
      expect(mocks.readProduct).not.toHaveBeenCalled();
      expect(mocks.estimateCosts).not.toHaveBeenCalled();
      expect(mocks.rpc.mock.calls.some(([name]) => name === "create_printful_apparel_checkout_intent")).toBe(false);
    },
  );
});
