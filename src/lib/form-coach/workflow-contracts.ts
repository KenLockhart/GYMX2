import { z } from "zod";
import { ExerciseTemplateSchema } from "./template-schema";

export const FormCoachAssessmentStatusSchema = z.enum([
  "sent",
  "in_progress",
  "completed",
  "cancelled",
  "expired",
]);
export type FormCoachAssessmentStatus = z.infer<typeof FormCoachAssessmentStatusSchema>;

export const ListCoachFormCoachAssessmentsInputSchema = z
  .object({
    page: z.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
    status: FormCoachAssessmentStatusSchema.nullable().default(null),
  })
  .strict();
export type ListCoachFormCoachAssessmentsInput = z.input<typeof ListCoachFormCoachAssessmentsInputSchema>;

const IsoTimestampSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();
export const FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS = 600;
export const FORM_COACH_REFERENCE_SIGNING_RESERVE_SECONDS = 5;

export const CoachFormCoachAssessmentRowSchema = z
  .object({
    assessment_id: UuidSchema,
    member_id: UuidSchema,
    source_kind: z.enum(["manual", "program"]),
    program_title: z.string().min(1).max(120).nullable(),
    sent_at: IsoTimestampSchema,
    due_at: IsoTimestampSchema,
    status: FormCoachAssessmentStatusSchema,
    item_count: z.number().int().min(0).max(20),
    finished_attempt_count: z.number().int().min(0).max(240),
    allow_member_clip: z.boolean(),
  })
  .strict();

export const CoachFormCoachAssessmentPageSchema = z
  .object({
    rows: z.array(CoachFormCoachAssessmentRowSchema).max(50),
    page: z.number().int().min(1).max(1_000_000),
    has_more: z.boolean(),
  })
  .strict();
export type CoachFormCoachAssessmentRow = z.infer<typeof CoachFormCoachAssessmentRowSchema>;
export type CoachFormCoachAssessmentPage = z.infer<typeof CoachFormCoachAssessmentPageSchema>;

const ExerciseFaultSchema = z.enum([
  "elbow_drift",
  "torso_swing",
  "short_rom_bottom",
  "short_rom_top",
  "eccentric_too_fast",
  "shoulder_shrug",
  "clean_rep",
]);

const RepResultSchema = z
  .object({
    rep_number: z.number().int().min(1).max(20),
    score: z.number().finite().min(0).max(100),
    rom_min_angle: z.number().finite().min(0).max(180),
    rom_max_angle: z.number().finite().min(0).max(180),
    rom_score: z.number().finite().min(0).max(100),
    max_upper_arm_drift: z.number().finite().min(0).max(180),
    max_torso_swing: z.number().finite().min(0).max(180),
    max_shrug: z.number().finite().min(0).max(1),
    concentric_ms: z.number().int().min(100).max(15_000),
    top_pause_ms: z.number().int().min(0).max(15_000),
    eccentric_ms: z.number().int().min(100).max(15_000),
    curve_similarity: z.number().finite().min(0).max(100),
    elbow_score: z.number().finite().min(0).max(100),
    torso_score: z.number().finite().min(0).max(100),
    tempo_score: z.number().finite().min(0).max(100),
    shoulders_score: z.number().finite().min(0).max(100),
    faults: z.array(ExerciseFaultSchema).max(20),
  })
  .strict()
  .refine((rep) => rep.rom_min_angle < rep.rom_max_angle, {
    message: "Rep range minimum must be below its maximum.",
    path: ["rom_min_angle"],
  });

const NumericSummaryKeys = [
  "rep_count",
  "average_score",
  "minimum_score",
  "maximum_score",
  "rom_min_angle_average",
  "rom_max_angle_average",
  "rom_average",
  "elbow_average",
  "torso_average",
  "tempo_average",
  "shoulders_average",
  "max_upper_arm_drift",
  "max_torso_swing",
  "max_shrug",
  "concentric_ms_average",
  "top_pause_ms_average",
  "eccentric_ms_average",
  "curve_similarity_average",
  "elbow_drift_count",
  "torso_swing_count",
  "short_rom_count",
  "shoulder_shrug_count",
] as const;

const NumericSummarySchema = z.record(z.enum(NumericSummaryKeys), z.number().finite()).refine(
  (summary) => Object.keys(summary).length === NumericSummaryKeys.length,
  { message: "Numeric summary must contain the complete approved key set." },
);

const AttemptResultSchema = z
  .object({
    rep_count: z.number().int().min(1).max(20),
    average_score: z.number().finite().min(0).max(100),
    numeric_summary: NumericSummarySchema,
    summary_state: z.enum(["pending", "complete", "unavailable"]),
    coach_summary: z.string().min(1).max(1000).nullable(),
    rep_results: z.array(RepResultSchema).max(20),
  })
  .strict();

const AttemptSchema = z
  .object({
    attempt_id: UuidSchema,
    attempt_number: z.number().int().min(1).max(12),
    state: z.enum(["running", "finished", "abandoned"]),
    started_at: IsoTimestampSchema,
    finished_at: IsoTimestampSchema.nullable(),
    result: AttemptResultSchema.nullable(),
  })
  .strict();

const ReviewSchema = z
  .object({
    verdict: z.enum(["learned", "needs_work"]),
    feedback: z.string().max(1000),
    created_at: IsoTimestampSchema,
  })
  .strict();

