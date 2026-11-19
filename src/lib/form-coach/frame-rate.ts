export type FrameRateStatus =
  | "warming-up"
  | "measuring"
  | "target-met"
  | "below-target"
  | "slow-pending"
  | "slow";

export type FrameRateOptions = Readonly<{
  targetFps?: number;
  slowThresholdFps?: number;
  windowMs?: number;
  warmupMs?: number;
  slowDurationMs?: number;
  maxSamples?: number;
}>;

export type FrameRateRecordResult =
  | Readonly<{ accepted: true }>
  | Readonly<{
      accepted: false;
      reason: "invalid-timestamp" | "non-monotonic-frame" | "invalid-drop-count" | "drop-counter-overflow";
    }>;

export type FrameRateSnapshot = Readonly<{
  atMs: number;
  fps: number | null;
  targetFps: number;
  slowThresholdFps: number;
  windowMs: number;
  warmingUp: boolean;
  targetMet: boolean | null;
  slowNotice: boolean;
  belowSlowThresholdMs: number;
  /** Bounded retained count; it is a lower bound if the sample cap is saturated. */
  processedFramesInWindow: number;
  droppedFramesInWindow: number;
  totalDroppedFrames: number;
  status: FrameRateStatus;
}>;

export type FrameRateMonitor = Readonly<{
  /** Record a processed frame at its monotonic timestamp and any drops since the previous processed frame. */
  recordFrame(timestampMs: number, droppedFramesSincePrevious?: number): FrameRateRecordResult;
  /** Observe the monitor at a monotonic time; call this from an adapter-owned UI timer if frames stop. */
  snapshot(nowMs: number): FrameRateSnapshot;
  /** Clears all bounded session counters and timing state, for stop or a new set/session. */
  reset(): void;
}>;

type ResolvedOptions = Readonly<{
  targetFps: number;
  slowThresholdFps: number;
  windowMs: number;
  warmupMs: number;
  slowDurationMs: number;
  maxSamples: number;
}>;

type FrameSample = {
  readonly timestampMs: number;
  readonly droppedFrames: number;
};

const DEFAULT_OPTIONS: ResolvedOptions = {
  targetFps: 20,
  slowThresholdFps: 15,
  windowMs: 2_000,
  warmupMs: 1_000,
  slowDurationMs: 3_000,
  maxSamples: 512,
};

function positiveFinite(value: number, name: string, allowZero = false): number {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(`${name} must be a ${allowZero ? "non-negative" : "positive"} finite number.`);
  }
  return value;
}

function resolveOptions(options: FrameRateOptions): ResolvedOptions {
  const targetFps = positiveFinite(options.targetFps ?? DEFAULT_OPTIONS.targetFps, "targetFps");
  const slowThresholdFps = positiveFinite(
    options.slowThresholdFps ?? DEFAULT_OPTIONS.slowThresholdFps,
    "slowThresholdFps",
  );
  if (slowThresholdFps >= targetFps) {
    throw new RangeError("slowThresholdFps must be lower than targetFps.");
  }

  const windowMs = positiveFinite(options.windowMs ?? DEFAULT_OPTIONS.windowMs, "windowMs");
  const warmupMs = positiveFinite(options.warmupMs ?? DEFAULT_OPTIONS.warmupMs, "warmupMs", true);
  const slowDurationMs = positiveFinite(
    options.slowDurationMs ?? DEFAULT_OPTIONS.slowDurationMs,
    "slowDurationMs",
  );
  const maxSamples = options.maxSamples ?? DEFAULT_OPTIONS.maxSamples;
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 2 || maxSamples > 10_000) {
    throw new RangeError("maxSamples must be an integer from 2 through 10000.");
  }
  const minimumSamplesForTarget = Math.ceil((targetFps * windowMs) / 1_000);
  if (!Number.isSafeInteger(minimumSamplesForTarget) || maxSamples < minimumSamplesForTarget) {
    throw new RangeError("maxSamples must be large enough to represent the configured target FPS across the window.");
  }

  return { targetFps, slowThresholdFps, windowMs, warmupMs, slowDurationMs, maxSamples };
}

/**
 * Creates a bounded in-memory FPS monitor. FPS counts processed-frame events only in the half-open
 * interval `(max(sessionStart, now - windowMs), now]`; the left boundary is excluded. Dropped frame
 * counts are attached to the next processed event. Defaults are target 20 FPS, a 15 FPS slow
 * threshold, a 2s rolling window, 1s warmup, a 3s slow-notice dwell, and at most 512 samples. The
 * sample cap must be large enough for the configured target rate across the window. If higher rates
 * saturate it, FPS and window counts are lower bounds, but capacity alone cannot report below target.
 * Timestamps must be monotonic completion times supplied by the future adapter; this module creates
 * no timer and makes no device-performance claim.
 */
