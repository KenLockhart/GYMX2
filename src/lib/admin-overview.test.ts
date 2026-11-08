import { describe, expect, it } from "vitest";
import { summarizeOverview } from "./admin-overview";

const now = new Date("2026-11-08T12:00:00Z");
const users = [
  { role: "admin", coach_requested: false, created_at: "2026-10-01T00:00:00Z" },
  { role: "coach", coach_requested: false, created_at: "2026-11-07T00:00:00Z" },
  { role: "member", coach_requested: true, created_at: "2026-11-06T00:00:00Z" },
  { role: "member", coach_requested: false, created_at: "2026-10-20T00:00:00Z" },
];
const sale = { amount_cents: 1000, fee_cents: 100, refunded_at: null, fulfillment_status: "not_needed" };
const sales = [
  { ...sale, created_at: "2026-11-07T00:00:00Z" },
  { ...sale, amount_cents: 5000, fee_cents: 5000, created_at: "2026-11-05T12:00:00Z", fulfillment_status: "to_ship" },
  { ...sale, created_at: "2026-11-06T00:00:00Z", refunded_at: "2026-11-07T00:00:00Z" },
  { ...sale, created_at: "2026-10-01T00:00:00Z" },
];

describe("summarizeOverview", () => {
  const overview = summarizeOverview({ users, sales, flaggedConversations: 2 }, now);

  it("counts people, new sign-ups and roles", () => {
    expect(overview).toMatchObject({ people: 4, newPeople: 2, coaches: 1, members: 2, coachRequests: 1 });
  });

  it("totals this week's sales without refunds or older sales", () => {
    expect(overview).toMatchObject({ weekSalesCount: 2, weekSalesCents: 6000, weekKeptCents: 5100 });
  });

  it("finds orders waiting to ship and how long the oldest has waited", () => {
    expect(overview).toMatchObject({ toShip: 1, oldestToShipDays: 3, flaggedConversations: 2 });
  });

  it("handles a quiet platform", () => {
    expect(summarizeOverview({ users: [], sales: [], flaggedConversations: 0 }, now)).toMatchObject({
      people: 0,
      toShip: 0,
      oldestToShipDays: null,
      weekSalesCents: 0,
    });
  });
});