const AssessmentItemSchema = z
  .object({
    item_id: UuidSchema,
    ordinal: z.number().int().min(1).max(20),
    item_key: z.string().regex(/^[a-z0-9_]{1,64}$/),
    title: z.string().min(1).max(120),
    exercise_key: z.literal("dumbbell_curl"),
    required_reps: z.number().int().min(1).max(20),
    pass_threshold: z.number().finite().min(0).max(100),
    cues_enabled: z.boolean(),
    max_attempts: z.number().int().min(1).max(3),
    can_start_new: z.boolean(),
    can_resume: z.boolean(),
    resume_clip_opt_in: z.boolean().nullable(),
    attempts: z.array(AttemptSchema).max(12),
    latest_review: ReviewSchema.nullable(),
    template: ExerciseTemplateSchema.nullable(),
  })
  .strict();

export const FormCoachWorkflowDetailSchema = z
  .object({
    assessment_id: UuidSchema,
    source_kind: z.enum(["manual", "program"]),
    program_title: z.string().min(1).max(120).nullable(),
    sent_at: IsoTimestampSchema,
    due_at: IsoTimestampSchema,
    status: FormCoachAssessmentStatusSchema,
    payer_role: z.enum(["coach", "member"]),
    can_attempt: z.boolean(),
    allow_member_clip: z.boolean(),
    member_id: UuidSchema.optional(),
    items: z.array(AssessmentItemSchema).min(1).max(20),
  })
  .strict();
export type FormCoachWorkflowDetail = z.infer<typeof FormCoachWorkflowDetailSchema>;

export const PinnedFormCoachReferenceAssetSchema = z
  .object({
    authorized_actor_id: UuidSchema,
    authorized_role: z.enum(["member", "coach"]),
    assessment_id: UuidSchema,
    item_id: UuidSchema,
    template_id: UuidSchema,
    template_version_id: UuidSchema,
    asset_id: UuidSchema,
    asset_owner_id: UuidSchema,
    asset_key: z.literal("reference"),
    bucket_id: z.literal("form-coach-reference"),
    storage_path: z.string().min(1).max(512),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byte_size: z.number().int().positive().max(200_000_000),
    authorized_until: IsoTimestampSchema.nullable(),
    authorized_ttl_seconds: z.number().int().min(1).max(FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS),
  })
  .strict()
  .superRefine((asset, context) => {
    const segments = asset.storage_path.split("/");
    const [ownerId, versionId, filename] = segments;
    const filePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:mp4|webm)$/;
    if (
      segments.length !== 3
      || ownerId !== asset.asset_owner_id.toLowerCase()
      || versionId !== asset.template_version_id.toLowerCase()
      || !filePattern.test(filename ?? "")
      || /[%\\?#\s]/.test(asset.storage_path)
      || segments.some((segment) => segment === "." || segment === "..")
    ) {
      context.addIssue({
        code: "custom",
        path: ["storage_path"],
        message: "Reference storage path is not the exact owner and pinned-version path.",
      });
    }
    if (asset.authorized_role === "member" && asset.authorized_until === null) {
      context.addIssue({
        code: "custom",
        path: ["authorized_until"],
        message: "Member reference authorization must have a deadline.",
      });
    }
    if (asset.authorized_role === "coach" && asset.authorized_until !== null) {
      context.addIssue({
        code: "custom",
        path: ["authorized_until"],
        message: "Coach history authorization has no assessment deadline.",
      });
    }
    if (asset.authorized_role === "coach" && asset.authorized_ttl_seconds !== FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["authorized_ttl_seconds"],
        message: "Coach reference links use the fixed short maximum lifetime.",
      });
    }
  });
export type PinnedFormCoachReferenceAsset = z.infer<typeof PinnedFormCoachReferenceAssetSchema>;

export function parseCoachFormCoachAssessmentPage(input: unknown): CoachFormCoachAssessmentPage {
  return CoachFormCoachAssessmentPageSchema.parse(input);
}

export function parseFormCoachWorkflowDetail(input: unknown): FormCoachWorkflowDetail {
  return FormCoachWorkflowDetailSchema.parse(input);
}

export function parsePinnedFormCoachReferenceAsset(input: unknown): PinnedFormCoachReferenceAsset | null {
  const parsed = PinnedFormCoachReferenceAssetSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/**
 * Return a conservative whole-second URL lifetime from the database's remaining budget. The
 * caller supplies elapsed monotonic time measured before the authorization RPC and after each
 * subsequent network operation; wall-clock time is deliberately not consulted.
 */
export function formCoachReferenceUrlTtlSeconds(
  databaseRemainingSeconds: number,
  elapsedMs: number,
  reserveSeconds = 0,
): number | null {
  if (!Number.isInteger(databaseRemainingSeconds) || databaseRemainingSeconds < 1
    || databaseRemainingSeconds > FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS
    || !Number.isFinite(elapsedMs) || elapsedMs < 0
    || !Number.isInteger(reserveSeconds) || reserveSeconds < 0
    || reserveSeconds > FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS) return null;
  const remaining = Math.floor(databaseRemainingSeconds - elapsedMs / 1000 - reserveSeconds);
  if (remaining < 1) return null;
  return Math.min(FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS, remaining);
}
