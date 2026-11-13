import { describe, expect, it } from "vitest";
import { categoriesFor, isDisplayOnly } from "./armory";
import { armoryItemSchema } from "./validation";

const product = {
  kind: "product", id: "", category: "gear", title: "Cap", description: "",
  price_cents: 3844, shipping_cents: 0, sizes: [], image_path: "", visible_to_all: true,
};
describe("display-only gear", () => {
  it("uses a separate kind, not a flag old code can ignore", () => {
    expect(isDisplayOnly({ kind: "preview" })).toBe(true);
    expect(isDisplayOnly({ kind: "product" })).toBe(false);
  });
  it.each(["paid", "download", "link"])("does not change existing %s behavior", (kind) => {
    expect(isDisplayOnly({ kind })).toBe(false);
  });
  it("accepts preview product metadata without making it free", () => {
    expect(armoryItemSchema.parse({ ...product, kind: "preview" })).toMatchObject({
      kind: "preview", price_cents: 3844, shipping_cents: 0,
    });
  });
  it("offers the gear category for previews", () => {
    expect(categoriesFor("preview").map((c) => c.value)).toContain("gear");
  });
  it.each([null, 0, 99])("requires a real display price, got %s", (price_cents) => {
    expect(armoryItemSchema.safeParse({ ...product, kind: "preview", price_cents }).success).toBe(false);
  });
  it("rejects unknown item kinds", () => {
    expect(armoryItemSchema.safeParse({ ...product, kind: "presale" }).success).toBe(false);
  });
});
