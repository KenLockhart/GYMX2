"use client";

import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { deleteMyAccount } from "./actions";

export function DeleteAccountForm({ role }: { role: "member" | "coach" }) {
  return (
    <ActionForm
      action={deleteMyAccount}
      confirmMessage="Delete your GYMX2 account for good? This can't be undone."
      className="max-w-xl space-y-4"
    >
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>
          Your profile, messages, Tasks, Memos and calendar responses are
          deleted.
        </li>
        {role === "coach" && (
          <li>
            Your videos, Tasks, sessions and Armory items are deleted, and
            members lose access to them.
          </li>
        )}
        <li>
          Downloads you bought stop working. Gear already ordered still ships.
        </li>
        <li>We keep records of past purchases for tax, without your name.</li>
      </ul>
      <Field
        label="Type DELETE to confirm"
        name="confirm"
        autoComplete="off"
        required
      />
      <Field
        label="Your password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormStatus />
      <SubmitButton
        pendingText="Deleting..."
        className="rounded-md border border-danger px-5 py-2.5 font-semibold text-danger transition hover:bg-danger hover:text-background disabled:opacity-60"
      >
        Delete my account
      </SubmitButton>
    </ActionForm>
  );
}
