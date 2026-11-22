import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  stripeCreate: vi.fn(),
  itemRead: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/purchases", () => ({ refreshPayoutAccount: vi.fn() }));
vi.mock("@/lib/platform-membership-server", () => ({ platformHasTier: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: mocks.stripeCreate } } }),
  isStripeConfigured: () => true,
  isStripeTestMode: () => false,
  stripePublishableKey: () => null,
}));
vi.mock("@/lib/supabase/env", () => ({ getSiteUrl: () => "https://gymx2.example.test" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle:
            table === "armory_items"
              ? mocks.itemRead
              : async () => ({ data: null, error: null }),
          is: () => ({ limit: async () => ({ data: [] }) }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === "profiles"
                ? { role: "coach" }
                : { stripe_account_id: "acct_coach", charges_enabled: true },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

import { createArmoryCheckout } from "./armory-checkout";

const itemId = "a1111111-1111-4111-8111-111111111111";
const sellerId = "b2222222-2222-4222-8222-222222222222";
const buyerId = "c3333333-3333-4333-8333-333333333333";
const item = {
  id: itemId,
  coach_id: sellerId,
  kind: "product",
  category: "gear",
  title: "Training shirt",
  price_cents: 2495,
  file_path: null,
  file_name: null,
  sizes: [],
  shipping_cents: 0,
  visible_to_all: true,
  printful_sku: null,
  printful_sync_variant_id: null,
  printful_variant_mappings: [],
  updated_at: "2026-11-18T20:00:00.000Z",
};

describe("Armory Checkout quote reservation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.itemRead.mockResolvedValue({ data: { ...item }, error: null });
    mocks.adminRpc.mockResolvedValue({ data: false, error: null });
  });

  it("rejects a stale or failed atomic snapshot reservation before creating any Stripe session", async () => {
    const result = await createArmoryCheckout({
      itemId,
      size: "",
      email: "buyer@example.test",
      profile: { id: buyerId, role: "member" },
    });

    expect(result).toEqual({
      error: "This item changed while checkout was opening. Refresh and try again.",
    });
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(1, "is_printful_managed_item", { target_item_id: itemId });
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(2, "create_armory_checkout_intent", expect.any(Object));
    expect(mocks.adminRpc).toHaveBeenCalledWith("create_armory_checkout_intent", {
      target_intent_id: expect.any(String),
      target_item_id: itemId,
      target_member_id: buyerId,
      target_guest_email: null,
      target_locale: "en",
      target_size: null,
      target_fee_cents: 250,
      target_item_updated_at: item.updated_at,
      target_item_price_cents: item.price_cents,
      target_item_shipping_cents: item.shipping_cents,
      target_item_title: item.title,
      target_item_kind: item.kind,
      target_item_category: item.category,
      target_file_path: null,
      target_file_name: null,
    });
    expect(mocks.stripeCreate).not.toHaveBeenCalled();
  });

  it("preserves private items returned by the member's authenticated RLS query", async () => {
    mocks.itemRead.mockResolvedValueOnce({
      data: { ...item, visible_to_all: false },
      error: null,
    });

    await createArmoryCheckout({
      itemId,
      size: "",
      email: "buyer@example.test",
      profile: { id: buyerId, role: "member" },
    });

    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "create_armory_checkout_intent",
      expect.objectContaining({
        target_item_id: itemId,
        target_member_id: buyerId,
      }),
    );
  });

  it.each(["preview", "download", "link", null])(
    "rejects non-sale kind %s before reserving an intent or creating Stripe Checkout",
    async (kind) => {
      mocks.itemRead.mockResolvedValueOnce({
        data: { ...item, kind },
        error: null,
      });

      await expect(createArmoryCheckout({
        itemId,
        size: "",
        email: "buyer@example.test",
        profile: { id: buyerId, role: "member" },
      })).resolves.toHaveProperty("error");

      expect(mocks.adminRpc).toHaveBeenCalledWith("is_printful_managed_item", { target_item_id: itemId });
      expect(mocks.adminRpc).not.toHaveBeenCalledWith("create_armory_checkout_intent", expect.anything());
      expect(mocks.stripeCreate).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing item before reserving an intent or creating Stripe Checkout", async () => {
    mocks.itemRead.mockResolvedValueOnce({ data: null, error: null });

    await expect(createArmoryCheckout({
      itemId,
      size: "",
      email: "buyer@example.test",
      profile: { id: buyerId, role: "member" },
    })).resolves.toHaveProperty("error");

    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.stripeCreate).not.toHaveBeenCalled();
  });

  it.each([
    { label: "managed preview", result: { data: true, error: null } },
    { label: "membership lookup failure", result: { data: null, error: { message: "unavailable" } } },
    { label: "malformed membership result", result: { data: null, error: null } },
  ])("fails closed for $label before Stripe", async ({ result }) => {
    mocks.adminRpc.mockResolvedValueOnce(result);
    await expect(createArmoryCheckout({
      itemId,
      size: "",
      email: "buyer@example.test",
      profile: { id: buyerId, role: "member" },
    })).resolves.toEqual({ error: "This item can't be bought right now." });
    expect(mocks.adminRpc).toHaveBeenCalledOnce();
    expect(mocks.adminRpc).toHaveBeenCalledWith("is_printful_managed_item", { target_item_id: itemId });
    expect(mocks.stripeCreate).not.toHaveBeenCalled();
  });
});
