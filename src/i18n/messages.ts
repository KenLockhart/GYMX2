import type { Locale } from "./config";
import { en } from "./en";
import { es } from "./es";

// Text with names or numbers in it is a function; its result is any string.
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => unknown
    ? (...args: A) => string
    : { [K in keyof T]: Widen<T[K]> };

// Every screen's text, by language. The Spanish set has the same shape as the English one, so a
// missing translation fails the type check.
export type Messages = Widen<typeof en>;
export const messages: Record<Locale, Messages> = { en, es };
