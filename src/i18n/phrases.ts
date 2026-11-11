import type { Locale } from "./config";
import { esPhrases } from "./es-phrases";
import { translateServerText } from "./server-text";

// Short screen text keyed by its English wording, for the larger screens (coach tools, community,
// Armory). Placeholders like {name} are filled from vars. A test checks every phrase used in the
// code has Spanish.
export function translate(
  text: string,
  locale: Locale,
  vars?: Record<string, string | number>,
): string {
  let out =
    locale === "es"
      ? (esPhrases[text] ?? translateServerText(text, locale))
      : text;
  if (vars)
    for (const [key, value] of Object.entries(vars))
      out = out.replaceAll(`{${key}}`, String(value));
  return out;
}

export type Tr = (
  text: string,
  vars?: Record<string, string | number>,
) => string;
