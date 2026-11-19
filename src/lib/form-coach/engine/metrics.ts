import { angleAtJoint, angleBetweenVectors, distance, getVisibleLandmark, sideLandmarkIndices, toPixelPoint } from "./geometry";
import type { ArmSide, FrameMetrics, LandmarkSet, Point2D, PostureBaseline } from "./types";

function signedLeanFromVertical(shoulder: Point2D, hip: Point2D): number {
  const dx = shoulder.x - hip.x;
  const upwardDistance = hip.y - shoulder.y;
  return (Math.atan2(dx, upwardDistance) * 180) / Math.PI;
}

export function createPostureBaseline(metrics: FrameMetrics): PostureBaseline {
  return {
    signedTorsoLeanDeg: metrics.signedTorsoLeanDeg,
    earShoulderVerticalPx: metrics.earShoulderVerticalPx,
    torsoLengthPx: metrics.torsoLengthPx,
  };
}

/**
 * Computes pixel-corrected elbow/arm/torso metrics. Returns null unless every required landmark
 * meets visibility 0.5; pass a setup-hold baseline for torso-swing and shrug measurements.
 */
export function computeFrameMetrics(input: {
  readonly landmarks: LandmarkSet;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly timestampMs: number;
  readonly arm: ArmSide;
  readonly baseline?: PostureBaseline | null;
}): FrameMetrics | null {
  const { landmarks, videoWidth, videoHeight, timestampMs, arm, baseline = null } = input;
  if (!Number.isFinite(timestampMs)) return null;
  const indices = sideLandmarkIndices(arm);
  const raw = {
    shoulder: getVisibleLandmark(landmarks, indices.shoulder),
    elbow: getVisibleLandmark(landmarks, indices.elbow),
    wrist: getVisibleLandmark(landmarks, indices.wrist),
    hip: getVisibleLandmark(landmarks, indices.hip),
    ear: getVisibleLandmark(landmarks, indices.ear),
  };
  if (Object.values(raw).some((landmark) => landmark === null)) return null;

  const shoulder = toPixelPoint(raw.shoulder, videoWidth, videoHeight);
  const elbow = toPixelPoint(raw.elbow, videoWidth, videoHeight);
  const wrist = toPixelPoint(raw.wrist, videoWidth, videoHeight);
  const hip = toPixelPoint(raw.hip, videoWidth, videoHeight);
  const ear = toPixelPoint(raw.ear, videoWidth, videoHeight);
  if (!shoulder || !elbow || !wrist || !hip || !ear) return null;

  const elbowAngleDeg = angleAtJoint(shoulder, elbow, wrist);
  const upperArmDriftDeg = angleBetweenVectors(
    { x: elbow.x - shoulder.x, y: elbow.y - shoulder.y },
    { x: hip.x - shoulder.x, y: hip.y - shoulder.y },
  );
  const torsoLengthPx = distance(shoulder, hip);
  const earShoulderVerticalPx = Math.abs(shoulder.y - ear.y);
  const signedTorsoLeanDeg = signedLeanFromVertical(shoulder, hip);
  if (
    elbowAngleDeg === null ||
    upperArmDriftDeg === null ||
    torsoLengthPx === 0 ||
    !Number.isFinite(signedTorsoLeanDeg)
  ) {
    return null;
  }

  const confidence = Math.min(...Object.values(raw).map((landmark) => landmark?.visibility ?? Number.NaN));
  if (!Number.isFinite(confidence)) return null;
  return {
    timestampMs,
    arm,
    confidence,
    elbowAngleDeg,
    upperArmDriftDeg,
    torsoLeanDeg: Math.abs(signedTorsoLeanDeg),
    signedTorsoLeanDeg,
    torsoSwingDeg: baseline ? Math.abs(signedTorsoLeanDeg - baseline.signedTorsoLeanDeg) : 0,
    shoulderShrugRatio: baseline
      ? (baseline.earShoulderVerticalPx - earShoulderVerticalPx) / torsoLengthPx
      : 0,
    earShoulderVerticalPx,
    torsoLengthPx,
  };
}
