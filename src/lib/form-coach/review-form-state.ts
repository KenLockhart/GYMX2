export type ReviewFormOutcome = "idle" | "saved" | "rejected" | "unknown";

export type ReviewFormActionState = Readonly<{
  outcome: ReviewFormOutcome;
  requestId?: string;
  invocationGeneration?: number;
  message?: string;
  error?: string;
}>;

export const INITIAL_REVIEW_FORM_ACTION_STATE: ReviewFormActionState = { outcome: "idle" };

export type ReviewFormDraft = Readonly<{
  verdict: "" | "learned" | "needs_work";
  feedback: string;
  openRetryWindow: boolean;
  retryMinutes: string;
  extraAttempts: string;
}>;

export type ReviewFormProjection = Readonly<{
  requestId: string;
  expectedReviewSequence: number;
  canReview: boolean;
  canOpenRetry: boolean;
  maxExtraAttempts: number;
}>;

export type ReviewFormTarget = Readonly<{
  assessmentId: string;
  itemId: string;
  attemptId: string;
}>;

export type ReviewFormIntent = Readonly<{
  target: ReviewFormTarget;
  requestId: string;
  expectedReviewSequence: number;
  draft: ReviewFormDraft;
}>;

export type ReviewFormLifecycleMode =
  | "ready"
  | "submitting"
  | "failed"
  | "stale_draft"
  | "awaiting_refresh"
  | "refreshing";

export type ReviewFormLifecycle = Readonly<{
  projection: ReviewFormProjection;
  draft: ReviewFormDraft;
  dirty: boolean;
  mode: ReviewFormLifecycleMode;
  intent: ReviewFormIntent | null;
  result: ReviewFormActionState;
  latestProjectionChanged: boolean;
  lastHandledActionGeneration: number;
}>;

export type ReviewFormLifecycleEvent =
  | Readonly<{ type: "edit"; field: keyof ReviewFormDraft; value: string | boolean }>
  | Readonly<{ type: "begin"; intent: ReviewFormIntent }>
  | Readonly<{ type: "retry_exact" }>
  | Readonly<{ type: "action_result"; result: ReviewFormActionState; latestProjection: ReviewFormProjection }>
  | Readonly<{ type: "sync_projection"; projection: ReviewFormProjection }>
  | Readonly<{ type: "discard_and_refresh"; projection: ReviewFormProjection }>;

export type ReviewFormActionPayload = Readonly<{
  assessment_id: string;
  item_id: string;
  attempt_id: string;
  expected_review_sequence: number;
  request_id: string;
  verdict: "learned" | "needs_work";
  feedback: string;
  open_retry_window: boolean;
  retry_minutes: string | null;
  extra_attempts: string | null;
}>;

export type ReviewFormAction = (
  previousState: ReviewFormActionState,
  formData: FormData,
) => Promise<ReviewFormActionState>;

export function createReviewFormActionTransportGuard(
  action: ReviewFormAction,
  isControlFlowError: (error: unknown) => boolean,
  nextInvocationGeneration?: () => number,
): ReviewFormAction {
  let localInvocationGeneration = 0;
  return async (previousState, formData) => {
    const invocationGeneration = nextInvocationGeneration
      ? nextInvocationGeneration()
      : ++localInvocationGeneration;
    try {
      return { ...await action(previousState, formData), invocationGeneration };
    } catch (error) {
      if (isControlFlowError(error)) throw error;
      const postedRequestId = formData.get("request_id");
      return {
        outcome: "unknown",
        ...(typeof postedRequestId === "string" ? { requestId: postedRequestId } : {}),
        invocationGeneration,
        error: "The review could not be confirmed. Retry the exact same review to check its status.",
      };
    }
  };
}

export function emptyReviewFormDraft(): ReviewFormDraft {
  return {
    verdict: "",
    feedback: "",
    openRetryWindow: false,
    retryMinutes: "60",
    extraAttempts: "1",
  };
}

export function createReviewFormLifecycle(projection: ReviewFormProjection): ReviewFormLifecycle {
  return {
    projection,
    draft: emptyReviewFormDraft(),
    dirty: false,
    mode: "ready",
    intent: null,
    result: INITIAL_REVIEW_FORM_ACTION_STATE,
    latestProjectionChanged: false,
    lastHandledActionGeneration: 0,
  };
}

function projectionChanged(left: ReviewFormProjection, right: ReviewFormProjection): boolean {
  return left.requestId !== right.requestId
    || left.expectedReviewSequence !== right.expectedReviewSequence
    || left.canReview !== right.canReview
    || left.canOpenRetry !== right.canOpenRetry
    || left.maxExtraAttempts !== right.maxExtraAttempts;
}

export function createReviewFormIntent(
  lifecycle: ReviewFormLifecycle,
  target: ReviewFormTarget,
): ReviewFormIntent | null {
  if (lifecycle.mode !== "ready" || !lifecycle.draft.verdict || !lifecycle.projection.canReview) return null;
  return {
    target,
    requestId: lifecycle.projection.requestId,
    expectedReviewSequence: lifecycle.projection.expectedReviewSequence,
    draft: { ...lifecycle.draft },
  };
}

