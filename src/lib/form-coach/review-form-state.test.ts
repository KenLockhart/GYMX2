import { describe, expect, it } from "vitest";
import {
  createReviewFormActionTransportGuard,
  createReviewFormIntent,
  createReviewFormLifecycle,
  reviewFormIntentPayload,
  reviewFormLifecycleReducer,
  type ReviewFormLifecycle,
  type ReviewFormProjection,
} from "./review-form-state";

const target = {
  assessmentId: "f1000000-0000-4000-8000-000000000001",
  itemId: "f1000000-0000-4000-8000-000000000002",
  attemptId: "f1000000-0000-4000-8000-000000000003",
};

function projection(overrides: Partial<ReviewFormProjection> = {}): ReviewFormProjection {
  return {
    requestId: "f1000000-0000-4000-8000-000000000004",
    expectedReviewSequence: 2,
    canReview: true,
    canOpenRetry: true,
    maxExtraAttempts: 2,
    ...overrides,
  };
}

function needsWorkDraft(state: ReviewFormLifecycle): ReviewFormLifecycle {
  let next = reviewFormLifecycleReducer(state, { type: "edit", field: "verdict", value: "needs_work" });
  next = reviewFormLifecycleReducer(next, { type: "edit", field: "feedback", value: "Keep the elbow steady." });
  next = reviewFormLifecycleReducer(next, { type: "edit", field: "openRetryWindow", value: true });
  next = reviewFormLifecycleReducer(next, { type: "edit", field: "retryMinutes", value: "90" });
  return reviewFormLifecycleReducer(next, { type: "edit", field: "extraAttempts", value: "2" });
}

