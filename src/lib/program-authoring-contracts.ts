import { z } from "zod";

const uuidSchema = z.string().uuid();
const positiveIntegerSchema = z.number().int().safe().positive();
const lessonsSchema = z.array(z.object({
  lessonOrdinal: positiveIntegerSchema.max(365),
  timelineDayNumber: positiveIntegerSchema.max(365),
  title: z.string().trim().min(1).max(120),
  instructions: z.string().max(2_000),
  pillar: z.enum(["mind", "body", "spirit"]),
  videoId: uuidSchema.nullable(),
}).strict()).min(1).max(365).superRefine((lessons, context) => {
  lessons.forEach((lesson, index) => {
    if (lesson.lessonOrdinal !== index + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "lessonOrdinal"],
        message: "Lesson ordinals must be contiguous and start at one.",
      });
    }
    if (index > 0 && lesson.timelineDayNumber <= lessons[index - 1]!.timelineDayNumber) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "timelineDayNumber"],
        message: "Timeline days must increase strictly.",
      });
    }
  });
});

export const programAuthoringLessonSchema = lessonsSchema.element;
export type ProgramAuthoringLesson = z.infer<typeof programAuthoringLessonSchema>;

export const programAuthoringSnapshotCommandSchema = z.object({
  programId: uuidSchema,
}).strict();

export const saveProgramAuthoringDraftCommandSchema = z.object({
  programId: uuidSchema,
  draftId: uuidSchema.nullable(),
  expectedDraftRevision: z.number().int().safe().min(0),
  expectedContentVersionId: uuidSchema,
  expectedOfferVersionId: uuidSchema,
  lessons: lessonsSchema,
}).strict();

export const discardProgramAuthoringDraftCommandSchema = z.object({
  programId: uuidSchema,
  draftId: uuidSchema,
  expectedDraftRevision: positiveIntegerSchema,
  expectedContentVersionId: uuidSchema,
  expectedOfferVersionId: uuidSchema,
}).strict();

export const publishProgramAuthoringDraftCommandSchema = z.object({
  programId: uuidSchema,
  draftId: uuidSchema,
  expectedDraftRevision: positiveIntegerSchema,
  expectedContentVersionId: uuidSchema,
  expectedOfferVersionId: uuidSchema,
  requestId: uuidSchema,
  listPriceCents: z.number().int().safe().min(50).max(2_147_483_647),
  maxInstallments: z.number().int().safe().min(1).max(12),
}).strict();

export const publishProgramOfferPriceCommandSchema = z.object({
  programId: uuidSchema,
  expectedContentVersionId: uuidSchema,
  expectedOfferVersionId: uuidSchema,
  requestId: uuidSchema,
  listPriceCents: z.number().int().safe().min(50).max(2_147_483_647),
  maxInstallments: z.number().int().safe().min(1).max(12),
}).strict();

function isoTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(new Date(value).getTime())) return false;
  const [year, month, day] = match.slice(1, 4).map(Number);
  if (year === undefined || month === undefined || day === undefined || year < 1) return false;
  const calendarDate = new Date(0);
  calendarDate.setUTCHours(0, 0, 0, 0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  return calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day;
}

export const createProgramPromotionCommandSchema = z.object({
  programId: uuidSchema,
  expectedContentVersionId: uuidSchema,
  expectedOfferVersionId: uuidSchema,
  requestId: uuidSchema,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,63}$/),
  discountKind: z.enum(["fixed", "percent"]),
  discountValue: positiveIntegerSchema.max(2_147_483_647),
  startsAt: z.string().refine(isoTimestamp, "A timestamp with an explicit offset is required."),
  endsAt: z.string().refine(isoTimestamp, "A timestamp with an explicit offset is required.").nullable(),
  maxRedemptions: positiveIntegerSchema.max(1_000_000),
}).strict().superRefine((command, context) => {
  if (command.discountKind === "percent" && command.discountValue > 10_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["discountValue"],
      message: "Percent promotions must be between 1 and 10000 basis points.",
    });
  }
  if (command.endsAt && Date.parse(command.endsAt) <= Date.parse(command.startsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "The promotion end must follow its start.",
    });
  }
});

const lessonWireSchema = z.object({
  lesson_ordinal: positiveIntegerSchema.max(365),
  timeline_day_number: positiveIntegerSchema.max(365),
  title: z.string().min(1).max(120),
  instructions: z.string().max(2_000),
  pillar: z.enum(["mind", "body", "spirit"]),
  video_id: uuidSchema.nullable(),
}).strict();

