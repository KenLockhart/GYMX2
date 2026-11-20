import { describe, expect, it } from "vitest";
import { getFormCoachOfferTitle } from "./offer-title";

describe("Form Coach customer-facing offer titles", () => {
  const copy = {
    monthlyPlan: "Monthly plan",
    annualPlan: "Annual plan",
    assessmentPack: (count: number) => `${count}-assessment pack`,
    oneTimePurchase: "One-time purchase",
  };

  it("uses plan interval and pack semantics instead of generated internal price keys", () => {
    expect(getFormCoachOfferTitle({ interval: "month", creditsPerPack: null }, copy)).toBe("Monthly plan");
    expect(getFormCoachOfferTitle({ interval: "year", creditsPerPack: null }, copy)).toBe("Annual plan");
    expect(getFormCoachOfferTitle({ interval: null, creditsPerPack: 5 }, copy)).toBe("5-assessment pack");
    expect(getFormCoachOfferTitle({ interval: null, creditsPerPack: null }, copy)).toBe("One-time purchase");
  });
});
