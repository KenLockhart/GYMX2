import { dtwSimilarity, resampleTimedCurve } from "./dtw";
import type { CurlScoringTemplate, RepComponentScores, ScoredCurlRep, SegmentedCurlRep } from "./types";

export const STRICTNESS_MULTIPLIERS = {
  beginner: 1.5,
  standard: 1,
  strict: 0.7,
} as const;

export function scoreLinearTolerance(deviation: number, tolerance: number): number {
  if (!Number.isFinite(deviation) || !Number.isFinite(tolerance) || tolerance <= 0) return 0;
  const excess = Math.max(0, deviation);
  if (excess <= tolerance) return 100;
  if (excess >= tolerance * 2) return 0;
  return 100 * (2 - excess / tolerance);
}

function phaseDeviationPct(actualMs: number, referenceMs: number): number {
  if (!Number.isFinite(actualMs) || actualMs < 0) return 200;
  if (referenceMs === 0) return actualMs === 0 ? 0 : 200;
  return (Math.abs(actualMs - referenceMs) / referenceMs) * 100;
}

function weightedScore(components: RepComponentScores, weights: CurlScoringTemplate["scoringWeights"]): number {
  const weightTotal = weights.rom + weights.elbow + weights.torso + weights.tempo + weights.shoulders;
  if (weightTotal <= 0) return 0;
  const total =
    components.rom * weights.rom +
    components.elbow * weights.elbow +
    components.torso * weights.torso +
    components.tempo * weights.tempo +
    components.shoulders * weights.shoulders;
  return Math.round((total / weightTotal) * 10) / 10;
}

export function scoreCurlRep(rep: SegmentedCurlRep, template: CurlScoringTemplate): ScoredCurlRep {
  const strictness = STRICTNESS_MULTIPLIERS[template.strictness];
  const tolerances = template.tolerances;
  const topRomError = Math.max(0, rep.romMinAngle - template.reference.romMinAngle);
  const bottomRomError = Math.max(0, template.reference.romMaxAngle - rep.romMaxAngle);
  const topRomScore = scoreLinearTolerance(topRomError, tolerances.romTopDeg * strictness);
  const bottomRomScore = scoreLinearTolerance(bottomRomError, tolerances.romBottomDeg * strictness);
  const tempoTolerance = tolerances.tempoPct * strictness;

  const componentScores: RepComponentScores = {
    rom: (topRomScore + bottomRomScore) / 2,
    elbow: scoreLinearTolerance(rep.maxUpperArmDrift, tolerances.upperArmDriftDeg * strictness),
    torso: scoreLinearTolerance(rep.maxTorsoSwing, tolerances.torsoSwingDeg * strictness),
    tempo:
      [
        phaseDeviationPct(rep.concentricMs, template.reference.concentricMs),
        phaseDeviationPct(rep.topPauseMs, template.reference.topPauseMs),
        phaseDeviationPct(rep.eccentricMs, template.reference.eccentricMs),
      ].reduce((sum, deviation) => sum + scoreLinearTolerance(deviation, tempoTolerance), 0) / 3,
    shoulders: scoreLinearTolerance(rep.maxShrug, tolerances.shrugRatio * strictness),
  };

  const faults: string[] = [];
  if (topRomError > tolerances.romTopDeg * strictness) faults.push("short_rom_top");
  if (bottomRomError > tolerances.romBottomDeg * strictness) faults.push("short_rom_bottom");
  if (rep.maxUpperArmDrift > tolerances.upperArmDriftDeg * strictness) faults.push("elbow_drift");
  if (rep.maxTorsoSwing > tolerances.torsoSwingDeg * strictness) faults.push("torso_swing");
  if (rep.maxShrug > tolerances.shrugRatio * strictness) faults.push("shoulder_shrug");
  if (
    template.reference.eccentricMs > 0 &&
    rep.eccentricMs < template.reference.eccentricMs * (1 - tempoTolerance / 100)
  ) {
    faults.push("eccentric_too_fast");
  }

  const elbowCurve = resampleTimedCurve(rep.elbowCurve, 50);
  const curveSimilarity = dtwSimilarity(elbowCurve, template.reference.elbowCurve) ?? 0;
  const romScore = Math.round(componentScores.rom * 10) / 10;
  return {
    ...rep,
    romScore,
    curveSimilarity,
    componentScores,
    score: weightedScore(componentScores, template.scoringWeights),
    faults,
  };
}
