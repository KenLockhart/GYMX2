import { describe, expect, it } from "vitest";
import {
  PLATFORM_PLANS,
  hasCurrentPaidPlatformMembership,
  platformSyncDecision,
  platformTierForPrice,
  tierIncludes,
} from "./platform-memberships";

describe("platform plans", () => {
  it("uses the fixed monthly USD amounts", () => {
    expect(PLATFORM_PLANS.map(({ tier, priceCents }) => [tier, priceCents])).toEqual([
      ["regular", 800],
      ["premium", 2495],
    ]);
  });

  it("grants only the categories included in each tier", () => {
    expect(PLATFORM_PLANS[0].categoryValues).toEqual([
      "ebook",
      "gear",
      "accessories",
      "program",
    ]);
    expect(PLATFORM_PLANS[1].categoryValues.slice(-2)).toEqual([
      "supplements",
      "doctor_network",
    ]);
    expect(tierIncludes("regular", "regular")).toBe(true);
    expect(tierIncludes("regular", "premium")).toBe(false);
    expect(tierIncludes("premium", "regular")).toBe(true);
    expect(tierIncludes(null, "regular")).toBe(false);
  });
});

describe("paid membership access", () => {
  const now = new Date("2026-11-17T12:00:00.000Z");

  it("keeps active members until the paid period ends, including scheduled cancellation", () => {
    expect(
      hasCurrentPaidPlatformMembership(
        { status: "active", current_period_end: "2026-11-18T12:00:00.000Z" },
        now,
      ),
    ).toBe(true);
  });

  it.each(["trialing", "past_due", "canceled", "unpaid", "incomplete"])(
    "does not grant access for %s subscriptions",
    (status) => {
      expect(
        hasCurrentPaidPlatformMembership(
          { status, current_period_end: "2026-11-18T12:00:00.000Z" },
          now,
        ),
      ).toBe(false);
    },
  );

  it("fails closed when the paid period is absent, invalid, or over", () => {
    expect(
      hasCurrentPaidPlatformMembership({ status: "active", current_period_end: null }, now),
    ).toBe(false);
    expect(
      hasCurrentPaidPlatformMembership(
        { status: "active", current_period_end: "not-a-date" },
        now,
      ),
    ).toBe(false);
    expect(
      hasCurrentPaidPlatformMembership(
        { status: "active", current_period_end: "2026-11-17T11:59:59.000Z" },
        now,
      ),
    ).toBe(false);
  });
});

describe("trusted Stripe prices", () => {
  const ids = { regular: "price_regular", premium: "price_premium" };
  const price = (overrides: Partial<Parameters<typeof platformTierForPrice>[0]> = {}) => ({
    id: "price_regular",
    active: true,
    currency: "usd",
    unit_amount: 800,
    recurring: { interval: "month", interval_count: 1 },
    ...overrides,
  });

  it("maps only configured price IDs with the trusted amount and monthly USD interval", () => {
    expect(platformTierForPrice(price(), ids)).toBe("regular");
    expect(
      platformTierForPrice(
        price({ id: "price_premium", unit_amount: 2495 }),
        ids,
      ),
    ).toBe("premium");
    expect(platformTierForPrice(price({ unit_amount: 1 }), ids)).toBeNull();
    expect(platformTierForPrice(price({ currency: "eur" }), ids)).toBeNull();
    expect(
      platformTierForPrice(price({ recurring: { interval: "year", interval_count: 1 } }), ids),
    ).toBeNull();
    expect(platformTierForPrice(price({ active: false }), ids)).toBeNull();
    expect(platformTierForPrice(price({ id: "price_from_client" }), ids)).toBeNull();
  });
});

describe("Stripe event ordering", () => {
  it("rejects a delayed reconciliation after the subscription row revision changes", () => {
    expect(
      platformSyncDecision(
        { revision: 8 },
        7,
      ),
    ).toBe("conflict");
  });

  it("fences competing webhook snapshots with a revision CAS", () => {
    const staleBaseline = platformSyncDecision({ revision: 5 }, 4);
    const refreshedBaseline = platformSyncDecision({ revision: 5 }, 5);
    expect(staleBaseline).toBe("conflict");
    expect(refreshedBaseline).toBe("apply");
  });

  it("accepts a current Stripe snapshot from an older event when its revision is fresh", () => {
    // Event.created is audit data only. Stripe event deliveries can arrive out of order, but the
    // handler retrieves the current object and must apply that snapshot when its CAS is current.
    expect(platformSyncDecision({ revision: 3 }, 3)).toBe("apply");
    expect(platformSyncDecision(null, null)).toBe("apply");
  });
});
