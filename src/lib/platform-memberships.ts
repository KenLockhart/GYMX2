export const PLATFORM_PLANS = [
  {
    tier: "regular",
    label: "Regular",
    priceCents: 800,
    categoryValues: ["ebook", "gear", "accessories", "program"] as const,
  },
  {
    tier: "premium",
    label: "Premium",
    priceCents: 2495,
    categoryValues: [
      "ebook",
      "gear",
      "accessories",
      "program",
      "supplements",
      "doctor_network",
    ] as const,
  },
] as const;

export type PlatformTier = (typeof PLATFORM_PLANS)[number]["tier"];

export const PLATFORM_SUBSCRIPTION_STATUSES = [
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "paused",
  "trialing",
  "unpaid",
] as const;

export type PlatformSubscriptionStatus =
  (typeof PLATFORM_SUBSCRIPTION_STATUSES)[number];

export type PlatformPriceShape = {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count: number } | null;
};

export function isPlatformTier(value: unknown): value is PlatformTier {
  return value === "regular" || value === "premium";
}

export function platformPlan(tier: PlatformTier) {
  return PLATFORM_PLANS.find((plan) => plan.tier === tier)!;
}

export function tierIncludes(current: PlatformTier | null, required: PlatformTier) {
  if (!current) return false;
  return current === "premium" || required === "regular";
}

export function hasCurrentPaidPlatformMembership(
  membership: {
    status: string;
    current_period_end: string | null;
  } | null,
  now = new Date(),
) {
  if (!membership || membership.status !== "active" || !membership.current_period_end)
    return false;
  const periodEnd = Date.parse(membership.current_period_end);
  return Number.isFinite(periodEnd) && periodEnd > now.getTime();
}

export function platformTierForPrice(
  price: PlatformPriceShape,
  configuredPriceIds: Record<PlatformTier, string | null>,
  requireActive = true,
): PlatformTier | null {
  if (
    (requireActive && !price.active) ||
    price.currency !== "usd" ||
    !price.recurring ||
    price.recurring.interval !== "month" ||
    price.recurring.interval_count !== 1
  ) {
    return null;
  }

  const matchingPlan = PLATFORM_PLANS.find(
    (plan) =>
      configuredPriceIds[plan.tier] === price.id &&
      price.unit_amount === plan.priceCents,
  );
  return matchingPlan?.tier ?? null;
}

// Syncs that are not backed by a Stripe event use a revision read before the API call. Webhook
// versions may be equal within one second, so a CAS conflict always requires a fresh Stripe read.
export function platformSyncDecision(
  current: { revision: number } | null,
  expectedRevision: number | null,
): "apply" | "conflict" {
  if (current ? current.revision !== expectedRevision : expectedRevision !== null)
    return "conflict";
  return "apply";
}
