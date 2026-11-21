import { FormCoachRepSubmissionSchema } from "./workflow-contracts";
import { isFormCoachRepSummary, type FormCoachRepSummary } from "./worker-protocol";

export type PersistableFormCoachRepResult = ReturnType<typeof FormCoachRepSubmissionSchema.parse>;

export type FormCoachRepSerialization =
  | Readonly<{ ok: true; value: PersistableFormCoachRepResult }>
  | Readonly<{ ok: false; reason: "invalid-worker-result" | "outside-persisted-result-domain" }>;

/** Maps only the approved numeric rep fields into the strict attempt-result contract. */
export function serializeFormCoachRepResult(summary: FormCoachRepSummary): FormCoachRepSerialization {
  if (!isFormCoachRepSummary(summary)) return { ok: false, reason: "invalid-worker-result" };

  // Round measured cumulative boundaries so fractional browser timestamps remain measured,
  // while adjacent integer phases still sum to the rounded total duration.
  const concentricBoundary = Math.round(summary.concentricMs);
  const topBoundary = Math.round(summary.concentricMs + summary.topPauseMs);
  const endBoundary = Math.round(summary.concentricMs + summary.topPauseMs + summary.eccentricMs);
  const payload = {
    rep_number: summary.repNumber,
    score: summary.score,
    rom_min_angle: summary.romMinAngle,
    rom_max_angle: summary.romMaxAngle,
    rom_score: summary.romScore,
    max_upper_arm_drift: summary.maxUpperArmDrift,
    max_torso_swing: summary.maxTorsoSwing,
    max_shrug: summary.maxShrug,
    concentric_ms: concentricBoundary,
    top_pause_ms: topBoundary - concentricBoundary,
    eccentric_ms: endBoundary - topBoundary,
    curve_similarity: summary.curveSimilarity,
    elbow_score: summary.componentScores.elbow,
    torso_score: summary.componentScores.torso,
    tempo_score: summary.componentScores.tempo,
    shoulders_score: summary.componentScores.shoulders,
    faults: [...summary.faults],
  };
  const parsed = FormCoachRepSubmissionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "outside-persisted-result-domain" };
  return { ok: true, value: parsed.data };
}
