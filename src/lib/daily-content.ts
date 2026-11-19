import { z } from "zod";
import { idSchema } from "@/lib/validation";

export const DAILY_CONTENT_KINDS = ["video", "quote", "affirmation"] as const;
export type DailyContentKind = (typeof DAILY_CONTENT_KINDS)[number];
export const DAILY_CONTENT_VIDEO_DELETE_BLOCKED = "daily-content-video-in-use";
export const DAILY_FUEL_VIDEO_DELETE_BLOCKED = "daily-fuel-video-in-use";

export type DailyContentActionState =
  | { status: "idle" | "saved" | "published" | "archived" | "cancelled" }
  | {
      status: "error";
      reason: "not_allowed" | "invalid" | "not_ready" | "day_changed" | "not_found" | "failed";
    };

export type DailyContentPortalRevision = {
  id: string;
  number: number;
  titleSnapshot: string;
  videoId: string | null;
  quoteText: string | null;
  quoteAttribution: string | null;
  affirmationText: string | null;
  createdAt: string;
};

export type DailyContentPortalItem = {
  id: string;
  kind: DailyContentKind;
  title: string;
  status: "draft" | "active" | "archived";
  updatedAt: string;
  latestRevision: DailyContentPortalRevision | null;
};

export type DailyContentPortalVideoOption = {
  id: string;
  title: string;
  status: string;
  visibility: string;
  createdAt: string;
  durationSeconds: number | null;
};

export type DailyContentPortalSlot = {
  id: string;
  itemId: string;
  revisionId: string;
  kind: DailyContentKind;
  title: string;
  day: string;
  status: "scheduled" | "published" | "cancelled";
};

export type DailyContentPortalData = {
  role: "coach" | "admin";
  today: string;
  page: number;
  hasMoreItems: boolean;
  hasMoreVideos: boolean;
  truncated: boolean;
  items: DailyContentPortalItem[];
  videoOptions: DailyContentPortalVideoOption[];
  slots: DailyContentPortalSlot[];
  error: boolean;
};

const blankId = z.union([z.literal(""), z.null(), idSchema]).transform((value) =>
  value === "" ? null : value,
);

export const dailyContentItemInputSchema = z
  .object({
    itemId: blankId,
    kind: z.enum(DAILY_CONTENT_KINDS),
    title: z.string().trim().min(1).max(120),
    videoId: blankId,
    quoteText: z.string().trim().max(500),
    quoteAttribution: z.string().trim().max(120),
    affirmationText: z.string().trim().max(500),
  })
  .superRefine((value, context) => {
    const emptyQuote = value.quoteText.length === 0;
    const emptyAttribution = value.quoteAttribution.length === 0;
    const emptyAffirmation = value.affirmationText.length === 0;
    if (value.kind === "video") {
      if (!value.videoId || !emptyQuote || !emptyAttribution || !emptyAffirmation)
        context.addIssue({ code: "custom", message: "Choose one ready video." });
    } else if (value.kind === "quote") {
      if (!value.quoteText || value.videoId || !emptyAffirmation)
        context.addIssue({ code: "custom", message: "Enter quote text only." });
    } else if (!value.affirmationText || value.videoId || !emptyQuote || !emptyAttribution) {
      context.addIssue({ code: "custom", message: "Enter affirmation text only." });
    }
  });

export type DailyContentItemInput = z.infer<typeof dailyContentItemInputSchema>;

export function parseDailyContentForm(formData: FormData) {
  const value = (key: string) => {
    const entry = formData.get(key);
    return typeof entry === "string" ? entry : "";
  };
  return dailyContentItemInputSchema.safeParse({
    itemId: value("item_id"),
    kind: value("kind"),
    title: value("title"),
    videoId: value("video_id"),
    quoteText: value("quote_text"),
    quoteAttribution: value("quote_attribution"),
    affirmationText: value("affirmation_text"),
  });
}

export const dailyContentSlotInputSchema = z.object({
  itemId: idSchema,
  revisionId: idSchema,
  day: z.iso.date(),
});

export function isValidDailyContentScheduleDay(day: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}-\d{2}-\d{2}$/.test(today))
    return false;
  const parsedDay = Date.parse(`${day}T00:00:00Z`);
  const parsedToday = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(parsedDay) && Number.isFinite(parsedToday) &&
    new Date(parsedDay).toISOString().slice(0, 10) === day &&
    new Date(parsedToday).toISOString().slice(0, 10) === today &&
    parsedDay >= parsedToday && parsedDay <= parsedToday + 365 * 86_400_000;
}

export type DailyContentSource<T> = { value: T; revisionId?: string; slotId?: string } | null;

export function chooseDailyContent<T>(input: {
  legacyVideo?: T | null;
  coach: DailyContentSource<T>;
  admin: DailyContentSource<T>;
}): DailyContentSource<T> {
  if (input.legacyVideo != null) return { value: input.legacyVideo };
  return input.coach ?? input.admin;
}

export function chooseTextDailyContent<T>(input: {
  coach: DailyContentSource<T>;
  admin: DailyContentSource<T>;
}): DailyContentSource<T> {
  return input.coach ?? input.admin;
}

export function isDailyContentVideoVisibility(
  value: unknown,
): value is "members" | "private" {
  return value === "members" || value === "private";
}
