import { LOCALE_TAG, type Locale } from "../i18n/config";
// Mind, Body and Spirit tracking: habit suggestions, weeks, and summaries. Days follow Eastern time.
import { dayKey, type Pillar } from "./achievements";

export const HABIT_SUGGESTIONS: Record<Pillar, string[]> = {
  mind: [
    "Meditate 10 minutes",
    "Read 10 pages",
    "Journal",
    "No phone first hour",
  ],
  body: [
    "Drink 8 glasses of water",
    "Walk 8,000 steps",
    "Sleep 7+ hours",
    "Hit my protein goal",
    "Stretch 10 minutes",
  ],
  spirit: [
    "Write 3 things I'm grateful for",
    "Prayer or reflection",
    "Time outdoors",
    "Reach out to someone",
  ],
};

export const MAX_HABITS = 12;
// Members can check off today and the six days before, but not the future.
export const EDITABLE_DAYS = 7;

function shiftDay(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The last n days, oldest first, ending today.
export function lastDays(count: number, now = new Date()) {
  const today = dayKey(now.toISOString());
  return Array.from({ length: count }, (_, index) =>
    shiftDay(today, index - (count - 1)),
  );
}

export function isEditableDay(day: string, now = new Date()) {
  return lastDays(EDITABLE_DAYS, now).includes(day);
}

export function weekdayLabel(day: string, locale: Locale = "en") {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(LOCALE_TAG[locale], {
    weekday: "short",
    timeZone: "UTC",
  });
}

type Habit = { id: string; pillar: Pillar };
type HabitLog = { habit_id: string; day: string };

// For each pillar over the given days: how many check-ins out of how many possible.
export function pillarSummary(
  habits: Habit[],
  logs: HabitLog[],
  days: string[],
) {
  const pillarOf = new Map(habits.map((habit) => [habit.id, habit.pillar]));
  const inRange = new Set(days);
  const summary: Record<Pillar, { done: number; possible: number }> = {
    mind: { done: 0, possible: 0 },
    body: { done: 0, possible: 0 },
    spirit: { done: 0, possible: 0 },
  };
  for (const habit of habits) summary[habit.pillar].possible += days.length;
  for (const log of logs) {
    const pillar = pillarOf.get(log.habit_id);
    if (pillar && inRange.has(log.day)) summary[pillar].done += 1;
  }
  return summary;
}

// Days on which every pillar had at least one check-in.
export function balancedDays(habits: Habit[], logs: HabitLog[]) {
  const pillarOf = new Map(habits.map((habit) => [habit.id, habit.pillar]));
  const byDay = new Map<string, Set<Pillar>>();
  for (const log of logs) {
    const pillar = pillarOf.get(log.habit_id);
    if (!pillar) continue;
    byDay.set(log.day, (byDay.get(log.day) ?? new Set()).add(pillar));
  }
  return [...byDay]
    .filter(([, pillars]) => pillars.size === 3)
    .map(([day]) => day);
}

// Averages over the days that have a value, and how many days were logged.
export function nutritionAverages(
  logs: {
    day: string;
    protein_g: number | null;
    calories: number | null;
    water_glasses: number | null;
  }[],
  days: string[],
) {
  const inRange = logs.filter((log) => days.includes(log.day));
  const average = (key: "protein_g" | "calories" | "water_glasses") => {
    const values = inRange.flatMap((log) =>
      log[key] === null ? [] : [log[key] as number],
    );
    return values.length
      ? Math.round(
          values.reduce((sum, value) => sum + value, 0) / values.length,
        )
      : null;
  };
  return {
    protein: average("protein_g"),
    calories: average("calories"),
    water: average("water_glasses"),
    logged: inRange.length,
  };
}

// The change between the earliest and latest weigh-ins in the window, if there are two.
export function weightChange(
  logs: { day: string; weight_lb: number | string | null }[],
  sinceDay: string,
) {
  const points = logs
    .filter((log) => log.weight_lb !== null && log.day >= sinceDay)
    .map((log) => ({ day: log.day, value: Number(log.weight_lb) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (points.length < 2) return null;
  return (
    Math.round((points[points.length - 1].value - points[0].value) * 10) / 10
  );
}

// "180", "180.5" or "" (left blank). Returns a number, null for blank, or NaN if unreadable.
export function parseMeasure(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value.trim().replace(/,/g, "") : "";
  if (text === "") return null;
  return /^\d+(\.\d)?$/.test(text) ? Number(text) : Number.NaN;
}
