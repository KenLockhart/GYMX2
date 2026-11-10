// The GYMX2 compatibility engine. Deterministic and explainable: every point comes from a rule here,
// and every score says what it was based on. Shared by the server and tests.
//
// 1. Hard rules first. A coach who can't serve the member (wrong format, language, waitlist, or a
//    preference the member set) gets no score at all, never a misleading high one.
// 2. Six categories, each 0-100, or null when there isn't enough information on either side.
// 3. The total is the weighted average of the categories we could score. With less than half the
//    weight available, there is no total: "not enough information yet", never an invented number.
import type { CoachDraft } from "./coach-draft";
import { MATCH_CATEGORIES, type MatchCategory, startingMonthlyPrice } from "./coach-profile";
import type { MatchAnswers } from "./match-questions";

export const MATCH_VERSION = "2026-11-10.1";

export type MatchWeights = Record<MatchCategory, number>;
export const DEFAULT_WEIGHTS: MatchWeights = Object.fromEntries(
  MATCH_CATEGORIES.map((c) => [c.key, c.weight]),
) as MatchWeights;

export type MatchResult =
  | {
      eligible: false;
      blockers: string[];
      version: string;
    }
  | {
      eligible: true;
      total: number | null;
      categories: Record<MatchCategory, number | null>;
      coverage: number;
      reasons: string[];
      discuss: string[];
      version: string;
    };

const one = (a: MatchAnswers, key: keyof MatchAnswers) => {
  const v = a[key];
  return typeof v === "string" ? v : undefined;
};
const many = (a: MatchAnswers, key: keyof MatchAnswers) => {
  const v = a[key];
  return Array.isArray(v) ? v : [];
};
const avg = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? Math.round(known.reduce((s, v) => s + v, 0) / known.length) : null;
};
const has = (text: string, ...words: string[]) => {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w));
};

// Which coach populations or specialty words serve each member goal.
const GOAL_FIT: Record<string, { populations: string[]; words: string[]; label: string }> = {
  lose_fat: { populations: ["Weight-loss clients"], words: ["weight", "fat"], label: "fat loss" },
  build_muscle: { populations: ["Muscle-building clients", "Bodybuilding"], words: ["muscle", "hypertrophy", "bodybuild"], label: "building muscle" },
  strength: { populations: ["Strength training"], words: ["strength", "powerlift"], label: "strength" },
  health_mobility: {
    populations: ["Mobility-focused clients", "General wellness", "Seniors"],
    words: ["mobility", "wellness", "health"],
    label: "health and mobility",
  },
  performance: { populations: ["Athletes"], words: ["athlet", "sport", "performance"], label: "athletic performance" },
  endurance: { populations: ["Functional fitness", "Athletes"], words: ["endurance", "running", "cardio", "conditioning"], label: "endurance" },
  habits: { populations: ["General wellness", "Busy professionals"], words: ["habit", "lifestyle"], label: "consistent habits" },
  confidence: { populations: ["Complete beginners", "Returning exercisers"], words: ["beginner", "confidence"], label: "gym confidence" },
};

const ACCOUNTABILITY_ORDER = ["daily", "several", "weekly", "on_request"];
const COACH_ACCOUNTABILITY: Record<string, string> = {
  daily: "daily",
  several: "several",
  weekly: "weekly",
  independent: "on_request",
};

const RELATIONSHIP_FIT: Record<string, { relationship: string[]; communication: string[] }> = {
  friendly: { relationship: ["companion", "mentor"], communication: ["friendly", "high_energy"] },
  professional: { relationship: ["partner", "educator"], communication: ["direct"] },
  mentor: { relationship: ["mentor", "educator"], communication: ["educational"] },
  accountability: { relationship: ["partner"], communication: ["direct"] },
};

const BUDGET_MAX: Record<string, number | null> = {
  under_75: 7500,
  "75_150": 15000,
  "150_250": 25000,
  "250_plus": null,
  flexible: null,
};

