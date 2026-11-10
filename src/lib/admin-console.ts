// Numbers for the Admin Console overview. Pure functions, so they're easy to test.

const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
] as const;
export type RangeDays = (typeof RANGES)[number]["days"];

export function readRange(value: unknown): RangeDays {
  const n = Number(value);
  return RANGES.some((r) => r.days === n) ? (n as RangeDays) : 30;
}

// How a count grew over the range: the total now, how many were added in the range, the change
// against the count at the start (null when it started at zero), and a running total per day
// for the sparkline.
export function growth(dates: string[], days: number, now = new Date()) {
  const end = now.getTime();
  const start = end - days * DAY_MS;
  const times = dates
    .map((d) => new Date(d).getTime())
    .filter((t) => Number.isFinite(t) && t <= end);
  const total = times.length;
  const added = times.filter((t) => t > start).length;
  const before = total - added;
  const changePct =
    before > 0 ? Math.round((added / before) * 1000) / 10 : null;
  const series = Array.from({ length: days + 1 }, (_, i) => {
    const cutoff = start + i * DAY_MS;
    return times.filter((t) => t <= cutoff).length;
  });
  return { total, added, changePct, series };
}

export function averageRating(ratings: number[]) {
  const valid = ratings.filter((r) => r >= 1 && r <= 5);
  if (!valid.length) return null;
  return (
    Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10
  );
}

export type ActivityKind =
  "signup" | "profile" | "review" | "sale" | "affiliate";
export type Activity = {
  kind: ActivityKind;
  title: string;
  detail: string;
  at: string;
  href: string;
};

// The newest events across every source, newest first.
export function mergeActivity(lists: Activity[][], limit = 6) {
  return lists
    .flat()
    .filter((a) => a.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

export function timeAgo(iso: string, now = new Date()) {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 60000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60)
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

// Points for a small sparkline, scaled to a width and height. A flat series sits in the middle.
export function sparklinePoints(
  series: number[],
  width = 96,
  height = 32,
  pad = 2,
) {
  if (series.length < 2) return "";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  return series
    .map((value, i) => {
      const x = pad + (i / (series.length - 1)) * (width - pad * 2);
      const y =
        span === 0
          ? height / 2
          : height - pad - ((value - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
