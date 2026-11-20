import { describe, expect, it } from "vitest";
import {
  CoachFormCoachAssessmentPageSchema,
  FormCoachWorkflowDetailSchema,
  FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS,
  FORM_COACH_REFERENCE_SIGNING_RESERVE_SECONDS,
  PinnedFormCoachReferenceAssetSchema,
  formCoachReferenceUrlTtlSeconds,
  parsePinnedFormCoachReferenceAsset,
} from "./workflow-contracts";

const coachId = "f1000000-0000-4000-8000-000000000001";
const memberId = "f1000000-0000-4000-8000-000000000002";
const assessmentId = "f1000000-0000-4000-8000-000000000003";
const itemId = "f1000000-0000-4000-8000-000000000004";
const templateId = "f1000000-0000-4000-8000-000000000005";
const versionId = "f1000000-0000-4000-8000-000000000006";
const assetId = "f1000000-0000-4000-8000-000000000007";
const now = "2026-11-20T12:00:00.000Z";

function referenceAsset(overrides: Record<string, unknown> = {}) {
  return {
    authorized_actor_id: coachId,
    authorized_role: "coach",
    assessment_id: assessmentId,
    item_id: itemId,
    template_id: templateId,
    template_version_id: versionId,
    asset_id: assetId,
    asset_owner_id: coachId,
    asset_key: "reference",
    bucket_id: "form-coach-reference",
    storage_path: `${coachId}/${versionId}/${assetId}.mp4`,
    content_sha256: "a".repeat(64),
    byte_size: 100,
    authorized_until: null,
    authorized_ttl_seconds: 600,
    ...overrides,
  };
}

