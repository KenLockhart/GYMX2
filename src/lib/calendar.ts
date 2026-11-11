import { LOCALE_TAG, type Locale } from "../i18n/config";

// Calendar helpers. Calendar days are handled as plain "YYYY-MM-DD" strings, worked out in UTC,
// so a day never shifts. Session times are real moments (ISO strings) shown in the viewer's time zone.

export type MonthKey = { year: number; month: number }; // month is 1–12

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonth(value: unknown, today = new Date()): MonthKey {
  const match = typeof value === "string" ? MONTH_PATTERN.exec(value) : null;
  if (match) return { year: Number(match[1]), month: Number(match[2]) };
  return { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
}

export function monthParam({ year, month }: MonthKey) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function shiftMonth({ year, month }: MonthKey, delta: number): MonthKey {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthTitle({ year, month }: MonthKey, locale: Locale = "en") {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    LOCALE_TAG[locale],
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  );
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

// Weeks run Sunday to Saturday. Days from the months before and after fill out the first and last week.
export function monthGrid({ year, month }: MonthKey): string[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());

  const last = new Date(Date.UTC(year, month, 0));
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));

  const weeks: string[][] = [];
  for (
    const day = new Date(start);
    day <= end;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    if (day.getUTCDay() === 0) weeks.push([]);
    weeks[weeks.length - 1].push(dayKey(day));
  }
  return weeks;
}

// What to load for a month view: the whole grid, plus a day either side so any time zone is covered.
export function monthRange(key: MonthKey) {
  const weeks = monthGrid(key);
  const from = new Date(`${weeks[0][0]}T00:00:00Z`);
  const to = new Date(`${weeks[weeks.length - 1][6]}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  to.setUTCDate(to.getUTCDate() + 2);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    firstDay: weeks[0][0],
    lastDay: weeks[weeks.length - 1][6],
  };
}

// The calendar day a moment falls on, for someone in the given time zone.
export function localDayKey(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function formatSessionTime(
  startsAt: string,
  endsAt: string,
  timeZone?: string,
  locale: Locale = "en",
) {
  const tag = LOCALE_TAG[locale];
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = start.toLocaleDateString(tag, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
  const time = (date: Date) =>
    date.toLocaleTimeString(tag, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
  const sameDay =
    localDayKey(startsAt, timeZone) === localDayKey(endsAt, timeZone);
  return sameDay
    ? `${day}, ${time(start)} – ${time(end)}`
    : `${day}, ${time(start)} – ${end.toLocaleDateString(tag, { month: "short", day: "numeric", timeZone })}, ${time(end)}`;
}

export type SessionResponse = "pending" | "going" | "not_going";

export const responseLabel: Record<SessionResponse, string> = {
  pending: "No reply yet",
  going: "Going",
  not_going: "Can't go",
};

// Who to email after a coach saves a session. New invitees get an invite; members who were already
// invited hear about it only when the time or place changed. Past sessions send nothing.
export type SessionDetails = {
  starts_at: string;
  ends_at: string;
  location: string;
  meeting_url: string | null;
};

export function planSessionEmails(
  before: { details: SessionDetails; memberIds: string[] } | null,
  after: { details: SessionDetails; memberIds: string[] },
  now = new Date(),
) {
  if (new Date(after.details.ends_at) <= now)
    return { invited: [], updated: [] };
  const previous = new Set(before?.memberIds ?? []);
  const invited = after.memberIds.filter((id) => !previous.has(id));
  const changed =
    before !== null &&
    (new Date(before.details.starts_at).getTime() !==
      new Date(after.details.starts_at).getTime() ||
      new Date(before.details.ends_at).getTime() !==
        new Date(after.details.ends_at).getTime() ||
      before.details.location.trim() !== after.details.location.trim() ||
      (before.details.meeting_url ?? "") !== (after.details.meeting_url ?? ""));
  const updated = changed
    ? after.memberIds.filter((id) => previous.has(id))
    : [];
  return { invited, updated };
}

// Emails can't know the reader's time zone, so they show Eastern time and say so.
export const EMAIL_TIME_ZONE = "America/New_York";

export function formatEmailSessionTime(
  startsAt: string,
  endsAt: string,
  locale: Locale = "en",
) {
  const zone =
    new Intl.DateTimeFormat("en-US", {
      timeZone: EMAIL_TIME_ZONE,
      timeZoneName: "short",
    })
      .formatToParts(new Date(startsAt))
      .find((part) => part.type === "timeZoneName")?.value ?? "ET";
  return `${formatSessionTime(startsAt, endsAt, EMAIL_TIME_ZONE, locale)} ${zone}`;
}
