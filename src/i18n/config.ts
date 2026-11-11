// The languages the coach and member screens come in. English is the default.
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "gymx2-locale";

// Each language's name in itself, for the pickers.
export const LOCALE_NAME: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

// For <html lang> and for formatting dates and numbers. Spanish is Latin American Spanish.
export const LOCALE_TAG: Record<Locale, string> = {
  en: "en-US",
  es: "es-419",
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

// The best match from a browser's Accept-Language header, for visitors who haven't chosen yet.
export function localeFromHeader(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const first = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((entry) => entry.tag && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q)
    .find((entry) => /^(en|es)\b/.test(entry.tag));
  return first?.tag.startsWith("es") ? "es" : DEFAULT_LOCALE;
}
