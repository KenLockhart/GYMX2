import { describe, expect, it } from "vitest";
import { scoreCurlRep, scoreLinearTolerance } from "./scoring";
import type { CurlScoringTemplate, SegmentedCurlRep } from "./types";

const rep: SegmentedCurlRep = {
  startMs: 1000,
  endMs: 6500,
  concentricMs: 2000,
  topPauseMs: 500,
  eccentricMs: 3000,
  romMinAngle: 40,
  romMaxAngle: 165,
  maxUpperArmDrift: 5,
  maxTorsoSwing: 3,
  maxShrug: 0.02,
  elbowCurve: Array.from({ length: 50 }, (_, index) => ({ timestampMs: index * 100, angleDeg: 165 - Math.abs(24 - index) * 5 })),
};

const template: CurlScoringTemplate = {
  reference: {
    romMinAngle: 40,
    romMaxAngle: 165,
    concentricMs: 2000,
    topPauseMs: 500,
    eccentricMs: 3000,
    elbowCurve: rep.elbowCurve.map((point) => point.angleDeg),
  },
  tolerances: { romTopDeg: 15, romBottomDeg: 15, upperArmDriftDeg: 15, torsoSwingDeg: 10, shrugRatio: 0.08, tempoPct: 35 },
  scoringWeights: { rom: 30, elbow: 25, torso: 20, tempo: 15, shoulders: 10 },
  strictness: "standard",
};

describe("curl scoring", () => {
  it("scores linearly from full credit at tolerance to zero at double tolerance", () => {
    expect(scoreLinearTolerance(5, 5)).toBe(100);
    expect(scoreLinearTolerance(7.5, 5)).toBe(50);
    expect(scoreLinearTolerance(10, 5)).toBe(0);
    expect(scoreLinearTolerance(-1, 5)).toBe(100);
  });

  it("gives a clean reference-matched rep full component and total scores", () => {
    const scored = scoreCurlRep(rep, template);
    expect(scored.score).toBe(100);
    expect(scored.romScore).toBe(100);
    expect(scored.curveSimilarity).toBe(100);
    expect(scored.faults).toEqual([]);
  });

  it("penalizes increasing deviations and applies the selected strictness multiplier", () => {
    const mild = scoreCurlRep({ ...rep, maxTorsoSwing: 11 }, template);
    const larger = scoreCurlRep({ ...rep, maxTorsoSwing: 19 }, template);
    const strict = scoreCurlRep({ ...rep, maxTorsoSwing: 11 }, { ...template, strictness: "strict" });
    expect(mild.score).toBeLessThan(100);
    expect(larger.score).toBeLessThan(mild.score);
    expect(strict.score).toBeLessThan(mild.score);
    expect(mild.faults).toContain("torso_swing");
  });

  it("reports ROM and fast-eccentric faults while retaining the numeric rep result", () => {
    const scored = scoreCurlRep({ ...rep, romMinAngle: 65, romMaxAngle: 140, eccentricMs: 1000 }, template);
    expect(scored.faults).toContain("short_rom_top");
    expect(scored.faults).toContain("short_rom_bottom");
    expect(scored.faults).toContain("eccentric_too_fast");
    expect(Number.isFinite(scored.score)).toBe(true);
  });
});
