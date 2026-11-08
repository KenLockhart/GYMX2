import { describe, expect, it } from "vitest";
import {
  bestSellers,
  earnings,
  lastMonths,
  memberHealth,
  monthKey,
  programStats,
  sessionTurnout,
  taskCompletion,
} from "./coach-insights";

const now = new Date("2026-11-20T15:00:00Z");
const sale = (
  over: Partial<Parameters<typeof bestSellers>[0][number]> = {},
) => ({
  item_id: "i1",
  item_title: "Shaker",
  amount_cents: 2000,
  fee_cents: 200,
  kind: "item",
  refunded_at: null,
  created_at: "2026-11-10T12:00:00Z",
  ...over,
});

describe("coach insights", () => {
  it("buckets months in Eastern time", () => {
    expect(monthKey("2026-11-01T03:00:00Z")).toBe("2026-10");
    expect(lastMonths(now, 3)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("totals earnings after fees and skips refunds", () => {
    const result = earnings(
      [
        sale(),
        sale({
          kind: "membership",
          amount_cents: 5000,
          fee_cents: 500,
          created_at: "2026-10-05T12:00:00Z",
        }),
        sale({ refunded_at: "2026-11-11T12:00:00Z" }),
      ],
      [
        {
          member_id: "a",
          price_cents: 5000,
          status: "active",
          cancel_at_period_end: false,
        },
        {
          member_id: "b",
          price_cents: 5000,
          status: "active",
          cancel_at_period_end: true,
        },
        {
          member_id: "c",
          price_cents: 5000,
          status: "trialing",
          cancel_at_period_end: false,
        },
      ],
      now,
    );
    expect(result.thisMonth).toBe(1800);
    expect(result.lastMonth).toBe(4500);
    expect(result.allTime).toBe(6300);
    expect(result.fromMemberships).toBe(4500);
    expect(result.monthlyRecurring).toBe(4500);
    expect(result.payingMembers).toBe(1);
    expect(result.trialingMembers).toBe(1);
    expect(result.cancelling).toBe(1);
    expect(result.months).toHaveLength(6);
  });

  it("ranks best sellers by earnings", () => {
    const top = bestSellers([
      sale(),
      sale(),
      sale({
        item_id: "i2",
        item_title: "Hoodie",
        amount_cents: 6000,
        fee_cents: 600,
      }),
    ]);
    expect(top.map((item) => item.title)).toEqual(["Hoodie", "Shaker"]);
    expect(top[1].sold).toBe(2);
  });

  it("finds members falling off, sparing brand-new ones", () => {
    const health = memberHealth(
      [
        { member_id: "a", name: "Active", joined_at: "2026-09-01T00:00:00Z" },
        { member_id: "q", name: "Quiet", joined_at: "2026-09-01T00:00:00Z" },
        { member_id: "n", name: "Never", joined_at: "2026-09-01T00:00:00Z" },
        { member_id: "new", name: "New", joined_at: "2026-11-18T00:00:00Z" },
      ],
      [
        { member_id: "a", at: "2026-11-19T00:00:00Z" },
        { member_id: "q", at: "2026-11-01T00:00:00Z" },
      ],
      now,
    );
    expect(health.activeThisWeek).toBe(1);
    expect(health.newThisMonth).toBe(1);
    expect(health.fallingOff.map((row) => row.name)).toEqual([
      "Never",
      "Quiet",
    ]);
    expect(health.fallingOff[1].daysQuiet).toBe(19);
  });

  it("measures tasks, sessions and programs", () => {
    expect(
      taskCompletion(
        [
          {
            created_at: "2026-11-10T00:00:00Z",
            completed_at: "2026-11-11T00:00:00Z",
          },
          { created_at: "2026-11-10T00:00:00Z", completed_at: null },
          { created_at: "2026-08-01T00:00:00Z", completed_at: null },
        ],
        now,
      ),
    ).toEqual({ given: 2, done: 1, rate: 50 });

    const turnout = sessionTurnout(
      [
        {
          session_id: "s",
          member_id: "a",
          response: "going",
          ends_at: "2026-11-15T00:00:00Z",
        },
        {
          session_id: "s",
          member_id: "b",
          response: "pending",
          ends_at: "2026-11-15T00:00:00Z",
        },
        {
          session_id: "future",
          member_id: "a",
          response: "going",
          ends_at: "2026-11-25T00:00:00Z",
        },
      ],
      [{ session_id: "s", member_id: "a" }],
      now,
    );
    expect(turnout).toEqual({
      sessions: 1,
      invited: 2,
      goingRate: 50,
      watchedLive: 1,
      liveRate: 50,
    });

    expect(
      programStats([
        {
          id: "p",
          title: "6 weeks",
          days: 4,
          enrollments: [{ done: 4 }, { done: 2 }],
        },
      ]),
    ).toEqual([
      { id: "p", title: "6 weeks", started: 2, finished: 1, average: 75 },
    ]);
  });
});
