// A coach's editable profile: validation for saving a draft, the checks before submitting, the
// completion meter and the conversion into what members see. Shared by the server and browser.
import { z } from "zod";
import {
  BIO_PROMPTS,
  COACH_STYLE,
  COACHING_DETAIL_FIELDS,
  NUTRITION_SUPPORT,
  PACKAGE_KINDS,
  POLICY_FIELDS,
  POPULATIONS,
  SERVICES,
  STYLE_KEYS,
  TIME_ZONES,
  optionLabel,
  timeZoneLabel,
} from "./coach-options";
import {
  type CoachPackage,
  type CoachProfileView,
  type CredentialStatus,
  LOVE_LANGUAGES,
} from "./coach-profile";

const text = (max: number) => z.string().trim().max(max).default("");
const list = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item).max(max).default([]);
const oneOf = <T extends readonly string[]>(values: T) =>
  z.enum(values as unknown as [T[number], ...T[number][]]);

const styleChoice = (key: keyof typeof COACH_STYLE) => {
  const values = COACH_STYLE[key].options.map((o) => o.value) as [
    string,
    ...string[],
  ];
  return z
    .object({
      primary: z.enum(values).nullable().default(null),
      secondary: z.enum(values).nullable().default(null),
    })
    .default({ primary: null, secondary: null });
};

const loveValues = LOVE_LANGUAGES.map((l) => l.value) as [string, ...string[]];

export const coachDraftSchema = z.object({
  headline: text(160),
  location: text(80),
  formats: list(z.enum(["online", "in_person"]), 2),
  experienceYears: z.number().int().min(0).max(60).nullable().default(null),
  specialties: list(z.string().trim().min(1).max(30), 3),
  acceptingClients: z.boolean().default(true),
  // Optional and never displayed: used only when a member asks for a coach who is a woman or a man.
  identity: z.enum(["woman", "man", "nonbinary"]).nullable().default(null),
  about: z
    .object({
      intro: text(2000),
      threeWords: list(z.string().trim().min(1).max(20), 3),
      prompts: list(
        z.object({ prompt: oneOf(BIO_PROMPTS), answer: text(500) }),
        BIO_PROMPTS.length,
      ),
      interests: list(z.string().trim().min(1).max(40), 8),
      funFacts: list(z.string().trim().min(1).max(120), 4),
      quote: text(200),
    })
    .default({
      intro: "",
      threeWords: [],
      prompts: [],
      interests: [],
      funFacts: [],
      quote: "",
    }),
  idealClient: text(500),
  populations: list(
    z.object({ label: oneOf(POPULATIONS), note: text(200) }),
    POPULATIONS.length,
  ),
  betterServedBy: text(500),
  style: z
    .object({
      motivation: styleChoice("motivation"),
      structure: styleChoice("structure"),
      communication: styleChoice("communication"),
      accountability: styleChoice("accountability"),
      relationship: styleChoice("relationship"),
      traits: list(z.string().trim().min(1).max(40), 8),
      note: text(300),
    })
    .default({
      motivation: { primary: null, secondary: null },
      structure: { primary: null, secondary: null },
      communication: { primary: null, secondary: null },
      accountability: { primary: null, secondary: null },
      relationship: { primary: null, secondary: null },
      traits: [],
      note: "",
    }),
  loveLanguages: z
    .object({
      primary: z.enum(loveValues).nullable().default(null),
      secondary: z.enum(loveValues).nullable().default(null),
    })
    .default({ primary: null, secondary: null }),
  coaching: z
    .object({
      included: list(oneOf(SERVICES), SERVICES.length),
      customization: z
        .enum(["custom", "mixed", "template"])
        .nullable()
        .default(null),
      details: z
        .partialRecord(
          oneOf(COACHING_DETAIL_FIELDS.map((f) => f.key)),
          z.string().trim().max(120),
        )
        .default({}),
    })
    .default({ included: [], customization: null, details: {} }),
  results: z
    .object({
      expertise: list(z.string().trim().min(1).max(40), 6),
      methodology: text(1000),
      stories: list(z.object({ title: text(80), summary: text(500) }), 3),
    })
    .default({ expertise: [], methodology: "", stories: [] }),
  nutrition: z
    .object({
      offers: list(oneOf(NUTRITION_SUPPORT), NUTRITION_SUPPORT.length),
      qualifications: text(200),
    })
    .default({ offers: [], qualifications: "" }),
  availability: z
    .object({
      timeZone: oneOf(TIME_ZONES.map((t) => t.value)).default(
        "America/New_York",
      ),
      schedule: list(z.object({ days: text(40), hours: text(80) }), 7),
      locations: text(200),
      languages: text(120),
      accessibility: text(300),
      capacity: text(120),
    })
    .default({
      timeZone: "America/New_York",
      schedule: [],
      locations: "",
      languages: "",
      accessibility: "",
      capacity: "",
    }),
  packages: list(
    z.object({
      name: text(60),
      kind: oneOf(PACKAGE_KINDS.map((k) => k.value)),
      priceCents: z.number().int().min(0).max(1_000_000),
      sessions: text(80),
      duration: text(60),
      includes: list(z.string().trim().min(1).max(80), 6),
      featured: z.boolean().default(false),
    }),
    8,
  ),
  policies: z
    .partialRecord(
      oneOf(POLICY_FIELDS.map((f) => f.key)),
      z.string().trim().max(200),
    )
    .default({}),
});

