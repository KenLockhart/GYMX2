import { z } from "zod";

export const sessionRequestSchema = z.object({
  coach_id: z.uuid("Choose a coach."),
  day: z.iso.date("Choose a valid date."),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time."),
  time_zone: z.string().trim().min(1).max(100),
  note: z.string().trim().max(1000),
});

export type SessionRequestInput = z.infer<typeof sessionRequestSchema>;

function localPartsAt(date: Date, formatter: Intl.DateTimeFormat) {
  const parts = new Map(
    formatter
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  const hour = parts.get("hour");
  const minute = parts.get("minute");
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  )
    return null;
  return { year, month, day, hour, minute };
}

// Converts a local date/time request into an instant without relying on the server's time zone.
// Sampling offsets around the requested date finds both sides of a DST fold, including half-hour
// transitions. A skipped spring-forward time has no exact candidate and is rejected.
export function localSessionRequestToIso(
  day: string,
  time: string,
  timeZone: string,
  now = new Date(),
) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const dateDay = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const wantedEpoch = Date.UTC(year, month - 1, dateDay, hour, minute);
  const wanted = new Date(wantedEpoch);
  if (
    wanted.getUTCFullYear() !== year ||
    wanted.getUTCMonth() + 1 !== month ||
    wanted.getUTCDate() !== dateDay ||
    hour > 23 ||
    minute > 59
  )
    return null;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }

  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 3) {
    const sample = wantedEpoch + hours * 60 * 60 * 1000;
    const parts = localPartsAt(new Date(sample), formatter);
    if (!parts) return null;
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    offsets.add(represented - sample);
  }

  const candidates = [...offsets]
    .map((offset) => wantedEpoch - offset)
    .filter((candidate) => {
      const resolved = localPartsAt(new Date(candidate), formatter);
      return (
        resolved?.year === year &&
        resolved.month === month &&
        resolved.day === dateDay &&
        resolved.hour === hour &&
        resolved.minute === minute
      );
    })
    .sort((a, b) => a - b);
  const candidate = candidates[0];
  if (candidate === undefined || candidate <= now.getTime()) return null;

  return new Date(candidate).toISOString();
}
