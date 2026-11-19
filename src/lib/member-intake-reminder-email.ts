import { escapeHtml, type Email } from "@/lib/email-templates";
import type { Locale } from "@/i18n/config";
import { sessionJoinPath } from "@/lib/session-join";

export type MemberIntakeReminderInput = {
  siteUrl: string;
  memberName: string;
  coachName: string;
  coachId: string;
  sessionId: string;
  startsAt: string;
  phase: "24h" | "2h";
  locale: Locale;
};

export function dueMemberIntakeReminderPhase(
  startsAt: Date,
  now: Date,
): "24h" | "2h" | null {
  const minutesUntil = (startsAt.getTime() - now.getTime()) / 60_000;
  if (minutesUntil >= 23 * 60 + 45 && minutesUntil <= 24 * 60 + 15) return "24h";
  if (minutesUntil >= 105 && minutesUntil <= 135) return "2h";
  return null;
}

export function memberIntakeReminderEmail(input: MemberIntakeReminderInput): Email {
  const isSpanish = input.locale === "es";
  const url = new URL("/intake", input.siteUrl);
  url.searchParams.set("coach", input.coachId);
  const returnTo = sessionJoinPath(input.sessionId);
  if (returnTo) url.searchParams.set("returnTo", returnTo);
  const safeName = escapeHtml(input.memberName);
  const safeCoach = escapeHtml(input.coachName);
  const when = new Intl.DateTimeFormat(isSpanish ? "es-419" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(input.startsAt));
  const safeWhen = escapeHtml(when);
  const subject = isSpanish
    ? "Revisa tu formulario antes de la sesión"
    : "Review your intake before your session";
  const heading = isSpanish
    ? "Prepárate para tu sesión"
    : "Get ready for your session";
  const intro = isSpanish
    ? `${safeName}, revisa tu formulario y compártelo con ${safeCoach} antes de tu sesión del ${safeWhen}.`
    : `${safeName}, review your intake and share it with ${safeCoach} before your session on ${safeWhen}.`;
  const button = isSpanish ? "Revisar formulario" : "Review intake";
  const html = `<main><h1>${heading}</h1><p>${intro}</p><p><a href="${escapeHtml(url.toString())}">${button}</a></p></main>`;
  const text = `${heading}\n\n${isSpanish
    ? `${input.memberName}, revisa tu formulario y compártelo con ${input.coachName} antes de tu sesión del ${when}.`
    : `${input.memberName}, review your intake and share it with ${input.coachName} before your session on ${when}.`}
\n\n${button}: ${url.toString()}`;
  return { subject, html, text, locale: input.locale };
}