export function createFrameRateMonitor(options: FrameRateOptions = {}): FrameRateMonitor {
  const resolved = resolveOptions(options);
  let samples: FrameSample[] = [];
  let startedAtMs: number | null = null;
  let lastFrameTimestampMs: number | null = null;
  let lastSnapshotTimestampMs: number | null = null;
  let hasObservedFrameInterval = false;
  let totalDroppedFrames = 0;
  let belowThresholdSinceMs: number | null = null;

  function windowStart(nowMs: number): number {
    return Math.max(startedAtMs ?? nowMs, nowMs - resolved.windowMs);
  }

  function prune(nowMs: number) {
    const cutoff = windowStart(nowMs);
    while (samples.length > 0 && samples[0]!.timestampMs <= cutoff) samples.shift();
    while (samples.length > resolved.maxSamples) samples.shift();
  }

  function calculateFps(nowMs: number): number | null {
    const start = windowStart(nowMs);
    const durationMs = nowMs - start;
    if (hasObservedFrameInterval && durationMs > 0) {
      return (samples.length * 1_000) / durationMs;
    }
    if (lastFrameTimestampMs !== null && nowMs - lastFrameTimestampMs >= resolved.windowMs) return 0;
    return null;
  }

  function updateBelowThreshold(nowMs: number, fps: number | null): boolean {
    const warmingUp = startedAtMs === null || nowMs - startedAtMs < resolved.warmupMs;
    const currentRateIsSlow = !warmingUp && fps !== null && fps < resolved.slowThresholdFps;
    if (currentRateIsSlow) {
      if (belowThresholdSinceMs === null) belowThresholdSinceMs = nowMs;
    } else {
      belowThresholdSinceMs = null;
    }
    return currentRateIsSlow;
  }

  function reset() {
    samples = [];
    startedAtMs = null;
    lastFrameTimestampMs = null;
    lastSnapshotTimestampMs = null;
    hasObservedFrameInterval = false;
    totalDroppedFrames = 0;
    belowThresholdSinceMs = null;
  }

  return {
    recordFrame(timestampMs, droppedFramesSincePrevious = 0) {
      if (!Number.isFinite(timestampMs) || timestampMs < 0) {
        return { accepted: false, reason: "invalid-timestamp" };
      }
      if (
        (lastFrameTimestampMs !== null && timestampMs <= lastFrameTimestampMs) ||
        (lastSnapshotTimestampMs !== null && timestampMs < lastSnapshotTimestampMs)
      ) {
        return { accepted: false, reason: "non-monotonic-frame" };
      }
      if (!Number.isSafeInteger(droppedFramesSincePrevious) || droppedFramesSincePrevious < 0) {
        return { accepted: false, reason: "invalid-drop-count" };
      }
      if (!Number.isSafeInteger(totalDroppedFrames + droppedFramesSincePrevious)) {
        return { accepted: false, reason: "drop-counter-overflow" };
      }

      if (lastFrameTimestampMs !== null) hasObservedFrameInterval = true;
      startedAtMs ??= timestampMs;
      lastFrameTimestampMs = timestampMs;
      totalDroppedFrames += droppedFramesSincePrevious;
      samples.push({ timestampMs, droppedFrames: droppedFramesSincePrevious });
      prune(timestampMs);
      updateBelowThreshold(timestampMs, calculateFps(timestampMs));
      return { accepted: true };
    },

    snapshot(nowMs) {
      if (!Number.isFinite(nowMs) || nowMs < 0) {
        throw new RangeError("snapshot time must be a non-negative finite monotonic number.");
      }
      if (
        (lastSnapshotTimestampMs !== null && nowMs < lastSnapshotTimestampMs) ||
        (lastFrameTimestampMs !== null && nowMs < lastFrameTimestampMs)
      ) {
        throw new RangeError("snapshot time must not move backwards.");
      }

      prune(nowMs);
      const fps = calculateFps(nowMs);

      const warmingUp = startedAtMs === null || nowMs - startedAtMs < resolved.warmupMs;
      const currentRateIsSlow = updateBelowThreshold(nowMs, fps);
      lastSnapshotTimestampMs = nowMs;

      const belowSlowThresholdMs =
        currentRateIsSlow && belowThresholdSinceMs !== null ? Math.max(0, nowMs - belowThresholdSinceMs) : 0;
      const slowNotice = currentRateIsSlow && belowSlowThresholdMs >= resolved.slowDurationMs;
      const processedFramesInWindow = samples.length;
      const droppedFramesInWindow = samples.reduce((sum, sample) => sum + sample.droppedFrames, 0);
      const targetMet = fps === null ? null : fps >= resolved.targetFps;

      let status: FrameRateStatus;
      if (warmingUp) status = "warming-up";
      else if (fps === null) status = "measuring";
      else if (slowNotice) status = "slow";
      else if (currentRateIsSlow) status = "slow-pending";
      else if (targetMet) status = "target-met";
      else status = "below-target";

      return {
        atMs: nowMs,
        fps,
        targetFps: resolved.targetFps,
        slowThresholdFps: resolved.slowThresholdFps,
        windowMs: resolved.windowMs,
        warmingUp,
        targetMet,
        slowNotice,
        belowSlowThresholdMs,
        processedFramesInWindow,
        droppedFramesInWindow,
        totalDroppedFrames,
        status,
      };
    },

    reset,
  };
}