describe("review form intent lifecycle", () => {
  it("turns a rejected action transport into an exact-retry outcome and preserves Next redirects", async () => {
    const formData = new FormData();
    formData.set("request_id", "f1000000-0000-4000-8000-000000000004");
    const isRedirect = (error: unknown) => Boolean(
      error && typeof error === "object" && "digest" in error
      && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT;"),
    );
    const rejected = createReviewFormActionTransportGuard(async () => {
      throw new Error("The action response was lost.");
    }, isRedirect);
    await expect(rejected({ outcome: "idle" }, formData)).resolves.toEqual({
      outcome: "unknown",
      requestId: "f1000000-0000-4000-8000-000000000004",
      invocationGeneration: 1,
      error: "The review could not be confirmed. Retry the exact same review to check its status.",
    });

    const returnedUnknown = createReviewFormActionTransportGuard(async () => ({
      outcome: "unknown",
      requestId: "f1000000-0000-4000-8000-000000000004",
      invocationGeneration: 1,
      error: "Server action reported an uncertain write.",
    }), isRedirect);
    await expect(returnedUnknown({ outcome: "idle" }, formData)).resolves.toMatchObject({
      outcome: "unknown",
      requestId: "f1000000-0000-4000-8000-000000000004",
      error: "Server action reported an uncertain write.",
    });

    const redirect = Object.assign(new Error("Redirect to login."), {
      digest: "NEXT_REDIRECT;push;/login;307;",
    });
    const redirecting = createReviewFormActionTransportGuard(async () => {
      throw redirect;
    }, isRedirect);
    await expect(redirecting({ outcome: "idle" }, formData)).rejects.toBe(redirect);
  });

  it("preserves every submitted field, UUID, and sequence after an ambiguous result and retries that exact intent", () => {
    const drafted = needsWorkDraft(createReviewFormLifecycle(projection()));
    const intent = createReviewFormIntent(drafted, target);
    if (!intent) throw new Error("Expected a review intent.");
    let state = reviewFormLifecycleReducer(drafted, { type: "begin", intent });
    state = reviewFormLifecycleReducer(state, {
      type: "action_result",
      result: { outcome: "unknown", requestId: intent.requestId, invocationGeneration: 1, error: "The result could not be confirmed." },
      latestProjection: projection(),
    });

    expect(state.mode).toBe("failed");
    expect(state.intent).toEqual(intent);
    expect(reviewFormIntentPayload(state.intent!)).toEqual({
      assessment_id: target.assessmentId,
      item_id: target.itemId,
      attempt_id: target.attemptId,
      expected_review_sequence: 2,
      request_id: "f1000000-0000-4000-8000-000000000004",
      verdict: "needs_work",
      feedback: "Keep the elbow steady.",
      open_retry_window: true,
      retry_minutes: "90",
      extra_attempts: "2",
    });

    const newerProjection = projection({
      requestId: "f1000000-0000-4000-8000-000000000005",
      expectedReviewSequence: 3,
    });
    state = reviewFormLifecycleReducer(state, { type: "sync_projection", projection: newerProjection });
    expect(state.mode).toBe("failed");
    expect(state.projection.expectedReviewSequence).toBe(2);
    expect(state.projection.requestId).toBe(intent.requestId);
    expect(state.intent).toEqual(intent);

    state = reviewFormLifecycleReducer(state, { type: "retry_exact" });
    expect(state.mode).toBe("submitting");
    expect(state.intent).toEqual(intent);
    state = reviewFormLifecycleReducer(state, { type: "sync_projection", projection: newerProjection });
    state = reviewFormLifecycleReducer(state, {
      type: "action_result",
      result: { outcome: "unknown", requestId: intent.requestId, invocationGeneration: 1, error: "The first result was already consumed." },
      latestProjection: newerProjection,
    });
    expect(state.mode).toBe("submitting");
    expect(state.intent).toEqual(intent);
    state = reviewFormLifecycleReducer(state, {
      type: "action_result",
      result: { outcome: "saved", requestId: intent.requestId, invocationGeneration: 2, message: "This review was already saved." },
      latestProjection: newerProjection,
    });
    expect(state.mode).toBe("ready");
    expect(state.projection).toEqual(newerProjection);
    expect(state.draft).toMatchObject({ verdict: "", feedback: "", openRetryWindow: false });
  });

  it("clears decision and retry selection after acknowledgement before a fresh review can start", () => {
    const drafted = needsWorkDraft(createReviewFormLifecycle(projection()));
    const intent = createReviewFormIntent(drafted, target);
    if (!intent) throw new Error("Expected a review intent.");
    let state = reviewFormLifecycleReducer(drafted, { type: "begin", intent });
    const refreshedProjection = projection({
      requestId: "f1000000-0000-4000-8000-000000000006",
      expectedReviewSequence: 3,
    });
    state = reviewFormLifecycleReducer(state, {
      type: "action_result",
      result: { outcome: "saved", requestId: intent.requestId, invocationGeneration: 1, message: "Review saved." },
      latestProjection: refreshedProjection,
    });

    expect(state.mode).toBe("ready");
    expect(state.projection).toEqual(refreshedProjection);
    expect(state.draft).toMatchObject({
      verdict: "", feedback: "", openRetryWindow: false, retryMinutes: "60", extraAttempts: "1",
    });
    expect(createReviewFormIntent(state, target)).toBeNull();
  });

  it("keeps an unsent dirty draft on its original sequence until explicit discard and refresh", () => {
    const drafted = needsWorkDraft(createReviewFormLifecycle(projection()));
    const nextProjection = projection({
      requestId: "f1000000-0000-4000-8000-000000000007",
      expectedReviewSequence: 4,
      canOpenRetry: false,
      maxExtraAttempts: 0,
    });
    let state = reviewFormLifecycleReducer(drafted, { type: "sync_projection", projection: nextProjection });

    expect(state.mode).toBe("stale_draft");
    expect(state.projection.expectedReviewSequence).toBe(2);
    expect(state.projection.requestId).toBe(projection().requestId);
    expect(state.draft).toEqual(drafted.draft);
    expect(createReviewFormIntent(state, target)).toBeNull();

    state = reviewFormLifecycleReducer(state, { type: "discard_and_refresh", projection: nextProjection });
    expect(state.mode).toBe("refreshing");
    expect(state.draft).toMatchObject({ verdict: "", openRetryWindow: false });
    const latestProjection = projection({
      requestId: "f1000000-0000-4000-8000-000000000008",
      expectedReviewSequence: 4,
      canOpenRetry: false,
      maxExtraAttempts: 0,
    });
    state = reviewFormLifecycleReducer(state, { type: "sync_projection", projection: latestProjection });
    expect(state.mode).toBe("ready");
    expect(state.projection).toEqual(latestProjection);
  });

  it("clears a retry selection when the coach changes the decision to Learned", () => {
    const drafted = needsWorkDraft(createReviewFormLifecycle(projection()));
    const learned = reviewFormLifecycleReducer(drafted, { type: "edit", field: "verdict", value: "learned" });
    expect(learned.draft.verdict).toBe("learned");
    expect(learned.draft.openRetryWindow).toBe(false);
  });

  it("does not let a prior saved result acknowledge a new review while its action is pending", () => {
    const firstDraft = needsWorkDraft(createReviewFormLifecycle(projection()));
    const firstIntent = createReviewFormIntent(firstDraft, target);
    if (!firstIntent) throw new Error("Expected the first review intent.");
    let state = reviewFormLifecycleReducer(firstDraft, { type: "begin", intent: firstIntent });
    state = reviewFormLifecycleReducer(state, {
      type: "action_result",
      result: { outcome: "saved", requestId: firstIntent.requestId, invocationGeneration: 1, message: "Review saved." },
      latestProjection: projection(),
    });

    const secondProjection = projection({
      requestId: "f1000000-0000-4000-8000-000000000009",
      expectedReviewSequence: 3,
    });
    state = reviewFormLifecycleReducer(state, { type: "sync_projection", projection: secondProjection });
    let nextDraft = reviewFormLifecycleReducer(state, { type: "edit", field: "verdict", value: "learned" });
    nextDraft = reviewFormLifecycleReducer(nextDraft, { type: "edit", field: "feedback", value: "Use the same range next time." });
    const secondIntent = createReviewFormIntent(nextDraft, target);
    if (!secondIntent) throw new Error("Expected the second review intent.");
    state = reviewFormLifecycleReducer(nextDraft, { type: "begin", intent: secondIntent });

    const refreshWhileSecondPending = projection({
      requestId: "f1000000-0000-4000-8000-000000000010",
      expectedReviewSequence: 4,
    });
    state = reviewFormLifecycleReducer(state, { type: "sync_projection", projection: refreshWhileSecondPending });
    state = reviewFormLifecycleReducer(state, {
      type: "action_result",
      result: { outcome: "saved", requestId: firstIntent.requestId, invocationGeneration: 2, message: "Stale result for the first request." },
      latestProjection: refreshWhileSecondPending,
    });

    expect(state.mode).toBe("submitting");
    expect(state.intent).toEqual(secondIntent);
    expect(state.draft).toEqual(secondIntent.draft);
    expect(state.projection.expectedReviewSequence).toBe(3);
  });
});
