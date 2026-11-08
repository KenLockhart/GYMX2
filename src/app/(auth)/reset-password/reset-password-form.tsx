"use client";

import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { updatePassword } from "../actions";

export function ResetPasswordForm() {
  return (
    <ActionForm action={updatePassword} className="space-y-4">
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters."
        required
      />
      <FormStatus />
      <SubmitButton pendingText="Saving...">Save new password</SubmitButton>
    </ActionForm>
  );
}
