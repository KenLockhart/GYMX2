import { describe, expect, it } from "vitest";
import { createExerciseRegistry, EXERCISE_REGISTRY, getExerciseDefinition, listExerciseDefinitions, STANDING_DUMBBELL_CURL } from "./registry";

describe("exercise registry", () => {
  it("registers the standing dumbbell curl with setup and non-clinical eligibility tags", () => {
    expect(getExerciseDefinition("dumbbell_curl")).toBe(STANDING_DUMBBELL_CURL);
    expect(STANDING_DUMBBELL_CURL.eligibilityTags).toEqual(["standing", "limb_loading"]);
    expect(STANDING_DUMBBELL_CURL.segmentation).toEqual({ metric: "elbowAngle", extendedThreshold: 150, flexedThreshold: 60 });
    expect(STANDING_DUMBBELL_CURL.setupInstructions.length).toBeGreaterThan(0);
    expect(getExerciseDefinition("unknown_exercise")).toBeNull();
  });

  it("accepts additional configuration entries without rewriting engine logic", () => {
    const additional = { ...STANDING_DUMBBELL_CURL, exerciseKey: "configured_press", displayName: "Configured press" };
    const registry = createExerciseRegistry([STANDING_DUMBBELL_CURL, additional]);
    expect(registry.size).toBe(2);
    expect(registry.get("configured_press")?.displayName).toBe("Configured press");
    expect(listExerciseDefinitions()).toEqual([...EXERCISE_REGISTRY.values()]);
  });

  it("rejects duplicate or invalid keys", () => {
    expect(() => createExerciseRegistry([STANDING_DUMBBELL_CURL, STANDING_DUMBBELL_CURL])).toThrow(/Duplicate/);
    expect(() => createExerciseRegistry([{ ...STANDING_DUMBBELL_CURL, exerciseKey: "Bad Key" }])).toThrow(/Invalid/);
  });
});
