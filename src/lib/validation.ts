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

// Only same-site paths are allowed, so a crafted link can't send someone to another site after login.
export function safeRedirectPath(path: unknown, fallback = "/dashboard") {
  if (typeof path !== "string" || !path.startsWith("/")) return fallback;
  if (path.startsWith("//") || path.includes("\\")) return fallback;
  return path;
}
