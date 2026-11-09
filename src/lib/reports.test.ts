import { describe, expect, it } from "vitest";
import { reasonLabel, REPORT_REASONS, summarizeReasons } from "./reports";

describe("reports", () => {
  it("matches the reasons the database accepts", () => {
    expect(REPORT_REASONS.map((r) => r.value)).toEqual([
      "spam",
      "harassment",
      "inappropriate",
      "off_platform",
      "other",
    ]);
    expect(reasonLabel("nonsense")).toBe("Other");
  });

  it("summarizes reasons, most common first", () => {
    expect(summarizeReasons(["harassment", "spam", "spam"])).toBe(
      "3 reports: Spam or selling (2), Harassment or bullying (1)",
    );
    expect(summarizeReasons(["other"])).toBe("1 report: Something else (1)");
  });
});
