import type { CameraView, CurlScoringTemplate, PoseLandmark, TrackedArm } from "./engine/types";
import type { CueCode, RepFaultCode, WorkerDelegate, WorkerErrorCode, WorkerModel } from "./worker-controller";

export type FormCoachRunMode = "reference" | "live";

export type FormCoachWorkerInit = Readonly<{
  version: 1;
  type: "init";
  sessionEpoch: number;
  model: WorkerModel;
  mode: FormCoachRunMode;
  arm: TrackedArm;
  cameraView: CameraView;
  referenceRepTarget: number;
  forceCpu: boolean;
  template?: CurlScoringTemplate;
  gpuCanvas: OffscreenCanvas | null;
}>;

export type FormCoachWorkerFrame = Readonly<{
  version: 1;
  type: "frame";
  sessionEpoch: number;
  sequence: number;
  captureTimestampMs: number;
  width: number;
  height: number;
  droppedFramesSincePrevious: number;
  frame: ImageBitmap;
}>;

export type FormCoachWorkerCommand =
  | FormCoachWorkerInit
  | FormCoachWorkerFrame
  | Readonly<{ version: 1; type: "stop"; sessionEpoch: number }>;

export type SetupStep =
  | "show-side-view"
  | "show-required-view"
  | "show-both-arms"
  | "move-back"
  | "extend-arm-hold"
  | "ready"
  | "low-confidence";

export type FormCoachRepSummary = Readonly<{
  repNumber: number;
  score: number;
  romScore: number;
  maxUpperArmDrift: number;
  maxTorsoSwing: number;
  maxShrug: number;
  curveSimilarity: number;
  faults: readonly RepFaultCode[];
  componentScores: Readonly<{ rom: number; elbow: number; torso: number; tempo: number; shoulders: number }>;
  romMinAngle: number;
  romMaxAngle: number;
  concentricMs: number;
  topPauseMs: number;
  eccentricMs: number;
}>;

export type NetworkAuditEntry = Readonly<{
  method: string;
  host: string;
  path: string;
  count: number;
}>;

export type FormCoachWorkerEvent =
  | Readonly<{ version: 1; type: "ready"; sessionEpoch: number; model: WorkerModel; delegate: WorkerDelegate }>
  | Readonly<{ version: 1; type: "processed"; sessionEpoch: number; sequence: number; captureTimestampMs: number }>
  | Readonly<{ version: 1; type: "rep-summary"; sessionEpoch: number; repNumber: number; score: number; durationMs: number; faults: readonly RepFaultCode[] }>
  | Readonly<{ version: 1; type: "cue"; sessionEpoch: number; cue: CueCode }>
  | Readonly<{ version: 1; type: "stopped"; sessionEpoch: number }>
  | Readonly<{ version: 1; type: "error"; sessionEpoch: number; code: WorkerErrorCode }>
  | Readonly<{ version: 1; type: "setup"; sessionEpoch: number; step: SetupStep }>
  | Readonly<{ version: 1; type: "overlay"; sessionEpoch: number; landmarks: readonly (PoseLandmark | null)[] }>
  | Readonly<{ version: 1; type: "rep-result"; sessionEpoch: number; summary: FormCoachRepSummary }>
  | Readonly<{ version: 1; type: "pair-rejected"; sessionEpoch: number; reason: "missing-partner" | "out-of-phase" | "phase-mismatch" | "asymmetric" }>
  | Readonly<{ version: 1; type: "reference-ready"; sessionEpoch: number; template: CurlScoringTemplate; cleanRepCount: number }>
  | Readonly<{ version: 1; type: "set-boundary"; sessionEpoch: number; reason: "session_sample_limit" }>
  | Readonly<{ version: 1; type: "network-audit"; sessionEpoch: number; allowedAssetGets: number; allowed: readonly NetworkAuditEntry[]; blocked: readonly NetworkAuditEntry[]; observed: readonly NetworkAuditEntry[] }>;

