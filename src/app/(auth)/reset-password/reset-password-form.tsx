"use client";

import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { useT } from "@/i18n/client";
import { updatePassword } from "../actions";

export function ResetPasswordForm() {
  const t = useT();
  return (
    <ActionForm action={updatePassword} className="space-y-4">
      <Field
        label={t.auth.reset.label}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        hint={t.auth.passwordHint}
        required
      />
      <FormStatus />
      <SubmitButton pendingText={t.auth.reset.pending}>
        {t.auth.reset.submit}
      </SubmitButton>
    </ActionForm>
  );
}
