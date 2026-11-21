import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssessmentReviewForm, type FormCoachReviewAction } from "./assessment-review-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const action: FormCoachReviewAction = async () => ({ outcome: "idle" });

describe("assessment review form", () => {
  it("posts a bound attempt and CAS sequence with a stable request UUID", () => {
    const markup = renderToStaticMarkup(createElement(AssessmentReviewForm, {
      assessmentId: "f1000000-0000-4000-8000-000000000001",
      itemId: "f1000000-0000-4000-8000-000000000002",
      attemptId: "f1000000-0000-4000-8000-000000000003",
      attemptNumber: 2,
      expectedReviewSequence: 4,
      requestId: "f1000000-0000-4000-8000-000000000004",
      canReview: true,
      canOpenRetry: true,
      maxExtraAttempts: 2,
      action,
    }));

    expect(markup).toContain('name="attempt_id" value="f1000000-0000-4000-8000-000000000003"');
    expect(markup).toContain('name="expected_review_sequence" value="4"');
    expect(markup).toContain('name="request_id" value="f1000000-0000-4000-8000-000000000004"');
    expect(markup).toContain("Learned");
    expect(markup).toContain("Needs Work");
    expect(markup).toContain('maxLength="1000"');
    expect(markup).not.toContain("member notified");
    expect(markup).not.toContain("notification delivered");
  });

  it("does not present a retry option when the database projection disallows one", () => {
    const markup = renderToStaticMarkup(createElement(AssessmentReviewForm, {
      assessmentId: "f1000000-0000-4000-8000-000000000001",
      itemId: "f1000000-0000-4000-8000-000000000002",
      attemptId: "f1000000-0000-4000-8000-000000000003",
      attemptNumber: 1,
      expectedReviewSequence: 1,
      requestId: "f1000000-0000-4000-8000-000000000004",
      canReview: true,
      canOpenRetry: false,
      maxExtraAttempts: 0,
      action,
    }));

    expect(markup).not.toContain("Optional retry window");
    expect(markup).not.toContain('name="retry_minutes"');
    expect(markup).not.toContain('name="extra_attempts"');
  });
});
