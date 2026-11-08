// Program rules: one day unlocks each day after a member starts. Days follow Eastern time.

function dayNumberSince(startedOn: string, today: string) {
  const start = new Date(`${startedOn}T12:00:00Z`).getTime();
  const now = new Date(`${today}T12:00:00Z`).getTime();
  return Math.floor((now - start) / (24 * 60 * 60 * 1000)) + 1;
}

// The highest day number open to the member today (day 1 on the day they start).
export function unlockedThrough(startedOn: string, today: string) {
  return Math.max(0, dayNumberSince(startedOn, today));
}

export function weeksLabel(dayCount: number) {
  if (dayCount === 0) return "No days yet";
  const weeks = Math.ceil(dayCount / 7);
  return dayCount < 7 ? `${dayCount} ${dayCount === 1 ? "day" : "days"}` : `${weeks} ${weeks === 1 ? "week" : "weeks"} · ${dayCount} days`;
}

export function progressPercent(done: number, total: number) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

// Where a member is: the first unlocked day they haven't finished, or null if they're caught up.
export function nextDay<D extends { id: string; day_number: number }>(
  days: D[],
  completedIds: Set<string>,
  unlocked: number,
) {
  return days.find((day) => day.day_number <= unlocked && !completedIds.has(day.id)) ?? null;
}
