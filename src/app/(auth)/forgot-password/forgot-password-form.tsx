"use client";

import { ActionForm, Field, FormStatus, SubmitButton } from "@/components/form-parts";
import { requestPasswordReset } from "../actions";

export function ForgotPasswordForm() {
  return (
    <ActionForm action={requestPasswordReset} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <FormStatus />
      <SubmitButton pendingText="Sending...">Send reset link</SubmitButton>
    </ActionForm>
  );
}
