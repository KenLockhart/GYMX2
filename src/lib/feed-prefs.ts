import { z } from "zod";
import { POST_KINDS, type PostKind } from "./community";

// How much a person wants of each kind of post. 1 is normal; each step moves a post about four
// hours up or down the personalized feed (see public.community_feed). It never shows or hides posts.
export const WEIGHT_STEPS = [
  { value: 0, label: "Less" },
  { value: 1, label: "Normal" },
  { value: 2, label: "More" },
  { value: 3, label: "Most" },
] as const;

export const MAX_PREFERRED_COACHES = 50;

export type FeedPreferences = {
  mode: "standard" | "personalized";
  sort: "newest" | "personalized";
  weights: Partial<Record<PostKind, number>>;
  preferredCoaches: string[];
};

export const STANDARD_PREFERENCES: FeedPreferences = {
  mode: "standard",
  sort: "newest",
  weights: {},
  preferredCoaches: [],
};

const kindValues = POST_KINDS.map((kind) => kind.value) as [
  PostKind,
  ...PostKind[],
];

export const preferencesSchema = z.object({
  mode: z.enum(["standard", "personalized"]),
  sort: z.enum(["newest", "personalized"]),
  weights: z.partialRecord(z.enum(kindValues), z.number().int().min(0).max(3)),
  preferredCoaches: z
    .array(z.uuid())
    .max(MAX_PREFERRED_COACHES, "Choose up to 50 coaches"),
});

// Only non-default weights are stored, so the row stays small and "Normal" means "not set".
export function compactWeights(weights: FeedPreferences["weights"]) {
  return Object.fromEntries(
    Object.entries(weights).filter(
      ([kind, weight]) =>
        kindValues.includes(kind as PostKind) &&
        Number.isInteger(weight) &&
        weight !== 1,
    ),
  ) as FeedPreferences["weights"];
}

// Reads a stored row (or none) back into preferences, ignoring anything unexpected.
export function readPreferences(
  row: {
    mode?: unknown;
    sort?: unknown;
    topic_weights?: unknown;
    preferred_coaches?: unknown;
  } | null,
): FeedPreferences {
  if (!row) return STANDARD_PREFERENCES;
  const weights: FeedPreferences["weights"] = {};
  if (row.topic_weights && typeof row.topic_weights === "object") {
    for (const [kind, weight] of Object.entries(row.topic_weights)) {
      if (
        kindValues.includes(kind as PostKind) &&
        typeof weight === "number" &&
        Number.isInteger(weight) &&
        weight >= 0 &&
        weight <= 3
      )
        weights[kind as PostKind] = weight;
    }
  }
  return {
    mode: row.mode === "personalized" ? "personalized" : "standard",
    sort: row.sort === "personalized" ? "personalized" : "newest",
    weights,
    preferredCoaches: Array.isArray(row.preferred_coaches)
      ? row.preferred_coaches.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
  };
}
