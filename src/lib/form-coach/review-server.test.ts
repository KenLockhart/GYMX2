import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCoach: vi.fn(), createClient: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireCoach: mocks.requireCoach }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { getCoachFormCoachReviewDetail } from "./review-server";

const coachId = "f1000000-0000-4000-8000-000000000001";
const memberId = "f1000000-0000-4000-8000-000000000002";
const assessmentId = "f1000000-0000-4000-8000-000000000003";
const itemId = "f1000000-0000-4000-8000-000000000004";
const attemptId = "f1000000-0000-4000-8000-000000000005";

function detail() {
  return {
    assessment_id: assessmentId,
    source_kind: "manual",
    program_title: null,
    sent_at: "2026-11-20T12:00:00.000Z",
    due_at: "2026-11-27T12:00:00.000Z",
    status: "in_progress",
    payer_role: "coach",
    can_attempt: false,
    allow_member_clip: false,
    member_id: memberId,
    items: [{
      item_id: itemId, ordinal: 1, item_key: "curl", title: "Curl", exercise_key: "dumbbell_curl",
      required_reps: 8, pass_threshold: 75, cues_enabled: false, max_attempts: 3,
      can_start_new: false, can_resume: false, resume_clip_opt_in: null,
      attempts: [{ attempt_id: attemptId, attempt_number: 1, state: "finished",
        started_at: "2026-11-20T12:00:00.000Z", finished_at: "2026-11-20T12:01:00.000Z", result: null }],
      latest_review: null, template: null, expected_review_sequence: 0, can_review: true,
      can_open_retry: true, max_extra_attempts: 3,
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCoach.mockResolvedValue({ profile: { id: coachId, role: "coach" } });
});
afterEach(() => vi.restoreAllMocks());

describe("coach review detail server boundary", () => {
  it("uses only the authenticated coach getter and validates the typed result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: detail(), error: null });
    mocks.createClient.mockResolvedValue({ rpc });

    await expect(getCoachFormCoachReviewDetail(assessmentId)).resolves.toMatchObject({
      kind: "ready", value: { assessment_id: assessmentId, items: [{ expected_review_sequence: 0 } ] },
    });
    expect(rpc).toHaveBeenCalledWith("get_coach_form_coach_review_detail", {
      target_assessment_id: assessmentId,
    });
    expect(mocks.requireCoach).toHaveBeenCalledOnce();
  });

  it("rejects malformed ids before database work and non-coach accounts before the RPC", async () => {
    await expect(getCoachFormCoachReviewDetail("not-a-uuid")).resolves.toEqual({ kind: "not_authorized" });
    expect(mocks.requireCoach).not.toHaveBeenCalled();

    mocks.requireCoach.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    await expect(getCoachFormCoachReviewDetail(assessmentId)).resolves.toEqual({ kind: "not_authorized" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("fails closed on an RPC error, missing row, or widened DTO", async () => {
    mocks.createClient.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: new Error("db") }) });
    await expect(getCoachFormCoachReviewDetail(assessmentId)).resolves.toEqual({ kind: "unavailable" });

    mocks.createClient.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) });
    await expect(getCoachFormCoachReviewDetail(assessmentId)).resolves.toEqual({ kind: "not_found" });

    mocks.createClient.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({
      data: { ...detail(), items: [{ ...detail().items[0], private_member_email: "x@example.test" }] }, error: null,
    }) });
    await expect(getCoachFormCoachReviewDetail(assessmentId)).resolves.toEqual({ kind: "unavailable" });
  });
});
