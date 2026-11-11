"use client";

import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { useT } from "@/i18n/client";
import { requestPasswordReset } from "../actions";

export function ForgotPasswordForm() {
  const t = useT();
  return (
    <ActionForm action={requestPasswordReset} className="space-y-4">
      <Field
        label={t.auth.email}
        name="email"
        type="email"
        autoComplete="email"
        required
      />
      <FormStatus />
      <SubmitButton pendingText={t.auth.forgot.pending}>
        {t.auth.forgot.submit}
      </SubmitButton>
    </ActionForm>
  );
}
