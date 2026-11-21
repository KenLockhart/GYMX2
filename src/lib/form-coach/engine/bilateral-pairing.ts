import { resampleTimedCurve } from "./dtw";
import type { ArmSide, SegmentedCurlRep } from "./types";

export type PairRejectionReason = "missing-partner" | "out-of-phase" | "phase-mismatch" | "asymmetric";

export interface BilateralRepPair {
  readonly left: SegmentedCurlRep;
  readonly right: SegmentedCurlRep;
}

export interface PairingUpdate {
  readonly pair?: BilateralRepPair;
  readonly rejected: readonly PairRejectionReason[];
}

const MAX_START_END_SKEW_MS = 350;
const MAX_UNMATCHED_WAIT_MS = 1_000;
const MAX_PHASE_DIFFERENCE_MS = 250;
const MAX_PHASE_DIFFERENCE_RATIO = 0.3;
const MAX_ROM_ASYMMETRY_DEG = 25;
const MAX_CURVE_ASYMMETRY_DEG = 20;

function phaseMatches(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(MAX_PHASE_DIFFERENCE_MS, Math.max(left, right) * MAX_PHASE_DIFFERENCE_RATIO);
}

function curveDifference(left: SegmentedCurlRep, right: SegmentedCurlRep): number | null {
  try {
    const leftCurve = resampleTimedCurve(left.elbowCurve, 50);
    const rightCurve = resampleTimedCurve(right.elbowCurve, 50);
    if (leftCurve.length !== 50 || rightCurve.length !== 50) return null;
    return leftCurve.reduce((sum, angle, index) => sum + Math.abs(angle - rightCurve[index]), 0) / leftCurve.length;
  } catch {
    return null;
  }
}

export function bilateralPairRejection(left: SegmentedCurlRep, right: SegmentedCurlRep): PairRejectionReason | null {
  if (Math.abs(left.startMs - right.startMs) > MAX_START_END_SKEW_MS || Math.abs(left.endMs - right.endMs) > MAX_START_END_SKEW_MS) {
    return "out-of-phase";
  }
  if (!phaseMatches(left.concentricMs, right.concentricMs) || !phaseMatches(left.topPauseMs, right.topPauseMs) || !phaseMatches(left.eccentricMs, right.eccentricMs)) {
    return "phase-mismatch";
  }
  if (
    Math.abs(left.romMinAngle - right.romMinAngle) > MAX_ROM_ASYMMETRY_DEG ||
    Math.abs(left.romMaxAngle - right.romMaxAngle) > MAX_ROM_ASYMMETRY_DEG
  ) return "asymmetric";
  if (Math.max(left.romMinAngle, right.romMinAngle) >= Math.min(left.romMaxAngle, right.romMaxAngle)) return "asymmetric";
  const difference = curveDifference(left, right);
  if (difference === null || difference > MAX_CURVE_ASYMMETRY_DEG) return "asymmetric";
  return null;
}

/** Holds at most one unmatched completed cycle per arm; curves remain local and bounded. */
export class BilateralRepPairer {
  private pending: Partial<Record<ArmSide, SegmentedCurlRep>> = {};

  push(arm: ArmSide, rep: SegmentedCurlRep, nowMs: number): PairingUpdate {
    const rejected = [...this.expire(nowMs)];
    const sameArm = this.pending[arm];
    if (sameArm) {
      rejected.push("missing-partner");
      delete this.pending[arm];
    }
    const otherArm: ArmSide = arm === "left" ? "right" : "left";
    const other = this.pending[otherArm];
    if (!other) {
      this.pending[arm] = rep;
      return { rejected };
    }

    const left = arm === "left" ? rep : other;
    const right = arm === "right" ? rep : other;
    const mismatch = bilateralPairRejection(left, right);
    if (!mismatch) {
      this.pending = {};
      return { pair: { left, right }, rejected };
    }

    rejected.push(mismatch);
    if (rep.startMs > other.startMs) {
      delete this.pending[otherArm];
      this.pending[arm] = rep;
    } else {
      delete this.pending[otherArm];
      this.pending[otherArm] = other;
    }
    return { rejected };
  }

  expire(nowMs: number): PairRejectionReason[] {
    const rejected: PairRejectionReason[] = [];
    for (const arm of ["left", "right"] as const) {
      const rep = this.pending[arm];
      if (rep && nowMs - rep.endMs > MAX_UNMATCHED_WAIT_MS) {
        delete this.pending[arm];
        rejected.push("missing-partner");
      }
    }
    return rejected;
  }

  reset(): PairRejectionReason[] {
    const rejected: PairRejectionReason[] = [];
    if (this.pending.left || this.pending.right) rejected.push("missing-partner");
    this.pending = {};
    return rejected;
  }
}
