import { describe, expect, it } from "vitest";
import { readDailyContentPage } from "./page-number";

describe("readDailyContentPage", () => {
  it("accepts a positive safe page number from query parameters", () => {
    expect(readDailyContentPage("3")).toBe(3);
    expect(readDailyContentPage(["4", "5"])).toBe(4);
  });

  it("defaults malformed, zero, negative, and unsafe page values to one", () => {
    for (const value of [undefined, "", "0", "-2", "2x", "9007199254740992"])
      expect(readDailyContentPage(value)).toBe(1);
  });
});
