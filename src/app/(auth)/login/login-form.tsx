"use client";

import { ActionForm, Field, FormStatus, SubmitButton } from "@/components/form-parts";
import { signIn } from "../actions";

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  return (
    <ActionForm action={signIn} initialState={{ error: initialError }} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormStatus />
      <SubmitButton pendingText="Logging in...">Log in</SubmitButton>
    </ActionForm>
  );
}
