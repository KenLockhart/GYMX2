import { describe, expect, it } from "vitest";
import { parseFormCoachReviewDetail } from "./review-contracts";

const uuid = (suffix: string) => `f1000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function detail() {
  return {
    assessment_id: uuid("1"),
    source_kind: "manual",
    program_title: null,
    sent_at: "2026-11-20T12:00:00.000Z",
    due_at: "2026-11-27T12:00:00.000Z",
    status: "in_progress",
    payer_role: "coach",
    can_attempt: false,
    allow_member_clip: false,
    member_id: uuid("2"),
    items: [{
      item_id: uuid("3"), ordinal: 1, item_key: "curl", title: "Curl",
      exercise_key: "dumbbell_curl", required_reps: 8, pass_threshold: 75,
      cues_enabled: false, max_attempts: 3, can_start_new: false, can_resume: false,
      resume_clip_opt_in: null, attempts: [{
        attempt_id: uuid("4"), attempt_number: 1, state: "finished",
        started_at: "2026-11-20T12:00:00.000Z", finished_at: "2026-11-20T12:01:00.000Z", result: null,
      }], latest_review: null, template: null,
      expected_review_sequence: 0, can_review: true, can_open_retry: true, max_extra_attempts: 3,
    }],
  };
}

describe("Form Coach review projection contract", () => {
  it("accepts the strict current sequence and bounded capabilities", () => {
    expect(parseFormCoachReviewDetail(detail()).items[0]).toMatchObject({
      expected_review_sequence: 0,
      can_review: true,
      can_open_retry: true,
      max_extra_attempts: 3,
    });
  });

  it("rejects widened data and a retry budget outside the SQL contract", () => {
    expect(() => parseFormCoachReviewDetail({ ...detail(), coach_email: "private@example.test" })).toThrow();
    expect(() => parseFormCoachReviewDetail({
      ...detail(), items: [{ ...detail().items[0], max_extra_attempts: 4 }],
    })).toThrow();
    expect(() => parseFormCoachReviewDetail({
      ...detail(), items: [{ ...detail().items[0], review_request_digest: "a".repeat(64) }],
    })).toThrow();
  });
});
