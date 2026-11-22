import type { ArmSide, LandmarkSet, Point2D, PoseLandmark } from "./types";

export const LANDMARK_INDEX = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

export const MIN_LANDMARK_VISIBILITY = 0.5;

export function isUsableLandmark(
  landmark: PoseLandmark | null | undefined,
  minimumVisibility = MIN_LANDMARK_VISIBILITY,
): landmark is PoseLandmark {
  return Boolean(
    landmark &&
      Number.isFinite(landmark.x) &&
      Number.isFinite(landmark.y) &&
      Number.isFinite(landmark.visibility) &&
      (landmark.visibility as number) >= minimumVisibility,
  );
}

export function getVisibleLandmark(
  landmarks: LandmarkSet,
  index: number,
  minimumVisibility = MIN_LANDMARK_VISIBILITY,
): PoseLandmark | null {
  const landmark = landmarks[index];
  return isUsableLandmark(landmark, minimumVisibility) ? landmark : null;
}

/** Converts normalized image coordinates into aspect-correct pixel coordinates. */
export function toPixelPoint(
  landmark: PoseLandmark | null | undefined,
  videoWidth: number,
  videoHeight: number,
  minimumVisibility = MIN_LANDMARK_VISIBILITY,
): Point2D | null {
  if (
    !isUsableLandmark(landmark, minimumVisibility) ||
    !Number.isFinite(videoWidth) ||
    !Number.isFinite(videoHeight) ||
    videoWidth <= 0 ||
    videoHeight <= 0
  ) {
    return null;
  }
  return { x: landmark.x * videoWidth, y: landmark.y * videoHeight };
}

export function sideLandmarkIndices(arm: ArmSide) {
  return arm === "left"
    ? {
        shoulder: LANDMARK_INDEX.leftShoulder,
        elbow: LANDMARK_INDEX.leftElbow,
        wrist: LANDMARK_INDEX.leftWrist,
        hip: LANDMARK_INDEX.leftHip,
        ear: LANDMARK_INDEX.leftEar,
      }
    : {
        shoulder: LANDMARK_INDEX.rightShoulder,
        elbow: LANDMARK_INDEX.rightElbow,
        wrist: LANDMARK_INDEX.rightWrist,
        hip: LANDMARK_INDEX.rightHip,
        ear: LANDMARK_INDEX.rightEar,
      };
}

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleBetweenVectors(a: Point2D, b: Point2D): number | null {
  const aLength = Math.hypot(a.x, a.y);
  const bLength = Math.hypot(b.x, b.y);
  if (aLength === 0 || bLength === 0) return null;
  const cosine = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (aLength * bLength)));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function angleAtJoint(first: Point2D, joint: Point2D, last: Point2D): number | null {
  return angleBetweenVectors(
    { x: first.x - joint.x, y: first.y - joint.y },
    { x: last.x - joint.x, y: last.y - joint.y },
  );
}
