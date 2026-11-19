import { z } from "zod";

export const INTAKE_STEPS = [
  "basic",
  "history",
  "health",
  "equipment",
  "routine",
  "food",
  "plan",
  "mind",
] as const;

export const SEX_VALUES = ["male", "female", "prefer_not_to_say"] as const;
export const BODY_PARTS = [
  "neck",
  "shoulder_left",
  "shoulder_right",
  "elbow_left",
  "elbow_right",
  "wrist_left",
  "wrist_right",
  "lower_back",
  "hip_left",
  "hip_right",
  "knee_left",
  "knee_right",
  "ankle_left",
  "ankle_right",
  "foot_left",
  "foot_right",
  "other",
] as const;

const yesNo = ["yes", "no"] as const;
const text = (max: number) => z.string().trim().max(max);
const optionalNumber = (min: number, max: number) =>
  z.number().finite().min(min).max(max).optional();
const stringArray = <T extends readonly [string, ...string[]]>(
  values: T,
  max: number,
) => z.array(z.enum(values)).max(max).default([]);

export const memberIntakeAnswerShape = {
  age: z.number().int().min(18).max(100),
  sex: z.enum(SEX_VALUES),
  height_in: z.number().finite().min(36).max(96),
  current_weight_lbs: z.number().finite().min(40).max(900),
  highest_adult_weight_lbs: optionalNumber(40, 900),
  lowest_adult_weight_lbs: optionalNumber(40, 900),
  goal_weight_lbs: optionalNumber(40, 900),
  waist_in: optionalNumber(10, 100),
  regain_causes: stringArray(
    [
      "stress",
      "work_schedule",
      "life_changes",
      "travel",
      "injury",
      "stopped_tracking",
      "other",
    ] as const,
    7,
  ),
  regain_causes_other: text(300).optional(),
  what_worked_before: stringArray(
    [
      "better_nutrition",
      "a_coach",
      "a_gym_routine",
      "a_specific_diet",
      "medication",
      "nothing_yet",
      "other",
    ] as const,
    7,
  ),
  what_worked_before_other: text(300).optional(),
  coached_before: z.enum(yesNo).optional(),
  coached_before_notes: text(1000).optional(),
  injuries: z
    .array(
      z
        .object({
          body_part: z.enum(BODY_PARTS),
          body_part_other: text(100).optional(),
          restriction: z.enum([
            "no_weight_bearing",
            "no_impact",
            "limited_range_of_motion",
            "pain_only",
          ]),
          duration: z.enum(["under_6_months", "6_to_24_months", "2_plus_years"]),
        })
        .strict(),
    )
    .max(20)
    .default([]),
  exercise_clearance: z.enum(["yes", "no", "not_sure"]),
  medical_notes: text(2000).optional(),
  interested_in_medication_consult: z.enum(["yes", "no", "maybe"]).optional(),
  training_location: z.enum(["home_gym", "commercial_gym", "both", "no_equipment"]),
  equipment: stringArray(
    [
      "dumbbells",
      "kettlebells",
      "barbell_and_rack",
      "cable_machine",
      "leg_press",
      "hack_squat",
      "preacher_curl_bench",
      "rower",
      "upright_or_recumbent_bike",
      "arm_bike",
      "total_body_machine",
      "resistance_bands",
      "pool_access",
    ] as const,
    13,
  ),
  training_days_per_week: z.number().int().min(2).max(6),
  session_minutes: z.union([z.literal(20), z.literal(30), z.literal(45), z.literal(60)]),
  work_type: z.enum(["desk", "on_feet", "mixed", "physical_labor"]),
  sleep_hours: z.number().finite().min(3).max(12).refine((n) => n * 2 === Math.round(n * 2)),
  sugary_drinks_per_day: z.enum(["0", "1", "2-3", "4+"]),
  sugary_drink_types: stringArray(
    ["soda", "juice", "sweet_tea", "energy_drinks", "other"] as const,
    5,
  ),
  alcohol_drinks_per_week: optionalNumber(0, 100),
  eating_pattern: stringArray(
    ["regular_meals", "eat_when_i_remember", "skip_breakfast", "graze_all_day", "late_night_eating"] as const,
    5,
  ),
  activity_level: z.enum(["sedentary", "light", "moderate", "active"]),
  food_allergies: stringArray(
    ["milk", "eggs", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soy", "sesame", "other"] as const,
    10,
  ),
  food_allergies_other: text(300).optional(),
  foods_avoided: text(1000).optional(),
  dietary_style: z.enum([
    "no_preference",
    "no_pork",
    "pescatarian",
    "vegetarian",
    "vegan",
    "other",
  ]),
  dietary_style_other: text(100).optional(),
  batch_cooking: z.enum(["twice_weekly", "once_weekly", "quick_meals_only"]),
  grocery_budget_weekly: z.enum(["under_50", "50_to_100", "100_to_150", "over_150"]).optional(),
  meals_per_day: z.enum(["2", "3", "3_plus_snack"]),
  plan_style: z.enum(["simple_rules", "detailed_tracking", "in_between"]),
  checkin_preference: z.enum(["daily_app_prompt", "weekly_coach_call", "text_message", "none"]),
  stress_level: z.number().int().min(1).max(10),
  stress_coping: text(1000).optional(),
  wants_support_resources: z.enum(yesNo).optional(),
  main_why: text(200),
} satisfies z.ZodRawShape;

const answerObject = z.object(memberIntakeAnswerShape).strict();

export const memberIntakeDraftSchema = answerObject.partial().strict();

export const memberIntakeAnswersSchema = answerObject.superRefine((answers, ctx) => {
  if (answers.regain_causes.includes("other") && !answers.regain_causes_other?.trim()) {
    ctx.addIssue({ code: "custom", path: ["regain_causes_other"], message: "Please describe the other reason." });
  }
  if (
    answers.what_worked_before.includes("other") &&
    !answers.what_worked_before_other?.trim()
  ) {
    ctx.addIssue({ code: "custom", path: ["what_worked_before_other"], message: "Please describe what worked." });
  }
  if (answers.dietary_style === "other" && !answers.dietary_style_other?.trim()) {
    ctx.addIssue({ code: "custom", path: ["dietary_style_other"], message: "Please describe your dietary style." });
  }
  if (answers.food_allergies.includes("other") && !answers.food_allergies_other?.trim()) {
    ctx.addIssue({ code: "custom", path: ["food_allergies_other"], message: "Please describe the other allergy." });
  }
  if (
    answers.lowest_adult_weight_lbs !== undefined &&
    answers.highest_adult_weight_lbs !== undefined &&
    answers.lowest_adult_weight_lbs > answers.highest_adult_weight_lbs
  ) {
    ctx.addIssue({ code: "custom", path: ["lowest_adult_weight_lbs"], message: "Lowest adult weight must not exceed highest adult weight." });
  }
  if (answers.goal_weight_lbs !== undefined && answers.goal_weight_lbs > answers.current_weight_lbs) {
    ctx.addIssue({ code: "custom", path: ["goal_weight_lbs"], message: "Goal weight must not exceed current weight." });
  }
  for (const [index, injury] of answers.injuries.entries()) {
    if (injury.body_part === "other" && !injury.body_part_other?.trim()) {
      ctx.addIssue({ code: "custom", path: ["injuries", index, "body_part_other"], message: "Please describe this body part." });
    }
  }
  if (answers.main_why.length < 1) {
    ctx.addIssue({ code: "custom", path: ["main_why"], message: "Please add your main reason." });
  }
  if (answers.eating_pattern.length < 1) {
    ctx.addIssue({ code: "custom", path: ["eating_pattern"], message: "Choose at least one eating pattern." });
  }
});

export const INTAKE_STEP_FIELDS = {
  1: ["age", "sex", "height_in", "current_weight_lbs", "highest_adult_weight_lbs", "lowest_adult_weight_lbs", "goal_weight_lbs", "waist_in"],
  2: ["regain_causes", "regain_causes_other", "what_worked_before", "what_worked_before_other", "coached_before", "coached_before_notes"],
  3: ["injuries", "exercise_clearance", "medical_notes", "interested_in_medication_consult"],
  4: ["training_location", "equipment", "training_days_per_week", "session_minutes"],
  5: ["work_type", "sleep_hours", "sugary_drinks_per_day", "sugary_drink_types", "alcohol_drinks_per_week", "eating_pattern", "activity_level"],
  6: ["food_allergies", "food_allergies_other", "foods_avoided", "dietary_style", "dietary_style_other", "batch_cooking", "grocery_budget_weekly", "meals_per_day"],
  7: ["plan_style", "checkin_preference"],
  8: ["stress_level", "stress_coping", "wants_support_resources", "main_why"],
} as const;

const INTAKE_STEP_REQUIRED_FIELDS: Record<number, readonly string[]> = {
  1: ["age", "sex", "height_in", "current_weight_lbs"],
  2: [],
  3: ["exercise_clearance"],
  4: ["training_location", "training_days_per_week", "session_minutes"],
  5: ["work_type", "sleep_hours", "sugary_drinks_per_day", "eating_pattern", "activity_level"],
  6: ["dietary_style", "batch_cooking", "meals_per_day"],
  7: ["plan_style", "checkin_preference"],
  8: ["stress_level", "main_why"],
};

export function validateIntakeStep(step: number, input: unknown): string | null {
  if (!Number.isInteger(step) || step < 1 || step > 8) return "invalid_step";
  const parsed = memberIntakeDraftSchema.safeParse(input);
  if (!parsed.success) return "invalid_answers";
  const answers = parsed.data;
  for (const key of INTAKE_STEP_REQUIRED_FIELDS[step] ?? []) {
    const value = answers[key as keyof MemberIntakeDraft];
    if (
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      return "required_fields";
    }
  }
  if (step === 2) {
    if (answers.regain_causes?.includes("other") && !answers.regain_causes_other?.trim()) {
      return "required_fields";
    }
    if (answers.what_worked_before?.includes("other") && !answers.what_worked_before_other?.trim()) {
      return "required_fields";
    }
  }
  if (step === 3 && answers.injuries?.some(
    (injury) => injury.body_part === "other" && !injury.body_part_other?.trim(),
  )) {
    return "required_fields";
  }
  if (step === 6) {
    if (answers.dietary_style === "other" && !answers.dietary_style_other?.trim()) {
      return "required_fields";
    }
    if (answers.food_allergies?.includes("other") && !answers.food_allergies_other?.trim()) {
      return "required_fields";
    }
  }
  if (step === 8 && !answers.main_why?.trim()) return "required_fields";
  return null;
}

export type MemberIntakeAnswers = z.infer<typeof memberIntakeAnswersSchema>;
export type MemberIntakeDraft = z.infer<typeof memberIntakeDraftSchema>;
export type MemberIntakeInjury = MemberIntakeAnswers["injuries"][number];

export const INTAKE_CONSENT_TEXT =
  "I agree to share these answers with coaches I book on GYMX2. I understand this is not medical advice, and I'll consult my doctor before starting a new exercise or nutrition program.";

export function centimetersToInches(cm: number) {
  return cm / 2.54;
}

export function feetAndInchesToInches(feet: number, inches: number) {
  if (!Number.isInteger(feet) || !Number.isInteger(inches) || feet < 0 || inches < 0 || inches > 11) {
    return null;
  }
  return feet * 12 + inches;
}

export function kilogramsToPounds(kg: number) {
  return kg * 2.2046226218;
}

export type MemberWeightUnit = "lb" | "kg";

export function displayMemberWeight(pounds: number | undefined, unit: MemberWeightUnit) {
  if (pounds === undefined) return "";
  return unit === "kg" ? (pounds / 2.2046226218).toFixed(1) : pounds;
}

export function memberWeightFromInput(value: string, unit: MemberWeightUnit) {
  if (value.trim() === "") return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return unit === "kg" ? kilogramsToPounds(numeric) : numeric;
}

export type PlanInputs = {
  bmi: number | null;
  estimatedMaintenanceCalories: number | null;
  calorieTarget: number | null;
  proteinTargetRangeG: { min: number; max: number } | null;
  proteinTargetG: number | null;
  stageTargetsLbs: number[];
  weightCycling: boolean;
  exerciseExclusionTags: string[];
  exerciseClearanceRequired: boolean;
};

const activityFactors = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
} as const;

