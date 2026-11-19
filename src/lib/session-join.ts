import { idSchema } from "@/lib/validation";

export function sessionJoinPath(sessionId: string): string | null {
  const parsed = idSchema.safeParse(sessionId);
  return parsed.success ? `/calendar/${parsed.data}/join` : null;
}

export function isSafeExternalMeetingUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function gatedSessionJoinUrl(
  siteUrl: string,
  sessionId: string | null,
  meetingUrl: string | null,
): string | null {
  if (!sessionId || !isSafeExternalMeetingUrl(meetingUrl)) return null;
  const path = sessionJoinPath(sessionId);
  if (!path) return null;
  try {
    const base = new URL(siteUrl);
    if (base.protocol !== "https:" && base.protocol !== "http:") return null;
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}
