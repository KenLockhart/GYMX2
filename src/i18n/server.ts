import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getCurrentAccount } from "@/lib/auth";
import {
  isLocale,
  LOCALE_COOKIE,
  localeFromHeader,
  type Locale,
} from "./config";
import { messages, type Messages } from "./messages";

// The language chosen on this browser, or the browser's own preference. No account lookup, so it's
// cheap enough for every page.
export const getBrowserLocale = cache(async (): Promise<Locale> => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return localeFromHeader((await headers()).get("accept-language"));
});

// The signed-in person's language (saved on their account, so it follows them between devices),
// or the browser's for visitors.
export const getLocale = cache(async (): Promise<Locale> => {
  const account = await getCurrentAccount();
  const saved = account?.profile.locale;
  return isLocale(saved) ? saved : getBrowserLocale();
});

export async function getT(): Promise<Messages> {
  return messages[await getLocale()];
}
