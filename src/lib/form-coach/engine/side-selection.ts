import { LANDMARK_INDEX, isUsableLandmark } from "./geometry";
import type { ArmSelectionResult, ArmSelectionSample, ArmSide, TrackedArm } from "./types";

const ARM_LANDMARKS: Record<ArmSide, readonly number[]> = {
  left: [LANDMARK_INDEX.leftShoulder, LANDMARK_INDEX.leftElbow, LANDMARK_INDEX.leftWrist],
  right: [LANDMARK_INDEX.rightShoulder, LANDMARK_INDEX.rightElbow, LANDMARK_INDEX.rightWrist],
};

function visibilityAt(sample: ArmSelectionSample, index: number): number {
  const landmark = sample.landmarks[index];
  if (!landmark || !Number.isFinite(landmark.visibility)) return 0;
  return Math.max(0, Math.min(1, landmark.visibility as number));
}

export function averageArmVisibility(samples: readonly ArmSelectionSample[]): Readonly<Record<ArmSide, number>> {
  const totals: Record<ArmSide, number> = { left: 0, right: 0 };
  let count = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample.timestampMs)) continue;
    count += 1;
    for (const arm of ["left", "right"] as const) {
      totals[arm] += ARM_LANDMARKS[arm].reduce((sum, index) => sum + visibilityAt(sample, index), 0) / 3;
    }
  }
  if (count === 0) return { left: 0, right: 0 };
  return { left: totals.left / count, right: totals.right / count };
}

export function selectArmByVisibility(samples: readonly ArmSelectionSample[]): ArmSide | null {
  if (samples.length === 0) return null;
  const averages = averageArmVisibility(samples);
  if (Math.max(averages.left, averages.right) < 0.5) return null;
  if (averages.left === averages.right) return null;
  return averages.left > averages.right ? "left" : "right";
}

/** Locks an auto selection once the first one-second visibility window has elapsed. */
export class ActiveArmSelector {
  private readonly requestedArm: TrackedArm;
  private readonly windowMs: number;
  private startMs: number | null = null;
  private samples: ArmSelectionSample[] = [];
  private locked: ArmSide | "both" | null = null;
  private averages: Readonly<Record<ArmSide, number>> = { left: 0, right: 0 };
  private resolved = false;
  private windowClosed = false;

  constructor(requestedArm: TrackedArm, windowMs = 1000) {
    if (!Number.isFinite(windowMs) || windowMs <= 0 || windowMs > 5000) {
      throw new RangeError("Auto-arm selection window must be between 0 and 5000 ms.");
    }
    this.requestedArm = requestedArm;
    this.windowMs = windowMs;
    if (requestedArm === "left" || requestedArm === "right" || requestedArm === "both") {
      this.locked = requestedArm;
      this.resolved = true;
    }
  }

  observe(sample: ArmSelectionSample): ArmSelectionResult {
    if (!Number.isFinite(sample.timestampMs)) {
      return { arm: this.locked, ready: this.resolved, averageVisibility: this.averages };
    }
    if (this.startMs === null) this.startMs = sample.timestampMs;
    if (this.requestedArm === "auto" && !this.windowClosed) {
      const elapsedMs = sample.timestampMs - this.startMs;
      if (elapsedMs <= this.windowMs) {
        this.samples.push(sample);
        this.averages = averageArmVisibility(this.samples);
      }
      if (elapsedMs >= this.windowMs) {
        this.locked = selectArmByVisibility(this.samples);
        this.resolved = this.locked !== null;
        this.windowClosed = true;
      }
    }
    return { arm: this.locked, ready: this.resolved, averageVisibility: this.averages };
  }

  getSelection(): ArmSelectionResult {
    return { arm: this.locked, ready: this.resolved, averageVisibility: this.averages };
  }

  /**
   * Retries the initial auto-arm visibility window after the user adjusts the camera/view.
   * A resolved selection otherwise remains locked for the lifetime of this selector.
   */
  reset(): void {
    this.startMs = null;
    this.samples = [];
    this.averages = { left: 0, right: 0 };
    this.windowClosed = false;
    this.resolved = false;
    this.locked = null;
    if (this.requestedArm === "left" || this.requestedArm === "right" || this.requestedArm === "both") {
      this.locked = this.requestedArm;
      this.resolved = true;
    }
  }
}

export function armVisibilityIsUsable(sample: ArmSelectionSample, arm: ArmSide): boolean {
  return ARM_LANDMARKS[arm].every((index) => isUsableLandmark(sample.landmarks[index]));
}