describe("Form Coach app workflow contracts", () => {
  it("accepts the bounded coach queue DTO and rejects stale or malformed fields", () => {
    const page = {
      rows: [{
        assessment_id: assessmentId,
        member_id: memberId,
        source_kind: "program",
        program_title: "Synthetic Program",
        sent_at: now,
        due_at: "2026-11-27T12:00:00.000Z",
        status: "sent",
        item_count: 2,
        finished_attempt_count: 1,
        allow_member_clip: false,
      }],
      page: 1,
      has_more: false,
    };

    expect(CoachFormCoachAssessmentPageSchema.parse(page)).toEqual(page);
    expect(CoachFormCoachAssessmentPageSchema.safeParse({
      ...page,
      rows: [{ ...page.rows[0], payer_role: "admin" }],
    }).success).toBe(false);
    expect(CoachFormCoachAssessmentPageSchema.safeParse({ ...page, page: 0 }).success).toBe(false);
  });

  it("accepts item capabilities and completed numeric result DTOs without raw media fields", () => {
    const numericSummary = {
      rep_count: 1,
      average_score: 85,
      minimum_score: 85,
      maximum_score: 85,
      rom_min_angle_average: 50,
      rom_max_angle_average: 150,
      rom_average: 100,
      elbow_average: 85,
      torso_average: 85,
      tempo_average: 85,
      shoulders_average: 85,
      max_upper_arm_drift: 2,
      max_torso_swing: 2,
      max_shrug: 0.1,
      concentric_ms_average: 1000,
      top_pause_ms_average: 200,
      eccentric_ms_average: 1500,
      curve_similarity_average: 85,
      elbow_drift_count: 0,
      torso_swing_count: 0,
      short_rom_count: 0,
      shoulder_shrug_count: 0,
    };
    const detail = {
      assessment_id: assessmentId,
      source_kind: "manual",
      program_title: null,
      sent_at: now,
      due_at: "2026-11-27T12:00:00.000Z",
      status: "sent",
      payer_role: "coach",
      can_attempt: false,
      allow_member_clip: true,
      member_id: memberId,
      items: [{
        item_id: itemId,
        ordinal: 1,
        item_key: "exercise_1",
        title: "Curl",
        exercise_key: "dumbbell_curl",
        required_reps: 8,
        pass_threshold: 75,
        cues_enabled: false,
        max_attempts: 2,
        can_start_new: false,
        can_resume: false,
        resume_clip_opt_in: null,
        attempts: [{
          attempt_id: "f1000000-0000-4000-8000-000000000008",
          attempt_number: 1,
          state: "finished",
          started_at: now,
          finished_at: now,
          result: {
            rep_count: 1,
            average_score: 85,
            numeric_summary: numericSummary,
            summary_state: "complete",
            coach_summary: "Stable curl with controlled tempo.",
            rep_results: [{
              rep_number: 1,
              score: 85,
              rom_min_angle: 50,
              rom_max_angle: 150,
              rom_score: 85,
              max_upper_arm_drift: 2,
              max_torso_swing: 2,
              max_shrug: 0.1,
              concentric_ms: 1000,
              top_pause_ms: 200,
              eccentric_ms: 1500,
              curve_similarity: 85,
              elbow_score: 85,
              torso_score: 85,
              tempo_score: 85,
              shoulders_score: 85,
              faults: ["clean_rep"],
            }],
          },
        }],
        latest_review: null,
        template: null,
      }],
    };

    expect(FormCoachWorkflowDetailSchema.parse(detail)).toEqual(detail);
    expect(FormCoachWorkflowDetailSchema.safeParse({
      ...detail,
      items: [{ ...detail.items[0], frame_url: "https://example.test/frame.jpg" }],
    }).success).toBe(false);
    expect(FormCoachWorkflowDetailSchema.safeParse({
      ...detail,
      items: [{ ...detail.items[0], resume_request_id: "f1000000-0000-4000-8000-000000000009" }],
    }).success).toBe(false);
    expect(FormCoachWorkflowDetailSchema.safeParse({
      ...detail,
      items: [{
        ...detail.items[0],
        attempts: [{
          attempt_id: "f1000000-0000-4000-8000-000000000010",
          attempt_number: 1,
          state: "running",
          started_at: now,
          finished_at: null,
          result: null,
          lease_token: "f1000000-0000-4000-8000-000000000011",
        }],
      }],
    }).success).toBe(false);
    expect(FormCoachWorkflowDetailSchema.safeParse({
      ...detail,
      can_attempt: true,
      allow_member_clip: "yes",
    }).success).toBe(false);
  });

  it("accepts only the exact owner and pinned-version private reference path", () => {
    expect(parsePinnedFormCoachReferenceAsset(referenceAsset())).toMatchObject({
      asset_owner_id: coachId,
      template_version_id: versionId,
      bucket_id: "form-coach-reference",
    });
    expect(parsePinnedFormCoachReferenceAsset(referenceAsset({
      storage_path: `${coachId}/${versionId}/../${assetId}.mp4`,
    }))).toBeNull();
    expect(parsePinnedFormCoachReferenceAsset(referenceAsset({
      storage_path: `https://storage.test/${coachId}/${versionId}/${assetId}.mp4`,
    }))).toBeNull();
    expect(parsePinnedFormCoachReferenceAsset(referenceAsset({
      storage_path: `${coachId}/${versionId}/%2e%2e.mp4`,
    }))).toBeNull();
    expect(parsePinnedFormCoachReferenceAsset(referenceAsset({
      storage_path: `${memberId}/${versionId}/${assetId}.mp4`,
    }))).toBeNull();
    expect(parsePinnedFormCoachReferenceAsset(referenceAsset({
      storage_path: `${coachId}/${templateId}/${assetId}.mp4`,
    }))).toBeNull();
    expect(parsePinnedFormCoachReferenceAsset(referenceAsset({
      bucket_id: "form-coach-clips",
    }))).toBeNull();
  });

  it("requires member expiry metadata and rejects extra URL/path authority", () => {
    expect(PinnedFormCoachReferenceAssetSchema.safeParse(referenceAsset({
      authorized_role: "member",
      authorized_actor_id: memberId,
      authorized_until: null,
    })).success).toBe(false);
    expect(PinnedFormCoachReferenceAssetSchema.safeParse(referenceAsset({
      arbitrary_url: "https://attacker.test/asset.mp4",
    })).success).toBe(false);
  });

  it("caps signer lifetime to a monotonic remainder of the database budget", () => {
    expect(formCoachReferenceUrlTtlSeconds(600, 0))
      .toBe(FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS);
    expect(formCoachReferenceUrlTtlSeconds(600, 500)).toBe(599);
    expect(formCoachReferenceUrlTtlSeconds(30, 1_250)).toBe(28);
    expect(formCoachReferenceUrlTtlSeconds(600, 120, FORM_COACH_REFERENCE_SIGNING_RESERVE_SECONDS)).toBe(594);
    expect(formCoachReferenceUrlTtlSeconds(600, 1_320, 0)).toBe(598);
    expect(formCoachReferenceUrlTtlSeconds(1, 1)).toBeNull();
    expect(formCoachReferenceUrlTtlSeconds(30, Number.NaN)).toBeNull();
    expect(formCoachReferenceUrlTtlSeconds(601, 0)).toBeNull();
  });
});
