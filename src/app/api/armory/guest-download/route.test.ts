import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  verifyPurchase: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/guest-armory-token", () => ({
  verifyGuestArmoryToken: mocks.verifyToken,
}));
vi.mock("@/lib/armory-purchases", () => ({
  verifyGuestArmoryPurchasePayment: mocks.verifyPurchase,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({ createSignedUrl: mocks.createSignedUrl }),
    },
  }),
}));

import { POST } from "./route";

const claim = {
  purchaseId: "a1111111-1111-4111-8111-111111111111",
  sessionId: "cs_test_guest_checkout_12345678",
  itemId: "b2222222-2222-4222-8222-222222222222",
  expiresAt: 2_000_000_000,
};

function request(body: unknown) {
  return new NextRequest("https://gymx2.example/api/armory/guest-download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("guest download claim endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("GUEST_ARMORY_DOWNLOAD_SECRET", "test-secret-at-least-32-characters-long");
    mocks.verifyToken.mockImplementation((token: string) =>
      token === "valid-signed-token" ? claim : null,
    );
    mocks.verifyPurchase.mockResolvedValue({
      email: "buyer@example.com",
      filePath: "seller/private-guide.pdf",
      fileName: "guide.pdf",
    });
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example/signed-download" },
      error: null,
    });
  });

  it("rejects malformed or unverified claims without contacting storage", async () => {
    const response = await POST(request({ token: "purchase-id-only" }));
    expect(response.status).toBe(404);
    expect(mocks.verifyPurchase).not.toHaveBeenCalled();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();

    mocks.verifyToken.mockReturnValueOnce(null);
    const invalid = await POST(request({ token: "tampered" }));
    expect(invalid.status).toBe(404);
    expect(mocks.verifyPurchase).not.toHaveBeenCalled();
  });

  it("requires a live paid unrefunded purchase before signing the private file", async () => {
    mocks.verifyPurchase.mockResolvedValueOnce(null);
    const response = await POST(request({ token: "valid-signed-token" }));
    expect(response.status).toBe(404);
    expect(mocks.verifyPurchase).toHaveBeenCalledWith({
      purchaseId: claim.purchaseId,
      sessionId: claim.sessionId,
      itemId: claim.itemId,
    });
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns only a short-lived signed URL and disables caching/referrers", async () => {
    const response = await POST(request({ token: "valid-signed-token" }));
    expect(response.status).toBe(200);
    expect(mocks.verifyPurchase).toHaveBeenCalledWith({
      purchaseId: claim.purchaseId,
      sessionId: claim.sessionId,
      itemId: claim.itemId,
    });
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      "seller/private-guide.pdf",
      60,
      { download: "guide.pdf" },
    );
    expect(await response.json()).toEqual({
      url: "https://storage.example/signed-download",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
