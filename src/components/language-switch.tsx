"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "@/i18n/actions";
import { useLocale, useT } from "@/i18n/client";
import { LOCALE_NAME, LOCALES, type Locale } from "@/i18n/config";

// English / Español, as a two-button switch. Switching saves the choice and redraws the page in it.
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const choose = (next: Locale) => {
    if (next === locale) return;
    start(async () => {
      await setLocale(next);
      router.refresh();
    });
  };

  return (
    <div
      role="group"
      aria-label={t.common.language.label}
      className={`flex rounded-full border border-border bg-background p-0.5 ${pending ? "opacity-60" : ""} ${className}`}
    >
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={option === locale}
          disabled={pending}
          onClick={() => choose(option)}
          className={`flex-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            option === locale
              ? "bg-accent text-accent-foreground"
              : "text-muted hover:text-foreground"
          }`}
        >
          {LOCALE_NAME[option]}
        </button>
      ))}
    </div>
  );
}
