"use client";

import { PILLARS } from "@/lib/achievements";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { EXPERIENCE, GOALS } from "@/lib/onboarding";
import { useT } from "@/i18n/client";
import type { ActionState } from "@/lib/types";

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
  const t = useT();
  const o = t.options;
  return (
    <ActionForm action={action} className="max-w-3xl space-y-8">
      <fieldset className="space-y-3">
        <legend className="text-xl font-semibold">{t.goalsForm.goals}</legend>
        <p className="text-sm text-muted">{t.goalsForm.goalsHint}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {GOALS.map((goal) => (
            <Choice
              key={goal.value}
              type="checkbox"
              name="goals"
              value={goal.value}
              label={o.goals[goal.value] ?? goal.label}
              checked={initial.goals.includes(goal.value)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-xl font-semibold">
          {t.goalsForm.experience}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {EXPERIENCE.map((item) => (
            <Choice
              key={item.value}
              type="radio"
              name="experience"
              value={item.value}
              label={o.experience[item.value]?.label ?? item.label}
              hint={o.experience[item.value]?.hint ?? item.hint}
              checked={initial.experience === item.value}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-xl font-semibold">{t.goalsForm.focus}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <Choice
              key={pillar.value}
              type="radio"
              name="focus"
              value={pillar.value}
              label={o.pillars[pillar.value]}
              hint={o.pillarHints[pillar.value]}
              checked={initial.focus === pillar.value}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <SubmitButton pendingText={t.common.saving} className="btn-primary">
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
  const t = useT();
  return (
    <ActionForm action={action} className="max-w-3xl space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {GOALS.map((goal) => (
          <Choice
            key={goal.value}
            type="checkbox"
            name="specialties"
            value={goal.value}
            label={t.options.goals[goal.value] ?? goal.label}
            checked={initial.includes(goal.value)}
          />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton pendingText={t.common.saving} className="btn-secondary">
          {t.profile.specialties.save}
        </SubmitButton>
        <FormStatus />
      </div>
    </ActionForm>
  );
}