export type CoachDraft = z.infer<typeof coachDraftSchema>;

export function emptyDraft(seed?: { bio?: string }): CoachDraft {
  const draft = coachDraftSchema.parse({});
  if (seed?.bio) draft.about.intro = seed.bio.slice(0, 2000);
  return draft;
}

// Reads stored data, keeping what's valid and dropping anything that isn't, so an old or partly
// broken draft still opens in the editor.
export function readDraft(data: unknown): CoachDraft {
  const parsed = coachDraftSchema.safeParse(data ?? {});
  if (parsed.success) return parsed.data;
  const draft = emptyDraft();
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      const field = (coachDraftSchema.shape as Record<string, z.ZodType>)[key];
      const one = field?.safeParse(value);
      if (one?.success) (draft as Record<string, unknown>)[key] = one.data;
    }
  }
  return draft;
}

// The steps of the editor, each with what makes it count as done.
export const PROFILE_CHECKS: {
  step: string;
  label: string;
  done: (d: CoachDraft, hasPhoto: boolean) => boolean;
  required: boolean;
}[] = [
  {
    step: "basics",
    label: "Headline, location and how you train",
    done: (d) => !!d.headline && !!d.location && d.formats.length > 0,
    required: true,
  },
  {
    step: "basics",
    label: "Top specialties",
    done: (d) => d.specialties.length > 0,
    required: true,
  },
  {
    step: "photo",
    label: "Profile photo",
    done: (_d, photo) => photo,
    required: false,
  },
  {
    step: "bio",
    label: "About me",
    done: (d) => d.about.intro.length >= 80,
    required: true,
  },
  {
    step: "bio",
    label: "Ideal client",
    done: (d) => !!d.idealClient,
    required: false,
  },
  {
    step: "clients",
    label: "Who you work best with",
    done: (d) => d.populations.length > 0,
    required: true,
  },
  {
    step: "style",
    label: "Coaching style",
    done: (d) => STYLE_KEYS.every((key) => d.style[key].primary),
    required: true,
  },
  {
    step: "style",
    label: "Coaching love language",
    done: (d) => !!d.loveLanguages.primary,
    required: true,
  },
  {
    step: "services",
    label: "What clients get",
    done: (d) => d.coaching.included.length > 0,
    required: true,
  },
  {
    step: "results",
    label: "Experience",
    done: (d) => d.experienceYears !== null,
    required: true,
  },
  {
    step: "nutrition",
    label: "Nutrition and lifestyle",
    done: (d) => d.nutrition.offers.length > 0,
    required: false,
  },
  {
    step: "availability",
    label: "Availability",
    done: (d) => d.availability.schedule.length > 0,
    required: false,
  },
  {
    step: "pricing",
    label: "At least one priced package",
    done: (d) => d.packages.some((p) => p.name.length > 0),
    required: true,
  },
  {
    step: "pricing",
    label: "Cancellation policy",
    done: (d) => !!d.policies.cancellation,
    required: true,
  },
];

