import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  adminRpc: vi.fn(),
  after: vi.fn(),
  recordArmory: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.adminFrom, rpc: mocks.adminRpc }),
}));
vi.mock("@/lib/affiliate-server", () => ({ recordAffiliateCommissions: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyNewSale: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/armory-purchases", () => ({
  confirmArmoryCheckoutSession: vi.fn(),
  recordArmoryCheckoutPurchase: mocks.recordArmory,
}));

import { recordPurchase } from "./purchases";

function setupPurchaseRow(result: unknown) {
  const select = vi.fn().mockResolvedValue(result);
  const upsert = vi.fn(() => ({ select }));
  const existingPurchase = vi.fn().mockResolvedValue({ data: null, error: null });
  mocks.adminFrom.mockReturnValue({
    upsert,
    select: () => ({ eq: () => ({ maybeSingle: existingPurchase }) }),
  });
  return { upsert, select };
}

describe("legacy purchase cutover", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.adminRpc.mockImplementation((name: string) => {
      if (name === "is_printful_apparel_auto_only") {
        return Promise.resolve({ data: false, error: null });
      }
      if (name === "record_printful_apparel_legacy_paid_resolution") {
        return Promise.resolve({ data: "synthetic-resolution", error: null });
      }
      throw new Error("Unexpected RPC");
    });
  });

  it("holds a paid product session instead of creating a to_ship purchase during cutover", async () => {
    mocks.adminRpc.mockImplementation((name: string) => {
      if (name === "is_printful_apparel_auto_only") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "record_printful_apparel_legacy_paid_resolution") {
        return Promise.resolve({ data: "synthetic-resolution", error: null });
      }
      throw new Error("Unexpected RPC");
    });
    const purchase = setupPurchaseRow({ data: [{ id: "synthetic" }], error: null });

    await expect(recordPurchase({
      id: "cs_legacy_physical_paid",
      payment_status: "paid",
      payment_intent: "pi_legacy_physical_paid",
      amount_total: 3200,
      currency: "usd",
      metadata: {
        item_id: "item-synthetic",
        member_id: "member-synthetic",
        item_title: "Synthetic physical item",
        kind: "product",
      },
    } as never)).resolves.toBe(true);

    expect(purchase.upsert).not.toHaveBeenCalled();
    expect(mocks.adminRpc).toHaveBeenCalledWith("record_printful_apparel_legacy_paid_resolution", {
      target_checkout_intent_id: null,
      target_session_id: "cs_legacy_physical_paid",
      target_payment_intent_id: "pi_legacy_physical_paid",
      target_amount_cents: 3200,
      target_currency: "usd",
      target_reason_code: "legacy_physical_without_intent",
    });
  });

  it("preserves digital purchases without consulting the physical cutover gate", async () => {
    const purchase = setupPurchaseRow({ data: [{ id: "synthetic" }], error: null });

    await expect(recordPurchase({
      id: "cs_legacy_digital_paid",
      payment_status: "paid",
      payment_intent: "pi_legacy_digital_paid",
      amount_total: 1800,
      currency: "usd",
      metadata: {
        item_id: "item-synthetic",
        member_id: "member-synthetic",
        item_title: "Synthetic digital item",
      },
    } as never)).resolves.toBe(true);

    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(purchase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillment_status: "not_needed" }),
      { onConflict: "stripe_session_id", ignoreDuplicates: true },
    );
  });
});
