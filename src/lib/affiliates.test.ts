import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  addMonths,
  earningsSummary,
  effectiveRates,
  isValidCode,
  normalizeCode,
  referralLink,
  saleCommission,
} from "./affiliates";

describe("codes and links", () => {
  it("cleans up a requested code", () => {
    expect(normalizeCode("  Coach Ken!! ")).toBe("coach-ken");
    expect(normalizeCode("--Fit_Life--")).toBe("fit-life");
  });

  it.each([
    ["ken", true],
    ["coach-ken-2026", true],
    ["ab", false],
    ["-ken", false],
    ["Ken", false],
  ])("checks %s", (code, valid) => {
    expect(isValidCode(code)).toBe(valid);
  });

  it("builds links, optionally to a page", () => {
    expect(referralLink("https://gymx2.com", "ken")).toBe(
      "https://gymx2.com/r/ken",
    );
    expect(referralLink("https://gymx2.com", "ken", "/armory/abc")).toBe(
      "https://gymx2.com/r/ken?to=%2Farmory%2Fabc",
    );
  });
});

describe("effectiveRates", () => {
  it("uses the program defaults", () => {
    expect(
      effectiveRates(DEFAULT_SETTINGS, {
        sale_percent: null,
        signup_bonus_cents: null,
      }),
    ).toEqual({
      salePercent: 10,
      signupBonusCents: 500,
      custom: false,
    });
  });

  it("uses an affiliate's own rates where set", () => {
    expect(
      effectiveRates(DEFAULT_SETTINGS, {
        sale_percent: "25.00",
        signup_bonus_cents: null,
      }),
    ).toEqual({
      salePercent: 25,
      signupBonusCents: 500,
      custom: true,
    });
  });
});

describe("saleCommission", () => {
  const coachSale = {
    amount_cents: 5599,
    shipping_cents: 599,
    fee_cents: 500,
    platformItem: false,
  };
  const ownSale = {
    amount_cents: 4995,
    shipping_cents: 0,
    fee_cents: 4995,
    platformItem: true,
  };

  it("takes a share of GYMX2's fee on a coach's item", () => {
    expect(
      saleCommission(coachSale, { sale_base: "platform_share" }, 10),
    ).toEqual({ baseCents: 500, amountCents: 50 });
  });

  it("takes a share of the whole price on GYMX2's own item", () => {
    expect(
      saleCommission(ownSale, { sale_base: "platform_share" }, 10),
    ).toEqual({ baseCents: 4995, amountCents: 500 });
  });

  it("can use the full item price, never shipping", () => {
    expect(saleCommission(coachSale, { sale_base: "sale_price" }, 10)).toEqual({
      baseCents: 5000,
      amountCents: 500,
    });
  });

  it("ignores shipping on GYMX2's own gear", () => {
    expect(
      saleCommission(
        {
          ...ownSale,
          amount_cents: 5594,
          shipping_cents: 599,
          fee_cents: 5594,
        },
        { sale_base: "platform_share" },
        20,
      ),
    ).toEqual({ baseCents: 4995, amountCents: 999 });
  });
});

describe("addMonths", () => {
  it("adds calendar months", () => {
    expect(addMonths(new Date("2026-11-08T12:00:00Z"), 12).toISOString()).toBe(
      "2027-11-08T12:00:00.000Z",
    );
  });
});

describe("earningsSummary", () => {
  const now = new Date("2026-12-15T00:00:00Z");
  it("splits waiting, available, paid and void", () => {
    expect(
      earningsSummary(
        [
          {
            amount_cents: 100,
            status: "pending",
            available_at: "2026-12-01T00:00:00Z",
          },
          {
            amount_cents: 200,
            status: "pending",
            available_at: "2027-01-01T00:00:00Z",
          },
          {
            amount_cents: 300,
            status: "paid",
            available_at: "2026-11-01T00:00:00Z",
          },
          {
            amount_cents: 400,
            status: "void",
            available_at: "2026-11-01T00:00:00Z",
          },
        ],
        now,
      ),
    ).toEqual({
      waitingCents: 200,
      availableCents: 100,
      paidCents: 300,
      voidCents: 400,
    });
  });
});