export function profileCompletion(draft: CoachDraft, hasPhoto: boolean) {
  const done = PROFILE_CHECKS.filter((check) => check.done(draft, hasPhoto));
  const missingRequired = PROFILE_CHECKS.filter(
    (check) => check.required && !check.done(draft, hasPhoto),
  );
  return {
    percent: Math.round((done.length / PROFILE_CHECKS.length) * 100),
    missingRequired,
    ready: missingRequired.length === 0,
  };
}

// Problems that block submitting, beyond missing sections: claims GYMX2 doesn't allow. A flag
// asks for a change; an admin still reviews every profile.
const RISKY = [
  {
    pattern: /\bguarantee(d|s)?\b/i,
    message: "Remove guarantees about results.",
  },
  {
    pattern:
      /\b(cure|diagnos\w*|prescri\w*|treat(s|ing|ment)? (diabetes|disease|injur\w*))\b/i,
    message:
      "Remove medical claims: diagnosing, treating or prescribing is outside fitness coaching.",
  },
  {
    pattern:
      /\b(registered dietitian|\bRD\b|doctor|physician|physical therapist)\b/i,
    message:
      "Only mention medical or dietitian titles you hold; GYMX2 will ask for proof.",
  },
  {
    pattern: /\b(venmo|cash ?app|zelle|paypal\.me|text me at|call me at)\b/i,
    message:
      "Keep payments and contact on GYMX2: remove outside payment or phone details.",
  },
];

