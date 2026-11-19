import {
  MIN_PAID_PRICE_CENTS,
  platformFeeCents,
  REGULAR_ARMORY_CATEGORIES,
} from "@/lib/armory";

export type ArmorySaleSnapshot = {
  id: string;
  coach_id: string;
  kind: string;
  category: string;
  title: string;
  price_cents: number | null;
  shipping_cents: number;
  sizes: string[];
  visible_to_all: boolean;
  printful_sku: string | null;
  printful_sync_variant_id: string | null;
  printful_variant_mappings: {
    option: string;
    sku: string;
    sync_variant_id: string | null;
  }[];
};

const PUBLIC_CATEGORIES = new Set<string>(
  REGULAR_ARMORY_CATEGORIES.map(({ value }) => value),
);

export function isPublicArmorySale(item: ArmorySaleSnapshot) {
  return (
    item.visible_to_all &&
    PUBLIC_CATEGORIES.has(item.category) &&
    (item.kind === "paid" || item.kind === "product") &&
    typeof item.price_cents === "number" &&
    item.price_cents >= MIN_PAID_PRICE_CENTS
  );
}

export function checkoutTotals(item: Pick<ArmorySaleSnapshot, "kind" | "price_cents" | "shipping_cents" | "coach_id">, platformSellerId: string) {
  if (item.price_cents === null || item.price_cents < MIN_PAID_PRICE_CENTS) return null;
  const shippingCents = item.kind === "product" ? item.shipping_cents : 0;
  const isPlatformItem = item.coach_id === platformSellerId;
  const feeCents = isPlatformItem ? item.price_cents + shippingCents : platformFeeCents(item.price_cents);
  return {
    priceCents: item.price_cents,
    shippingCents,
    totalCents: item.price_cents + shippingCents,
    feeCents,
    isPlatformItem,
  };
}

export function isPaidCardCheckout(input: {
  mode: string | null | undefined;
  paymentStatus: string | null | undefined;
  currency: string | null | undefined;
  amountTotal: number | null | undefined;
  expectedAmount: number;
}) {
  return (
    input.mode === "payment" &&
    input.paymentStatus === "paid" &&
    input.currency?.toLowerCase() === "usd" &&
    input.amountTotal === input.expectedAmount
  );
}

export function isArmoryChargeRefunded(input: {
  refunded: boolean;
  amountRefunded: number;
}) {
  return input.refunded || input.amountRefunded > 0;
}

export function isLegacyPurchaseFullyRefunded(refunded: boolean) {
  return refunded;
}
