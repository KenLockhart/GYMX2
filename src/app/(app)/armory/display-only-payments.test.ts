import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/i18n/server", () => ({
  getLocale: async () => "en",
  getTr: async () => (text: string) => text,
}));
vi.mock("@/lib/auth", () => ({
  requireAuthenticatedAccount: async () => ({
    profile: { id: "00000000-0000-4000-8000-000000000002", role: "member", locale: "en" },
    email: "buyer@example.test",
  }),
}));
vi.mock("@/lib/armory-checkout", () => ({
  createArmoryCheckout: mocks.createCheckout,
}));
vi.mock("@/lib/notify", () => ({ notifyOrderShipped: vi.fn() }));
vi.mock("@/lib/refunds", () => ({ refundPurchase: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: () => true, getStripe: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { buyArmoryItem } from "./payments";

const itemId = "00000000-0000-4000-8000-000000000001";

function request() {
  const data = new FormData();
  data.set("item_id", itemId);
  data.set("size", "M");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createCheckout.mockResolvedValue({ clientSecret: "test_secret" });
});

describe("authenticated Armory Checkout action", () => {
  it("passes only the validated item and size to the server-owned catalog checkout", async () => {
    const data = request();
    data.set("kind", "preview");

    await expect(buyArmoryItem({}, data)).resolves.toEqual({ clientSecret: "test_secret" });

    expect(mocks.createCheckout).toHaveBeenCalledWith({
      itemId,
      size: "M",
      email: "buyer@example.test",
      profile: { id: "00000000-0000-4000-8000-000000000002", role: "member", locale: "en" },
      embedded: true,
      locale: "en",
    });
  });

  it("rejects invalid requests before invoking checkout", async () => {
    const data = request();
    data.set("item_id", "not-an-id");

    await expect(buyArmoryItem({}, data)).resolves.toHaveProperty("error");
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("redirects to hosted checkout when no embedded form is returned", async () => {
    mocks.createCheckout.mockResolvedValueOnce({ url: "https://checkout.example.test/session" });
    mocks.redirect.mockImplementation(() => { throw new Error("redirect"); });

    await expect(buyArmoryItem({}, request())).rejects.toThrow("redirect");
    expect(mocks.redirect).toHaveBeenCalledWith("https://checkout.example.test/session");
  });
});