export function reviewFormIntentPayload(intent: ReviewFormIntent): ReviewFormActionPayload {
  const openRetryWindow = intent.draft.verdict === "needs_work"
    && intent.draft.openRetryWindow;
  return {
    assessment_id: intent.target.assessmentId,
    item_id: intent.target.itemId,
    attempt_id: intent.target.attemptId,
    expected_review_sequence: intent.expectedReviewSequence,
    request_id: intent.requestId,
    verdict: intent.draft.verdict as "learned" | "needs_work",
    feedback: intent.draft.feedback,
    open_retry_window: openRetryWindow,
    retry_minutes: openRetryWindow ? intent.draft.retryMinutes : null,
    extra_attempts: openRetryWindow ? intent.draft.extraAttempts : null,
  };
}

function freshWithResult(
  projection: ReviewFormProjection,
  result: ReviewFormActionState,
  lastHandledActionGeneration: number,
): ReviewFormLifecycle {
  return { ...createReviewFormLifecycle(projection), result, lastHandledActionGeneration };
}

export function reviewFormLifecycleReducer(
  lifecycle: ReviewFormLifecycle,
  event: ReviewFormLifecycleEvent,
): ReviewFormLifecycle {
  switch (event.type) {
    case "edit": {
      if (lifecycle.mode !== "ready") return lifecycle;
      const edited = { ...lifecycle.draft, [event.field]: event.value } as unknown as ReviewFormDraft;
      const draft = event.field === "verdict" && event.value !== "needs_work"
        ? { ...edited, openRetryWindow: false }
        : edited;
      return { ...lifecycle, draft, dirty: true, result: INITIAL_REVIEW_FORM_ACTION_STATE };
    }
    case "begin":
      if (lifecycle.mode !== "ready" || !lifecycle.draft.verdict) return lifecycle;
      return {
        ...lifecycle,
        mode: "submitting",
        intent: event.intent,
        result: INITIAL_REVIEW_FORM_ACTION_STATE,
        latestProjectionChanged: false,
      };
    case "retry_exact":
      if (lifecycle.mode !== "failed" || lifecycle.result.outcome !== "unknown" || !lifecycle.intent) return lifecycle;
      return { ...lifecycle, mode: "submitting", result: INITIAL_REVIEW_FORM_ACTION_STATE };
    case "action_result": {
      const generation = event.result.invocationGeneration;
      if (generation === undefined || generation <= lifecycle.lastHandledActionGeneration) return lifecycle;
      const withGeneration = { ...lifecycle, lastHandledActionGeneration: generation };
      if (withGeneration.mode !== "submitting" || !withGeneration.intent) return withGeneration;
      if (event.result.requestId !== withGeneration.intent.requestId) return withGeneration;
      if (event.result.outcome === "saved") {
        if (event.latestProjection.expectedReviewSequence !== withGeneration.intent.expectedReviewSequence) {
          return freshWithResult(event.latestProjection, event.result, generation);
        }
        return {
          ...withGeneration,
          draft: emptyReviewFormDraft(),
          dirty: false,
          mode: "awaiting_refresh",
          result: event.result,
          latestProjectionChanged: projectionChanged(lifecycle.projection, event.latestProjection),
        };
      }
      return {
        ...withGeneration,
        mode: "failed",
        result: event.result,
        latestProjectionChanged: projectionChanged(lifecycle.projection, event.latestProjection),
      };
    }
    case "sync_projection": {
      if (!projectionChanged(lifecycle.projection, event.projection)) return lifecycle;
      if (lifecycle.mode === "ready" && !lifecycle.dirty) {
        return freshWithResult(event.projection, lifecycle.result, lifecycle.lastHandledActionGeneration);
      }
      if (lifecycle.mode === "ready" && lifecycle.dirty) {
        return { ...lifecycle, mode: "stale_draft", latestProjectionChanged: true };
      }
      if (lifecycle.mode === "awaiting_refresh" && lifecycle.intent
        && event.projection.expectedReviewSequence !== lifecycle.intent.expectedReviewSequence) {
        return freshWithResult(event.projection, lifecycle.result, lifecycle.lastHandledActionGeneration);
      }
      if (lifecycle.mode === "refreshing") {
        return freshWithResult(event.projection, INITIAL_REVIEW_FORM_ACTION_STATE, lifecycle.lastHandledActionGeneration);
      }
      if (lifecycle.mode === "submitting") return lifecycle;
      return { ...lifecycle, latestProjectionChanged: true };
    }
    case "discard_and_refresh":
      return {
        ...createReviewFormLifecycle(event.projection),
        mode: "refreshing",
        latestProjectionChanged: false,
        lastHandledActionGeneration: lifecycle.lastHandledActionGeneration,
      };
  }
}