const ZONE_OFFSET: Record<string, number> = {
  "America/New_York": -5,
  "America/Chicago": -6,
  "America/Denver": -7,
  "America/Phoenix": -7,
  "America/Los_Angeles": -8,
  "America/Anchorage": -9,
  "Pacific/Honolulu": -10,
};

function styleScore(member: string | undefined, coach: { primary: string | null; secondary: string | null }) {
  if (!member || !coach.primary) return null;
  if (coach.primary === member) return 100;
  if (coach.secondary === member) return 75;
  return 25;
}

// Hard rules: things that make a coach unable to serve this member right now.
export function blockersFor(answers: MatchAnswers, coach: CoachDraft): string[] {
  const blockers: string[] = [];
  if (!coach.acceptingClients) blockers.push("Not taking new clients right now (waitlist only).");
  const location = one(answers, "location");
  if (location === "in_person" && !coach.formats.includes("in_person"))
    blockers.push("Only coaches online, and you asked for in-person training.");
  if (location === "online" && coach.formats.length > 0 && !coach.formats.includes("online"))
    blockers.push("Only coaches in person, and you asked for online training.");
  const language = one(answers, "language");
  if (language === "spanish" && !has(coach.availability.languages, "spanish", "español", "espanol"))
    blockers.push("Doesn't list Spanish, which you asked for.");
  const gender = one(answers, "coach_gender");
  if ((gender === "woman" || gender === "man") && coach.identity !== gender)
    blockers.push(`You asked for a coach who is a ${gender}.`);
  return blockers;
}

