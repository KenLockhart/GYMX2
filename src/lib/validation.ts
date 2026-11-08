import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
const password = z
  .string()
  .min(8, "Use at least 8 characters for your password.")
  .max(72, "Use 72 characters or fewer for your password.");
const displayName = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(80, "Use 80 characters or fewer for your name.");

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const socialLink = (label: string) =>
  z
    .string()
    .trim()
    .max(300, `The ${label} link is too long.`)
    .refine((value) => value === "" || isHttpsUrl(value), {
      error: `The ${label} link must be a full address starting with https://`,
    })
    .transform((value) => (value === "" ? null : value));

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({
  display_name: displayName,
  email,
  password,
  coach_requested: z.boolean(),
});

export const emailSchema = z.object({ email });

export const newPasswordSchema = z.object({ password });

export const profileSchema = z.object({
  display_name: displayName,
  bio: z.string().trim().max(1000, "Use 1,000 characters or fewer for your bio."),
  coach_requested: z.boolean(),
  instagram_url: socialLink("Instagram"),
  tiktok_url: socialLink("TikTok"),
  youtube_url: socialLink("YouTube"),
  x_url: socialLink("X"),
  website_url: socialLink("website"),
});

export const setRoleSchema = z.object({
  user_id: z.uuid(),
  role: z.enum(["member", "coach", "admin"]),
});

export const emailLinkTypeSchema = z.enum(["email", "recovery"]);

const taskOrVideoTitle = z
  .string()
  .trim()
  .min(1, "Enter a title.")
  .max(120, "Use 120 characters or fewer for the title.");
const isoDate = z.iso.date("Choose a valid date.");

export const videoSchema = z.object({
  title: taskOrVideoTitle,
  description: z.string().trim().max(2000, "Use 2,000 characters or fewer for the description."),
});

export const taskSchema = z.object({
  video_id: z.uuid("Choose a video."),
  title: taskOrVideoTitle,
  instructions: z.string().trim().max(2000, "Use 2,000 characters or fewer for the instructions."),
  due_on: z.union([z.literal("").transform(() => null), isoDate]),
  member_ids: z.array(z.uuid()).min(1, "Choose at least one member.").max(200),
});

export const memoSchema = z.object({
  id: z.union([z.literal("").transform(() => null), z.uuid()]),
  memo_date: isoDate,
  body: z.string().trim().min(1, "Write a note first.").max(5000, "Use 5,000 characters or fewer."),
  shared_with_coaches: z.boolean(),
});

export const idSchema = z.uuid();

// Only same-site paths are allowed, so a crafted link can't send someone to another site after login.
export function safeRedirectPath(path: unknown, fallback = "/dashboard") {
  if (typeof path !== "string" || !path.startsWith("/")) return fallback;
  if (path.startsWith("//") || path.includes("\\")) return fallback;
  return path;
}

const optionalHttpsUrl = z
  .string()
  .trim()
  .max(500, "The meeting link is too long.")
  .refine((value) => value === "" || isHttpsUrl(value), {
    error: "The meeting link must be a full address starting with https://",
  });

const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

// Times arrive as full ISO moments. The browser turns the coach's local date and time into one before sending.
export const sessionSchema = z
  .object({
    id: z.union([z.literal("").transform(() => null), z.uuid()]),
    title: taskOrVideoTitle,
    notes: z.string().trim().max(2000, "Use 2,000 characters or fewer for the notes."),
    location: z.string().trim().max(200, "Use 200 characters or fewer for the location."),
    meeting_url: optionalHttpsUrl,
    starts_at: z.iso.datetime({ offset: true, error: "Choose a date and start time." }),
    ends_at: z.iso.datetime({ offset: true, error: "Choose an end time." }),
    member_ids: z.array(z.uuid()).min(1, "Invite at least one member.").max(200),
  })
  .refine((value) => Date.parse(value.ends_at) > Date.parse(value.starts_at), {
    error: "The session must end after it starts.",
  })
  .refine((value) => Date.parse(value.ends_at) - Date.parse(value.starts_at) <= MAX_SESSION_MS, {
    error: "A session can last up to 24 hours.",
  });

export const sessionResponseSchema = z.object({
  session_id: z.uuid(),
  response: z.enum(["going", "not_going"]),
});
