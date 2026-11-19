import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  entitlement: vi.fn(),
  ownedPurchase: vi.fn(),
  legacyPurchase: vi.fn(),
  item: vi.fn(),
  signedUrl: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentAccount: mocks.account }));
vi.mock("@/lib/platform-membership-server", () => ({
  getPlatformEntitlement: mocks.entitlement,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "armory_items") {
        return { select: () => ({ eq: () => ({ maybeSingle: mocks.item }) }) };
      }
      const query = {
        eq: () => query,
        is: () => query,
        order: () => query,
        limit: mocks.legacyPurchase,
      };
      return { select: () => query };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        eq: () => query,
        is: () => query,
        order: () => query,
        limit: mocks.ownedPurchase,
      };
      return { select: () => query };
    },
    storage: {
      from: () => ({ createSignedUrl: mocks.signedUrl }),
    },
  }),
}));

import { GET } from "./route";

const itemId = "a1111111-1111-4111-8111-111111111111";
const purchaseId = "b2222222-2222-4222-8222-222222222222";
const intentId = "c3333333-3333-4333-8333-333333333333";
const memberId = "d4444444-4444-4444-8444-444444444444";

function request() {
  return new NextRequest(`https://gymx2.example.test/armory/${itemId}/download`);
}

describe("authenticated paid Armory download", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.account.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    mocks.entitlement.mockResolvedValue({ ok: true, entitlement: null });
    mocks.ownedPurchase.mockResolvedValue({
      data: [{
        id: purchaseId,
        item_id: null,
        checkout_intent_id: intentId,
        stripe_session_id: "cs_test_paid_download",
        intent: {
          id: intentId,
          item_id: itemId,
          member_id: memberId,
          buyer_was_guest: false,
          stripe_session_id: "cs_test_paid_download",
          status: "paid",
          item_kind: "paid",
          file_path: "seller/old-version.pdf",
          file_name: "old-version.pdf",
        },
      }],
      error: null,
    });
    mocks.legacyPurchase.mockResolvedValue({ data: [], error: null });
    mocks.item.mockResolvedValue({ data: null, error: null });
    mocks.signedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/short-lived" },
      error: null,
    });
  });

  it("serves the immutable paid file snapshot after deletion nulls the catalog foreign key", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: itemId }) });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://storage.example.test/short-lived");
    expect(mocks.signedUrl).toHaveBeenCalledWith(
      "seller/old-version.pdf",
      60,
      { download: "old-version.pdf" },
    );
  });

  it("does not sign an intent snapshot that belongs to another member or session", async () => {
    mocks.ownedPurchase.mockResolvedValueOnce({
      data: [{
        id: purchaseId,
        item_id: null,
        checkout_intent_id: intentId,
        stripe_session_id: "cs_test_paid_download",
        intent: {
          id: intentId,
          item_id: itemId,
          member_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          buyer_was_guest: false,
          stripe_session_id: "cs_test_other_order",
          status: "paid",
          item_kind: "paid",
          file_path: "seller/private.pdf",
          file_name: "private.pdf",
        },
      }],
      error: null,
    });

    const response = await GET(request(), { params: Promise.resolve({ id: itemId }) });

    expect(response.status).toBe(303);
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });
});
