import type { ExerciseFault } from "./types";

export type CueFault = ExerciseFault | "clean_rep";
export type CueKind = "form" | "breathing" | "praise";
export type CurlPhase = "concentric" | "eccentric";

export interface CueDefinition {
  readonly key: string;
  readonly fault: CueFault;
  readonly text: string;
  /** Smaller number means higher priority. */
  readonly priority: number;
  readonly minPersistMs: number;
  readonly cooldownMs: number;
}

export const DEFAULT_CURL_CUES = [
  { key: "elbows_pinned", fault: "elbow_drift", text: "Pin your elbows to your sides", priority: 1, minPersistMs: 300, cooldownMs: 4000 },
  { key: "no_swing", fault: "torso_swing", text: "No swinging — lighten the weight if you need to", priority: 1, minPersistMs: 300, cooldownMs: 4000 },
  { key: "full_range_down", fault: "short_rom_bottom", text: "All the way down", priority: 2, minPersistMs: 300, cooldownMs: 4000 },
  { key: "full_range_up", fault: "short_rom_top", text: "Squeeze all the way up", priority: 2, minPersistMs: 300, cooldownMs: 4000 },
  { key: "slow_down", fault: "eccentric_too_fast", text: "Slow it down on the way down", priority: 3, minPersistMs: 300, cooldownMs: 4000 },
  { key: "relax_shoulders", fault: "shoulder_shrug", text: "Relax your shoulders", priority: 3, minPersistMs: 300, cooldownMs: 4000 },
  { key: "good_rep", fault: "clean_rep", text: "Perfect rep", priority: 4, minPersistMs: 0, cooldownMs: 4000 },
] as const satisfies readonly CueDefinition[];

export interface CueAnnouncement {
  readonly key: string;
  readonly text: string;
  readonly kind: CueKind;
  readonly fault?: CueFault;
  readonly priority: number;
  readonly queuedAtMs: number;
  readonly expiresAtMs: number;
}

export type CueSchedulerEvent =
  | {
      readonly type: "frame";
      readonly atMs: number;
      readonly faults: readonly ExerciseFault[];
      /** Set only at the start of a phase, not on every frame. */
      readonly phaseStarted?: CurlPhase;
      /** Current phase is used to drop a queued breathing cue after a transition. */
      readonly currentPhase?: CurlPhase | null;
      readonly repNumber?: number;
      readonly stalledMs?: number;
    }
  | { readonly type: "rep_completed"; readonly atMs: number; readonly repNumber: number; readonly faults: readonly ExerciseFault[] }
  | { readonly type: "cue_finished"; readonly atMs: number };

export interface CueSchedulerOptions {
  readonly enabled?: boolean;
  readonly globalGapMs?: number;
  readonly maxQueueAgeMs?: number;
  readonly fullCueReps?: number;
  readonly thenEvery?: number;
  readonly cues?: readonly CueDefinition[];
}

interface CueCandidate extends CueAnnouncement {
  readonly cooldownMs: number;
  readonly phase?: CurlPhase;
  readonly repNumber?: number;
}

interface FaultPersistence {
  readonly startedAtMs: number;
}

const BREATHING_CUES: Record<string, Omit<CueCandidate, "queuedAtMs" | "expiresAtMs">> = {
  exhale: { key: "exhale", text: "Exhale", kind: "breathing", priority: 2, cooldownMs: 4000 },
  inhale: { key: "inhale", text: "Inhale", kind: "breathing", priority: 2, cooldownMs: 4000 },
  keep_breathing: {
    key: "keep_breathing",
    text: "Keep breathing — don't hold your breath.",
    kind: "breathing",
    priority: 1,
    cooldownMs: 4000,
  },
};

/**
 * Pure scheduler. It emits one announcement at a time and stays busy until the adapter calls
 * `cue_finished`; it never invokes speech, audio, timers, or browser APIs itself.
 */
export class CurlCueScheduler {
  private readonly enabled: boolean;
  private readonly globalGapMs: number;
  private readonly maxQueueAgeMs: number;
  private readonly fullCueReps: number;
  private readonly thenEvery: number;
  private readonly cuesByFault = new Map<CueFault, CueDefinition>();
  private readonly faultPersistence = new Map<ExerciseFault, FaultPersistence>();
  private readonly repFaultStreak = new Map<ExerciseFault, number>();
  private readonly lastCueAt = new Map<string, number>();
  private queue: CueCandidate | null = null;
  private active: CueAnnouncement | null = null;
  private lastDispatchAt = Number.NEGATIVE_INFINITY;
  private lastProcessedAt = Number.NEGATIVE_INFINITY;
  private cleanRepCount = 0;
  private currentPhase: CurlPhase | null = null;
  private currentRepNumber: number | null = null;

