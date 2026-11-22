import { describe, expect, it } from "vitest";
import { createFrameRateMonitor } from "./frame-rate";

describe("Form Coach processed-frame rate monitor", () => {
  it("uses documented bounded defaults for target, warning threshold, warmup, and window", () => {
    const monitor = createFrameRateMonitor();
    const snapshot = monitor.snapshot(0);

    expect(snapshot).toMatchObject({
      targetFps: 20,
      slowThresholdFps: 15,
      windowMs: 2_000,
      warmingUp: true,
      fps: null,
      slowNotice: false,
      status: "warming-up",
    });
  });

  it("reports a stable 20 FPS rate after warmup", () => {
    const monitor = createFrameRateMonitor();
    for (let frame = 0; frame <= 60; frame += 1) {
      const timestamp = frame * 50;
      expect(monitor.recordFrame(timestamp).accepted).toBe(true);
      monitor.snapshot(timestamp);
    }

    const snapshot = monitor.snapshot(3_000);
    expect(snapshot.fps).toBeCloseTo(20, 6);
    expect(snapshot.warmingUp).toBe(false);
    expect(snapshot.targetMet).toBe(true);
    expect(snapshot.slowNotice).toBe(false);
    expect(snapshot.status).toBe("target-met");
    expect(snapshot.processedFramesInWindow).toBeLessThanOrEqual(512);
  });

  it("decays a stopped 20 FPS stream through the window and starts slow dwell when the measured rate drops below 15", () => {
    const monitor = createFrameRateMonitor({ warmupMs: 0 });
    for (let frame = 0; frame <= 60; frame += 1) {
      expect(monitor.recordFrame(frame * 50).accepted).toBe(true);
    }

    expect(monitor.snapshot(3_000)).toMatchObject({ fps: 20, targetMet: true, slowNotice: false });

    const halfSecondIdle = monitor.snapshot(3_500);
    expect(halfSecondIdle.fps).toBe(15);
    expect(halfSecondIdle.targetMet).toBe(false);
    expect(halfSecondIdle.slowNotice).toBe(false);

    const belowThreshold = monitor.snapshot(3_550);
    expect(belowThreshold.fps).toBe(14.5);
    expect(belowThreshold.status).toBe("slow-pending");
    expect(belowThreshold.belowSlowThresholdMs).toBe(0);

    expect(monitor.snapshot(4_000).fps).toBe(10);
    expect(monitor.snapshot(6_550)).toMatchObject({
      fps: 0,
      slowNotice: true,
      belowSlowThresholdMs: 3_000,
      status: "slow",
    });
  });

  it("clears slow dwell on healthy processed frames even when no snapshots occur", () => {
    const monitor = createFrameRateMonitor({ windowMs: 1_000, warmupMs: 0, slowDurationMs: 200 });
    expect(monitor.recordFrame(0).accepted).toBe(true);
    expect(monitor.recordFrame(70).accepted).toBe(true);
    expect(monitor.snapshot(100).slowNotice).toBe(false);

    for (let timestamp = 150; timestamp <= 4_000; timestamp += 50) {
      expect(monitor.recordFrame(timestamp).accepted).toBe(true);
    }

    const shortStall = monitor.snapshot(4_300);
    expect(shortStall.fps).toBe(14);
    expect(shortStall.belowSlowThresholdMs).toBe(0);
    expect(shortStall.slowNotice).toBe(false);

    const beforeDwell = monitor.snapshot(4_400);
    expect(beforeDwell.belowSlowThresholdMs).toBe(100);
    expect(beforeDwell.slowNotice).toBe(false);
  });

  it("measures resumed frames only within the active window after a long gap", () => {
    const monitor = createFrameRateMonitor({ warmupMs: 0 });
    expect(monitor.recordFrame(0).accepted).toBe(true);

    for (let timestamp = 10_000; timestamp <= 11_500; timestamp += 50) {
      expect(monitor.recordFrame(timestamp).accepted).toBe(true);
    }

    expect(monitor.snapshot(11_500)).toMatchObject({
      fps: 15.5,
      processedFramesInWindow: 31,
      slowNotice: false,
      status: "below-target",
    });
  });

  it("treats exactly 15 FPS as below the target but not below the slow threshold", () => {
    const monitor = createFrameRateMonitor({ warmupMs: 0 });
    for (let frame = 0; frame <= 15; frame += 1) {
      const timestamp = (frame * 1_000) / 15;
      expect(monitor.recordFrame(timestamp).accepted).toBe(true);
      monitor.snapshot(timestamp);
    }

    const snapshot = monitor.snapshot(1_000);
    expect(snapshot.fps).toBe(15);
    expect(snapshot.targetMet).toBe(false);
    expect(snapshot.slowNotice).toBe(false);
    expect(snapshot.status).toBe("below-target");
  });

  it("signals slow processing only after FPS stays below 15 for the configured dwell", () => {
    const monitor = createFrameRateMonitor({ warmupMs: 0 });
    const intervalMs = 1_000 / 14;
    for (let frame = 0; frame <= 42; frame += 1) {
      const timestamp = frame * intervalMs;
      expect(monitor.recordFrame(timestamp).accepted).toBe(true);
      monitor.snapshot(timestamp);
    }

    const beforeDwell = monitor.snapshot(3_000);
    expect(beforeDwell.fps).toBeCloseTo(14, 6);
    expect(beforeDwell.slowNotice).toBe(false);
    expect(beforeDwell.status).toBe("slow-pending");

    const afterDwell = monitor.snapshot(3_150);
    expect(afterDwell.slowNotice).toBe(true);
    expect(afterDwell.status).toBe("slow");
    expect(afterDwell.belowSlowThresholdMs).toBeGreaterThanOrEqual(3_000);
  });

  it("decays to zero when processed frames stop and eventually signals the slow notice", () => {
    const monitor = createFrameRateMonitor({ warmupMs: 0, windowMs: 1_000 });
    expect(monitor.recordFrame(0).accepted).toBe(true);

    expect(monitor.snapshot(1_000)).toMatchObject({ fps: 0, slowNotice: false, status: "slow-pending" });
    expect(monitor.snapshot(3_999).slowNotice).toBe(false);
    expect(monitor.snapshot(4_000)).toMatchObject({ fps: 0, slowNotice: true, status: "slow" });
  });

  it("counts drops separately from processed FPS and keeps window counters bounded", () => {
    const monitor = createFrameRateMonitor({ windowMs: 100, warmupMs: 0, maxSamples: 2 });
    expect(monitor.recordFrame(0, 4).accepted).toBe(true);
    expect(monitor.recordFrame(50, 1).accepted).toBe(true);
    expect(monitor.recordFrame(100, 2).accepted).toBe(true);
    expect(monitor.recordFrame(150, 3).accepted).toBe(true);

    const snapshot = monitor.snapshot(150);
    expect(snapshot.fps).toBeCloseTo(20, 6);
    expect(snapshot.processedFramesInWindow).toBe(2);
    expect(snapshot.droppedFramesInWindow).toBe(5);
    expect(snapshot.totalDroppedFrames).toBe(10);
  });

  it("rejects invalid or non-monotonic frames without changing counters", () => {
    const monitor = createFrameRateMonitor({ warmupMs: 0 });
    expect(monitor.recordFrame(10).accepted).toBe(true);
    expect(monitor.recordFrame(10)).toEqual({ accepted: false, reason: "non-monotonic-frame" });
    expect(monitor.recordFrame(9)).toEqual({ accepted: false, reason: "non-monotonic-frame" });
    expect(monitor.recordFrame(Number.NaN)).toEqual({ accepted: false, reason: "invalid-timestamp" });
    expect(monitor.recordFrame(20, -1)).toEqual({ accepted: false, reason: "invalid-drop-count" });
    expect(monitor.snapshot(10)).toMatchObject({ totalDroppedFrames: 0, processedFramesInWindow: 0 });
    expect(() => monitor.snapshot(9)).toThrow(/move backwards/i);
  });

  it("does not rewind the observation window with a frame older than the last snapshot", () => {
    const monitor = createFrameRateMonitor({ warmupMs: 0 });
    expect(monitor.recordFrame(0).accepted).toBe(true);
    expect(monitor.recordFrame(50).accepted).toBe(true);
    monitor.snapshot(100);

    expect(monitor.recordFrame(99)).toEqual({ accepted: false, reason: "non-monotonic-frame" });
    expect(monitor.recordFrame(100).accepted).toBe(true);
    expect(monitor.snapshot(100).fps).toBeCloseTo(20, 6);
  });

  it("resets all timing and drop state for stop or a new session", () => {
    const monitor = createFrameRateMonitor({ warmupMs: 0 });
    monitor.recordFrame(1_000, 2);
    monitor.recordFrame(1_050);
    monitor.reset();

    expect(monitor.snapshot(0)).toMatchObject({
      fps: null,
      warmingUp: true,
      processedFramesInWindow: 0,
      droppedFramesInWindow: 0,
      totalDroppedFrames: 0,
      status: "warming-up",
    });
    expect(monitor.recordFrame(0).accepted).toBe(true);
  });

  it("rejects invalid option bounds", () => {
    expect(() => createFrameRateMonitor({ slowThresholdFps: 20 })).toThrow(/lower than target/i);
    expect(() => createFrameRateMonitor({ maxSamples: 1 })).toThrow(/maxSamples/i);
    expect(() => createFrameRateMonitor({ maxSamples: 39 })).toThrow(/large enough/i);
  });
});