function round(value: number, places = 0) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function injuryLoadTag(bodyPart: string) {
  const match = /^(ankle|foot|knee)_(left|right)$/.exec(bodyPart);
  return match ? `loads_${match[2]}_${match[1]}` : null;
}

export function buildPlanInputs(intake: MemberIntakeDraft): PlanInputs {
  const currentWeight = intake.current_weight_lbs;
  const bmi =
    currentWeight !== undefined && intake.height_in !== undefined
      ? round((currentWeight / 2.2046226218) / (intake.height_in * 0.0254) ** 2, 1)
      : null;

  let estimatedMaintenanceCalories: number | null = null;
  if (
    currentWeight !== undefined &&
    intake.height_in !== undefined &&
    intake.age !== undefined &&
    intake.sex !== undefined &&
    intake.sex !== "prefer_not_to_say" &&
    intake.activity_level !== undefined
  ) {
    const weightKg = currentWeight / 2.2046226218;
    const heightCm = intake.height_in * 2.54;
    const sexAdjustment = intake.sex === "male" ? 5 : -161;
    const bmr = 10 * weightKg + 6.25 * heightCm - 5 * intake.age + sexAdjustment;
    estimatedMaintenanceCalories = round(bmr * activityFactors[intake.activity_level]);
  }

  const calorieTarget =
    estimatedMaintenanceCalories === null
      ? null
      : Math.max(0, estimatedMaintenanceCalories - 500);
  const proteinAnchorG =
    currentWeight === undefined ? null : Math.max(210, currentWeight * 0.85);
  const proteinTargetRangeG = proteinAnchorG === null
    ? null
    : { min: round(proteinAnchorG * 0.8), max: round(proteinAnchorG) };
  // 0.9 of the higher anchor is a neutral estimate for coach review, not a prescription.
  const proteinTargetG = proteinAnchorG === null ? null : round(proteinAnchorG * 0.9);

  const stageTargetsLbs: number[] = [];
  if (
    currentWeight !== undefined &&
    intake.goal_weight_lbs !== undefined &&
    intake.goal_weight_lbs < currentWeight
  ) {
    let current = currentWeight;
    while (current > intake.goal_weight_lbs && stageTargetsLbs.length < 20) {
      const next = current - intake.goal_weight_lbs <= current * 0.09
        ? intake.goal_weight_lbs
        : current * 0.92;
      stageTargetsLbs.push(round(next, 1));
      current = next;
    }
  }

  const injuries = intake.injuries ?? [];
  const exerciseExclusionTags = new Set<string>();
  for (const injury of injuries) {
    if (injury.restriction === "no_impact") exerciseExclusionTags.add("impact");
    if (
      injury.restriction === "no_weight_bearing" &&
      /^(ankle|foot|knee)_(left|right)$/.test(injury.body_part)
    ) {
      exerciseExclusionTags.add("standing");
      exerciseExclusionTags.add("impact");
      const loadTag = injuryLoadTag(injury.body_part);
      if (loadTag) exerciseExclusionTags.add(loadTag);
    }
  }

  const lowestObserved = intake.lowest_adult_weight_lbs ?? currentWeight;
  const weightCycling = Boolean(
    currentWeight !== undefined &&
      intake.highest_adult_weight_lbs !== undefined &&
      lowestObserved !== undefined &&
      intake.highest_adult_weight_lbs - lowestObserved > 30,
  );

  return {
    bmi,
    estimatedMaintenanceCalories,
    calorieTarget,
    proteinTargetRangeG,
    proteinTargetG,
    stageTargetsLbs,
    weightCycling,
    exerciseExclusionTags: [...exerciseExclusionTags].sort(),
    exerciseClearanceRequired:
      intake.exercise_clearance === "no" || intake.exercise_clearance === "not_sure",
  };
}
