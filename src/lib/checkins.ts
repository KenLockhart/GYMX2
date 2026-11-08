// Weekly check-ins: one per member per week (weeks start Monday, Eastern time).

export const CHECKIN_SCALES = [
  {
    key: "energy",
    label: "Energy",
    low: "Drained",
    high: "Full of energy",
    goodHigh: true,
  },
  { key: "sleep", label: "Sleep", low: "Poor", high: "Great", goodHigh: true },
  {
    key: "stress",
    label: "Stress",
    low: "Calm",
    high: "Overwhelmed",
    goodHigh: false,
  },
  {
    key: "motivation",
    label: "Motivation",
    low: "Struggling",
    high: "Fired up",
    goodHigh: true,
  },
] as const;
export type ScaleKey = (typeof CHECKIN_SCALES)[number]["key"];
export const CHECKIN_TEXT_MAX = 1000;
export const CHECKIN_QUESTION_MAX = 500;

export type Checkin = {
  id: string;
  member_id: string;
  week_start: string;
  energy: number;
  sleep: number;
  stress: number;
  motivation: number;
  wins: string;
  struggles: string;
  question: string;
  created_at: string;
};

function shift(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The Monday of the week containing this day ("2026-11-08" is a Sunday, so "2026-11-02").
export function weekStart(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sunday ... 6 Saturday
  return shift(day, -((weekday + 6) % 7));
}

export function previousWeeks(currentWeek: string, count: number) {
  return Array.from({ length: count }, (_, index) =>
    shift(currentWeek, -7 * (count - 1 - index)),
  );
}

export function weekLabel(week: string) {
  return new Date(`${week}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// A 1-5 answer that's worth a coach's attention: low energy/sleep/motivation or high stress.
export function needsAttention(checkin: Pick<Checkin, ScaleKey>) {
  return CHECKIN_SCALES.filter((scale) =>
    scale.goodHigh ? checkin[scale.key] <= 2 : checkin[scale.key] >= 4,
  ).map((scale) => scale.label);
}

export function average(values: number[]) {
  return values.length
    ? Math.round(
        (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
      ) / 10
    : null;
}

// This week's summary for a coach: who checked in, who hasn't, and the averages.
export function weekSummary(
  memberIds: string[],
  checkins: Checkin[],
  week: string,
) {
  const thisWeek = checkins.filter(
    (row) => row.week_start === week && memberIds.includes(row.member_id),
  );
  const done = new Set(thisWeek.map((row) => row.member_id));
  return {
    checkedIn: thisWeek.length,
    missing: memberIds.filter((id) => !done.has(id)),
    averages: Object.fromEntries(
      CHECKIN_SCALES.map((scale) => [
        scale.key,
        average(thisWeek.map((row) => row[scale.key])),
      ]),
    ) as Record<ScaleKey, number | null>,
    flagged: thisWeek.filter((row) => needsAttention(row).length > 0).length,
  };
}
