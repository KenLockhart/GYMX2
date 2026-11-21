import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssessmentDetail } from "./assessment-detail";
import { AssessmentList } from "./assessment-list";
import type { FormCoachReviewAction } from "./assessment-review-form";
import type { FormCoachWorkflowDetail } from "@/lib/form-coach/workflow-contracts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const assessmentId = "f1000000-0000-4000-8000-000000000003";
const memberId = "f1000000-0000-4000-8000-000000000002";
const now = "2026-11-20T12:00:00.000Z";
type RepFaults = NonNullable<
  NonNullable<FormCoachWorkflowDetail["items"][number]["attempts"][number]["result"]>["rep_results"][number]
>["faults"];

const detail: FormCoachWorkflowDetail = {
  assessment_id: assessmentId,
  source_kind: "manual",
  program_title: null,
  sent_at: now,
  due_at: "2026-11-27T00:30:00.000Z",
  status: "completed",
  payer_role: "coach",
  can_attempt: false,
  allow_member_clip: false,
  items: [{
    item_id: "f1000000-0000-4000-8000-000000000004",
    ordinal: 1,
    item_key: "exercise_1",
    title: "Dumbbell curl",
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
        average_score: 82,
        numeric_summary: {
          rep_count: 1,
          average_score: 82,
          minimum_score: 82,
          maximum_score: 82,
          rom_min_angle_average: 48,
          rom_max_angle_average: 151,
          rom_average: 82,
          elbow_average: 80,
          torso_average: 90,
          tempo_average: 85,
          shoulders_average: 88,
          max_upper_arm_drift: 4,
          max_torso_swing: 2,
          max_shrug: 0.1,
          concentric_ms_average: 800,
          top_pause_ms_average: 100,
          eccentric_ms_average: 1200,
          curve_similarity_average: 90,
          elbow_drift_count: 1,
          torso_swing_count: 0,
          short_rom_count: 0,
          shoulder_shrug_count: 0,
        },
        summary_state: "pending",
        coach_summary: null,
        rep_results: [{
          rep_number: 1,
          score: 82,
          rom_min_angle: 48,
          rom_max_angle: 151,
          rom_score: 82,
          max_upper_arm_drift: 4,
          max_torso_swing: 2,
          max_shrug: 0.1,
          concentric_ms: 800,
          top_pause_ms: 100,
          eccentric_ms: 1200,
          curve_similarity: 90,
          elbow_score: 80,
          torso_score: 90,
          tempo_score: 85,
          shoulders_score: 88,
          faults: ["elbow_drift"],
        }],
      },
    }],
    latest_review: {
      verdict: "needs_work",
      feedback: "Keep your elbow steady on the next practice.",
      created_at: now,
    },
    template: null,
  }],
};

function detailWithRepFaults(repFaults: readonly RepFaults[]): FormCoachWorkflowDetail {
  const item = detail.items[0];
  const attempt = item?.attempts[0];
  const result = attempt?.result;
  const rep = result?.rep_results[0];
  if (!item || !attempt || !result || !rep) throw new Error("The UI fixture requires one finished rep.");

  return {
    ...detail,
    items: [{
      ...item,
      attempts: [{
        ...attempt,
        result: {
          ...result,
          rep_count: repFaults.length,
          numeric_summary: { ...result.numeric_summary, rep_count: repFaults.length },
          rep_results: repFaults.map((faults, index) => ({
            ...rep,
            rep_number: index + 1,
            faults: [...faults],
          })),
        },
      }],
    }],
  };
}

