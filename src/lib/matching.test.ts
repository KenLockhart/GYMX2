import { describe, expect, it } from "vitest";
import { emptyDraft, type CoachDraft } from "./coach-draft";
import type { MatchAnswers } from "./match-questions";
import { blockersFor, computeMatch, DEFAULT_WEIGHTS, MATCH_VERSION, validWeights } from "./matching";

function coach(change: (d: CoachDraft) => void = () => {}) {
  const d = emptyDraft();
  d.formats = ["online", "in_person"];
  d.specialties = ["Strength", "Weight Loss"];
  d.populations = [
    { label: "Complete beginners", note: "" },
    { label: "Weight-loss clients", note: "" },
    { label: "Strength training", note: "" },
  ];
  d.style.motivation = { primary: "encouraging", secondary: "calm" };
  d.style.communication = { primary: "friendly", secondary: "educational" };
  d.style.accountability = { primary: "weekly", secondary: "several" };
  d.style.relationship = { primary: "mentor", secondary: "educator" };
  d.loveLanguages = { primary: "encouragement", secondary: "milestones" };
  d.coaching.included = ["Personalized training plans", "Weekly check-ins", "In-app messaging"];
  d.experienceYears = 8;
  d.availability.timeZone = "America/New_York";
  d.availability.schedule = [{ days: "Mon to Thu", hours: "6:00 to 9:00 AM, 5:00 to 8:00 PM" }];
  d.packages = [
    { name: "Online", kind: "monthly", priceCents: 14900, sessions: "", duration: "", includes: [], featured: false },
  ];
  change(d);
  return d;
}

const jasmineFan: MatchAnswers = {
  motivation: "encouraging",
  accountability: "weekly",
  experience: "beginner",
  goals: ["strength", "lose_fat"],
  training_mode: "async",
  relationship: "mentor",
  love_primary: "encouragement",
  love_secondary: "milestones",
  budget: "75_150",
  schedule: ["evening"],
  time_zone: "America/New_York",
};

describe("matching engine", () => {
  it("scores a strong fit highly and explains why", () => {
    const result = computeMatch(jasmineFan, coach());
    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.coverage).toBe(100);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.version).toBe(MATCH_VERSION);
    for (const value of Object.values(result.categories)) {
      expect(value).not.toBeNull();
      expect(value!).toBeGreaterThanOrEqual(0);
      expect(value!).toBeLessThanOrEqual(100);
    }
  });

  it("scores a poor fit low and lists what to discuss", () => {
    const result = computeMatch(
      {
        ...jasmineFan,
        motivation: "demanding",
        accountability: "daily",
        goals: ["performance"],
        training_mode: "live",
        love_primary: "tough_love",
        love_secondary: "education",
        budget: "under_75",
        schedule: ["weekend"],
        time_zone: "America/Los_Angeles",
        relationship: "accountability",
      },
      coach(),
    );
    if (!result.eligible) throw new Error("should be eligible");
    expect(result.total).toBeLessThan(40);
    expect(result.discuss.length).toBeGreaterThan(0);
  });

  it("never scores a coach who fails a hard rule", () => {
    const waitlist = computeMatch(jasmineFan, coach((d) => (d.acceptingClients = false)));
    expect(waitlist).toMatchObject({ eligible: false });
    expect(blockersFor({ location: "in_person" }, coach((d) => (d.formats = ["online"])))).toHaveLength(1);
    expect(blockersFor({ language: "spanish" }, coach())).toHaveLength(1);
    expect(blockersFor({ language: "spanish" }, coach((d) => (d.availability.languages = "English, Spanish")))).toHaveLength(0);
    expect(blockersFor({ coach_gender: "woman" }, coach())).toHaveLength(1);
    expect(blockersFor({ coach_gender: "woman" }, coach((d) => (d.identity = "woman")))).toHaveLength(0);
    expect(blockersFor({ coach_gender: "any" }, coach())).toHaveLength(0);
  });

  it("says when there isn't enough information instead of inventing a score", () => {
    const result = computeMatch({ budget: "flexible" }, coach());
    if (!result.eligible) throw new Error("should be eligible");
    expect(result.total).toBeNull();
    expect(result.categories.goals).toBeNull();
    expect(result.coverage).toBeLessThan(50);
  });

  it("treats a skipped question as missing, not as a mismatch", () => {
    const withBudget = computeMatch(jasmineFan, coach());
    const rest = { ...jasmineFan };
    delete rest.budget;
    const without = computeMatch(rest, coach());
    if (!withBudget.eligible || !without.eligible) throw new Error("should be eligible");
    expect(without.categories.budget).toBeNull();
    expect(without.total).not.toBeNull();
    expect(without.coverage).toBeLessThan(withBudget.coverage);
  });

  it("handles budget bands", () => {
    const over = computeMatch({ ...jasmineFan, budget: "under_75" }, coach());
    const near = computeMatch({ ...jasmineFan, budget: "75_150" }, coach((d) => (d.packages[0].priceCents = 17000)));
    const flexible = computeMatch({ ...jasmineFan, budget: "flexible" }, coach((d) => (d.packages[0].priceCents = 99900)));
    if (!over.eligible || !near.eligible || !flexible.eligible) throw new Error();
    expect(over.categories.budget).toBe(15);
    expect(near.categories.budget).toBe(55);
    expect(flexible.categories.budget).toBe(100);
  });

  it("uses admin weights", () => {
    const goalsOnly = { goals: 100, personality: 0, schedule: 0, communication: 0, experience: 0, budget: 0 };
    const result = computeMatch(jasmineFan, coach(), goalsOnly);
    if (!result.eligible) throw new Error();
    expect(result.total).toBe(result.categories.goals);
  });

  it("validates weights", () => {
    expect(validWeights(DEFAULT_WEIGHTS)).toBe(true);
    expect(validWeights({ ...DEFAULT_WEIGHTS, goals: 30 })).toBe(false);
    expect(validWeights({ ...DEFAULT_WEIGHTS, goals: 25.5, budget: 9.5 })).toBe(false);
  });

  it("is deterministic", () => {
    expect(computeMatch(jasmineFan, coach())).toEqual(computeMatch(jasmineFan, coach()));
  });
});
