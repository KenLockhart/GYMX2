import { describe, expect, it } from "vitest";
import { isFormCoachRepSummary, type FormCoachRepSummary } from "./worker-protocol";
import { serializeFormCoachRepResult } from "./runtime-results";

function summary(overrides: Partial<FormCoachRepSummary> = {}): FormCoachRepSummary {
  return {
    repNumber: 1,
    score: 82,
    romScore: 80,
    maxUpperArmDrift: 12,
    maxTorsoSwing: 4,
    maxShrug: 0.12,
    curveSimilarity: 91,
    faults: ["eccentric_too_fast"],
    componentScores: { rom: 80, elbow: 72, torso: 90, tempo: 78, shoulders: 88 },
    romMinAngle: 48,
    romMaxAngle: 165,
    concentricMs: 80,
    topPauseMs: 0,
    eccentricMs: 520,
    ...overrides,
  };
}

describe("runtime rep result bridge", () => {
  it("serializes the complete numeric contract with no worker-only fields", () => {
    const result = serializeFormCoachRepResult(summary());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      rep_number: 1,
      score: 82,
      rom_min_angle: 48,
      rom_max_angle: 165,
      rom_score: 80,
      max_upper_arm_drift: 12,
      max_torso_swing: 4,
      max_shrug: 0.12,
      concentric_ms: 80,
      top_pause_ms: 0,
      eccentric_ms: 520,
      curve_similarity: 91,
      elbow_score: 72,
      torso_score: 90,
      tempo_score: 78,
      shoulders_score: 88,
      faults: ["eccentric_too_fast"],
    });
    expect(Object.keys(result.value)).toHaveLength(17);
    expect(JSON.stringify(result.value)).not.toMatch(/landmark|frame|video|elbowCurve|notes/i);
  });

  it("rounds fractional measured boundaries without clamping a fast phase", () => {
    const result = serializeFormCoachRepResult(summary({ concentricMs: 80.3, topPauseMs: 0.4, eccentricMs: 519.4 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.concentric_ms).toBe(80);
      expect(result.value.top_pause_ms).toBe(1);
      expect(result.value.eccentric_ms).toBe(519);
      expect(result.value.concentric_ms + result.value.top_pause_ms + result.value.eccentric_ms).toBe(600);
    }
  });

  it("keeps a measured 80 ms fast-eccentric fault and handles the total duration boundaries", () => {
    const shortPhase = serializeFormCoachRepResult(summary());
    expect(shortPhase.ok && shortPhase.value.concentric_ms).toBe(80);
    expect(shortPhase.ok && shortPhase.value.faults).toContain("eccentric_too_fast");
    expect(serializeFormCoachRepResult(summary({ concentricMs: 1, topPauseMs: 0, eccentricMs: 598.9 })).ok).toBe(false);
    expect(serializeFormCoachRepResult(summary({ concentricMs: 80.2, topPauseMs: 0.4, eccentricMs: 14_919.3 })).ok).toBe(true);
    expect(serializeFormCoachRepResult(summary({ concentricMs: 80, topPauseMs: 0, eccentricMs: 14_920.1 })).ok).toBe(false);
  });

  it("rejects malformed worker results, non-finite metrics, and out-of-range measurements", () => {
    expect(isFormCoachRepSummary({ ...summary(), rawLandmarks: [] })).toBe(false);
    expect(serializeFormCoachRepResult(summary({ maxShrug: Number.NaN })).ok).toBe(false);
    expect(serializeFormCoachRepResult(summary({ curveSimilarity: 101 })).ok).toBe(false);
    expect(serializeFormCoachRepResult(summary({ repNumber: 21 })).ok).toBe(false);
    expect(serializeFormCoachRepResult(summary({ romMinAngle: 170, romMaxAngle: 170 })).ok).toBe(false);
  });
});
