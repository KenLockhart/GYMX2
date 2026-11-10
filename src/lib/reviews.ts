// Review categories and report reasons. Shared by the server and the browser.

export const REVIEW_CATEGORIES = [
  {
    key: "communication",
    column: "rating_communication",
    label: "Communication",
  },
  { key: "knowledge", column: "rating_knowledge", label: "Knowledge" },
  { key: "motivation", column: "rating_motivation", label: "Motivation" },
  { key: "results", column: "rating_results", label: "Results" },
  { key: "value", column: "rating_value", label: "Value for money" },
] as const;
export type ReviewCategoryColumn = (typeof REVIEW_CATEGORIES)[number]["column"];

// A category average shows only once enough members rated it, so one review can't stand alone.
export const CATEGORY_MIN_RATINGS = 3;

export function categoryAverages(
  rows: Partial<Record<ReviewCategoryColumn, number | null>>[],
  min = CATEGORY_MIN_RATINGS,
) {
  return REVIEW_CATEGORIES.flatMap((category) => {
    const values = rows
      .map((row) => row[category.column])
      .filter((v): v is number => typeof v === "number" && v >= 1 && v <= 5);
    if (values.length < min) return [];
    const score =
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    return [{ label: category.label, score }];
  });
}

export const REVIEW_REPORT_REASONS = [
  { value: "fake", label: "Not a real client or a fake review" },
  { value: "harassment", label: "Harassment or hate" },
  { value: "inappropriate", label: "Inappropriate or unsafe" },
  { value: "personal_info", label: "Shares someone's private information" },
  { value: "spam", label: "Spam or advertising" },
  { value: "other", label: "Something else" },
] as const;

export const COACH_REPORT_REASONS = [
  { value: "misleading", label: "False claims or credentials" },
  { value: "harassment", label: "Harassment or unwanted contact" },
  { value: "inappropriate", label: "Inappropriate behaviour" },
  { value: "off_platform", label: "Asking for payment or contact off GYMX2" },
  { value: "safety", label: "Unsafe or harmful advice" },
  { value: "spam", label: "Spam or a fake account" },
  { value: "other", label: "Something else" },
] as const;

export type ReviewReportReason =
  (typeof REVIEW_REPORT_REASONS)[number]["value"];
export type CoachReportReason = (typeof COACH_REPORT_REASONS)[number]["value"];

export function reportReasonLabel(reason: string) {
  return (
    [...REVIEW_REPORT_REASONS, ...COACH_REPORT_REASONS].find(
      (r) => r.value === reason,
    )?.label ?? "Something else"
  );
}
