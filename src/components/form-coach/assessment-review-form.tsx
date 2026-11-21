"use client";

import { useActionState, useCallback, useEffect, useMemo, useReducer, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createReviewFormIntent,
  createReviewFormActionTransportGuard,
  createReviewFormLifecycle,
  INITIAL_REVIEW_FORM_ACTION_STATE,
  reviewFormIntentPayload,
  reviewFormLifecycleReducer,
  type ReviewFormAction,
  type ReviewFormActionPayload,
  type ReviewFormProjection,
} from "@/lib/form-coach/review-form-state";

export type FormCoachReviewAction = ReviewFormAction;

function isNextRedirectControlFlowError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT;");
}

function toFormData(payload: ReviewFormActionPayload): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(payload)) {
    if (name === "open_retry_window") {
      if (value === true) formData.set(name, "on");
      continue;
    }
    if (value === null || value === false) continue;
    formData.set(name, String(value));
  }
  return formData;
}

export function AssessmentReviewForm({
  assessmentId,
  itemId,
  attemptId,
  attemptNumber,
  expectedReviewSequence,
  requestId,
  canReview,
  canOpenRetry,
  maxExtraAttempts,
  action,
}: {
  assessmentId: string;
  itemId: string;
  attemptId: string;
  attemptNumber: number;
  expectedReviewSequence: number;
  requestId: string;
  canReview: boolean;
  canOpenRetry: boolean;
  maxExtraAttempts: number;
  action: FormCoachReviewAction;
}) {
  const router = useRouter();
  const projection = useMemo<ReviewFormProjection>(() => ({
    requestId,
    expectedReviewSequence,
    canReview,
    canOpenRetry,
    maxExtraAttempts,
  }), [requestId, expectedReviewSequence, canReview, canOpenRetry, maxExtraAttempts]);
  const target = useMemo(() => ({ assessmentId, itemId, attemptId }), [assessmentId, itemId, attemptId]);
  const [lifecycle, dispatch] = useReducer(reviewFormLifecycleReducer, projection, createReviewFormLifecycle);
  const nextActionGeneration = useRef(0);
  const guardedAction = useCallback<ReviewFormAction>(
    async (previousState, formData) => {
      const generation = ++nextActionGeneration.current;
      const invokeGuardedAction = createReviewFormActionTransportGuard(
        action,
        isNextRedirectControlFlowError,
        () => generation,
      );
      return invokeGuardedAction(previousState, formData);
    },
    [action],
  );
  const [actionState, formAction, pending] = useActionState(guardedAction, INITIAL_REVIEW_FORM_ACTION_STATE);

  useEffect(() => {
    dispatch({ type: "sync_projection", projection });
  }, [projection]);

  useEffect(() => {
    if (actionState.outcome === "idle") return;
    dispatch({ type: "action_result", result: actionState, latestProjection: projection });
  }, [actionState, projection]);

  const busy = pending || lifecycle.mode === "submitting" || lifecycle.mode === "refreshing";
  const fieldsDisabled = busy || lifecycle.mode !== "ready" || !lifecycle.projection.canReview;

  function invokeIntent(intent: NonNullable<typeof lifecycle.intent>, retrying: boolean) {
    if (retrying) dispatch({ type: "retry_exact" });
    else dispatch({ type: "begin", intent });
    startTransition(() => formAction(toFormData(reviewFormIntentPayload(intent))));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = createReviewFormIntent(lifecycle, target);
    if (!intent) return;
    invokeIntent(intent, false);
  }

  function retryExactIntent() {
    if (lifecycle.intent) invokeIntent(lifecycle.intent, true);
  }

  function discardAndRefresh() {
    dispatch({ type: "discard_and_refresh", projection });
    router.refresh();
  }

  const decisionHelpId = `review-attempt-${attemptId}-decision-help`;
  const staleCopy = lifecycle.mode === "stale_draft"
    ? "The assessment changed while this draft was open. Your draft and original review sequence are preserved. Discard it and refresh before starting a new review."
    : lifecycle.latestProjectionChanged
      ? "The assessment changed after this request began. The saved request still uses its original review sequence."
      : null;

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <input type="hidden" name="assessment_id" value={target.assessmentId} />
      <input type="hidden" name="item_id" value={target.itemId} />
      <input type="hidden" name="attempt_id" value={target.attemptId} />
      <input type="hidden" name="expected_review_sequence" value={lifecycle.projection.expectedReviewSequence} />
      <input type="hidden" name="request_id" value={lifecycle.projection.requestId} />
      <h4 className="font-semibold">Review finished attempt {attemptNumber}</h4>

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Decision</span>
        <select
          className="field-input"
          name="verdict"
          value={lifecycle.draft.verdict}
          onChange={(event) => dispatch({ type: "edit", field: "verdict", value: event.currentTarget.value as "" | "learned" | "needs_work" })}
          required
          disabled={fieldsDisabled}
          aria-describedby={decisionHelpId}
        >
          <option value="" disabled>Choose a review decision</option>
          <option value="learned">Learned</option>
          <option value="needs_work">Needs Work</option>
        </select>
        <span id={decisionHelpId} className="block text-xs text-muted">
          This decision is saved against the selected finished attempt.
        </span>
      </label>

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Feedback (optional)</span>
        <textarea
          className="field-input min-h-24"
          name="feedback"
          maxLength={1000}
          value={lifecycle.draft.feedback}
          onChange={(event) => dispatch({ type: "edit", field: "feedback", value: event.currentTarget.value })}
          disabled={fieldsDisabled}
        />
      </label>

      {lifecycle.projection.canOpenRetry && lifecycle.draft.verdict === "needs_work" && (
        <fieldset disabled={fieldsDisabled} className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Optional retry window</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              name="open_retry_window"
              checked={lifecycle.draft.openRetryWindow}
              onChange={(event) => dispatch({ type: "edit", field: "openRetryWindow", value: event.currentTarget.checked })}
            />
            <span>Allow another attempt in the existing assessment</span>
          </label>
          {lifecycle.draft.openRetryWindow && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Window length in minutes</span>
                <input
                  className="field-input"
                  type="number"
                  name="retry_minutes"
                  min={1}
                  max={43200}
                  step={1}
                  value={lifecycle.draft.retryMinutes}
                  onChange={(event) => dispatch({ type: "edit", field: "retryMinutes", value: event.currentTarget.value })}
                  required
                />
              </label>
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Additional attempts</span>
                <input
                  className="field-input"
                  type="number"
                  name="extra_attempts"
                  min={1}
                  max={lifecycle.projection.maxExtraAttempts}
                  step={1}
                  value={lifecycle.draft.extraAttempts}
                  onChange={(event) => dispatch({ type: "edit", field: "extraAttempts", value: event.currentTarget.value })}
                  required
                />
                <span className="block text-xs text-muted">Up to {lifecycle.projection.maxExtraAttempts} remain under the existing retry allowance.</span>
              </label>
            </div>
          )}
        </fieldset>
      )}

      {staleCopy && <p role="alert" className="text-sm text-danger">{staleCopy}</p>}
      {lifecycle.result.error && <p role="alert" className="text-sm text-danger">{lifecycle.result.error}</p>}
      {lifecycle.result.message && <p role="status" className="text-sm text-success">{lifecycle.result.message}</p>}
      {lifecycle.mode === "awaiting_refresh" && (
        <p role="status" className="text-sm text-muted">Refreshing the saved review sequence…</p>
      )}
      {lifecycle.mode === "refreshing" && (
        <p role="status" className="text-sm text-muted">Loading the latest review state…</p>
      )}

      {lifecycle.mode === "failed" && lifecycle.result.outcome === "unknown" && (
        <button className="btn-secondary min-h-11" type="button" onClick={retryExactIntent} disabled={busy}>
          Retry the exact same review
        </button>
      )}
      {(lifecycle.mode === "failed" || lifecycle.mode === "stale_draft" || lifecycle.mode === "awaiting_refresh") && (
        <button className="btn-secondary min-h-11" type="button" onClick={discardAndRefresh} disabled={busy}>
          Discard draft and refresh current review
        </button>
      )}
      {lifecycle.mode === "refreshing" && (
        <button className="btn-secondary min-h-11" type="button" onClick={() => router.refresh()} disabled={pending}>
          Refresh review state
        </button>
      )}
      {lifecycle.mode === "ready" && lifecycle.projection.canReview && (
        <button className="btn-primary min-h-11" type="submit" disabled={busy || !lifecycle.draft.verdict}>
          {busy ? "Saving review…" : "Save review"}
        </button>
      )}
    </form>
  );
}
