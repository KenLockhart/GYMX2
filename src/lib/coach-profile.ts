// The coach profile shown to members: the 12 sections from the Coach Discovery plan. Shared by the
// server and the browser. PR 1 renders the labeled Coach Jasmine sample; real coaches fill the
// same shape from their profile data in PR 2.

export const LOVE_LANGUAGES = [
  {
    value: "encouragement",
    label: "Words of Encouragement",
    description: "Positive reinforcement, patience and celebrating small wins.",
  },
  {
    value: "tough_love",
    label: "Tough Love & Accountability",
    description:
      "Direct feedback, firm expectations and steady accountability.",
  },
  {
    value: "education",
    label: "Education & Understanding",
    description: "Knowing why each exercise, routine and strategy works.",
  },
  {
    value: "connection",
    label: "Friendly Connection",
    description: "Conversation, rapport, humor and a supportive relationship.",
  },
  {
    value: "milestones",
    label: "Results & Milestones",
    description:
      "Measurable progress, goals, achievements and performance data.",
  },
] as const;
export type LoveLanguage = (typeof LOVE_LANGUAGES)[number]["value"];

export function loveLanguage(value: LoveLanguage) {
  return LOVE_LANGUAGES.find((item) => item.value === value)!;
}

// The six compatibility categories and their starting weights (percent). Admins can change the
// weights once the matching engine ships; the category list stays fixed.
export const MATCH_CATEGORIES = [
  { key: "goals", label: "Training goals", weight: 25 },
  { key: "personality", label: "Coaching personality", weight: 20 },
  { key: "schedule", label: "Schedule", weight: 15 },
  { key: "communication", label: "Communication", weight: 15 },
  { key: "experience", label: "Experience with your needs", weight: 15 },
  { key: "budget", label: "Budget", weight: 10 },
] as const;
export type MatchCategory = (typeof MATCH_CATEGORIES)[number]["key"];

export type MatchSummary = {
  total: number;
  categories: Record<MatchCategory, number>;
  reasons: string[];
  discuss: string[];
};

// The total as a weighted average of the category scores, rounded to a whole percent.
export function weightedTotal(categories: Record<MatchCategory, number>) {
  const sum = MATCH_CATEGORIES.reduce(
    (total, category) => total + categories[category.key] * category.weight,
    0,
  );
  const weights = MATCH_CATEGORIES.reduce((total, c) => total + c.weight, 0);
  return Math.round(sum / weights);
}

export type CredentialStatus = "verified" | "pending" | "unverified";

export type CoachPackage = {
  name: string;
  kind:
    "intro" | "single" | "package" | "monthly" | "group" | "premium" | "trial";
  priceCents: number;
  billing: string;
  sessions: string;
  duration: string;
  includes: string[];
  featured?: boolean;
};

export type CoachProfileView = {
  id: string;
  // Fictional demonstration data: every rating, price, credential and result is labeled.
  sample: boolean;
  name: string;
  firstName: string;
  photoUrl: string | null;
  headline: string;
  verification: CredentialStatus;
  specialties: string[];
  location: string;
  formats: ("online" | "in_person")[];
  rating: { average: number; count: number } | null;
  experienceYears: number;
  match: MatchSummary | null;
  about: {
    intro: string[];
    threeWords: string[];
    prompts: { prompt: string; answer: string }[];
    interests: string[];
    funFacts: string[];
    quote: string;
  };
  idealClient: string;
  populations: { label: string; note: string }[];
  betterServedBy: string;
  style: {
    traits: string[];
    attributes: { label: string; primary: string; secondary?: string }[];
    note: string;
  };
  loveLanguages: { primary: LoveLanguage; secondary: LoveLanguage };
  coaching: {
    included: string[];
    details: { label: string; value: string }[];
  };
  results: {
    expertise: string[];
    methodology: string;
    stories: { title: string; summary: string }[];
  };
  nutrition: {
    offers: string[];
    qualifications: string;
    scope: string;
  };
  availability: {
    acceptingClients: boolean;
    timeZone: string;
    schedule: { days: string; hours: string }[];
    details: { label: string; value: string }[];
  };
  packages: CoachPackage[];
  policies: { label: string; value: string }[];
  credentials: {
    title: string;
    organization: string;
    status: CredentialStatus;
    detail: string;
  }[];
  reviews: {
    categories: { label: string; score: number }[];
    items: {
      author: string;
      date: string;
      format: string;
      goal: string;
      rating: number;
      body: string;
      reply: string | null;
    }[];
  };
  video: { prompts: string[] };
  intro: {
    title: string;
    priceCents: number;
    minutes: number;
    formats: string[];
    cancellation: string;
    questions: string[];
  };
};

// The lowest recurring monthly price, which is the only honest "starting price": intro calls
// and single sessions aren't the price of coaching.
export function startingMonthlyPrice(packages: CoachPackage[]) {
  const monthly = packages
    .filter((item) => item.kind === "monthly" || item.kind === "premium")
    .map((item) => item.priceCents);
  return monthly.length ? Math.min(...monthly) : null;
}

export function formatPrice(cents: number) {
  if (cents === 0) return "Free";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatsLabel(formats: CoachProfileView["formats"]) {
  if (formats.includes("online") && formats.includes("in_person"))
    return "Online & in-person";
  return formats.includes("online") ? "Online" : "In-person";
}
