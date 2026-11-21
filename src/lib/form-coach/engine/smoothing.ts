import { MIN_LANDMARK_VISIBILITY } from "./geometry";
import type { LandmarkSet, PoseLandmark } from "./types";

export class LandmarkEmaSmoother {
  private readonly alpha: number;
  private readonly previous = new Map<number, PoseLandmark>();

  constructor(alpha = 0.4, private readonly minimumVisibility = MIN_LANDMARK_VISIBILITY) {
    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
      throw new RangeError("EMA alpha must be in (0, 1].");
    }
    this.alpha = alpha;
  }

  smooth(landmarks: LandmarkSet): Array<PoseLandmark | null> {
    const output: Array<PoseLandmark | null> = [];
    for (let index = 0; index < landmarks.length; index += 1) {
      const current = landmarks[index];
      if (!current || !Number.isFinite(current.x) || !Number.isFinite(current.y)) {
        this.previous.delete(index);
        output.push(null);
        continue;
      }
      const visibility = current.visibility;
      if (visibility === undefined || !Number.isFinite(visibility) || visibility < this.minimumVisibility) {
        this.previous.delete(index);
        output.push({ ...current });
        continue;
      }

      const previous = this.previous.get(index);
      const smoothed: PoseLandmark = previous
        ? {
            x: previous.x + this.alpha * (current.x - previous.x),
            y: previous.y + this.alpha * (current.y - previous.y),
            ...(current.z !== undefined
              ? { z: (previous.z ?? current.z) + this.alpha * (current.z - (previous.z ?? current.z)) }
              : {}),
            visibility,
          }
        : { ...current, visibility };
      this.previous.set(index, smoothed);
      output.push(smoothed);
    }
    for (const index of this.previous.keys()) {
      if (index >= landmarks.length) this.previous.delete(index);
    }
    return output;
  }

  reset(): void {
    this.previous.clear();
  }
}

export function smoothLandmarks(
  landmarks: LandmarkSet,
  previous: LandmarkSet | null,
  alpha = 0.4,
  minimumVisibility = MIN_LANDMARK_VISIBILITY,
): Array<PoseLandmark | null> {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
    throw new RangeError("EMA alpha must be in (0, 1].");
  }
  return Array.from({ length: landmarks.length }, (_, index) => {
    const current = landmarks[index];
    if (!current || !Number.isFinite(current.x) || !Number.isFinite(current.y)) return null;
    const visibility = current.visibility;
    if (visibility === undefined || !Number.isFinite(visibility) || visibility < minimumVisibility) return { ...current };
    const prior = previous?.[index];
    if (
      !prior || !Number.isFinite(prior.x) || !Number.isFinite(prior.y) ||
      !Number.isFinite(prior.visibility) || (prior.visibility as number) < minimumVisibility
    ) {
      return { ...current, visibility };
    }
    return {
      x: prior.x + alpha * (current.x - prior.x),
      y: prior.y + alpha * (current.y - prior.y),
      ...(current.z !== undefined
        ? { z: (prior.z ?? current.z) + alpha * (current.z - (prior.z ?? current.z)) }
        : {}),
      visibility,
    };
  });
}
