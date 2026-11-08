import { describe, expect, it } from "vitest";
import {
  isValidSlug,
  ratingSummary,
  reviewerName,
  stars,
  suggestSlug,
} from "./public-pages";

describe("public coach pages", () => {
  it("suggests clean addresses", () => {
    expect(suggestSlug("Coach Ken Lockhart!")).toBe("coach-ken-lockhart");
    expect(suggestSlug("  José  Núñez ")).toBe("jose-nunez");
  });

  it("validates addresses", () => {
    expect(isValidSlug("ken-lockhart")).toBe(true);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("-ken")).toBe(false);
    expect(isValidSlug("ken--l")).toBe(false);
    expect(isValidSlug("Ken")).toBe(false);
  });

  it("summarizes and displays reviews", () => {
    expect(ratingSummary([5, 4, 4])).toEqual({ average: 4.3, count: 3 });
    expect(ratingSummary([])).toBeNull();
    expect(reviewerName("Ken Lockhart")).toBe("Ken L.");
    expect(reviewerName("Madonna")).toBe("Madonna");
    expect(stars(4)).toBe("★★★★☆");
  });
});
