// The GYMX2 compatibility questionnaire. One definition drives the screens, the validation and the
// summary, and the matching engine reads the same keys. Every question can be skipped.
import { z } from "zod";
import { LOVE_LANGUAGES } from "./coach-profile";
import { TIME_ZONES } from "./coach-options";

type Option = { value: string; label: string; hint?: string };

export type Question = {
  key: string;
  title: string;
  subtitle?: string;
  kind: "single" | "multi" | "text";
  options?: readonly Option[];
  max?: number;
  core: boolean;
  // Kept private and used only for matching (for example, accessibility needs).
  privateNote?: boolean;
};

export const QUESTIONS = [
  {
    key: "motivation",
    title: "What kind of coach brings out your best?",
    kind: "single",
    core: true,
    options: [
      { value: "encouraging", label: "Encouraging and patient" },
      { value: "demanding", label: "Strict and demanding" },
      { value: "energetic", label: "Energetic and motivational" },
      { value: "calm", label: "Calm and educational" },
    ],
  },
  {
    key: "accountability",
    title: "How much accountability do you want?",
    kind: "single",
    core: true,
    options: [
      { value: "daily", label: "Daily check-ins" },
      { value: "several", label: "Several times a week" },
      { value: "weekly", label: "Weekly check-ins" },
      { value: "on_request", label: "Only when I ask for help" },
    ],
  },
  {
    key: "experience",
    title: "How would you describe your fitness experience?",
    kind: "single",
    core: true,
    options: [
      { value: "beginner", label: "Complete beginner" },
      { value: "returning", label: "Returning after a break" },
      { value: "intermediate", label: "Intermediate" },
      { value: "advanced", label: "Advanced" },
    ],
  },
  {
    key: "goals",
    title: "What are your goals?",
    subtitle: "Pick up to three.",
    kind: "multi",
    max: 3,
    core: true,
    options: [
      { value: "lose_fat", label: "Lose body fat" },
      { value: "build_muscle", label: "Build muscle" },
      { value: "strength", label: "Get stronger" },
      { value: "health_mobility", label: "Improve health and mobility" },
      { value: "performance", label: "Athletic performance" },
      { value: "endurance", label: "Build endurance" },
      { value: "habits", label: "Build consistent habits" },
      { value: "confidence", label: "Feel confident in the gym" },
    ],
  },
  {
    key: "training_mode",
    title: "How do you prefer to train online?",
    kind: "single",
    core: true,
    options: [
      { value: "live", label: "Live one-on-one video" },
      { value: "async", label: "Personalized workouts on my schedule" },
      { value: "both", label: "A combination of both" },
      { value: "unsure", label: "Not sure yet" },
    ],
  },
  {
    key: "relationship",
    title: "What kind of relationship do you want with your coach?",
    kind: "single",
    core: true,
    options: [
      { value: "friendly", label: "Friendly and conversational" },
      { value: "professional", label: "Professional and results-focused" },
      { value: "mentor", label: "Mentor and educator" },
      { value: "accountability", label: "Strong accountability partner" },
    ],
  },
  {
    key: "love_primary",
    title: "My Coaching Love Language",
    subtitle:
      "What motivates you most? This is about coaching style, not a personality test.",
    kind: "single",
    core: true,
    options: LOVE_LANGUAGES.map((l) => ({
      value: l.value,
      label: l.label,
      hint: l.description,
    })),
  },
  {
    key: "love_secondary",
    title: "And second?",
    subtitle: "Optional: a second motivation style that also works for you.",
    kind: "single",
    core: false,
    options: LOVE_LANGUAGES.map((l) => ({
      value: l.value,
      label: l.label,
      hint: l.description,
    })),
  },
  {
    key: "budget",
    title: "What's your monthly budget for coaching?",
    kind: "single",
    core: false,
    options: [
      { value: "under_75", label: "Under $75" },
      { value: "75_150", label: "$75 to $150" },
      { value: "150_250", label: "$150 to $250" },
      { value: "250_plus", label: "$250 or more" },
      { value: "flexible", label: "Flexible" },
    ],
  },
  {
    key: "schedule",
    title: "When do you usually train?",
    kind: "multi",
    max: 4,
    core: false,
    options: [
      { value: "early", label: "Early mornings" },
      { value: "daytime", label: "Daytime" },
      { value: "evening", label: "Evenings" },
      { value: "weekend", label: "Weekends" },
    ],
  },
  {
    key: "time_zone",
    title: "What's your time zone?",
    kind: "single",
    core: false,
    options: TIME_ZONES.map((t) => ({ value: t.value, label: t.label })),
  },
  {
    key: "location",
    title: "Where do you want to train with a coach?",
    kind: "single",
    core: false,
    options: [
      { value: "online", label: "Online only" },
      { value: "in_person", label: "In person" },
      { value: "either", label: "Either is fine" },
    ],
  },
  {
    key: "equipment",
    title: "What equipment do you have?",
    kind: "single",
    core: false,
    options: [
      { value: "none", label: "None, bodyweight only" },
      { value: "home", label: "Home basics (dumbbells, bands)" },
      { value: "gym", label: "Full gym" },
    ],
  },
  {
    key: "session_length",
    title: "How long should sessions be?",
    kind: "single",
    core: false,
    options: [
      { value: "30", label: "About 30 minutes" },
      { value: "45", label: "About 45 minutes" },
      { value: "60", label: "An hour" },
      { value: "any", label: "No preference" },
    ],
  },
  {
    key: "language",
    title: "Which language should your coach speak?",
    kind: "single",
    core: false,
    options: [
      { value: "english", label: "English" },
      { value: "spanish", label: "Spanish" },
      { value: "either", label: "English or Spanish" },
    ],
  },
  {
    key: "accessibility",
    title: "Anything your coach should be able to adapt to?",
    subtitle:
      "Private: used only to find coaches who offer this. Never shown on your profile.",
    kind: "multi",
    max: 4,
    core: false,
    privateNote: true,
    options: [
      { value: "low_impact", label: "Low-impact options" },
      { value: "seated", label: "Seated or adaptive exercises" },
      { value: "mobility", label: "Limited mobility" },
      { value: "postpartum", label: "Postpartum training" },
    ],
  },
  {
    key: "specialties",
    title: "Any coach specialties you want?",
    kind: "multi",
    max: 3,
    core: false,
    options: [
      { value: "Complete beginners", label: "Beginner-friendly" },
      { value: "Weight-loss clients", label: "Weight loss" },
      { value: "Strength training", label: "Strength training" },
      { value: "Bodybuilding", label: "Bodybuilding" },
      { value: "Seniors", label: "Older adults" },
      { value: "Athletes", label: "Athletes" },
      { value: "Functional fitness", label: "Functional fitness" },
      { value: "Home workout clients", label: "Home workouts" },
    ],
  },
  {
    key: "coach_gender",
    title: "Do you have a preference for your coach?",
    subtitle:
      "Optional. It only uses how coaches describe themselves, if they choose to.",
    kind: "single",
    core: false,
    options: [
      { value: "any", label: "No preference" },
      { value: "woman", label: "A woman" },
      { value: "man", label: "A man" },
    ],
  },
  {
    key: "trial_first",
    title: "Want to meet your coach before committing?",
    kind: "single",
    core: false,
    options: [
      { value: "yes", label: "Yes, an intro session first" },
      { value: "no", label: "No, I'm ready to start" },
    ],
  },
] as const satisfies readonly Question[];

