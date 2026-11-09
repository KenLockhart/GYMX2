// Reporting posts and comments. Shared by the server and the browser.

export const REPORT_REASONS = [
  { value: "spam", label: "Spam or selling" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate", label: "Inappropriate or unsafe" },
  { value: "off_platform", label: "Taking people or payments off GYMX2" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export const REPORT_DETAILS_MAX = 1000;

export function reasonLabel(reason: string) {
  return REPORT_REASONS.find((item) => item.value === reason)?.label ?? "Other";
}

// "3 reports: Spam or selling (2), Harassment or bullying (1)", most common first.
export function summarizeReasons(reasons: string[]) {
  const counts = new Map<string, number>();
  for (const reason of reasons)
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const parts = [...counts]
    .sort(
      (a, b) =>
        b[1] - a[1] || reasonLabel(a[0]).localeCompare(reasonLabel(b[0])),
    )
    .map(([reason, count]) => `${reasonLabel(reason)} (${count})`);
  return `${reasons.length} ${reasons.length === 1 ? "report" : "reports"}: ${parts.join(", ")}`;
}
