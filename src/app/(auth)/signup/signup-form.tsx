"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { setLocale } from "@/i18n/actions";
import { useLocale, useT } from "@/i18n/client";
import { LOCALE_NAME, LOCALES } from "@/i18n/config";
import { signUp } from "../actions";

export function SignupForm({ next }: { next?: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [switching, start] = useTransition();

  return (
    <ActionForm action={signUp} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t.auth.signup.language}</span>
        <select
          value={locale}
          disabled={switching}
          onChange={(event) => {
            const chosen = event.target.value;
            // Redraw this page in the chosen language straight away.
            start(async () => {
              await setLocale(chosen);
              router.refresh();
            });
          }}
          className="field-input"
        >
          {LOCALES.map((option) => (
            <option key={option} value={option} lang={option}>
              {LOCALE_NAME[option]}
            </option>
          ))}
        </select>
        <span className="block text-xs text-muted">
          {t.auth.signup.languageHint}
        </span>
      </label>
      {/* The choice is saved as it's made; this sends it with the form too. */}
      <input type="hidden" name="locale" value={locale} />
      <Field
        label={t.auth.name}
        name="display_name"
        autoComplete="name"
        maxLength={80}
        required
      />
      <Field
        label={t.auth.email}
        name="email"
        type="email"
        autoComplete="email"
        required
      />
      <Field
        label={t.auth.password}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        hint={t.auth.passwordHint}
        required
      />
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="coach_requested"
          className="mt-0.5 size-4 accent-accent"
        />
        <span>
          {t.auth.signup.coach}
          <span className="block text-muted">{t.auth.signup.coachHint}</span>
        </span>
      </label>
      <p className="text-sm text-muted">
        {t.auth.signup.agreeBefore}{" "}
        <Link href="/terms" className="text-link">
          {t.auth.signup.terms}
        </Link>{" "}
        {t.auth.signup.and}{" "}
        <Link href="/privacy" className="text-link">
          {t.auth.signup.privacy}
        </Link>
        {t.auth.signup.legalInEnglish}
        {t.auth.signup.agreeAfter}
      </p>
      <FormStatus />
      <SubmitButton pendingText={t.auth.signup.pending}>
        {t.auth.signup.submit}
      </SubmitButton>
    </ActionForm>
  );
}
