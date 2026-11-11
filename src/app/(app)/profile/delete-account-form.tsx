"use client";

import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { useT } from "@/i18n/client";
import { deleteMyAccount } from "./actions";

export function DeleteAccountForm({ role }: { role: "member" | "coach" }) {
  const d = useT().profile.delete;
  return (
    <ActionForm
      action={deleteMyAccount}
      confirmMessage={d.confirm}
      className="max-w-xl space-y-4"
    >
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>{d.profileGone}</li>
        {role === "coach" && <li>{d.coachGone}</li>}
        <li>{d.downloads}</li>
        <li>{d.records}</li>
      </ul>
      <Field label={d.typeDelete} name="confirm" autoComplete="off" required />
      <Field
        label={d.password}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormStatus />
      <SubmitButton
        pendingText={d.pending}
        className="rounded-md border border-danger px-5 py-2.5 font-semibold text-danger transition hover:bg-danger hover:text-background disabled:opacity-60"
      >
        {d.submit}
      </SubmitButton>
    </ActionForm>
  );
}