export function isFormCoachWorkerMessage(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isBoundedPoseOverlay(value: unknown): value is readonly (PoseLandmark | null)[] {
  if (!Array.isArray(value) || value.length > 33) return false;
  return value.every((landmark) => {
    if (landmark === null) return true;
    if (!landmark || typeof landmark !== "object") return false;
    const point = landmark as Record<string, unknown>;
    return (
      Number.isFinite(point.x) && (point.x as number) >= -0.25 && (point.x as number) <= 1.25 &&
      Number.isFinite(point.y) && (point.y as number) >= -0.25 && (point.y as number) <= 1.25 &&
      (point.z === undefined || (Number.isFinite(point.z) && (point.z as number) >= -5 && (point.z as number) <= 5)) &&
      (point.visibility === undefined || (Number.isFinite(point.visibility) && (point.visibility as number) >= 0 && (point.visibility as number) <= 1))
    );
  });
}

export function isFormCoachRepSummary(value: unknown): value is FormCoachRepSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Record<string, unknown>;
  const scores = summary.componentScores;
  const faults = new Set(["elbow_drift", "torso_swing", "short_rom_bottom", "short_rom_top", "eccentric_too_fast", "shoulder_shrug"]);
  const scoreKeys = ["rom", "elbow", "torso", "tempo", "shoulders"];
  const summaryKeys = [
    "repNumber", "score", "romScore", "maxUpperArmDrift", "maxTorsoSwing", "maxShrug", "curveSimilarity",
    "faults", "componentScores", "romMinAngle", "romMaxAngle", "concentricMs", "topPauseMs", "eccentricMs",
  ];
  return (
    Object.keys(summary).sort().join("\0") === [...summaryKeys].sort().join("\0") &&
    Number.isSafeInteger(summary.repNumber) && (summary.repNumber as number) >= 1 && (summary.repNumber as number) <= 1_000_000 &&
    Number.isFinite(summary.score) && (summary.score as number) >= 0 && (summary.score as number) <= 100 &&
    Number.isFinite(summary.romScore) && (summary.romScore as number) >= 0 && (summary.romScore as number) <= 100 &&
    Number.isFinite(summary.maxUpperArmDrift) && (summary.maxUpperArmDrift as number) >= 0 && (summary.maxUpperArmDrift as number) <= 180 &&
    Number.isFinite(summary.maxTorsoSwing) && (summary.maxTorsoSwing as number) >= 0 && (summary.maxTorsoSwing as number) <= 180 &&
    Number.isFinite(summary.maxShrug) && (summary.maxShrug as number) >= 0 && (summary.maxShrug as number) <= 1 &&
    Number.isFinite(summary.curveSimilarity) && (summary.curveSimilarity as number) >= 0 && (summary.curveSimilarity as number) <= 100 &&
    Number.isFinite(summary.romMinAngle) && (summary.romMinAngle as number) >= 0 && (summary.romMinAngle as number) <= 180 &&
    Number.isFinite(summary.romMaxAngle) && (summary.romMaxAngle as number) >= 0 && (summary.romMaxAngle as number) <= 180 &&
    Number.isFinite(summary.concentricMs) && (summary.concentricMs as number) >= 1 && (summary.concentricMs as number) <= 15_000 &&
    Number.isFinite(summary.topPauseMs) && (summary.topPauseMs as number) >= 0 && (summary.topPauseMs as number) <= 15_000 &&
    Number.isFinite(summary.eccentricMs) && (summary.eccentricMs as number) >= 1 && (summary.eccentricMs as number) <= 15_000 &&
    (summary.concentricMs as number) + (summary.topPauseMs as number) + (summary.eccentricMs as number) >= 600 &&
    (summary.concentricMs as number) + (summary.topPauseMs as number) + (summary.eccentricMs as number) <= 15_000 &&
    Array.isArray(summary.faults) && summary.faults.length <= 6 && summary.faults.every((fault) => typeof fault === "string" && faults.has(fault)) &&
    !!scores && typeof scores === "object" && Object.keys(scores).sort().join("\0") === [...scoreKeys].sort().join("\0") &&
    Object.values(scores).every((score) => Number.isFinite(score) && (score as number) >= 0 && (score as number) <= 100)
  );
}

export function isCurlScoringTemplate(value: unknown): value is CurlScoringTemplate {
  if (!value || typeof value !== "object") return false;
  const template = value as Record<string, unknown>;
  const reference = template.reference;
  const tolerances = template.tolerances;
  const weights = template.scoringWeights;
  if (!reference || typeof reference !== "object" || !tolerances || typeof tolerances !== "object" || !weights || typeof weights !== "object") return false;
  const referenceRecord = reference as Record<string, unknown>;
  const toleranceRecord = tolerances as Record<string, unknown>;
  const weightRecord = weights as Record<string, unknown>;
  const curve = referenceRecord.elbowCurve;
  const finiteInRange = (number: unknown, min: number, max: number) => Number.isFinite(number) && (number as number) >= min && (number as number) <= max;
  return (
    ["beginner", "standard", "strict"].includes(String(template.strictness)) &&
    finiteInRange(referenceRecord.romMinAngle, 0, 180) &&
    finiteInRange(referenceRecord.romMaxAngle, 0, 180) &&
    finiteInRange(referenceRecord.concentricMs, 0, 60_000) &&
    finiteInRange(referenceRecord.topPauseMs, 0, 60_000) &&
    finiteInRange(referenceRecord.eccentricMs, 0, 60_000) &&
    Array.isArray(curve) && curve.length === 50 && curve.every((angle) => finiteInRange(angle, 0, 180)) &&
    finiteInRange(toleranceRecord.romTopDeg, 0.1, 90) &&
    finiteInRange(toleranceRecord.romBottomDeg, 0.1, 90) &&
    finiteInRange(toleranceRecord.upperArmDriftDeg, 0.1, 90) &&
    finiteInRange(toleranceRecord.torsoSwingDeg, 0.1, 90) &&
    finiteInRange(toleranceRecord.shrugRatio, 0.001, 2) &&
    finiteInRange(toleranceRecord.tempoPct, 0.1, 200) &&
    ["rom", "elbow", "torso", "tempo", "shoulders"].every((key) => finiteInRange(weightRecord[key], 0, 100))
  );
}
