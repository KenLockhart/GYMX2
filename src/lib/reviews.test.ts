import { describe, expect, it } from "vitest";
import { categoryAverages, reportReasonLabel } from "./reviews";

describe("categoryAverages", () => {
  it("averages each category, to one decimal place", () => {
    const rows = [
      { rating_communication: 5, rating_value: 4 },
      { rating_communication: 4, rating_value: 4 },
      { rating_communication: 4, rating_value: null },
    ];
    expect(categoryAverages(rows)).toEqual([
      { label: "Communication", score: 4.3 },
    ]);
  });

  it("hides a category until enough members rated it", () => {
    expect(
      categoryAverages([{ rating_results: 5 }, { rating_results: 1 }]),
    ).toEqual([]);
    expect(categoryAverages([{ rating_results: 5 }], 1)).toEqual([
      { label: "Results", score: 5 },
    ]);
  });

  it("ignores out-of-range values", () => {
    expect(
      categoryAverages(
        [
          { rating_knowledge: 9 },
          { rating_knowledge: 0 },
          { rating_knowledge: 3 },
        ],
        1,
      ),
    ).toEqual([{ label: "Knowledge", score: 3 }]);
  });
});

describe("reportReasonLabel", () => {
  it("labels review and coach reasons", () => {
    expect(reportReasonLabel("fake")).toMatch(/fake/i);
    expect(reportReasonLabel("misleading")).toMatch(/claims/i);
    expect(reportReasonLabel("nope")).toBe("Something else");
  });
});
