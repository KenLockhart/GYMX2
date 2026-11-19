import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}));

import { bindArmoryCheckoutSession } from "./armory-checkout-binding";

describe("Armory Checkout session binding", () => {
  const intentId = "a1111111-1111-4111-8111-111111111111";
  const sessionId = "cs_test_guest_checkout_12345678";

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.maybeSingle.mockResolvedValue({
      data: { stripe_session_id: sessionId },
      error: null,
    });
  });

  it("accepts a successful exact bind without a follow-up query", async () => {
    await expect(bindArmoryCheckoutSession(intentId, sessionId)).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("bind_armory_checkout_session", {
      target_intent_id: intentId,
      target_session_id: sessionId,
    });
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it("recovers a lost commit response only when read-back matches the same session", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("response lost") });
    await expect(bindArmoryCheckoutSession(intentId, sessionId)).resolves.toBe(true);
    expect(mocks.maybeSingle).toHaveBeenCalledOnce();
  });

  it("never treats another or unknown session binding as success", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    mocks.maybeSingle.mockResolvedValueOnce({
      data: { stripe_session_id: "cs_test_different_session_12345678" },
      error: null,
    });
    await expect(bindArmoryCheckoutSession(intentId, sessionId)).resolves.toBe(false);

    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("response lost") });
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error("read failed") });
    await expect(bindArmoryCheckoutSession(intentId, sessionId)).resolves.toBe(false);
  });
});