export type QuestionKey = (typeof QUESTIONS)[number]["key"];

// Answers: each question optional; values must come from the question's own options.
export const answersSchema = z.object(
  Object.fromEntries(
    QUESTIONS.map((q) => {
      const values = q.options.map((o) => o.value) as [string, ...string[]];
      const value =
        q.kind === "multi"
          ? z
              .array(z.enum(values))
              .max("max" in q ? q.max : values.length)
              .optional()
          : z.enum(values).optional();
      return [q.key, value];
    }),
  ) as unknown as Record<
    QuestionKey,
    z.ZodOptional<z.ZodType<string | string[]>>
  >,
);
export type MatchAnswers = Partial<Record<QuestionKey, string | string[]>>;

export function readAnswers(data: unknown): MatchAnswers {
  const parsed = answersSchema.safeParse(data ?? {});
  if (parsed.success) return parsed.data as MatchAnswers;
  // Keep each answer that's still valid (for example after an option is retired).
  const kept: MatchAnswers = {};
  if (data && typeof data === "object") {
    for (const q of QUESTIONS) {
      const one = answersSchema.shape[q.key].safeParse(
        (data as Record<string, unknown>)[q.key],
      );
      if (one.success && one.data !== undefined) kept[q.key] = one.data;
    }
  }
  return kept;
}

export function answerLabel(
  key: QuestionKey,
  value: string | string[] | undefined,
) {
  const q = QUESTIONS.find((item) => item.key === key);
  if (!q || value === undefined || (Array.isArray(value) && value.length === 0))
    return null;
  const options = q.options as readonly Option[];
  const one = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return Array.isArray(value) ? value.map(one).join(", ") : one(value);
}

export function coreAnswered(answers: MatchAnswers) {
  const core = QUESTIONS.filter((q) => q.core);
  const done = core.filter((q) => {
    const value = answers[q.key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });
  return { done: done.length, total: core.length };
}
