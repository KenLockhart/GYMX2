import { describe, expect, it } from "vitest";
import { CurlCueScheduler, DEFAULT_CURL_CUES } from "./cues";

describe("deterministic curl cue scheduler", () => {
  it("waits for 300 ms of fault persistence before announcing a cue", () => {
    const scheduler = new CurlCueScheduler();
    expect(scheduler.handle({ type: "frame", atMs: 0, faults: ["elbow_drift"] })).toEqual([]);
    expect(scheduler.handle({ type: "frame", atMs: 299, faults: ["elbow_drift"] })).toEqual([]);
    expect(scheduler.handle({ type: "frame", atMs: 300, faults: ["elbow_drift"] })[0]?.key).toBe("elbows_pinned");
  });

  it("announces a fault after it appears on two consecutive reps", () => {
    const scheduler = new CurlCueScheduler();
    expect(scheduler.handle({ type: "rep_completed", atMs: 100, repNumber: 1, faults: ["torso_swing"] })).toEqual([]);
    expect(scheduler.handle({ type: "rep_completed", atMs: 500, repNumber: 2, faults: ["torso_swing"] })[0]?.key).toBe("no_swing");
  });

  it("resolves batched simultaneous candidates by explicit priority", () => {
    const cues = DEFAULT_CURL_CUES.map((cue) => cue.fault === "elbow_drift" ? { ...cue, minPersistMs: 0 } : cue);
    const scheduler = new CurlCueScheduler({ cues });
    const emitted = scheduler.handleEvents([
      { type: "frame", atMs: 0, faults: [], phaseStarted: "concentric", repNumber: 1 },
      { type: "frame", atMs: 0, faults: ["elbow_drift"] },
    ]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ key: "elbows_pinned", priority: 1 });
  });

  it("keeps cues non-overlapping, enforces the global gap, and uses only one queue slot", () => {
    const scheduler = new CurlCueScheduler();
    expect(scheduler.handle({ type: "frame", atMs: 0, faults: [], phaseStarted: "concentric", repNumber: 1 })[0]?.key).toBe("exhale");
    expect(scheduler.handle({ type: "frame", atMs: 1000, faults: ["elbow_drift"] })).toEqual([]);
    expect(scheduler.handle({ type: "frame", atMs: 1300, faults: ["elbow_drift"] })).toEqual([]);
    expect(scheduler.queuedCue?.key).toBe("elbows_pinned");
    expect(scheduler.handle({ type: "frame", atMs: 2000, faults: ["elbow_drift", "torso_swing"] })).toEqual([]);
    expect(scheduler.queuedCue?.key).toBe("elbows_pinned");
    expect(scheduler.handle({ type: "cue_finished", atMs: 2400 })).toEqual([]);
    expect(scheduler.advance(2499)).toEqual([]);
    expect(scheduler.advance(2500)[0]?.key).toBe("elbows_pinned");
    expect(scheduler.activeCue?.key).toBe("elbows_pinned");
  });

  it("drops a stale queued cue rather than playing it late", () => {
    const scheduler = new CurlCueScheduler({ maxQueueAgeMs: 1000 });
    scheduler.handle({ type: "frame", atMs: 0, faults: [], phaseStarted: "concentric", repNumber: 1 });
    scheduler.handle({ type: "frame", atMs: 10, faults: ["elbow_drift"] });
    scheduler.handle({ type: "frame", atMs: 310, faults: ["elbow_drift"] });
    expect(scheduler.queuedCue?.key).toBe("elbows_pinned");
    scheduler.advance(1311);
    expect(scheduler.queuedCue).toBeNull();
    expect(scheduler.handle({ type: "cue_finished", atMs: 1400 })).toEqual([]);
  });

  it("re-announces a continuously present frame fault after its four-second cooldown", () => {
    const scheduler = new CurlCueScheduler({ globalGapMs: 0, maxQueueAgeMs: 5000 });
    expect(scheduler.handle({ type: "frame", atMs: 0, faults: ["elbow_drift"] })).toEqual([]);
    expect(scheduler.handle({ type: "frame", atMs: 300, faults: ["elbow_drift"] })[0]?.key).toBe("elbows_pinned");
    scheduler.handle({ type: "cue_finished", atMs: 301 });
    expect(scheduler.handle({ type: "frame", atMs: 4300, faults: ["elbow_drift"] })[0]?.key).toBe("elbows_pinned");
  });

  it("re-arms a persistent fault after its queued cue expires or is replaced", () => {
    const scheduler = new CurlCueScheduler({ globalGapMs: 0, maxQueueAgeMs: 1000 });
    scheduler.handle({ type: "frame", atMs: 0, faults: [], phaseStarted: "concentric", repNumber: 1 });
    scheduler.handle({ type: "frame", atMs: 100, faults: ["short_rom_top"] });
    scheduler.handle({ type: "frame", atMs: 400, faults: ["short_rom_top"] });
    expect(scheduler.queuedCue?.key).toBe("full_range_up");
    scheduler.handle({ type: "frame", atMs: 500, faults: ["short_rom_top", "elbow_drift"] });
    scheduler.handle({ type: "frame", atMs: 800, faults: ["short_rom_top", "elbow_drift"] });
    expect(scheduler.queuedCue?.key).toBe("elbows_pinned");
    scheduler.advance(1801);
    scheduler.handle({ type: "cue_finished", atMs: 1900 });
    expect(scheduler.handle({ type: "frame", atMs: 2000, faults: ["short_rom_top"] })[0]?.key).toBe("full_range_up");
  });

  it("drops queued fault cues when the fault clears and breathing cues when their phase goes stale", () => {
    const faultScheduler = new CurlCueScheduler({ globalGapMs: 0 });
    faultScheduler.handle({ type: "frame", atMs: 0, faults: [], phaseStarted: "concentric", repNumber: 1 });
    faultScheduler.handle({ type: "frame", atMs: 100, faults: ["elbow_drift"] });
    faultScheduler.handle({ type: "frame", atMs: 400, faults: ["elbow_drift"] });
    expect(faultScheduler.queuedCue?.key).toBe("elbows_pinned");
    faultScheduler.handle({ type: "frame", atMs: 500, faults: [] });
    expect(faultScheduler.queuedCue).toBeNull();

    const breathingScheduler = new CurlCueScheduler({ globalGapMs: 0 });
    breathingScheduler.handle({ type: "frame", atMs: 0, faults: [], phaseStarted: "concentric", repNumber: 1 });
    breathingScheduler.handle({ type: "frame", atMs: 100, faults: [], phaseStarted: "eccentric", repNumber: 1 });
    expect(breathingScheduler.queuedCue?.key).toBe("inhale");
    breathingScheduler.handle({ type: "frame", atMs: 200, faults: [], phaseStarted: "concentric", repNumber: 1 });
    expect(breathingScheduler.queuedCue).toBeNull();
  });

  it("removes a queued stall warning when the stall resolves before the active cue finishes", () => {
    const scheduler = new CurlCueScheduler({ globalGapMs: 0 });
    expect(scheduler.handle({ type: "frame", atMs: 0, faults: [], phaseStarted: "concentric", repNumber: 1 })[0]?.key).toBe("exhale");
    scheduler.handle({ type: "frame", atMs: 100, faults: [], stalledMs: 2500 });
    expect(scheduler.queuedCue?.key).toBe("keep_breathing");
    scheduler.handle({ type: "frame", atMs: 200, faults: [], stalledMs: 0 });
    expect(scheduler.queuedCue).toBeNull();
    scheduler.handle({ type: "cue_finished", atMs: 300 });
    expect(scheduler.advance(3000)).toEqual([]);
  });

  it("re-cues the same rep fault after cooldown on a later rep", () => {
    const scheduler = new CurlCueScheduler({ globalGapMs: 0 });
    expect(scheduler.handle({ type: "rep_completed", atMs: 0, repNumber: 1, faults: ["torso_swing"] })).toEqual([]);
    expect(scheduler.handle({ type: "rep_completed", atMs: 1000, repNumber: 2, faults: ["torso_swing"] })[0]?.key).toBe("no_swing");
    scheduler.handle({ type: "cue_finished", atMs: 1001 });
    expect(scheduler.handle({ type: "rep_completed", atMs: 2000, repNumber: 3, faults: ["torso_swing"] })).toEqual([]);
    expect(scheduler.handle({ type: "rep_completed", atMs: 5000, repNumber: 4, faults: ["torso_swing"] })[0]?.key).toBe("no_swing");
  });

  it("praises at most every third clean rep", () => {
    const scheduler = new CurlCueScheduler();
    expect(scheduler.handle({ type: "rep_completed", atMs: 0, repNumber: 1, faults: [] })).toEqual([]);
    expect(scheduler.handle({ type: "rep_completed", atMs: 1000, repNumber: 2, faults: [] })).toEqual([]);
    expect(scheduler.handle({ type: "rep_completed", atMs: 2000, repNumber: 3, faults: [] })[0]?.key).toBe("good_rep");
    scheduler.handle({ type: "cue_finished", atMs: 2100 });
    expect(scheduler.handle({ type: "rep_completed", atMs: 3000, repNumber: 4, faults: [] })).toEqual([]);
    expect(scheduler.handle({ type: "rep_completed", atMs: 4000, repNumber: 5, faults: [] })).toEqual([]);
    expect(scheduler.handle({ type: "rep_completed", atMs: 6000, repNumber: 6, faults: [] })[0]?.key).toBe("good_rep");
  });

  it("cues breathing on the first three reps, then every third rep, and handles stalls over two seconds", () => {
    const scheduler = new CurlCueScheduler();
    const received: string[] = [];
    for (const repNumber of [1, 2, 3, 4, 5, 6]) {
      const atMs = (repNumber - 1) * 5000;
      const announcements = scheduler.handle({ type: "frame", atMs, faults: [], phaseStarted: "concentric", repNumber });
      received.push(...announcements.map(({ key }) => key));
      if (announcements.length) scheduler.handle({ type: "cue_finished", atMs: atMs + 100 });
    }
    expect(received).toEqual(["exhale", "exhale", "exhale", "exhale"]);

    const stalled = new CurlCueScheduler();
    expect(stalled.handle({ type: "frame", atMs: 0, faults: [], stalledMs: 2000 })).toEqual([]);
    expect(stalled.handle({ type: "frame", atMs: 100, faults: [], stalledMs: 2001 })[0]?.key).toBe("keep_breathing");
    expect(stalled.handle({ type: "frame", atMs: 200, faults: [], stalledMs: 2500 })).toEqual([]);
  });

  it("suppresses all cues when disabled while leaving scoring outside the scheduler", () => {
    const scheduler = new CurlCueScheduler({ enabled: false });
    expect(scheduler.handle({ type: "frame", atMs: 0, faults: ["elbow_drift"], phaseStarted: "concentric", repNumber: 1 })).toEqual([]);
    expect(scheduler.handle({ type: "frame", atMs: 500, faults: ["elbow_drift"], stalledMs: 2500 })).toEqual([]);
    expect(scheduler.activeCue).toBeNull();
  });
});
