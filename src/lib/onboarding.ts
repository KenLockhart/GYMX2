import type { Pillar } from "@/lib/achievements";

// The goals members pick and coaches specialize in. Each belongs to a Mind/Body/Spirit pillar.
export const GOALS = [
  { value: "lose_weight", label: "Lose weight", pillar: "body" },
  { value: "build_muscle", label: "Build muscle and strength", pillar: "body" },
  { value: "get_fit", label: "Get fitter and build endurance", pillar: "body" },
  { value: "mobility", label: "Move better and recover", pillar: "body" },
  { value: "eat_better", label: "Eat better", pillar: "body" },
  { value: "reduce_stress", label: "Manage stress", pillar: "mind" },
  { value: "sleep_better", label: "Sleep better", pillar: "mind" },
  { value: "build_habits", label: "Build habits that stick", pillar: "mind" },
  {
    value: "find_purpose",
    label: "Find purpose and motivation",
    pillar: "spirit",
  },
  { value: "grow_spiritually", label: "Grow spiritually", pillar: "spirit" },
] as const satisfies readonly {
  value: string;
  label: string;
  pillar: Pillar;
}[];

export type Goal = (typeof GOALS)[number]["value"];
export const GOAL_VALUES = GOALS.map((goal) => goal.value) as [Goal, ...Goal[]];

export const EXPERIENCE = [
  { value: "new", label: "New to this", hint: "Just getting started" },
  { value: "some", label: "Some experience", hint: "I've trained on and off" },
  {
    value: "experienced",
    label: "Experienced",
    hint: "Training is part of my life",
  },
] as const;
export type Experience = (typeof EXPERIENCE)[number]["value"];

export function goalLabel(value: string) {
  return GOALS.find((goal) => goal.value === value)?.label ?? value;
}

export function experienceLabel(value: string | null | undefined) {
  return EXPERIENCE.find((item) => item.value === value)?.label ?? null;
}

export type CoachCandidate = {
  id: string;
  specialties: string[];
  programs: number;
};
export type Match = { id: string; score: number; shared: Goal[] };

// Coaches ranked for a member: 2 points per shared goal, 1 per specialty in their main pillar,
// and a small nudge for coaches with programs ready to start.
export function matchCoaches(
  member: { goals: string[]; focus: Pillar | null },
  coaches: CoachCandidate[],
  limit = 3,
): Match[] {
  const wanted = new Set(member.goals);
  return coaches
    .map((coach) => {
      const shared = GOALS.filter(
        (goal) =>
          wanted.has(goal.value) && coach.specialties.includes(goal.value),
      ).map((goal) => goal.value);
      const inFocus = member.focus
        ? GOALS.filter(
            (goal) =>
              goal.pillar === member.focus &&
              coach.specialties.includes(goal.value),
          ).length
        : 0;
      const score =
        shared.length * 2 + inFocus + (coach.programs > 0 ? 0.5 : 0);
      return { id: coach.id, score, shared };
    })
    .filter((match) => match.shared.length > 0 || match.score >= 1)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
