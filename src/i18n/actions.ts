"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isLocale, LOCALE_COOKIE, type Locale } from "./config";

export async function rememberLocale(locale: Locale) {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}

// Switches the whole console to a language. Saved on the account (so it follows the person to other
// devices) and on this browser (so the pages before log-in match).
export async function setLocale(locale: string): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };
  await rememberLocale(locale);
  const account = await getCurrentAccount();
  if (account) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ locale })
      .eq("id", account.profile.id);
    if (error) {
      console.error(error);
      return { ok: false };
    }
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