  constructor(options: CueSchedulerOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.globalGapMs = options.globalGapMs ?? 2500;
    this.maxQueueAgeMs = options.maxQueueAgeMs ?? 2500;
    this.fullCueReps = options.fullCueReps ?? 3;
    this.thenEvery = options.thenEvery ?? 3;
    if (
      !Number.isFinite(this.globalGapMs) || this.globalGapMs < 0 ||
      !Number.isFinite(this.maxQueueAgeMs) || this.maxQueueAgeMs < 1 ||
      !Number.isInteger(this.fullCueReps) || this.fullCueReps < 1 ||
      !Number.isInteger(this.thenEvery) || this.thenEvery < 1
    ) {
      throw new RangeError("Invalid cue scheduler options.");
    }
    for (const cue of options.cues ?? DEFAULT_CURL_CUES) {
      this.cuesByFault.set(cue.fault, cue);
    }
  }

  get activeCue(): CueAnnouncement | null {
    return this.active;
  }

  get queuedCue(): CueAnnouncement | null {
    return this.queue;
  }

  handle(event: CueSchedulerEvent): readonly CueAnnouncement[] {
    return this.handleEvents([event]);
  }

  /** Batch equal-time events so priority is resolved before a cue is emitted. */
  handleEvents(events: readonly CueSchedulerEvent[]): readonly CueAnnouncement[] {
    const ordered = events
      .filter((event) => Number.isFinite(event.atMs) && event.atMs >= this.lastProcessedAt)
      .slice()
      .sort((left, right) => left.atMs - right.atMs);
    const emitted: CueAnnouncement[] = [];
    for (let index = 0; index < ordered.length;) {
      const atMs = ordered[index].atMs;
      const sameTime: CueSchedulerEvent[] = [];
      while (index < ordered.length && ordered[index].atMs === atMs) {
        sameTime.push(ordered[index]);
        index += 1;
      }
      this.lastProcessedAt = atMs;
      this.expireStaleQueue(atMs);
      for (const event of sameTime) this.processEvent(event);
      emitted.push(...this.dispatchIfReady(atMs));
    }
    return emitted;
  }

  advance(atMs: number): readonly CueAnnouncement[] {
    if (!Number.isFinite(atMs) || atMs < this.lastProcessedAt) return [];
    this.lastProcessedAt = atMs;
    this.expireStaleQueue(atMs);
    return this.dispatchIfReady(atMs);
  }

  reset(): void {
    this.faultPersistence.clear();
    this.repFaultStreak.clear();
    this.lastCueAt.clear();
    this.queue = null;
    this.active = null;
    this.lastDispatchAt = Number.NEGATIVE_INFINITY;
    this.lastProcessedAt = Number.NEGATIVE_INFINITY;
    this.cleanRepCount = 0;
    this.currentPhase = null;
    this.currentRepNumber = null;
  }

  private processEvent(event: CueSchedulerEvent): void {
    if (event.type === "cue_finished") {
      this.active = null;
      return;
    }
    if (event.type === "rep_completed") {
      this.processRep(event);
      return;
    }
    this.processFrame(event);
  }

  private processFrame(event: Extract<CueSchedulerEvent, { type: "frame" }>): void {
    const currentFaults = new Set(event.faults);
    if (event.phaseStarted !== undefined) this.currentPhase = event.phaseStarted;
    else if (event.currentPhase !== undefined) this.currentPhase = event.currentPhase;
    if (event.repNumber !== undefined) this.currentRepNumber = event.repNumber;
    this.invalidateStaleQueue(currentFaults);
    if ((event.stalledMs === undefined || event.stalledMs <= 2000) && this.queue?.key === "keep_breathing") {
      this.queue = null;
    }

    for (const fault of this.faultPersistence.keys()) {
      if (!currentFaults.has(fault)) this.faultPersistence.delete(fault);
    }
    for (const fault of currentFaults) {
      const cue = this.cuesByFault.get(fault);
      if (!cue) continue;
      const previous = this.faultPersistence.get(fault);
      const tracking = previous ?? { startedAtMs: event.atMs };
      this.faultPersistence.set(fault, tracking);
      if (event.atMs - tracking.startedAtMs >= cue.minPersistMs) {
        this.enqueueFormCue(cue, event.atMs, fault, {
          phase: event.phaseStarted ?? event.currentPhase ?? this.currentPhase ?? undefined,
          repNumber: event.repNumber ?? this.currentRepNumber ?? undefined,
        });
      }
    }

    if (event.phaseStarted && event.repNumber && this.shouldCueBreathing(event.repNumber)) {
      const key = event.phaseStarted === "concentric" ? "exhale" : "inhale";
      const cue = BREATHING_CUES[key];
      this.enqueue(cue, event.atMs, { phase: event.phaseStarted, repNumber: event.repNumber });
    }

    if (event.stalledMs !== undefined && event.stalledMs > 2000) {
      this.enqueue(BREATHING_CUES.keep_breathing, event.atMs, {
        phase: this.currentPhase ?? undefined,
        repNumber: this.currentRepNumber ?? undefined,
      });
    }
  }