// Claims members can't check, flagged for the coach and for the admin who reviews the profile.
const UNCHECKABLE = [
  {
    pattern:
      /(#\s?1\b|\bnumber one\b|\bbest (coach|trainer|in)\b|\btop[- ]rated\b)/i,
    message:
      'Avoid rankings members can\'t check, like "#1", "best in" or "top-rated". Let reviews speak for you.',
  },
  {
    pattern:
      /\b(lose|drop|shed)\s+\d+\s*(lbs?|pounds|kg|kilos?)\s+(in|within)\s+\d+\s*(days?|weeks?)\b/i,
    message:
      'Avoid promising a set result in a set time ("lose 20 lbs in 30 days"). Results vary from person to person.',
  },
  {
    pattern: /\b(fda|clinically) (approved|proven)\b/i,
    message: 'Remove "FDA approved" or "clinically proven" claims.',
  },
];

const CERTIFIED = /\b(certified|certification|licensed|accredited)\b/i;

// Warnings about a profile's wording. With the coach's credentials, it also asks for proof of
// any certification or license the profile mentions.
export function profileWarnings(
  draft: CoachDraft,
  credentials?: { status: string }[],
) {
  const all = JSON.stringify(draft);
  const warnings = [...RISKY, ...UNCHECKABLE]
    .filter((rule) => rule.pattern.test(all))
    .map((rule) => rule.message);
  if (
    credentials &&
    CERTIFIED.test(all) &&
    !credentials.some((c) => c.status !== "rejected")
  )
    warnings.push(
      "Your profile mentions a certification or license. Add it under Qualifications so GYMX2 can check it.",
    );
  return warnings;
}

function cleanParagraphs(value: string) {
  return value
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// Turns a coach's saved profile into what the profile page shows.
export function toCoachView(
  draft: CoachDraft,
  extras: {
    id: string;
    name: string;
    photoUrl: string | null;
    rating: { average: number; count: number } | null;
    reviews: CoachProfileView["reviews"]["items"];
    reviewCategories?: CoachProfileView["reviews"]["categories"];
    credentials?: CoachProfileView["credentials"];
    verification?: CredentialStatus;
  },
): CoachProfileView {
  const firstName =
    extras.name.replace(/^Coach\s+/i, "").split(/\s+/)[0] || extras.name;
  const style = STYLE_KEYS.flatMap((key) => {
    const primary = optionLabel(key, draft.style[key].primary);
    if (!primary) return [];
    const secondary = optionLabel(key, draft.style[key].secondary);
    return [
      {
        label: COACH_STYLE[key].label,
        primary,
        ...(secondary && secondary !== primary ? { secondary } : {}),
      },
    ];
  });
  const details: { label: string; value: string }[] =
    COACHING_DETAIL_FIELDS.flatMap((field) => {
      const value = draft.coaching.details[field.key];
      return value ? [{ label: field.label, value }] : [];
    });
  if (draft.coaching.customization)
    details.unshift({
      label: "Programming",
      value: {
        custom: "Built for you",
        mixed: "Templates adjusted for you",
        template: "Proven templates",
      }[draft.coaching.customization],
    });

  return {
    id: extras.id,
    sample: false,
    name: extras.name,
    firstName,
    photoUrl: extras.photoUrl,
    headline: draft.headline,
    verification: extras.verification ?? "unverified",
    specialties: draft.specialties,
    location: draft.location,
    formats: draft.formats.length ? draft.formats : ["online"],
    rating: extras.rating,
    experienceYears: draft.experienceYears ?? 0,
    match: null,
    about: {
      intro: cleanParagraphs(draft.about.intro),
      threeWords: draft.about.threeWords,
      prompts: draft.about.prompts.filter((p) => p.answer),
      interests: draft.about.interests,
      funFacts: draft.about.funFacts,
      quote: draft.about.quote,
    },
    idealClient: draft.idealClient,
    populations: draft.populations,
    betterServedBy: draft.betterServedBy,
    style: {
      traits: draft.style.traits,
      attributes: style,
      note: draft.style.note,
    },
    loveLanguages: {
      primary: (draft.loveLanguages.primary ??
        null) as CoachProfileView["loveLanguages"]["primary"],
      secondary: (draft.loveLanguages.secondary ??
        null) as CoachProfileView["loveLanguages"]["secondary"],
    },
    coaching: { included: draft.coaching.included, details },
    results: {
      expertise: draft.results.expertise,
      methodology: draft.results.methodology,
      stories: draft.results.stories.filter((s) => s.title || s.summary),
    },
    nutrition: {
      offers: draft.nutrition.offers,
      qualifications: draft.nutrition.qualifications,
      scope: `${firstName} coaches everyday healthy habits. Meal plans for medical conditions, diagnosis and medication are for doctors and registered dietitians.`,
    },
    availability: {
      acceptingClients: draft.acceptingClients,
      timeZone: timeZoneLabel(draft.availability.timeZone),
      schedule: draft.availability.schedule.filter((s) => s.days || s.hours),
      details: [
        { label: "Training locations", value: draft.availability.locations },
        { label: "Languages", value: draft.availability.languages },
        { label: "Accessibility", value: draft.availability.accessibility },
        { label: "Capacity", value: draft.availability.capacity },
      ].filter((item) => item.value),
    },
    packages: draft.packages.map((item): CoachPackage => ({
      name: item.name,
      kind: item.kind,
      priceCents: item.priceCents,
      billing:
        item.kind === "monthly" ||
        item.kind === "premium" ||
        item.kind === "group"
          ? "Monthly"
          : "One time",
      sessions: item.sessions,
      duration: item.duration,
      includes: item.includes,
      featured: item.featured,
    })),
    policies: POLICY_FIELDS.flatMap((field) => {
      const value = draft.policies[field.key];
      return value ? [{ label: field.label, value }] : [];
    }),
    credentials: extras.credentials ?? [],
    reviews: {
      categories: extras.reviewCategories ?? [],
      items: extras.reviews,
    },
    video: null,
    intro: null,
  };
}
