import { z } from "zod";
import type { CurlScoringTemplate, ExerciseFault, TrackedArm } from "./engine/types";

const finiteNumber = z.number().finite();
const boundedAngle = finiteNumber.min(0).max(180);
const boundedDurationMs = finiteNumber.min(100).max(15000);

const FaultSchema = z.enum([
  "elbow_drift",
  "torso_swing",
  "short_rom_bottom",
  "short_rom_top",
  "eccentric_too_fast",
  "shoulder_shrug",
  "clean_rep",
]);

export const TemplateCueSchema = z
  .object({
    key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
    fault: FaultSchema,
    text: z.string().trim().min(1).max(200),
    priority: finiteNumber.int().min(1).max(10),
    minPersistMs: finiteNumber.int().min(0).max(10000),
    cooldownMs: finiteNumber.int().min(0).max(60000),
    audioPath: z.string().min(1).max(512).optional(),
  })
  .strict();

const SegmentationSchema = z
  .object({
    metric: z.literal("elbowAngle"),
    extendedThreshold: finiteNumber.min(120).lt(180),
    flexedThreshold: finiteNumber.min(20).max(90),
  })
  .strict()
  .refine((value) => value.extendedThreshold > value.flexedThreshold + 10, {
    message: "Extension threshold must be at least 10 degrees above the flexion threshold.",
    path: ["extendedThreshold"],
  });

const ReferenceSchema = z
  .object({
    romMinAngle: boundedAngle,
    romMaxAngle: boundedAngle,
    concentricMs: boundedDurationMs,
    topPauseMs: finiteNumber.min(0).max(15000),
    eccentricMs: boundedDurationMs,
    elbowCurve: z.array(boundedAngle).length(50),
  })
  .strict()
  .refine((value) => value.romMinAngle < value.romMaxAngle, {
    message: "Reference ROM minimum must be lower than its maximum.",
    path: ["romMinAngle"],
  });

const TolerancesSchema = z
  .object({
    romTopDeg: finiteNumber.min(0.1).max(90),
    romBottomDeg: finiteNumber.min(0.1).max(90),
    upperArmDriftDeg: finiteNumber.min(0.1).max(90),
    torsoSwingDeg: finiteNumber.min(0.1).max(90),
    shrugRatio: finiteNumber.min(0.001).max(1),
    tempoPct: finiteNumber.min(1).max(100),
  })
  .strict();

const ScoringWeightsSchema = z
  .object({
    rom: finiteNumber.min(0).max(100),
    elbow: finiteNumber.min(0).max(100),
    torso: finiteNumber.min(0).max(100),
    tempo: finiteNumber.min(0).max(100),
    shoulders: finiteNumber.min(0).max(100),
  })
  .strict()
  .refine((weights) => Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 100) < 0.01, {
    message: "Scoring weights must sum to 100.",
  });

const BreathingSchema = z
  .object({
    concentric: z.literal("exhale"),
    eccentric: z.literal("inhale"),
    fullCueReps: finiteNumber.int().min(1).max(10),
    thenEvery: finiteNumber.int().min(1).max(10),
  })
  .strict();

export const ExerciseTemplateSchema = z
  .object({
    exerciseKey: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
    schemaVersion: z.literal(1),
    cameraView: z.enum(["side", "front", "three_quarter"]),
    arm: z.enum(["left", "right", "both", "auto"]),
    segmentation: SegmentationSchema,
    reference: ReferenceSchema,
    tolerances: TolerancesSchema,
    scoringWeights: ScoringWeightsSchema,
    strictness: z.enum(["beginner", "standard", "strict"]),
    cues: z.array(TemplateCueSchema).max(32),
    breathing: BreathingSchema,
  })
  .strict();

export type ExerciseTemplate = z.infer<typeof ExerciseTemplateSchema>;
export type TemplateCue = z.infer<typeof TemplateCueSchema>;

export function parseExerciseTemplate(input: unknown): ExerciseTemplate {
  return ExerciseTemplateSchema.parse(input);
}

export function safeParseExerciseTemplate(input: unknown) {
  return ExerciseTemplateSchema.safeParse(input);
}

export function scoringTemplateFromExerciseTemplate(template: ExerciseTemplate): CurlScoringTemplate {
  return {
    reference: template.reference,
    tolerances: template.tolerances,
    scoringWeights: template.scoringWeights,
    strictness: template.strictness,
  };
}

export function isExerciseFault(value: string): value is ExerciseFault {
  return FaultSchema.options.includes(value as (typeof FaultSchema.options)[number]) && value !== "clean_rep";
}

export function isTrackedArm(value: string): value is TrackedArm {
  return value === "left" || value === "right" || value === "both" || value === "auto";
}
