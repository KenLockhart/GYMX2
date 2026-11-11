"use client";

import { createContext, use } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { messages, type Messages } from "./messages";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale(): Locale {
  return use(LocaleContext);
}

export function useT(): Messages {
  return messages[use(LocaleContext)];
}
