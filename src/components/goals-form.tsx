"use client";

import { PILLARS } from "@/lib/achievements";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { EXPERIENCE, GOALS } from "@/lib/onboarding";
import type { ActionState } from "@/lib/types";

const pillarHint = {
  mind: "Stress, sleep, focus and habits",
  body: "Strength, fitness, weight and nutrition",
  spirit: "Purpose, motivation and inner growth",
} as const;

function Choice({
  type,
  name,
  value,
  label,
  hint,
  checked,
}: {
  type: "checkbox" | "radio";
  name: string;
  value: string;
  label: string;
  hint?: string;
  checked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3 text-sm has-[:checked]:border-accent">
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={checked}
        className="mt-0.5 size-4 accent-accent"
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function GoalsForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  initial: { goals: string[]; experience: string | null; focus: string | null };
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="max-w-3xl space-y-8">
      <fieldset className="space-y-3">
        <legend className="text-xl font-semibold">
          What do you want to work on?
        </legend>
        <p className="text-sm text-muted">Pick as many as you like.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {GOALS.map((goal) => (
            <Choice
              key={goal.value}
              type="checkbox"
              name="goals"
              value={goal.value}
              label={goal.label}
              checked={initial.goals.includes(goal.value)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-xl font-semibold">
          How much experience do you have?
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {EXPERIENCE.map((item) => (
            <Choice
              key={item.value}
              type="radio"
              name="experience"
              value={item.value}
              label={item.label}
              hint={item.hint}
              checked={initial.experience === item.value}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-xl font-semibold">
          Where do you want to start?
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <Choice
              key={pillar.value}
              type="radio"
              name="focus"
              value={pillar.value}
              label={pillar.label}
              hint={pillarHint[pillar.value]}
              checked={initial.focus === pillar.value}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Saving..." className="btn-primary">
          {submitLabel}
        </SubmitButton>
        <FormStatus />
      </div>
    </ActionForm>
  );
}

export function SpecialtiesForm({
  action,
  initial,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  initial: string[];
}) {
  return (
    <ActionForm action={action} className="max-w-3xl space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {GOALS.map((goal) => (
          <Choice
            key={goal.value}
            type="checkbox"
            name="specialties"
            value={goal.value}
            label={goal.label}
            checked={initial.includes(goal.value)}
          />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Saving..." className="btn-secondary">
          Save specialties
        </SubmitButton>
        <FormStatus />
      </div>
    </ActionForm>
  );
}