const authoringSnapshotWireSchema = z.object({
  status: z.literal("ready"),
  program_id: uuidSchema,
  published: z.boolean(),
  platform_owned: z.boolean(),
  current_content_version_id: uuidSchema,
  current_offer_version_id: uuidSchema,
  current_revision_kind: z.enum(["current", "free_snapshot", "paid"]),
  current_lesson_count: z.number().int().safe().min(0).max(365),
  offer_kind: z.enum(["free", "paid"]),
  list_price_cents: z.number().int().safe().min(0).max(2_147_483_647),
  currency: z.literal("usd"),
  max_installments: z.number().int().safe().min(1).max(12),
  payout_ready: z.boolean(),
  draft_id: uuidSchema.nullable(),
  draft_revision: positiveIntegerSchema.nullable(),
  draft_stale: z.boolean(),
  lessons: z.array(lessonWireSchema).max(365),
}).strict().superRefine((value, context) => {
  if ((value.draft_id === null) !== (value.draft_revision === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["draft_revision"], message: "Draft identity is incomplete." });
  }
});

export type ProgramAuthoringSnapshot = {
  programId: string;
  published: boolean;
  platformOwned: boolean;
  currentContentVersionId: string;
  currentOfferVersionId: string;
  currentRevisionKind: "current" | "free_snapshot" | "paid";
  currentLessonCount: number;
  offerKind: "free" | "paid";
  listPriceCents: number;
  currency: "usd";
  maxInstallments: number;
  payoutReady: boolean;
  draftId: string | null;
  draftRevision: number | null;
  draftStale: boolean;
  lessons: ProgramAuthoringLesson[];
};

export function parseProgramAuthoringSnapshot(value: unknown): ProgramAuthoringSnapshot | null {
  const parsed = authoringSnapshotWireSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    programId: parsed.data.program_id,
    published: parsed.data.published,
    platformOwned: parsed.data.platform_owned,
    currentContentVersionId: parsed.data.current_content_version_id,
    currentOfferVersionId: parsed.data.current_offer_version_id,
    currentRevisionKind: parsed.data.current_revision_kind,
    currentLessonCount: parsed.data.current_lesson_count,
    offerKind: parsed.data.offer_kind,
    listPriceCents: parsed.data.list_price_cents,
    currency: parsed.data.currency,
    maxInstallments: parsed.data.max_installments,
    payoutReady: parsed.data.payout_ready,
    draftId: parsed.data.draft_id,
    draftRevision: parsed.data.draft_revision,
    draftStale: parsed.data.draft_stale,
    lessons: parsed.data.lessons.map((lesson) => ({
      lessonOrdinal: lesson.lesson_ordinal,
      timelineDayNumber: lesson.timeline_day_number,
      title: lesson.title,
      instructions: lesson.instructions,
      pillar: lesson.pillar,
      videoId: lesson.video_id,
    })),
  };
}

export type ProgramAuthoringSavedDraft = {
  status: "saved";
  programId: string;
  draftId: string;
  draftRevision: number;
  baseContentVersionId: string;
  baseOfferVersionId: string;
  lessonCount: number;
};

export type ProgramAuthoringDiscarded = {
  status: "discarded" | "already_absent";
  programId: string;
  draftId: string;
  draftRevision: number;
};

export type ProgramAuthoringPublished = {
  status: "published";
  programId: string;
  contentVersionId: string;
  offerVersionId: string;
  freeSnapshotId: string | null;
  revisionNumber: number | null;
  offerNumber: number;
  listPriceCents: number;
  currency: "usd";
  maxInstallments: number;
  published: boolean;
  replayed: boolean;
};

export type ProgramAuthoringPromotion = {
  status: "published";
  programId: string;
  contentVersionId: string;
  offerVersionId: string;
  promotionId: string;
  code: string;
  discountKind: "fixed" | "percent";
  discountValue: number;
  startsAt: string;
  endsAt: string | null;
  maxRedemptions: number;
  published: boolean;
  replayed: boolean;
};

export type ProgramAuthoringResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "feature_disabled" | "invalid_request" | "unavailable" | "conflict" };