describe("Form Coach assessment views", () => {
  it("renders the member inbox without a fabricated member name or raw member ID", () => {
    const markup = renderToStaticMarkup(createElement(AssessmentList, {
      role: "member",
      rows: [{
        assessment_id: assessmentId,
        source_kind: "manual",
        program_title: null,
        sent_at: now,
        due_at: "2026-11-27T00:30:00.000Z",
        status: "sent",
        item_count: 1,
        finished_attempt_count: 0,
      }],
      page: 1,
      hasMore: false,
    }));

    expect(markup).toContain("Manual Form Check");
    expect(markup).toContain("Finished attempts");
    expect(markup).toContain("Nov 27, 2026, 12:30:00 AM UTC");
    expect(markup).not.toContain(memberId);
    expect(markup).not.toContain("Member f1000000");
  });

  it("keeps previous-page navigation visible when a later member page is empty", () => {
    const markup = renderToStaticMarkup(createElement(AssessmentList, {
      role: "member",
      rows: [],
      page: 2,
      hasMore: false,
    }));

    expect(markup).toContain("There are no assessments on this page.");
    expect(markup).toContain("href=\"/form-checks?page=1\"");
    expect(markup).toContain("Previous");
    expect(markup).not.toContain("Next</a>");
  });

  it("keeps the coach status filter in empty later-page navigation and has a clear first-page empty state", () => {
    const laterPage = renderToStaticMarkup(createElement(AssessmentList, {
      role: "coach",
      rows: [],
      page: 2,
      hasMore: false,
      status: "in_progress",
    }));
    expect(laterPage).toContain("href=\"/form-coach/assessments?page=1&amp;status=in_progress\"");
    expect(laterPage).toContain("selected status");

    const firstPage = renderToStaticMarkup(createElement(AssessmentList, {
      role: "member",
      rows: [],
      page: 1,
      hasMore: false,
    }));
    expect(firstPage).toContain("There are no Form Checks in your inbox yet.");
    expect(firstPage).not.toContain("Previous</a>");
  });

  it("renders best and all finished numeric history, fault counts, pending summary and latest feedback read-only", () => {
    const markup = renderToStaticMarkup(createElement(AssessmentDetail, { role: "member", detail }));

    expect(markup).toContain("Best finished attempt");
    expect(markup).toContain("Finished attempt history");
    expect(markup).toContain("Elbow drift");
    expect(markup).toContain("Top corrections");
    expect(markup).toContain("Summary pending");
    expect(markup).toContain("November 27, 2026 at 12:30:00 AM UTC");
    expect(markup).toContain("Latest coach feedback");
    expect(markup).toContain("Keep your elbow steady on the next practice.");
    expect(markup).not.toContain("Start attempt");
    expect(markup).not.toContain("Submit review");
    expect(markup).not.toContain("storage_path");
  });

  it("counts empty and legacy clean flags as clean and deduplicates faults once per rep", () => {
    const markup = renderToStaticMarkup(createElement(AssessmentDetail, {
      role: "member",
      detail: detailWithRepFaults([
        [],
        ["clean_rep"],
        ["clean_rep", "elbow_drift"],
        ["elbow_drift", "elbow_drift"],
      ]),
    }));

    expect(markup).toContain("Clean reps: 2");
    expect(markup).toContain("<span class=\"tabular-nums\">2</span></li>");
    expect(markup).not.toContain("Elbow drift, Elbow drift");
  });

  it("shows the form flag summary for history whose reps have no substantive faults", () => {
    const markup = renderToStaticMarkup(createElement(AssessmentDetail, {
      role: "member",
      detail: detailWithRepFaults([[], ["clean_rep"]]),
    }));

    expect(markup).toContain("Form flag counts across finished reps");
    expect(markup).toContain("Clean reps: 2");
    expect(markup).toContain("No corrections were recorded.");
  });

  it("links to a coach's member profile only from the authorized detail projection", () => {
    const markup = renderToStaticMarkup(createElement(AssessmentDetail, {
      role: "coach",
      detail: { ...detail, member_id: memberId },
    }));

    expect(markup).toContain(`/members/${memberId}`);
    expect(markup).toContain("Open member profile");
  });

  it("shows coach review controls only from the review projection and against finished attempts", () => {
    const reviewAction: FormCoachReviewAction = async () => ({ outcome: "idle" });
    const reviewDetail = {
      ...detail,
      items: detail.items.map((item) => ({
        ...item,
        expected_review_sequence: 3,
        can_review: true,
        can_open_retry: true,
        max_extra_attempts: 2,
      })),
    };
    const markup = renderToStaticMarkup(createElement(AssessmentDetail, {
      role: "coach",
      detail: reviewDetail,
      reviewAction,
    }));

    expect(markup).toContain("Coach review controls");
    expect(markup).toContain("Review finished attempt 1");
    expect(markup).toContain('name="expected_review_sequence" value="3"');
    expect(markup).toContain("Save review");
  });

  it("keeps authorized history visible when review controls are unavailable", () => {
    const reviewDetail = {
      ...detail,
      items: detail.items.map((item) => ({
        ...item,
        expected_review_sequence: 1,
        can_review: false,
        can_open_retry: false,
        max_extra_attempts: 0,
      })),
    };
    const markup = renderToStaticMarkup(createElement(AssessmentDetail, {
      role: "coach",
      detail: reviewDetail,
      reviewAction: async () => ({ outcome: "idle" as const }),
    }));

    expect(markup).toContain("Best finished attempt");
    expect(markup).toContain("Review controls are currently unavailable");
    expect(markup).not.toContain('name="verdict"');
  });

  it("never renders coach review forms to the member route even if given a review projection", () => {
    const reviewDetail = {
      ...detail,
      items: detail.items.map((item) => ({
        ...item,
        expected_review_sequence: 1,
        can_review: true,
        can_open_retry: true,
        max_extra_attempts: 2,
      })),
    };
    const markup = renderToStaticMarkup(createElement(AssessmentDetail, {
      role: "member",
      detail: reviewDetail,
      reviewAction: async () => ({ outcome: "idle" as const }),
    }));

    expect(markup).toContain("Latest coach feedback");
    expect(markup).not.toContain('name="verdict"');
    expect(markup).not.toContain("Coach review controls");
  });
});
