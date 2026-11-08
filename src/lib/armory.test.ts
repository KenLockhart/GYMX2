import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  describeSize,
  fileExtension,
  formatMoney,
  formatPrice,
  isCategory,
  parsePrice,
  platformFeeCents,
  publicImageUrl,
  safeFileName,
} from "./armory";

describe("formatPrice", () => {
  it("shows dollars", () => {
    expect(formatPrice(2499)).toBe("$24.99");
  });

  it("calls zero free", () => {
    expect(formatPrice(0)).toBe("Free");
  });

  it("hides a missing price", () => {
    expect(formatPrice(null)).toBeNull();
  });
});

describe("parsePrice", () => {
  it.each([
    ["24.99", 2499],
    ["$24.99", 2499],
    ["1,250", 125000],
    ["24", 2400],
    ["0", 0],
  ])("reads %s", (input, cents) => {
    expect(parsePrice(input)).toBe(cents);
  });

  it("treats blank as no price", () => {
    expect(parsePrice("  ")).toBeNull();
  });

  it.each(["ten", "24.999", "-5"])("rejects %s", (input) => {
    expect(parsePrice(input)).toBeNaN();
  });
});

describe("categories", () => {
  it("labels categories", () => {
    expect(categoryLabel("gear")).toBe("Gear");
    expect(categoryLabel("unknown")).toBe("Other");
  });

  it("knows valid categories", () => {
    expect(isCategory("ebook")).toBe(true);
    expect(isCategory("weapons")).toBe(false);
  });
});

describe("file names", () => {
  it("finds the extension", () => {
    expect(fileExtension("Plan.Final.PDF")).toBe("pdf");
    expect(fileExtension("README")).toBe("");
  });

  it("makes a safe stored name", () => {
    expect(safeFileName("My Meal Plan (v2)!.PDF")).toBe("my-meal-plan-v2.pdf");
    expect(safeFileName("???.pdf")).toBe("file.pdf");
  });
});

describe("publicImageUrl", () => {
  it("builds the public address", () => {
    expect(publicImageUrl("https://x.supabase.co", "abc/cover 1.png")).toBe(
      "https://x.supabase.co/storage/v1/object/public/armory-images/abc/cover%201.png",
    );
  });

  it("returns nothing without an image", () => {
    expect(publicImageUrl("https://x.supabase.co", null)).toBeNull();
  });
});

describe("describeSize", () => {
  it("shows KB and MB", () => {
    expect(describeSize(2048)).toBe("2 KB");
    expect(describeSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("platformFeeCents", () => {
  it.each([
    [1999, 200],
    [1000, 100],
    [105, 11],
    [0, 0],
  ])("takes 10%% of %i cents", (amount, fee) => {
    expect(platformFeeCents(amount)).toBe(fee);
  });
});

describe("formatMoney", () => {
  it("shows zero as dollars", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(1799)).toBe("$17.99");
  });
});