export function parseProgramAuthoringSavedDraft(value: unknown): ProgramAuthoringSavedDraft | null {
  const parsed = z.object({
    status: z.literal("saved"),
    program_id: uuidSchema,
    draft_id: uuidSchema,
    draft_revision: positiveIntegerSchema,
    base_content_version_id: uuidSchema,
    base_offer_version_id: uuidSchema,
    lesson_count: positiveIntegerSchema.max(365),
  }).strict().safeParse(value);
  if (!parsed.success) return null;
  return {
    status: "saved",
    programId: parsed.data.program_id,
    draftId: parsed.data.draft_id,
    draftRevision: parsed.data.draft_revision,
    baseContentVersionId: parsed.data.base_content_version_id,
    baseOfferVersionId: parsed.data.base_offer_version_id,
    lessonCount: parsed.data.lesson_count,
  };
}

export function parseProgramAuthoringDiscarded(value: unknown): ProgramAuthoringDiscarded | {
  status: "conflict";
  programId: string;
  draftId: string;
} | null {
  const success = z.object({
    status: z.enum(["discarded", "already_absent"]),
    program_id: uuidSchema,
    draft_id: uuidSchema,
    draft_revision: positiveIntegerSchema,
  }).strict().safeParse(value);
  if (success.success) {
    return {
      status: success.data.status,
      programId: success.data.program_id,
      draftId: success.data.draft_id,
      draftRevision: success.data.draft_revision,
    };
  }
  const conflict = z.object({
    status: z.literal("conflict"),
    program_id: uuidSchema,
    draft_id: uuidSchema,
  }).strict().safeParse(value);
  return conflict.success
    ? { status: "conflict", programId: conflict.data.program_id, draftId: conflict.data.draft_id }
    : null;
}

export function parseProgramAuthoringPublished(value: unknown): ProgramAuthoringPublished | null {
  const parsed = z.object({
    status: z.literal("published"),
    program_id: uuidSchema,
    content_version_id: uuidSchema,
    offer_version_id: uuidSchema,
    free_snapshot_id: uuidSchema.nullable().optional(),
    revision_number: positiveIntegerSchema.optional(),
    offer_number: positiveIntegerSchema,
    list_price_cents: z.number().int().safe().min(50).max(2_147_483_647),
    currency: z.literal("usd"),
    max_installments: positiveIntegerSchema.max(12),
    published: z.boolean(),
    replayed: z.boolean().optional(),
  }).strict().safeParse(value);
  if (!parsed.success) return null;
  return {
    status: "published",
    programId: parsed.data.program_id,
    contentVersionId: parsed.data.content_version_id,
    offerVersionId: parsed.data.offer_version_id,
    freeSnapshotId: parsed.data.free_snapshot_id ?? null,
    revisionNumber: parsed.data.revision_number ?? null,
    offerNumber: parsed.data.offer_number,
    listPriceCents: parsed.data.list_price_cents,
    currency: parsed.data.currency,
    maxInstallments: parsed.data.max_installments,
    published: parsed.data.published,
    replayed: parsed.data.replayed ?? false,
  };
}

export function parseProgramAuthoringPromotion(value: unknown): ProgramAuthoringPromotion | null {
  const parsed = z.object({
    status: z.literal("published"),
    program_id: uuidSchema,
    content_version_id: uuidSchema,
    offer_version_id: uuidSchema,
    promotion_id: uuidSchema,
    code: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,63}$/),
    discount_kind: z.enum(["fixed", "percent"]),
    discount_value: positiveIntegerSchema.max(2_147_483_647),
    starts_at: z.string().refine(isoTimestamp),
    ends_at: z.string().refine(isoTimestamp).nullable(),
    max_redemptions: positiveIntegerSchema.max(1_000_000),
    published: z.boolean(),
    replayed: z.boolean().optional(),
  }).strict().safeParse(value);
  if (!parsed.success) return null;
  return {
    status: "published",
    programId: parsed.data.program_id,
    contentVersionId: parsed.data.content_version_id,
    offerVersionId: parsed.data.offer_version_id,
    promotionId: parsed.data.promotion_id,
    code: parsed.data.code,
    discountKind: parsed.data.discount_kind,
    discountValue: parsed.data.discount_value,
    startsAt: parsed.data.starts_at,
    endsAt: parsed.data.ends_at,
    maxRedemptions: parsed.data.max_redemptions,
    published: parsed.data.published,
    replayed: parsed.data.replayed ?? false,
  };
}
