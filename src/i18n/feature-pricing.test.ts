import { describe, expect, it } from "vitest";
import { messages } from "./messages";

describe("Form Coach pricing translations", () => {
  it("keeps the English and Spanish admin pricing messages in the same shape", () => {
    expect(Object.keys(messages.es.featurePricing).sort()).toEqual(Object.keys(messages.en.featurePricing).sort());
    expect(Object.keys(messages.es.featurePricing.result).sort()).toEqual(Object.keys(messages.en.featurePricing.result).sort());
    expect(messages.en.nav.links["/admin/monetization/feature-pricing"]).toBe("Form Coach pricing");
    expect(messages.es.nav.links["/admin/monetization/feature-pricing"]).toBe("Precios de Form Coach");
  });
});
