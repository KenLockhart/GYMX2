import type { MemberIntakeAnswers } from "@/lib/member-intake";
import { getLocale, getT } from "@/i18n/server";

type Props = {
  answers: MemberIntakeAnswers;
  completedAt?: string | null;
};

type AnswerKey = keyof MemberIntakeAnswers;

const groups: { key: keyof Awaited<ReturnType<typeof getT>>["intake"]["sections"]; fields: AnswerKey[] }[] = [
  { key: "basic", fields: ["age", "sex", "height_in", "current_weight_lbs", "highest_adult_weight_lbs", "lowest_adult_weight_lbs", "goal_weight_lbs", "waist_in"] },
  { key: "history", fields: ["regain_causes", "regain_causes_other", "what_worked_before", "what_worked_before_other", "coached_before", "coached_before_notes"] },
  { key: "health", fields: ["injuries", "exercise_clearance", "medical_notes", "interested_in_medication_consult"] },
  { key: "equipment", fields: ["training_location", "equipment", "training_days_per_week", "session_minutes"] },
  { key: "routine", fields: ["work_type", "sleep_hours", "sugary_drinks_per_day", "sugary_drink_types", "alcohol_drinks_per_week", "eating_pattern", "activity_level"] },
  { key: "food", fields: ["food_allergies", "food_allergies_other", "foods_avoided", "dietary_style", "dietary_style_other", "batch_cooking", "grocery_budget_weekly", "meals_per_day"] },
  { key: "plan", fields: ["plan_style", "checkin_preference"] },
  { key: "mind", fields: ["stress_level", "stress_coping", "wants_support_resources", "main_why"] },
];

const fieldAliases: Record<string, string> = {
  height_in: "height",
  current_weight_lbs: "current_weight",
  highest_adult_weight_lbs: "highest_weight",
  lowest_adult_weight_lbs: "lowest_weight",
  goal_weight_lbs: "goal_weight",
  waist_in: "waist",
  regain_causes_other: "regain_causes_other",
  what_worked_before_other: "what_worked_before_other",
  interested_in_medication_consult: "medication_consult",
  training_days_per_week: "training_days",
  sugary_drinks_per_day: "sugary_drinks",
  alcohol_drinks_per_week: "alcohol_drinks",
  food_allergies: "food_allergies",
  grocery_budget_weekly: "grocery_budget",
  wants_support_resources: "support_resources",
};

function displayValue(value: unknown, choices: Record<string, string>, locale: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) {
    if (!value.length) return null;
    return value.map((item) => typeof item === "string" ? choices[item] ?? item : "").filter(Boolean).join(", ");
  }
  if (typeof value === "string") return choices[value] ?? value;
  if (typeof value === "number") return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  return null;
}

function heightLabel(inches: number, locale: string) {
  const feet = Math.floor(inches / 12);
  const rest = Math.round(inches - feet * 12);
  return locale === "es-419" ? `${feet} pies ${rest} pulg` : `${feet} ft ${rest} in`;
}

function formatValue(key: AnswerKey, value: unknown, choices: Record<string, string>, locale: string): string | null {
  if (key === "injuries" && Array.isArray(value)) {
    if (!value.length) return null;
    return value.map((injury) => {
      const part = injury.body_part === "other"
        ? String(injury.body_part_other ?? choices.other)
        : choices[injury.body_part] ?? injury.body_part;
      return `${part} · ${choices[injury.restriction] ?? injury.restriction} · ${choices[injury.duration] ?? injury.duration}`;
    }).join("; ");
  }
  if (key === "height_in" && typeof value === "number") return heightLabel(value, locale);
  if (["current_weight_lbs", "highest_adult_weight_lbs", "lowest_adult_weight_lbs", "goal_weight_lbs"].includes(key) && typeof value === "number") {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} lb`;
  }
  if (key === "waist_in" && typeof value === "number") return `${value} in`;
  if (key === "sleep_hours" && typeof value === "number") return `${value} h`;
  if (key === "session_minutes" && typeof value === "number") return `${value} min`;
  if (key === "training_days_per_week" && typeof value === "number") return `${value} / week`;
  if (key === "stress_level" && typeof value === "number") return `${value} / 10`;
  return displayValue(value, choices, locale);
}

export async function CoachIntakeSummary({ answers, completedAt }: Props) {
  const t = (await getT()).intake;
  const locale = await getLocale();
  const localeTag = locale === "es" ? "es-419" : "en-US";
  const choices = t.choice as Record<string, string>;
  const fieldLabels = t.field as Record<string, string>;
  const fieldLabel = (key: string) => fieldLabels[fieldAliases[key] ?? key] ?? key;
  const weights = t.currentVsHighLow(
    answers.current_weight_lbs ? `${answers.current_weight_lbs} lb` : "–",
    answers.highest_adult_weight_lbs ? `${answers.highest_adult_weight_lbs} lb` : "–",
    answers.lowest_adult_weight_lbs ? `${answers.lowest_adult_weight_lbs} lb` : "–",
  );
  const noWeightBearing = answers.injuries.some((injury) =>
    injury.restriction === "no_weight_bearing" &&
    /^(ankle|foot|knee)_(left|right)$/.test(injury.body_part),
  );
  const highlights = [
    ["exercise_clearance", answers.exercise_clearance],
    ["sugary_drinks_per_day", answers.sugary_drinks_per_day],
    ["eating_pattern", answers.eating_pattern],
    ["plan_style", answers.plan_style],
    ["main_why", answers.main_why],
  ] as const;

  return (
    <article className="space-y-5">
      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold">{t.highlights}</h2>
          {completedAt && <time className="text-xs text-muted" dateTime={completedAt}>{new Intl.DateTimeFormat(localeTag, { dateStyle: "medium" }).format(new Date(completedAt))}</time>}
        </div>
        <p className="text-sm font-medium">{weights}</p>
        {noWeightBearing && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">{t.nwbWarning}: {answers.injuries.filter((injury) => injury.restriction === "no_weight_bearing" && /^(ankle|foot|knee)_(left|right)$/.test(injury.body_part)).map((injury) => choices[injury.body_part] ?? injury.body_part).join(", ")}</p>}
        <dl className="grid gap-3 sm:grid-cols-2">
          {highlights.map(([key, value]) => (
            <div key={key} className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted">{fieldLabel(key)}</dt>
              <dd className={key === "main_why" ? "mt-1 whitespace-pre-wrap font-medium" : "mt-1 font-medium"}>
                {formatValue(key, value, choices, localeTag) ?? "–"}
              </dd>
            </div>
          ))}
        </dl>
        {answers.injuries.length === 0 && <p className="text-sm text-muted">{t.noInjuries}</p>}
        <p className="text-xs text-muted">{t.medicalDisclaimer}</p>
      </section>

      <h2 className="text-xl font-semibold">{t.stepSummary}</h2>
      <div className="space-y-4">
        {groups.map((group) => {
          const entries = group.fields.map((key) => ({
            key,
            value: formatValue(key, answers[key], choices, localeTag),
          })).filter((entry) => entry.value !== null);
          if (!entries.length) return null;
          return (
            <section key={group.key} className="space-y-2 rounded-xl border border-border bg-surface p-4">
              <h3 className="font-semibold">{t.sections[group.key]}</h3>
              <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                {entries.map((entry) => (
                  <div key={entry.key} className={entry.key === "main_why" || entry.key === "medical_notes" ? "sm:col-span-2" : ""}>
                    <dt className="text-xs text-muted">{fieldLabel(entry.key)}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm">{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
    </article>
  );
}
