import { DEFAULT_CURL_CUES } from "./cues";
import type { CameraView, CurlTolerances, ExerciseFault, ScoringWeights, TrackedArm } from "./types";

export interface ExerciseDefinition {
  readonly exerciseKey: string;
  readonly displayName: string;
  readonly cameraView: CameraView;
  readonly arm: TrackedArm;
  readonly trackedMetrics: readonly string[];
  readonly segmentation: {
    readonly metric: "elbowAngle";
    readonly extendedThreshold: number;
    readonly flexedThreshold: number;
  };
  readonly defaultTolerances: CurlTolerances;
  readonly defaultScoringWeights: ScoringWeights;
  readonly faultDefinitions: Readonly<Record<ExerciseFault, string>>;
  readonly defaultCues: typeof DEFAULT_CURL_CUES;
  readonly eligibilityTags: readonly string[];
  readonly setupInstructions: readonly string[];
}

export const STANDING_DUMBBELL_CURL: ExerciseDefinition = {
  exerciseKey: "dumbbell_curl",
  displayName: "Standing dumbbell curl",
  cameraView: "side",
  arm: "auto",
  trackedMetrics: ["elbowAngle", "upperArmDrift", "torsoSwing", "shoulderShrug", "phaseTempo"],
  segmentation: { metric: "elbowAngle", extendedThreshold: 150, flexedThreshold: 60 },
  defaultTolerances: {
    romTopDeg: 15,
    romBottomDeg: 15,
    upperArmDriftDeg: 15,
    torsoSwingDeg: 10,
    shrugRatio: 0.08,
    tempoPct: 35,
  },
  defaultScoringWeights: { rom: 30, elbow: 25, torso: 20, tempo: 15, shoulders: 10 },
  faultDefinitions: {
    elbow_drift: "The upper arm moved away from its reference position.",
    torso_swing: "The torso moved more than the selected tolerance.",
    short_rom_bottom: "The arm did not return close enough to the extended position.",
    short_rom_top: "The curl did not reach close enough to the reference flexion.",
    eccentric_too_fast: "The lowering phase was faster than the selected tolerance.",
    shoulder_shrug: "The shoulder rose toward the ear more than the selected tolerance.",
  },
  defaultCues: DEFAULT_CURL_CUES,
  eligibilityTags: ["standing", "limb_loading"],
  setupInstructions: [
    "Place the camera at waist height about 2–3 m away.",
    "Stand sideways with the shoulders, elbows, wrists, hips, and ear visible.",
    "Use a weight you can control and stop if you feel pain.",
  ],
};

export type ExerciseRegistry = ReadonlyMap<string, ExerciseDefinition>;

export function createExerciseRegistry(definitions: readonly ExerciseDefinition[]): ExerciseRegistry {
  const registry = new Map<string, ExerciseDefinition>();
  for (const definition of definitions) {
    if (!/^[a-z0-9_]{1,64}$/.test(definition.exerciseKey)) {
      throw new RangeError(`Invalid exercise key: ${definition.exerciseKey}`);
    }
    if (registry.has(definition.exerciseKey)) {
      throw new RangeError(`Duplicate exercise key: ${definition.exerciseKey}`);
    }
    registry.set(definition.exerciseKey, definition);
  }
  return registry;
}

export const EXERCISE_REGISTRY = createExerciseRegistry([STANDING_DUMBBELL_CURL]);

export function getExerciseDefinition(exerciseKey: string): ExerciseDefinition | null {
  return EXERCISE_REGISTRY.get(exerciseKey) ?? null;
}

export function listExerciseDefinitions(): readonly ExerciseDefinition[] {
  return [...EXERCISE_REGISTRY.values()];
}