  private processRep(event: Extract<CueSchedulerEvent, { type: "rep_completed" }>): void {
    const faults = new Set(event.faults);
    if (this.queue?.repNumber !== undefined && event.repNumber > this.queue.repNumber) {
      this.queue = null;
    }
    if (this.queue?.kind === "form" && this.queue.fault && this.queue.fault !== "clean_rep" && !faults.has(this.queue.fault)) {
      this.queue = null;
    }
    for (const fault of this.repFaultStreak.keys()) {
      if (!faults.has(fault)) {
        this.repFaultStreak.delete(fault);
      }
    }
    for (const fault of faults) {
      const streak = (this.repFaultStreak.get(fault) ?? 0) + 1;
      this.repFaultStreak.set(fault, streak);
      const cue = this.cuesByFault.get(fault);
      if (streak >= 2 && cue) {
        this.enqueueFormCue(cue, event.atMs, fault, {
          phase: this.currentPhase ?? undefined,
          repNumber: event.repNumber,
        });
      }
    }

    if (faults.size === 0) {
      this.cleanRepCount += 1;
      if (this.cleanRepCount % 3 === 0) {
        const praise = this.cuesByFault.get("clean_rep");
        if (praise) this.enqueueFormCue(praise, event.atMs, "clean_rep", { repNumber: event.repNumber });
      }
    }
  }

  private enqueueFormCue(
    cue: CueDefinition,
    atMs: number,
    fault: CueFault,
    context: { readonly phase?: CurlPhase; readonly repNumber?: number } = {},
  ): boolean {
    return this.enqueue({ ...cue, kind: fault === "clean_rep" ? "praise" : "form", fault }, atMs, context);
  }

  private enqueue(
    cue: Omit<CueCandidate, "queuedAtMs" | "expiresAtMs">,
    atMs: number,
    context: { readonly phase?: CurlPhase; readonly repNumber?: number } = {},
  ): boolean {
    if (!this.enabled) return false;
    const lastAt = this.lastCueAt.get(cue.key);
    if (lastAt !== undefined && atMs - lastAt < cue.cooldownMs) return false;
    if (this.active?.key === cue.key || this.queue?.key === cue.key) return true;
    const candidate: CueCandidate = {
      ...cue,
      queuedAtMs: atMs,
      expiresAtMs: atMs + this.maxQueueAgeMs,
      ...context,
    };
    if (!this.queue || candidate.priority < this.queue.priority) {
      this.queue = candidate;
      return true;
    }
    if (candidate.priority === this.queue.priority && candidate.queuedAtMs < this.queue.queuedAtMs) {
      this.queue = candidate;
      return true;
    }
    return false;
  }

  private invalidateStaleQueue(currentFaults: ReadonlySet<ExerciseFault>): void {
    const queued = this.queue;
    if (!queued) return;
    if (queued.kind === "form" && queued.fault && queued.fault !== "clean_rep" && !currentFaults.has(queued.fault)) {
      this.queue = null;
      return;
    }
    if (queued.kind === "breathing") {
      if (queued.phase && this.currentPhase !== queued.phase) {
        this.queue = null;
        return;
      }
      if (queued.repNumber !== undefined && this.currentRepNumber !== queued.repNumber) this.queue = null;
    }
  }

  private expireStaleQueue(atMs: number): void {
    if (this.queue && atMs > this.queue.expiresAtMs) this.queue = null;
  }

  private dispatchIfReady(atMs: number): CueAnnouncement[] {
    if (!this.enabled || this.active || !this.queue) return [];
    if (atMs - this.lastDispatchAt < this.globalGapMs) return [];
    const candidate = this.queue;
    this.queue = null;
    const lastAt = this.lastCueAt.get(candidate.key);
    if (lastAt !== undefined && atMs - lastAt < candidate.cooldownMs) return [];
    const announcement: CueAnnouncement = {
      key: candidate.key,
      text: candidate.text,
      kind: candidate.kind,
      ...(candidate.fault ? { fault: candidate.fault } : {}),
      priority: candidate.priority,
      queuedAtMs: candidate.queuedAtMs,
      expiresAtMs: candidate.expiresAtMs,
    };
    this.active = announcement;
    this.lastDispatchAt = atMs;
    this.lastCueAt.set(candidate.key, atMs);
    return [announcement];
  }

  private shouldCueBreathing(repNumber: number): boolean {
    return repNumber <= this.fullCueReps || (repNumber - this.fullCueReps) % this.thenEvery === 0;
  }
}
