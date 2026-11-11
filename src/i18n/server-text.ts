import type { Locale } from "./config";
import { esServerText, esServerPatterns } from "./es/server-text";

// Messages that come back from the server (form errors and confirmations) are written in English.
// This looks up the translation, falling back to the English text.
export function translateServerText(text: string, locale: Locale): string {
  if (locale === "en" || !text) return text;
  const exact = esServerText[text];
  if (exact) return exact;
  for (const [pattern, replace] of esServerPatterns) {
    const match = text.match(pattern);
    if (match) return replace(...match.slice(1));
  }
  return text;
}
