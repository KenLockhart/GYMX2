import { LOCALE_TAG, type Locale } from "../i18n/config";
import { z } from "zod";

// Free intro sessions: coaches publish times, members book one. Shared by the server and browser.

export const INTRO_MINUTES = [15, 20, 30, 45, 60] as const;
export const INTRO_FORMAT_LABEL = {
  online: "Video call",
  in_person: "In person",
} as const;
export type IntroFormat = keyof typeof INTRO_FORMAT_LABEL;
export const MAX_SLOTS_PER_ADD = 40;

export const introSlotsSchema = z
  .object({
    starts: z
      .array(z.iso.datetime({ offset: true }))
      .min(1, "Pick at least one time.")
      .max(MAX_SLOTS_PER_ADD, `Add up to ${MAX_SLOTS_PER_ADD} times at once.`),
    minutes: z.coerce
      .number()
      .refine(
        (n) => (INTRO_MINUTES as readonly number[]).includes(n),
        "Pick a length.",
      ),
    format: z.enum(["online", "in_person"]),
    location: z
      .string()
      .trim()
      .max(200, "Use 200 characters or fewer for the place."),
    meetingUrl: z
      .string()
      .trim()
      .max(500)
      .refine(
        (v) => v === "" || /^https:\/\/\S+$/.test(v),
        "Video links must start with https://",
      ),
  })
  .superRefine((value, ctx) => {
    if (value.format === "in_person" && !value.location)
      ctx.addIssue({
        code: "custom",
        message: "Add where you'll meet.",
        path: ["location"],
      });
  });

export const introMessageSchema = z
  .string()
  .trim()
  .max(1000, "Keep your message to 1,000 characters.");

// The same local wall-clock time each week (so 6 PM stays 6 PM across daylight saving changes).
export function repeatWeekly(first: Date, weeks: number) {
  return Array.from({ length: Math.max(1, Math.min(weeks, 12)) }, (_, i) => {
    const d = new Date(first);
    d.setDate(d.getDate() + i * 7);
    return d.toISOString();
  });
}

export type OpenSlot = {
  id: string;
  startsAt: string;
  minutes: number;
  format: IntroFormat;
};

// Open times grouped by the viewer's local day, in order.
export function slotsByDay(
  slots: OpenSlot[],
  timeZone?: string,
  locale: Locale = "en",
) {
  const days: { key: string; label: string; slots: OpenSlot[] }[] = [];
  for (const slot of [...slots].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  )) {
    const date = new Date(slot.startsAt);
    const key = date.toLocaleDateString("en-CA", { timeZone });
    const label = date.toLocaleDateString(LOCALE_TAG[locale], {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone,
    });
    const last = days[days.length - 1];
    if (last?.key === key) last.slots.push(slot);
    else days.push({ key, label, slots: [slot] });
  }
  return days;
}

export function formatIntroFormats(formats: IntroFormat[]) {
  return [...new Set(formats)].map((f) => INTRO_FORMAT_LABEL[f]);
}

// Readable messages for the database's booking errors.
export function introErrorMessage(message: string | undefined) {
  const known = [
    "Only members can book an intro.",
    "Keep your message to 1,000 characters.",
    "That time isn't available any more.",
    "Someone just booked that time. Please pick another.",
    "You already have an intro with this coach.",
    "You can have up to 3 upcoming intros at a time.",
    "Intro not found.",
    "This intro was already cancelled.",
    "This intro has already started.",
  ];
  return (
    known.find((text) => message?.includes(text)) ??
    "That didn't work. Please try again."
  );
}
