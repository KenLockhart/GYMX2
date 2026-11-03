"use client";

import { createContext, startTransition, use, useActionState } from "react";
import type { ActionState } from "@/lib/types";

const FormContext = createContext<{ state: ActionState; pending: boolean }>({
  state: {},
  pending: false,
});

export function ActionForm({
  action,
  initialState = {},
  className,
  children,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(event) => {
        // A plain form action makes React clear the fields, losing what was typed if the server rejects it.
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <FormContext value={{ state, pending }}>{children}</FormContext>
    </form>
  );
}

export function SubmitButton({
  children,
  pendingText,
  className = "btn-primary w-full",
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
}) {
  const { pending } = use(FormContext);
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}

export function FormStatus() {
  const { state } = use(FormContext);
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  }
  return null;
}

export function Field({
  label,
  hint,
  ...inputProps
}: { label: string; hint?: string } & React.ComponentProps<"input">) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input className="field-input" {...inputProps} />
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}
