import { describe, expect, it } from "vitest";
import {
  checkoutTotals,
  isArmoryChargeRefunded,
  isLegacyPurchaseFullyRefunded,
  isPaidCardCheckout,
  isPublicArmorySale,
  type ArmorySaleSnapshot,
} from "./armory-commerce-core";

const regularProduct: ArmorySaleSnapshot = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  coach_id: "223e4567-e89b-42d3-a456-426614174000",
  kind: "product",
  category: "gear",
  required_membership_tier: "everyone",
  title: "Training shirt",
  price_cents: 2495,
  shipping_cents: 450,
  sizes: ["S", "M"],
  visible_to_all: true,
  printful_sku: null,
  printful_sync_variant_id: null,
  printful_variant_mappings: [],
};

describe("public Armory commerce rules", () => {
  it("allows only visible regular paid/product listings in the public sale projection", () => {
    expect(isPublicArmorySale(regularProduct)).toBe(true);
    expect(isPublicArmorySale({ ...regularProduct, visible_to_all: false })).toBe(false);
    expect(isPublicArmorySale({ ...regularProduct, category: "supplements" })).toBe(false);
    expect(isPublicArmorySale({ ...regularProduct, category: "doctor_network" })).toBe(false);
    expect(isPublicArmorySale({ ...regularProduct, category: "ebook", required_membership_tier: "premium" })).toBe(false);
    expect(isPublicArmorySale({ ...regularProduct, required_membership_tier: "unknown" })).toBe(false);
    expect(isPublicArmorySale({ ...regularProduct, kind: "preview" })).toBe(false);
    expect(isPublicArmorySale({ ...regularProduct, price_cents: 0 })).toBe(false);
  });

  it("keeps shipping out of the coach 10% fee and gives platform sales full gross", () => {
    expect(checkoutTotals(regularProduct, "platform-seller")).toEqual({
      priceCents: 2495,
      shippingCents: 450,
      totalCents: 2945,
      feeCents: 250,
      isPlatformItem: false,
    });
    expect(checkoutTotals({ ...regularProduct, coach_id: "platform-seller" }, "platform-seller")).toEqual({
      priceCents: 2495,
      shippingCents: 450,
      totalCents: 2945,
      feeCents: 2945,
      isPlatformItem: true,
    });
  });

  it("accepts only paid card Checkout sessions with the expected USD total", () => {
    const valid = {
      mode: "payment",
      paymentStatus: "paid",
      currency: "usd",
      amountTotal: 2945,
      expectedAmount: 2945,
    };
    expect(isPaidCardCheckout(valid)).toBe(true);
    expect(isPaidCardCheckout({ ...valid, amountTotal: 2495 })).toBe(false);
    expect(isPaidCardCheckout({ ...valid, currency: "eur" })).toBe(false);
    expect(isPaidCardCheckout({ ...valid, paymentStatus: "unpaid" })).toBe(false);
    expect(isPaidCardCheckout({ ...valid, mode: "subscription" })).toBe(false);
  });

  it("treats a partial Stripe refund as refunded even when Stripe has not marked the charge fully refunded", () => {
    expect(isArmoryChargeRefunded({ refunded: false, amountRefunded: 1 })).toBe(true);
    expect(isArmoryChargeRefunded({ refunded: false, amountRefunded: 0 })).toBe(false);
    expect(isArmoryChargeRefunded({ refunded: true, amountRefunded: 0 })).toBe(true);
    expect(isLegacyPurchaseFullyRefunded(false)).toBe(false);
    expect(isLegacyPurchaseFullyRefunded(true)).toBe(true);
  });
});
