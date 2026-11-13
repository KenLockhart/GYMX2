import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  item: {} as Record<string, unknown> | null,
  select: vi.fn(),
  createCheckout: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAccount: vi.fn(async () => ({ profile: { id: "00000000-0000-4000-8000-000000000002", role: "member" }, email: "buyer@example.test" })),
  requireCoach: vi.fn(),
}));
vi.mock("@/lib/notify", () => ({ notifyOrderShipped: vi.fn() }));
vi.mock("@/lib/purchases", () => ({ refreshPayoutAccount: vi.fn() }));
vi.mock("@/lib/refunds", () => ({ refundPurchase: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: () => true,
  stripePublishableKey: () => "pk_test_fixture",
  getStripe: () => ({ checkout: { sessions: { create: mocks.createCheckout } } }),
}));
vi.mock("@/lib/supabase/env", () => ({ getSiteUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const query = {
        select: (...args: unknown[]) => { mocks.select(...args); return query; },
        eq: () => query,
        is: () => query,
        maybeSingle: async () => ({ data: mocks.item }),
        limit: async () => ({ data: table === "purchases" ? [] : null }),
      };
      return query;
    },
  }),
}));
import { buyArmoryItem } from "./payments";

const baseItem = {
  id: "00000000-0000-4000-8000-000000000001",
  coach_id: "00000000-0000-4000-8000-000000000003",
  kind: "product", title: "GYMX2 Cap", price_cents: 3844, sizes: [], shipping_cents: 0,
};
function request() {
  const data = new FormData();
  data.set("item_id", baseItem.id);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.item = { ...baseItem };
  mocks.createCheckout.mockResolvedValue({ client_secret: "test_secret", url: "https://checkout.stripe.com/test" });
  mocks.createAdminClient.mockReturnValue({ from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { role: "admin" } }) };
    return query;
  } });
});

describe("server-side display-only checkout gate", () => {
  it.each(["preview", "unknown", undefined, null])("rejects direct checkout for kind %s", async (kind) => {
    mocks.item = { ...baseItem, kind };
    expect(await buyArmoryItem({}, request())).toEqual({ error: "This item can't be bought right now." });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it("rejects a missing row before contacting Stripe", async () => {
    mocks.item = null;
    expect(await buyArmoryItem({}, request())).toHaveProperty("error");
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });
  it("keeps existing explicitly sellable gear checkout unchanged", async () => {
    expect(await buyArmoryItem({}, request())).toEqual({ clientSecret: "test_secret" });
    expect(mocks.createCheckout).toHaveBeenCalledOnce();
    expect(mocks.createCheckout.mock.calls[0][0]).toMatchObject({
      line_items: [{ price_data: { unit_amount: 3844 } }],
      shipping_options: [{ shipping_rate_data: { fixed_amount: { amount: 0 } } }],
    });
  });
  it("keeps existing paid downloads purchasable", async () => {
    mocks.item = { ...baseItem, kind: "paid" };
    expect(await buyArmoryItem({}, request())).toEqual({ clientSecret: "test_secret" });
    expect(mocks.createCheckout).toHaveBeenCalledOnce();
  });
  it("does not allow a crafted form field to override the database flag", async () => {
    mocks.item = { ...baseItem, kind: "preview" };
    const data = request();
    data.set("kind", "product");
    expect(await buyArmoryItem({}, data)).toHaveProperty("error");
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });
});
