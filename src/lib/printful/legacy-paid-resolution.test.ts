import { describe, expect, it, vi } from "vitest";
import { recordLegacyPhysicalPaidResolution } from "./legacy-paid-resolution";

const validPayment = {
  sessionId: "cs_legacy_physical_session",
  paymentIntentId: "pi_legacy_physical_intent",
  amountCents: 3_200,
  currency: "usd",
  paymentStatus: "paid",
  checkoutIntentId: null,
};

function fakeAdmin(cutover: unknown, resolutionError: unknown | null = null) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "is_printful_apparel_auto_only") return { data: cutover, error: null };
    return { data: "resolution-synthetic", error: resolutionError };
  });
  return { rpc };
}

describe("legacy paid physical cutover", () => {
  it("durably holds a late paid legacy session with no checkout intent", async () => {
    const admin = fakeAdmin(true);

    await expect(recordLegacyPhysicalPaidResolution(admin, validPayment)).resolves.toBe("recorded");

    expect(admin.rpc).toHaveBeenCalledTimes(2);
    expect(admin.rpc).toHaveBeenLastCalledWith("record_printful_apparel_legacy_paid_resolution", {
      target_checkout_intent_id: null,
      target_session_id: validPayment.sessionId,
      target_payment_intent_id: validPayment.paymentIntentId,
      target_amount_cents: validPayment.amountCents,
      target_currency: "usd",
      target_reason_code: "legacy_physical_without_intent",
    });
  });

  it("binds an older Armory intent to a resolution rather than making a manual order", async () => {
    const admin = fakeAdmin(true);
    const input = {
      ...validPayment,
      checkoutIntentId: "8fd4dcd4-9180-4ef2-9ecf-144a9d222e7a",
    };

    await expect(recordLegacyPhysicalPaidResolution(admin, input)).resolves.toBe("recorded");

    expect(admin.rpc).toHaveBeenLastCalledWith("record_printful_apparel_legacy_paid_resolution", {
      target_checkout_intent_id: input.checkoutIntentId,
      target_session_id: input.sessionId,
      target_payment_intent_id: input.paymentIntentId,
      target_amount_cents: input.amountCents,
      target_currency: "usd",
      target_reason_code: "physical_paid_after_auto_only_cutover",
    });
  });

  it("does not divert while legacy physical sales remain enabled", async () => {
    const admin = fakeAdmin(false);

    await expect(recordLegacyPhysicalPaidResolution(admin, validPayment)).resolves.toBe("not_cutover");

    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed if cutover state or payment facts cannot be validated", async () => {
    const stateError = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: new Error("synthetic") }),
    };
    const malformedPayment = fakeAdmin(true);

    await expect(recordLegacyPhysicalPaidResolution(stateError, validPayment)).resolves.toBe("failed");
    await expect(recordLegacyPhysicalPaidResolution(malformedPayment, {
      ...validPayment,
      amountCents: null,
    })).resolves.toBe("failed");

    expect(malformedPayment.rpc).toHaveBeenCalledTimes(1);
  });
});
