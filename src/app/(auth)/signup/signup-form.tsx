"use client";

import { ActionForm, Field, FormStatus, SubmitButton } from "@/components/form-parts";
import { signUp } from "../actions";

export function SignupForm() {
  return (
    <ActionForm action={signUp} className="space-y-4">
      <Field label="Name" name="display_name" autoComplete="name" maxLength={80} required />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters."
        required
      />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="coach_requested" className="mt-0.5 size-4 accent-accent" />
        <span>
          I want to coach on GYMX2.
          <span className="block text-muted">An admin reviews every coach request.</span>
        </span>
      </label>
      <FormStatus />
      <SubmitButton pendingText="Creating account...">Create account</SubmitButton>
    </ActionForm>
  );
}
