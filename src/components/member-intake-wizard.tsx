"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import {
  centimetersToInches,
  displayMemberWeight,
  feetAndInchesToInches,
  memberWeightFromInput,
  type MemberIntakeDraft,
} from "@/lib/member-intake";
import {
  prepareMemberIntakeFormData,
  safeMemberIntakeReturnPath,
} from "@/lib/member-intake-form";
import type { PendingIntakeBooking } from "@/lib/member-intake-server";
import {
  completeMemberIntake,
  saveMemberIntakeStep,
} from "@/app/(app)/intake/actions";

type Props = {
  initialAnswers: MemberIntakeDraft;
  step: number;
  coach: PendingIntakeBooking | null;
  returnTo?: string | null;
  error?: string | null;
};

type Choice = readonly string[];

const options = {
  sex: ["male", "female", "prefer_not_to_say"],
  causes: ["stress", "work_schedule", "life_changes", "travel", "injury", "stopped_tracking", "other"],
  worked: ["better_nutrition", "a_coach", "a_gym_routine", "a_specific_diet", "medication", "nothing_yet", "other"],
  bodyParts: ["neck", "shoulder_left", "shoulder_right", "elbow_left", "elbow_right", "wrist_left", "wrist_right", "lower_back", "hip_left", "hip_right", "knee_left", "knee_right", "ankle_left", "ankle_right", "foot_left", "foot_right", "other"],
  restrictions: ["no_weight_bearing", "no_impact", "limited_range_of_motion", "pain_only"],
  durations: ["under_6_months", "6_to_24_months", "2_plus_years"],
  clearance: ["yes", "no", "not_sure"],
  maybe: ["yes", "no", "maybe"],
  locations: ["home_gym", "commercial_gym", "both", "no_equipment"],
  equipment: ["dumbbells", "kettlebells", "barbell_and_rack", "cable_machine", "leg_press", "hack_squat", "preacher_curl_bench", "rower", "upright_or_recumbent_bike", "arm_bike", "total_body_machine", "resistance_bands", "pool_access"],
  work: ["desk", "on_feet", "mixed", "physical_labor"],
  sugary: ["0", "1", "2-3", "4+"],
  sugaryTypes: ["soda", "juice", "sweet_tea", "energy_drinks", "other"],
  eating: ["regular_meals", "eat_when_i_remember", "skip_breakfast", "graze_all_day", "late_night_eating"],
  activity: ["sedentary", "light", "moderate", "active"],
  allergies: ["milk", "eggs", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soy", "sesame", "other"],
  dietary: ["no_preference", "no_pork", "pescatarian", "vegetarian", "vegan", "other"],
  batch: ["twice_weekly", "once_weekly", "quick_meals_only"],
  budget: ["under_50", "50_to_100", "100_to_150", "over_150"],
  meals: ["2", "3", "3_plus_snack"],
  plans: ["simple_rules", "detailed_tracking", "in_between"],
  checkins: ["daily_app_prompt", "weekly_coach_call", "text_message", "none"],
} as const satisfies Record<string, Choice>;

function isSelected(value: unknown, option: string) {
  return Array.isArray(value) && value.includes(option);
}

export function MemberIntakeWizard({ initialAnswers, step, coach, returnTo, error: initialError }: Props) {
  const t = useT().intake;
  const router = useRouter();
  const [answers, setAnswers] = useState<MemberIntakeDraft>(() => ({
    ...initialAnswers,
    stress_level: initialAnswers.stress_level ?? 5,
  }));
  const [consent, setConsent] = useState(false);
  const [formError, setFormError] = useState(initialError ?? "");
  const [pending, startTransition] = useTransition();
  const [heightUnit, setHeightUnit] = useState<"ft" | "cm">("ft");
  const [weightUnit, setWeightUnit] = useState<"lb" | "kg">("lb");
  const choices = t.choice as Record<string, string>;
  const fields = t.field as Record<string, string>;
  const sectionKeys = ["basic", "history", "health", "equipment", "routine", "food", "plan", "mind"] as const;
  const sections = t.sections;

  function setValue(key: keyof MemberIntakeDraft, value: unknown) {
    setAnswers((previous) => ({ ...previous, [key]: value }) as MemberIntakeDraft);
    setFormError("");
  }

  function toggleArray(key: keyof MemberIntakeDraft, option: string) {
    const current = answers[key];
    const next = Array.isArray(current) ? [...current] as string[] : [];
    setValue(key, next.includes(option) ? next.filter((item) => item !== option) : [...next, option]);
  }

  function label(key: string) {
    return fields[key] ?? key;
  }

  function choice(value: string) {
    return choices[value] ?? value;
  }

  function choose(key: keyof MemberIntakeDraft, value: string | number | undefined) {
    setValue(key, value);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const formData = prepareMemberIntakeFormData(
      new FormData(event.currentTarget),
      {
        answers,
        step,
        coach: coach ? { coachId: coach.coachId, bookingId: coach.bookingId } : null,
        consent,
        submitterValue: submitter?.value ?? null,
        returnTo,
      },
    );
    setFormError("");

    startTransition(async () => {
      const result = submitter?.value === "finish"
        ? await completeMemberIntake(formData)
        : (() => saveMemberIntakeStep(formData))();
      const resolved = await result;
      if (resolved.error) {
        setFormError(resolved.error);
        return;
      }
      if (resolved.redirectTo) {
        router.push(resolved.redirectTo);
        router.refresh();
      }
    });
  }

  function selectField(
    key: keyof MemberIntakeDraft,
    optionValues: Choice,
    required = false,
    optionalPlaceholder = false,
  ) {
    const value = answers[key];
    return (
      <label className="block space-y-1.5" key={String(key)}>
        <span className="text-sm font-medium">{label(String(key))}{required ? " *" : ""}</span>
        <select
          className="field-input"
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          required={required}
          onChange={(event) => {
            const next = event.target.value || undefined;
            choose(key, key === "session_minutes" && next !== undefined ? Number(next) : next);
          }}
        >
          <option value="">{optionalPlaceholder ? t.buttons.choose : t.buttons.choose}</option>
          {optionValues.map((option) => (
            <option value={option} key={option}>{choice(option)}</option>
          ))}
        </select>
      </label>
    );
  }

  function numberField(
    key: keyof MemberIntakeDraft,
    options: { min?: number; max?: number; step?: number; required?: boolean; unit?: string } = {},
  ) {
    const value = answers[key];
    return (
      <label className="block space-y-1.5" key={String(key)}>
        <span className="text-sm font-medium">{label(String(key))}{options.required ? " *" : ""}</span>
        <span className="flex items-center gap-2">
          <input
            className="field-input"
            type="number"
            value={typeof value === "number" ? value : ""}
            min={options.min}
            max={options.max}
            step={options.step ?? 1}
            required={options.required}
            onChange={(event) => choose(key, event.target.value === "" ? undefined : Number(event.target.value))}
          />
          {options.unit && <span className="text-sm text-muted">{options.unit}</span>}
        </span>
      </label>
    );
  }

  function weightField(key: "highest_adult_weight_lbs" | "lowest_adult_weight_lbs" | "goal_weight_lbs") {
    const pounds = answers[key];
    const inKilograms = weightUnit === "kg";
    const value = displayMemberWeight(pounds, weightUnit);
    return (
      <label className="block space-y-1.5" key={key}>
        <span className="text-sm font-medium">{label(key)}</span>
        <span className="flex items-center gap-2">
          <input
            className="field-input"
            type="number"
            min={inKilograms ? 18.2 : 40}
            max={inKilograms ? 408.2 : 900}
            step={0.1}
            value={value}
            onChange={(event) => {
              choose(key, memberWeightFromInput(event.target.value, weightUnit));
            }}
          />
          <span className="text-sm text-muted">{inKilograms ? t.buttons.kilograms : t.buttons.pounds}</span>
        </span>
      </label>
    );
  }

  function textField(key: keyof MemberIntakeDraft, options: { maxLength?: number; required?: boolean; hint?: string } = {}) {
    const value = answers[key];
    return (
      <label className="block space-y-1.5" key={String(key)}>
        <span className="text-sm font-medium">{label(String(key))}{options.required ? " *" : ""}</span>
        <textarea
          className="field-input min-h-24"
          value={typeof value === "string" ? value : ""}
          maxLength={options.maxLength}
          required={options.required}
          onChange={(event) => choose(key, event.target.value)}
        />
        {options.hint && <span className="block text-xs text-muted">{options.hint}</span>}
      </label>
    );
  }

  function checkboxGroup(key: keyof MemberIntakeDraft, values: Choice) {
    const selected = answers[key];
    return (
      <fieldset className="space-y-2" key={String(key)}>
        <legend className="mb-2 text-sm font-medium">{label(String(key))}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {values.map((option) => (
            <label key={option} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={isSelected(selected, option)}
                onChange={() => toggleArray(key, option)}
                className="size-4 accent-accent"
              />
              <span>{choice(option)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  function stepOne() {
    const heightIn = answers.height_in;
    const totalIn = Math.round(heightIn ?? 0);
    const feet = Math.floor(totalIn / 12);
    const remainingInches = totalIn % 12;
    const cm = heightIn === undefined ? "" : (heightIn * 2.54).toFixed(2);
    const currentWeight = answers.current_weight_lbs;
    const weightDisplay = displayMemberWeight(currentWeight, weightUnit);
    return (
      <div className="space-y-5">
        {numberField("age", { min: 18, max: 100, required: true })}
        {selectField("sex", options.sex, true)}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{label("height")} *</span>
            <div className="inline-flex rounded-lg border border-border p-1" aria-label={label("height")}>
              <button type="button" className={`rounded px-3 py-1 text-sm ${heightUnit === "ft" ? "bg-accent text-accent-foreground" : ""}`} onClick={() => setHeightUnit("ft")}>{t.buttons.feet}/{t.buttons.inches}</button>
              <button type="button" className={`rounded px-3 py-1 text-sm ${heightUnit === "cm" ? "bg-accent text-accent-foreground" : ""}`} onClick={() => setHeightUnit("cm")}>{t.buttons.centimeters}</button>
            </div>
          </div>
          {heightUnit === "ft" ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5"><span className="sr-only">{t.buttons.feet}</span><input className="field-input" type="number" min={3} max={8} value={heightIn === undefined ? "" : feet} required aria-label={t.buttons.feet} onChange={(event) => {
                const nextFeet = Number(event.target.value || 0);
                const next = feetAndInchesToInches(nextFeet, nextFeet === 8 ? 0 : remainingInches);
                choose("height_in", next === null ? undefined : next);
              }} /><span className="text-xs text-muted">{t.buttons.feet}</span></label>
              <label className="space-y-1.5"><span className="sr-only">{t.buttons.inches}</span><input className="field-input" type="number" min={0} max={feet === 8 ? 0 : 11} value={heightIn === undefined ? "" : remainingInches} required aria-label={t.buttons.inches} onChange={(event) => {
                const next = feetAndInchesToInches(feet, feet === 8 ? 0 : Number(event.target.value || 0));
                choose("height_in", next === null ? undefined : next);
              }} /><span className="text-xs text-muted">{t.buttons.inches}</span></label>
            </div>
          ) : (
            <label className="block"><span className="sr-only">{label("height")}</span><input className="field-input" type="number" min={91.44} max={243.84} step={0.01} value={cm} required onChange={(event) => choose("height_in", event.target.value === "" ? undefined : centimetersToInches(Number(event.target.value)))} /></label>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{label("current_weight")} *</span>
            <div className="inline-flex rounded-lg border border-border p-1" aria-label={label("current_weight")}>
              <button type="button" className={`rounded px-3 py-1 text-sm ${weightUnit === "lb" ? "bg-accent text-accent-foreground" : ""}`} onClick={() => setWeightUnit("lb")}>{t.buttons.pounds}</button>
              <button type="button" className={`rounded px-3 py-1 text-sm ${weightUnit === "kg" ? "bg-accent text-accent-foreground" : ""}`} onClick={() => setWeightUnit("kg")}>{t.buttons.kilograms}</button>
            </div>
          </div>
          <input className="field-input" type="number" min={weightUnit === "lb" ? 40 : 18.2} max={weightUnit === "lb" ? 900 : 408.2} step="0.1" value={weightDisplay} required onChange={(event) => {
            choose("current_weight_lbs", memberWeightFromInput(event.target.value, weightUnit));
          }} />
        </div>
        {weightField("highest_adult_weight_lbs")}
        {weightField("lowest_adult_weight_lbs")}
        {weightField("goal_weight_lbs")}
        {numberField("waist_in", { min: 10, max: 100, step: 0.1, unit: t.buttons.inches })}
      </div>
    );
  }

  function injuriesEditor() {
    const injuries = answers.injuries ?? [];
    return (
      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">{label("injuries")}</legend>
        {injuries.map((injury, index) => (
          <div key={index} className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{label("injuries")} {index + 1}</p>
              <button type="button" className="text-sm text-danger underline" onClick={() => setValue("injuries", injuries.filter((_, rowIndex) => rowIndex !== index))}>{t.buttons.removeInjury}</button>
            </div>
            <label className="block space-y-1.5"><span className="text-sm">{label("body_part")}</span><select className="field-input" value={injury.body_part} onChange={(event) => {
              const next = [...injuries];
              next[index] = { ...injury, body_part: event.target.value as typeof injury.body_part };
              setValue("injuries", next);
            }}>{options.bodyParts.map((part) => <option key={part} value={part}>{choice(part)}</option>)}</select></label>
            {injury.body_part === "other" && <label className="block space-y-1.5"><span className="text-sm">{label("body_part_other")}</span><input className="field-input" maxLength={100} value={injury.body_part_other ?? ""} onChange={(event) => {
              const next = [...injuries]; next[index] = { ...injury, body_part_other: event.target.value }; setValue("injuries", next);
            }} /></label>}
            {(["restriction", "duration"] as const).map((fieldName) => {
              const vals = fieldName === "restriction" ? options.restrictions : options.durations;
              return <label key={fieldName} className="block space-y-1.5"><span className="text-sm">{label(fieldName)}</span><select className="field-input" value={injury[fieldName]} onChange={(event) => {
                const next = [...injuries]; next[index] = { ...injury, [fieldName]: event.target.value } as typeof injury; setValue("injuries", next);
              }}>{vals.map((option) => <option key={option} value={option}>{choice(option)}</option>)}</select></label>;
            })}
          </div>
        ))}
        <button type="button" className="btn-secondary" onClick={() => setValue("injuries", [...injuries, {
          body_part: "neck",
          restriction: "pain_only",
          duration: "under_6_months",
        }])}>{t.buttons.addInjury}</button>
      </fieldset>
    );
  }

  function renderStep() {
    if (step === 1) return stepOne();
    if (step === 2) return <div className="space-y-5">
      {checkboxGroup("regain_causes", options.causes)}
      {isSelected(answers.regain_causes, "other") && textField("regain_causes_other", { maxLength: 300 })}
      {checkboxGroup("what_worked_before", options.worked)}
      {isSelected(answers.what_worked_before, "other") && textField("what_worked_before_other", { maxLength: 300 })}
      {selectField("coached_before", ["yes", "no"])}
      {answers.coached_before === "yes" && textField("coached_before_notes", { maxLength: 1000 })}
    </div>;
    if (step === 3) return <div className="space-y-5">
      {injuriesEditor()}
      {selectField("exercise_clearance", options.clearance, true)}
      {textField("medical_notes", { maxLength: 2000, hint: t.healthNote })}
      {selectField("interested_in_medication_consult", options.maybe)}
    </div>;
    if (step === 4) return <div className="space-y-5">
      {selectField("training_location", options.locations, true)}
      {checkboxGroup("equipment", options.equipment)}
      {numberField("training_days_per_week", { min: 2, max: 6, required: true })}
      {selectField("session_minutes", ["20", "30", "45", "60"], true)}
    </div>;
    if (step === 5) return <div className="space-y-5">
      {selectField("work_type", options.work, true)}
      {numberField("sleep_hours", { min: 3, max: 12, step: 0.5, required: true })}
      {selectField("sugary_drinks_per_day", options.sugary, true)}
      {checkboxGroup("sugary_drink_types", options.sugaryTypes)}
      {numberField("alcohol_drinks_per_week", { min: 0, max: 100, step: 1 })}
      {checkboxGroup("eating_pattern", options.eating)}
      {selectField("activity_level", options.activity, true)}
    </div>;
    if (step === 6) return <div className="space-y-5">
      {checkboxGroup("food_allergies", options.allergies)}
      {isSelected(answers.food_allergies, "other") && textField("food_allergies_other", { maxLength: 300 })}
      {textField("foods_avoided", { maxLength: 1000 })}
      {selectField("dietary_style", options.dietary, true)}
      {answers.dietary_style === "other" && textField("dietary_style_other", { maxLength: 100 })}
      {selectField("batch_cooking", options.batch, true)}
      {selectField("grocery_budget_weekly", options.budget, false, true)}
      {selectField("meals_per_day", options.meals, true)}
    </div>;
    if (step === 7) return <div className="space-y-5">
      {selectField("plan_style", options.plans, true)}
      {selectField("checkin_preference", options.checkins, true)}
    </div>;
    return <div className="space-y-5">
      <label className="block space-y-2">
        <span className="text-sm font-medium">{label("stress_level")} *</span>
        <input className="w-full accent-accent" type="range" min={1} max={10} step={1} value={answers.stress_level ?? 5} onChange={(event) => choose("stress_level", Number(event.target.value))} />
        <span className="flex justify-between text-xs text-muted"><span>1</span><span className="font-semibold text-foreground">{answers.stress_level ?? 5}</span><span>10</span></span>
      </label>
      {textField("stress_coping", { maxLength: 1000 })}
      {selectField("wants_support_resources", ["yes", "no"])}
      {textField("main_why", { maxLength: 200, required: true, hint: t.mainWhyHint })}
      <label className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed">
        <input type="checkbox" className="mt-1 size-4 shrink-0 accent-accent" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>{t.consent}</span>
      </label>
    </div>;
  }

  const heading = step === 1 ? sections.basic
    : step === 2 ? sections.history
      : step === 3 ? sections.health
        : step === 4 ? sections.equipment
          : step === 5 ? sections.routine
            : step === 6 ? sections.food
              : step === 7 ? sections.plan
                : sections.mind;
  const errorText = formError
    ? (t.errors as Record<string, string>)[formError] ?? t.errors.save_failed
    : "";
  const subtitle = coach
    ? coach.state === "review"
      ? t.subtitleReview(coach.coachName)
      : t.subtitleNew(coach.coachName)
    : t.subtitleUpdate;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">{t.progress(step, 8)}</p>
        <h1 className="text-4xl sm:text-5xl">{t.title}</h1>
        <p className="text-muted">{subtitle}</p>
        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">{t.privacyNote}</p>
      </header>

      <div className="grid grid-cols-8 gap-1" aria-label={t.progress(step, 8)}>
        {sectionKeys.map((key, index) => (
          <div key={key} className={`h-2 rounded-full ${index + 1 <= step ? "bg-accent" : "bg-surface-raised"}`} title={sections[key]} />
        ))}
      </div>

      <form onSubmit={submit} className="space-y-6 rounded-2xl border border-border bg-surface p-4 sm:p-6">
        <input type="hidden" name="return_to" value={safeMemberIntakeReturnPath(returnTo) ?? ""} />
        <div>
          <h2 className="text-2xl font-semibold">{heading}</h2>
          {step === 3 && <p className="mt-2 text-sm text-muted">{t.healthNote}</p>}
        </div>

        {renderStep()}

        {formError && <p role="alert" className="rounded-lg border border-danger/50 bg-danger/5 p-3 text-sm text-danger">{errorText}</p>}
        {step === 8 && !coach && <p className="rounded-lg border border-border bg-surface-raised p-3 text-sm text-muted">{t.bookingNeeded}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          {step < 8 ? (
            <button type="submit" value="next" className="btn-primary order-2" disabled={pending}>
              {pending ? t.buttons.submitting : t.buttons.next}
            </button>
          ) : (
            <button type="submit" value="finish" className="btn-primary order-2" disabled={pending || !consent}>
              {pending ? t.buttons.completing : t.buttons.finish}
            </button>
          )}
          {step > 1 ? (
            <button type="submit" value="back" formNoValidate className="btn-secondary order-1" disabled={pending}>
              {t.buttons.previous}
            </button>
          ) : (
            <button type="button" className="btn-secondary order-1" onClick={() => router.push("/calendar")}>{t.buttons.openCalendar}</button>
          )}
        </div>
      </form>
      <p className="text-xs text-muted">{t.medicalDisclaimer}</p>
    </section>
  );
}
