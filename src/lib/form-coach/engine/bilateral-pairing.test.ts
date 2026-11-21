import { describe, expect, it } from "vitest";
import { BilateralRepPairer, bilateralPairRejection } from "./bilateral-pairing";
import type { SegmentedCurlRep } from "./types";

function rep(startMs: number, overrides: Partial<SegmentedCurlRep> = {}): SegmentedCurlRep {
  return {
    startMs,
    endMs: startMs + 1_600,
    concentricMs: 700,
    topPauseMs: 200,
    eccentricMs: 700,
    romMinAngle: 45,
    romMaxAngle: 165,
    maxUpperArmDrift: 4,
    maxTorsoSwing: 3,
    maxShrug: 0.02,
    elbowCurve: [
      { timestampMs: startMs, angleDeg: 165 },
      { timestampMs: startMs + 500, angleDeg: 95 },
      { timestampMs: startMs + 800, angleDeg: 45 },
      { timestampMs: startMs + 1_100, angleDeg: 95 },
      { timestampMs: startMs + 1_600, angleDeg: 165 },
    ],
    ...overrides,
  };
}

describe("bilateral rep pairing", () => {
  it("emits one pair only after both arms complete the same clean cycle", () => {
    const pairer = new BilateralRepPairer();
    expect(pairer.push("left", rep(1_000), 2_600)).toEqual({ rejected: [] });
    expect(pairer.push("right", rep(1_120), 2_720)).toMatchObject({
      pair: { left: { startMs: 1_000 }, right: { startMs: 1_120 } },
      rejected: [],
    });
  });

  it("rejects out-of-phase cycles instead of pairing alternating arms", () => {
    const pairer = new BilateralRepPairer();
    pairer.push("left", rep(0), 1_600);
    const alternating = pairer.push("right", rep(500), 2_100);
    expect(alternating.pair).toBeUndefined();
    expect(alternating.rejected).toContain("out-of-phase");
    const nextLeft = pairer.push("left", rep(2_500), 4_100);
    expect(nextLeft.pair).toBeUndefined();
    expect(nextLeft.rejected).toContain("missing-partner");
    expect(pairer.push("right", rep(2_800), 4_400).pair).toBeDefined();
  });

  it("rejects unmatched work after a bounded wait and on a visibility/time-gap reset", () => {
    const pairer = new BilateralRepPairer();
    pairer.push("left", rep(0), 1_600);
    expect(pairer.expire(2_601)).toEqual(["missing-partner"]);
    pairer.push("right", rep(3_000), 4_600);
    expect(pairer.reset()).toEqual(["missing-partner"]);
    expect(pairer.push("left", rep(5_000), 6_600).pair).toBeUndefined();
  });

  it("rejects phase timing and ROM/curve asymmetry", () => {
    expect(bilateralPairRejection(rep(0), rep(0, { eccentricMs: 1_200 }))).toBe("phase-mismatch");
    expect(bilateralPairRejection(rep(0), rep(0, { romMinAngle: 75 }))).toBe("asymmetric");
    expect(bilateralPairRejection(rep(0), rep(0, {
      elbowCurve: [
        { timestampMs: 0, angleDeg: 0 },
        { timestampMs: 1_600, angleDeg: 180 },
      ],
    }))).toBe("asymmetric");
  });

  it("keeps a newer candidate after rejecting the older out-of-phase cycle", () => {
    const pairer = new BilateralRepPairer();
    pairer.push("left", rep(2_000), 3_600);
    const firstMatchAttempt = pairer.push("right", rep(2_500), 4_100);
    expect(firstMatchAttempt.rejected).toContain("out-of-phase");
    const pair = pairer.push("left", rep(2_560), 4_160);
    expect(pair.pair).toMatchObject({ left: { startMs: 2_560 }, right: { startMs: 2_500 } });
  });
});
