import type { TimedCurvePoint } from "./types";

export function resampleTimedCurve(points: readonly TimedCurvePoint[], sampleCount = 50): number[] {
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 500) {
    throw new RangeError("Curve sample count must be an integer from 2 to 500.");
  }
  if (points.length === 0) return [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(point.timestampMs) || !Number.isFinite(point.angleDeg) || point.angleDeg < 0 || point.angleDeg > 180) {
      throw new RangeError("Curve points must contain finite timestamps and angles from 0 to 180 degrees.");
    }
    if (index > 0 && point.timestampMs < points[index - 1].timestampMs) {
      throw new RangeError("Curve timestamps must be nondecreasing.");
    }
  }
  if (points.length === 1) return Array.from({ length: sampleCount }, () => points[0].angleDeg);

  const first = points[0];
  const last = points[points.length - 1];
  const duration = last.timestampMs - first.timestampMs;
  if (duration <= 0) return Array.from({ length: sampleCount }, () => last.angleDeg);

  const resampled: number[] = [];
  let rightIndex = 1;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const targetTime = first.timestampMs + (duration * sampleIndex) / (sampleCount - 1);
    while (rightIndex < points.length - 1 && points[rightIndex].timestampMs < targetTime) rightIndex += 1;
    const left = points[rightIndex - 1];
    const right = points[rightIndex];
    const interval = right.timestampMs - left.timestampMs;
    const ratio = interval <= 0 ? 1 : Math.max(0, Math.min(1, (targetTime - left.timestampMs) / interval));
    resampled.push(left.angleDeg + ratio * (right.angleDeg - left.angleDeg));
  }
  return resampled;
}

export function dynamicTimeWarpingDistance(first: readonly number[], second: readonly number[]): number | null {
  if (first.length === 0 || second.length === 0) return null;
  if (first.some((value) => !Number.isFinite(value)) || second.some((value) => !Number.isFinite(value))) return null;

  let previous = Array.from({ length: second.length + 1 }, () => Number.POSITIVE_INFINITY);
  previous[0] = 0;
  for (let i = 1; i <= first.length; i += 1) {
    const current = Array.from({ length: second.length + 1 }, () => Number.POSITIVE_INFINITY);
    for (let j = 1; j <= second.length; j += 1) {
      const cost = Math.abs(first[i - 1] - second[j - 1]);
      current[j] = cost + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    previous = current;
  }
  const distance = previous[second.length] / Math.max(first.length, second.length);
  return Number.isFinite(distance) ? distance : null;
}

/** Maps average absolute DTW angle error (0..180 degrees) to a 0..100 similarity score. */
export function dtwSimilarity(first: readonly number[], second: readonly number[]): number | null {
  const distance = dynamicTimeWarpingDistance(first, second);
  if (distance === null) return null;
  return Math.round(Math.max(0, Math.min(100, 100 * (1 - distance / 180))) * 10) / 10;
}
