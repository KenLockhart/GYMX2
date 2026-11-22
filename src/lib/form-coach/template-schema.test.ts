import { describe, expect, it } from "vitest";
import {
  ExerciseTemplateSchema,
  parseExerciseTemplate,
  scoringTemplateFromExerciseTemplate,
  type ExerciseTemplate,
} from "./template-schema";

function validTemplate(): ExerciseTemplate {
  return {
    exerciseKey: "dumbbell_curl",
    schemaVersion: 1,
    cameraView: "side",
    arm: "auto",
    segmentation: { metric: "elbowAngle", extendedThreshold: 150, flexedThreshold: 60 },
    reference: {
      romMinAngle: 40,
      romMaxAngle: 165,
      concentricMs: 2000,
      topPauseMs: 500,
      eccentricMs: 3000,
      elbowCurve: Array.from({ length: 50 }, (_, index) => 165 - index * 2.5),
    },
    tolerances: {
      romTopDeg: 15,
      romBottomDeg: 15,
      upperArmDriftDeg: 15,
      torsoSwingDeg: 10,
      shrugRatio: 0.08,
      tempoPct: 35,
    },
    scoringWeights: { rom: 30, elbow: 25, torso: 20, tempo: 15, shoulders: 10 },
    strictness: "standard",
    cues: [{ key: "elbows_pinned", fault: "elbow_drift", text: "Pin your elbows", priority: 1, minPersistMs: 300, cooldownMs: 4000 }],
    breathing: { concentric: "exhale", eccentric: "inhale", fullCueReps: 3, thenEvery: 3 },
  };
}

describe("exercise template schema", () => {
  it("accepts a bounded versioned curl reference and provides scoring fields", () => {
    const template = parseExerciseTemplate(validTemplate());
    expect(template.reference.elbowCurve).toHaveLength(50);
    expect(scoringTemplateFromExerciseTemplate(template).strictness).toBe("standard");
  });

  it("rejects non-finite/out-of-range metrics and malformed reference curves", () => {
    const invalid = validTemplate();
    invalid.reference.romMinAngle = Number.NaN;
    expect(ExerciseTemplateSchema.safeParse(invalid).success).toBe(false);
    const shortCurve = validTemplate();
    shortCurve.reference.elbowCurve = [20, 40];
    expect(ExerciseTemplateSchema.safeParse(shortCurve).success).toBe(false);
  });

  it("requires consistent phase thresholds, ROM, and scoring weights", () => {
    const thresholds = validTemplate();
    thresholds.segmentation.extendedThreshold = 60;
    expect(ExerciseTemplateSchema.safeParse(thresholds).success).toBe(false);
    const weights = validTemplate();
    weights.scoringWeights.shoulders = 9;
    expect(ExerciseTemplateSchema.safeParse(weights).success).toBe(false);
    const rom = validTemplate();
    rom.reference.romMinAngle = 170;
    expect(ExerciseTemplateSchema.safeParse(rom).success).toBe(false);

    const impossibleExtension = validTemplate();
    impossibleExtension.segmentation.extendedThreshold = 180;
    expect(ExerciseTemplateSchema.safeParse(impossibleExtension).success).toBe(false);

    const reachableBoundary = validTemplate();
    reachableBoundary.segmentation.extendedThreshold = 179.999;
    expect(ExerciseTemplateSchema.safeParse(reachableBoundary).success).toBe(true);
  });

  it("rejects raw frame/landmark fields and bounds cue text/path values", () => {
    const mediaPayload = { ...validTemplate(), landmarks: [{ x: 0.5, y: 0.5 }] };
    expect(ExerciseTemplateSchema.safeParse(mediaPayload).success).toBe(false);
    const longText = validTemplate();
    longText.cues[0].text = "x".repeat(201);
    expect(ExerciseTemplateSchema.safeParse(longText).success).toBe(false);
    const longPath = validTemplate();
    longPath.cues[0].audioPath = "a".repeat(513);
    expect(ExerciseTemplateSchema.safeParse(longPath).success).toBe(false);
  });
});
