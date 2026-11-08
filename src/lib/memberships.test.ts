import { describe, expect, it } from "vitest";
import { hasAccess, hasEnded, membershipFeeCents, membershipStatusLabel, monthlyRecurringCents } from "./memberships";

describe("membership rules", () => {
  it("keeps 10% for GYMX2", () => {
    expect(membershipFeeCents(2900)).toBe(290);
    expect(membershipFeeCents(1999)).toBe(200);
  });

  it.each([
    ["trialing", true, false],
    ["active", true, false],
    ["past_due", true, false],
    ["incomplete", false, false],
    ["canceled", false, true],
    ["unpaid", false, true],
  ])("%s: access %s, ended %s", (status, access, ended) => {
    expect(hasAccess(status)).toBe(access);
    expect(hasEnded(status)).toBe(ended);
  });

  it("describes where a membership stands", () => {
    const base = {
      current_period_end: "2026-12-08T12:00:00Z",
      trial_end: "2026-11-15T12:00:00Z",
      cancel_at_period_end: false,
    };
    expect(membershipStatusLabel({ ...base, status: "active" })).toBe("Renews Dec 8, 2026");
    expect(membershipStatusLabel({ ...base, status: "active", cancel_at_period_end: true })).toBe("Ends Dec 8, 2026");
    expect(membershipStatusLabel({ ...base, status: "trialing" })).toBe("Free trial until Nov 15, 2026");
    expect(membershipStatusLabel({ ...base, status: "past_due" })).toContain("Update your card");
    expect(membershipStatusLabel({ ...base, status: "canceled" })).toBe("Ended");
  });

  it("counts monthly revenue from paying members only", () => {
    expect(
      monthlyRecurringCents([
        { status: "active", price_cents: 2900 },
        { status: "past_due", price_cents: 2900 },
        { status: "trialing", price_cents: 7900 },
        { status: "canceled", price_cents: 2900 },
      ]),
    ).toBe(5800);
  });
});