export function computeMatch(
  answers: MatchAnswers,
  coach: CoachDraft,
  weights: MatchWeights = DEFAULT_WEIGHTS,
): MatchResult {
  const blockers = blockersFor(answers, coach);
  if (blockers.length) return { eligible: false, blockers, version: MATCH_VERSION };

  const reasons: { weight: number; text: string }[] = [];
  const discuss: string[] = [];
  const populations = new Set<string>(coach.populations.map((p) => p.label));
  const coachText = [coach.specialties.join(" "), coach.results.expertise.join(" "), coach.headline].join(" ");

  // 1. Training goals.
  const goals = many(answers, "goals");
  const wantedSpecialties = many(answers, "specialties");
  let goalsScore: number | null = null;
  if ((goals.length || wantedSpecialties.length) && (populations.size || coach.specialties.length)) {
    const covered = goals.filter((g) => {
      const fit = GOAL_FIT[g];
      return fit && (fit.populations.some((p) => populations.has(p)) || has(coachText, ...fit.words));
    });
    const specialtyHits = wantedSpecialties.filter((s) => populations.has(s));
    const parts = [
      goals.length ? (covered.length / goals.length) * 100 : null,
      wantedSpecialties.length ? (specialtyHits.length / wantedSpecialties.length) * 100 : null,
    ];
    goalsScore = avg(parts);
    if (covered.length)
      reasons.push({
        weight: 3,
        text: `Works with people focused on ${covered.map((g) => GOAL_FIT[g].label).join(" and ")}, like you.`,
      });
    const missed = goals.filter((g) => !covered.includes(g));
    if (missed.length)
      discuss.push(`Ask about ${missed.map((g) => GOAL_FIT[g]?.label ?? g).join(" and ")}: it isn't one of their listed focuses.`);
  }

  // 2. Coaching personality: motivation style, love language and the relationship you want.
  const motivation = styleScore(one(answers, "motivation"), coach.style.motivation);
  const lovePrimary = one(answers, "love_primary");
  const loveSecondary = one(answers, "love_secondary");
  let love: number | null = null;
  if (lovePrimary && coach.loveLanguages.primary) {
    if (lovePrimary === coach.loveLanguages.primary) love = 100;
    else if (lovePrimary === coach.loveLanguages.secondary) love = 80;
    else if (loveSecondary && loveSecondary === coach.loveLanguages.primary) love = 70;
    else if (loveSecondary && loveSecondary === coach.loveLanguages.secondary) love = 55;
    else love = 25;
  }
  const wantedRelationship = one(answers, "relationship");
  let relationship: number | null = null;
  if (wantedRelationship && coach.style.relationship.primary) {
    const fit = RELATIONSHIP_FIT[wantedRelationship];
    const r = [coach.style.relationship.primary, coach.style.relationship.secondary];
    const c = [coach.style.communication.primary, coach.style.communication.secondary];
    relationship =
      fit.relationship.includes(r[0] ?? "") ? 100
      : fit.relationship.includes(r[1] ?? "") || fit.communication.includes(c[0] ?? "") ? 75
      : fit.communication.includes(c[1] ?? "") ? 55
      : 30;
  }
  const personality = avg([motivation, love, relationship]);
  if (motivation === 100) reasons.push({ weight: 2, text: "Their main coaching style is the one you said brings out your best." });
  if (love !== null && love >= 80) reasons.push({ weight: 2, text: "They motivate people the way your Coaching Love Language describes." });
  if (motivation !== null && motivation < 50) discuss.push("Their coaching style differs from the one you picked; ask how they'd adapt.");

  // 3. Schedule: when you train, against when they coach, and time zones.
  const when = many(answers, "schedule");
  const slots = coach.availability.schedule.map((s) => `${s.days} ${s.hours}`).join(" ");
  let timing: number | null = null;
  if (when.length && slots.trim()) {
    const lower = slots.toLowerCase();
    const offers = {
      early: /\b([4-8])(:\d\d)?\s*(am|a\.m\.)/.test(lower) || has(lower, "morning", "early"),
      daytime: /\b(9|10|11|12|1|2|3)(:\d\d)?\s*(am|pm|a\.m\.|p\.m\.)/.test(lower) || has(lower, "daytime", "afternoon", "noon", "midday"),
      evening: /\b([5-9]|10)(:\d\d)?\s*(pm|p\.m\.)/.test(lower) || has(lower, "evening", "night"),
      weekend: has(lower, "sat", "sun", "weekend"),
    } as Record<string, boolean>;
    const hits = when.filter((w) => offers[w]);
    timing = Math.round((hits.length / when.length) * 100);
    const misses = when.filter((w) => !offers[w]);
    if (misses.length)
      discuss.push(`Their listed hours may not cover ${misses.map((m) => ({ early: "early mornings", daytime: "daytime", evening: "evenings", weekend: "weekends" })[m]).join(" or ")}.`);
    else reasons.push({ weight: 1, text: "Their hours line up with when you like to train." });
  }
  const zone = one(answers, "time_zone");
  let zoneScore: number | null = null;
  if (zone && coach.availability.timeZone) {
    const diff = Math.abs((ZONE_OFFSET[zone] ?? 0) - (ZONE_OFFSET[coach.availability.timeZone] ?? 0));
    zoneScore = diff === 0 ? 100 : diff <= 1 ? 85 : diff <= 3 ? 60 : 40;
    if (diff >= 2) discuss.push("You're in different time zones; check live session times.");
  }
  const schedule = timing === null ? null : avg([timing, zoneScore]);

  // 4. Communication: how much accountability and how you like to train online.
  const accountability = one(answers, "accountability");
  let accountabilityScore: number | null = null;
  const coachAcc = [coach.style.accountability.primary, coach.style.accountability.secondary].map((v) =>
    v ? COACH_ACCOUNTABILITY[v] : null,
  );
  if (accountability && coachAcc[0]) {
    if (coachAcc[0] === accountability) accountabilityScore = 100;
    else if (coachAcc[1] === accountability) accountabilityScore = 80;
    else {
      const gap = Math.abs(ACCOUNTABILITY_ORDER.indexOf(accountability) - ACCOUNTABILITY_ORDER.indexOf(coachAcc[0]));
      accountabilityScore = gap === 1 ? 65 : 30;
    }
    if (accountabilityScore >= 80) reasons.push({ weight: 1, text: "They check in about as often as you want." });
    else if (accountabilityScore < 50) discuss.push("Agree how often you'll check in: your preference and theirs differ.");
  }
  const mode = one(answers, "training_mode");
  let modeScore: number | null = null;
  if (mode && mode !== "unsure" && coach.coaching.included.length) {
    const live = coach.coaching.included.some((s) => s === "Live one-on-one video sessions" || s === "In-person sessions");
    const plans = coach.coaching.included.some((s) => s === "Personalized training plans" || s === "Prerecorded workout library");
    modeScore =
      mode === "live" ? (live ? 100 : 25)
      : mode === "async" ? (plans ? 100 : 40)
      : live && plans ? 100 : live || plans ? 60 : 30;
    if (mode === "live" && !live) discuss.push("You want live sessions, and they don't list them.");
  }
  const communication = avg([accountabilityScore, modeScore]);

  // 5. Experience with your needs: your level, any adaptations you need, years coaching.
  const level = one(answers, "experience");
  let levelScore: number | null = null;
  if (level && (populations.size || coach.experienceYears !== null)) {
    const years = coach.experienceYears ?? 0;
    levelScore =
      level === "beginner" ? (populations.has("Complete beginners") ? 100 : 50)
      : level === "returning" ? (populations.has("Returning exercisers") ? 100 : populations.has("Complete beginners") ? 75 : 50)
      : level === "intermediate" ? (years >= 3 ? 90 : 60)
      : populations.has("Athletes") || populations.has("Bodybuilding") || years >= 8 ? 100 : years >= 4 ? 70 : 45;
    if (levelScore === 100) reasons.push({ weight: 2, text: "They work with people at your experience level." });
  }
  const needs = many(answers, "accessibility");
  let needsScore: number | null = null;
  if (needs.length) {
    const offered = (n: string) =>
      n === "postpartum"
        ? populations.has("Postpartum clients")
        : !!coach.availability.accessibility || populations.has("People with disabilities") || populations.has("Seniors");
    needsScore = Math.round((needs.filter(offered).length / needs.length) * 100);
    if (needsScore < 100) discuss.push("Ask how they'd adapt training to what you need; it isn't spelled out on their profile.");
  }
  const experience = avg([levelScore, needsScore]);

  // 6. Budget: their cheapest monthly option against yours.
  const budget = one(answers, "budget");
  const price = startingMonthlyPrice(
    coach.packages.map((p) => ({ ...p, billing: "", featured: p.featured })),
  );
  let budgetScore: number | null = null;
  if (budget && price !== null) {
    const max = BUDGET_MAX[budget];
    if (max === null || max === undefined || price <= max) budgetScore = 100;
    else if (price <= max * 1.25) {
      budgetScore = 55;
      discuss.push("Their plans start a little above your budget; ask what's included.");
    } else {
      budgetScore = 15;
      discuss.push("Their plans start well above your budget.");
    }
    if (budgetScore === 100) reasons.push({ weight: 1, text: "Their plans fit your budget." });
  }

  const categories: Record<MatchCategory, number | null> = {
    goals: goalsScore,
    personality,
    schedule,
    communication,
    experience,
    budget: budgetScore,
  };
  const totalWeight = MATCH_CATEGORIES.reduce((s, c) => s + weights[c.key], 0);
  const known = MATCH_CATEGORIES.filter((c) => categories[c.key] !== null);
  const knownWeight = known.reduce((s, c) => s + weights[c.key], 0);
  const coverage = totalWeight ? Math.round((knownWeight / totalWeight) * 100) : 0;
  const total =
    knownWeight > 0 && coverage >= 50
      ? Math.round(known.reduce((s, c) => s + (categories[c.key] as number) * weights[c.key], 0) / knownWeight)
      : null;

  if (one(answers, "trial_first") === "yes")
    discuss.push("You wanted to meet first: ask for an intro session before you commit.");

  return {
    eligible: true,
    total,
    categories,
    coverage,
    reasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 4).map((r) => r.text),
    discuss: discuss.slice(0, 4),
    version: MATCH_VERSION,
  };
}

// Checks admin-entered weights: whole numbers 0-100 that add up to 100.
export function validWeights(weights: Record<string, unknown>): weights is MatchWeights {
  const values = MATCH_CATEGORIES.map((c) => weights[c.key]);
  return (
    values.every((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100) &&
    values.reduce((s: number, v) => s + (v as number), 0) === 100
  );
}
