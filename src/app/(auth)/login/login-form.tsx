"use client";

import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { useT } from "@/i18n/client";
import { signIn } from "../actions";

export function LoginForm({
  next,
  initialError,
}: {
  next?: string;
  initialError?: string;
}) {
  const t = useT();
  return (
    <ActionForm
      action={signIn}
      initialState={{ error: initialError }}
      className="space-y-4"
    >
      {next && <input type="hidden" name="next" value={next} />}
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
        autoComplete="current-password"
        required
      />
      <FormStatus />
      <SubmitButton pendingText={t.auth.login.pending}>
        {t.auth.login.submit}
      </SubmitButton>
    </ActionForm>
  );
}
