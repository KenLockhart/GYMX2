import { describe, expect, it } from "vitest";
import {
  buildPlanInputs,
  centimetersToInches,
  feetAndInchesToInches,
  kilogramsToPounds,
  memberIntakeAnswersSchema,
  memberIntakeDraftSchema,
} from "./member-intake";

const fixture = {
  age: 52,
  sex: "male" as const,
  height_in: 73,
  current_weight_lbs: 257,
  highest_adult_weight_lbs: 320,
  injuries: [
    {
      body_part: "ankle_right" as const,
      restriction: "no_weight_bearing" as const,
      duration: "2_plus_years" as const,
    },
  ],
  exercise_clearance: "yes" as const,
  interested_in_medication_consult: "maybe" as const,
  training_location: "commercial_gym" as const,
  training_days_per_week: 3,
  session_minutes: 45 as const,
  work_type: "mixed" as const,
  sleep_hours: 7.5,
  sugary_drinks_per_day: "1" as const,
  eating_pattern: ["regular_meals" as const],
  activity_level: "light" as const,
  dietary_style: "no_preference" as const,
  batch_cooking: "once_weekly" as const,
  meals_per_day: "3" as const,
  plan_style: "in_between" as const,
  checkin_preference: "weekly_coach_call" as const,
  stress_level: 5,
  main_why: "I want more energy for my family.",
};

describe("member intake validation", () => {
  it("validates a complete questionnaire and applies empty multi-select defaults", () => {
    const parsed = memberIntakeAnswersSchema.parse(fixture);
    expect(parsed.regain_causes).toEqual([]);
    expect(parsed.equipment).toEqual([]);
    expect(parsed.food_allergies).toEqual([]);
  });

  it("keeps step drafts partial but rejects unknown and forged fields", () => {
    expect(memberIntakeDraftSchema.safeParse({ age: 52 }).success).toBe(true);
    expect(memberIntakeDraftSchema.safeParse({ age: 17 }).success).toBe(false);
    expect(
      memberIntakeDraftSchema.safeParse({ age: 52, status: "completed" }).success,
    ).toBe(false);
    expect(
      memberIntakeDraftSchema.safeParse({ age: 52, coach_id: "other" }).success,
    ).toBe(false);
  });

  it("requires descriptions for selected Other choices and keeps weights coherent", () => {
    expect(
      memberIntakeAnswersSchema.safeParse({
        ...fixture,
        regain_causes: ["other"],
      }).success,
    ).toBe(false);
    expect(
      memberIntakeAnswersSchema.safeParse({
        ...fixture,
        lowest_adult_weight_lbs: 240,
        highest_adult_weight_lbs: 220,
      }).success,
    ).toBe(false);
    expect(
      memberIntakeAnswersSchema.safeParse({
        ...fixture,
        goal_weight_lbs: 300,
      }).success,
    ).toBe(false);
  });
});

describe("unit conversions", () => {
  it("converts centimeters, feet/inches and kilograms to canonical units", () => {
    expect(centimetersToInches(185.42)).toBeCloseTo(73, 5);
    expect(centimetersToInches(91.44)).toBeCloseTo(36, 10);
    expect(centimetersToInches(243.84)).toBeCloseTo(96, 10);
    expect(feetAndInchesToInches(6, 1)).toBe(73);
    expect(feetAndInchesToInches(3, 0)).toBe(36);
    expect(feetAndInchesToInches(8, 0)).toBe(96);
    expect(feetAndInchesToInches(6, 12)).toBeNull();
    expect(kilogramsToPounds(100)).toBeCloseTo(220.46, 1);
  });
});

describe("buildPlanInputs", () => {
  it("uses Mifflin-St Jeor for explicit light activity and flags weight cycling", () => {
    const result = buildPlanInputs(fixture);
    expect(result.bmi).toBeCloseTo(33.9, 1);
    expect(result.estimatedMaintenanceCalories).toBeGreaterThan(2700);
    expect(result.calorieTarget).toBeGreaterThanOrEqual(2200);
    expect(result.calorieTarget).toBeLessThanOrEqual(2400);
    expect(result.weightCycling).toBe(true);
    expect(result.proteinTargetG).toBe(197);
    expect(result.proteinTargetRangeG).toEqual({ min: 175, max: 218 });
    expect(result.exerciseClearanceRequired).toBe(false);
  });

  it("adds standing, impact and affected-side load exclusions for no-weight-bearing ankle injuries", () => {
    const tags = buildPlanInputs(fixture).exerciseExclusionTags;
    expect(tags).toContain("standing");
    expect(tags).toContain("impact");
    expect(tags).toContain("loads_right_ankle");
  });

  it("derives side-first loading exclusions for every ankle, foot and knee", () => {
    const injuries = [
      "ankle_left", "ankle_right", "foot_left", "foot_right", "knee_left", "knee_right",
    ].map((body_part) => ({
      body_part: body_part as "ankle_left" | "ankle_right" | "foot_left" | "foot_right" | "knee_left" | "knee_right",
      restriction: "no_weight_bearing" as const,
      duration: "2_plus_years" as const,
    }));
    const tags = buildPlanInputs({ ...fixture, injuries }).exerciseExclusionTags;
    for (const tag of [
      "loads_left_ankle", "loads_right_ankle", "loads_left_foot", "loads_right_foot",
      "loads_left_knee", "loads_right_knee", "standing", "impact",
    ]) {
      expect(tags).toContain(tag);
    }
  });

  it("requires clinician clearance when the intake answer is no or unsure", () => {
    expect(buildPlanInputs({ ...fixture, exercise_clearance: "no" }).exerciseClearanceRequired).toBe(true);
    expect(buildPlanInputs({ ...fixture, exercise_clearance: "not_sure" }).exerciseClearanceRequired).toBe(true);
  });

  it("does not guess sex or activity and only creates milestones for a valid goal", () => {
    const unknown = buildPlanInputs({
      ...fixture,
      sex: "prefer_not_to_say",
      activity_level: undefined,
    });
    expect(unknown.estimatedMaintenanceCalories).toBeNull();
    expect(unknown.calorieTarget).toBeNull();
    expect(unknown.stageTargetsLbs).toEqual([]);

    const stages = buildPlanInputs({ ...fixture, goal_weight_lbs: 200 }).stageTargetsLbs;
    expect(stages.at(-1)).toBe(200);
    expect(stages.every((value) => value > 0)).toBe(true);
    expect(stages.every((value, index) => index === 0 || value < stages[index - 1]!)).toBe(true);
    expect(stages.slice(0, 2).every((value, index) => {
      const previous = index === 0 ? fixture.current_weight_lbs : stages[index - 1]!;
      return (previous - value) / previous >= 0.07 && (previous - value) / previous <= 0.09;
    })).toBe(true);
  });

  it("does not flag weight cycling without an observed high-to-low difference above 30 pounds", () => {
    expect(
      buildPlanInputs({
        ...fixture,
        highest_adult_weight_lbs: 280,
        lowest_adult_weight_lbs: 257,
      }).weightCycling,
    ).toBe(false);
  });
});
