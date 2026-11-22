"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCoach } from "@/lib/auth";
import { getCoachFormCoachReviewDetail } from "@/lib/form-coach/review-server";
import { createClient } from "@/lib/supabase/server";
import type { ReviewFormActionState } from "@/lib/form-coach/review-form-state";

const uuidSchema = z.string().uuid();
const integerField = (maxDigits: number) => z.string()
  .regex(new RegExp(`^\\d{1,${maxDigits}}$`))
  .transform(Number);

const reviewInputSchema = z.object({
  assessmentId: uuidSchema,
  itemId: uuidSchema,
  attemptId: uuidSchema,
  expectedSequence: integerField(10).pipe(z.number().int().min(0).max(2_147_483_647)),
  requestId: uuidSchema,
  verdict: z.enum(["learned", "needs_work"]),
  feedback: z.string().refine((value) => Array.from(value).length <= 1000),
  openRetryWindow: z.boolean(),
  retryMinutes: integerField(5).pipe(z.number().int().min(1).max(43_200)).optional(),
  extraAttempts: integerField(1).pipe(z.number().int().min(1).max(3)).optional(),
}).strict();

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function safeFormInput(formData: FormData) {
  const openRetryWindow = formString(formData, "open_retry_window") === "on";
  const raw = {
    assessmentId: formString(formData, "assessment_id"),
    itemId: formString(formData, "item_id"),
    attemptId: formString(formData, "attempt_id"),
    expectedSequence: formString(formData, "expected_review_sequence"),
    requestId: formString(formData, "request_id"),
    verdict: formString(formData, "verdict"),
    feedback: formString(formData, "feedback"),
    openRetryWindow,
    ...(openRetryWindow ? {
      retryMinutes: formString(formData, "retry_minutes"),
      extraAttempts: formString(formData, "extra_attempts"),
    } : {}),
  };
  return reviewInputSchema.safeParse(raw);
}

const ReviewResultSchema = z.object({
  outcome: z.enum(["recorded", "already_recorded", "feature_disabled", "item_learned"]),
}).passthrough();

const definiteReviewAbortCodes = new Set([
  "22023", // invalid RPC arguments
  "23505", // request ID reused with a different payload
  "40001", // stale review sequence
  "42501", // authorization changed
  "54000", // retry allowance exhausted
  "55000", // review state or funding is unavailable
  "P0002", // referenced row is unavailable
]);

type ReviewActionResult = Omit<ReviewFormActionState, "requestId">;

function withRequestId(requestId: string, result: ReviewActionResult): ReviewFormActionState {
  return { ...result, requestId };
}

function isNextRedirectControlFlowError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT;");
}

export async function recordFormCoachReviewAction(
  _: ReviewFormActionState,
  formData: FormData,
): Promise<ReviewFormActionState> {
  const requestId = formString(formData, "request_id");
  let writeStarted = false;
  let confirmedWrite: "recorded" | "already_recorded" | null = null;
  try {
    const account = await requireCoach();
    if (account.profile.role !== "coach") {
      return withRequestId(requestId, { outcome: "rejected", error: "Review unavailable. Refresh the assessment and try again." });
    }

    const parsed = safeFormInput(formData);
    if (!parsed.success) return withRequestId(requestId, { outcome: "rejected", error: "Check the review fields and try again." });
    const input = parsed.data;
    if (input.openRetryWindow && input.verdict !== "needs_work") {
      return withRequestId(requestId, { outcome: "rejected", error: "A retry window can only be opened for a Needs Work review." });
    }

    const current = await getCoachFormCoachReviewDetail(input.assessmentId);
    if (current.kind !== "ready" || current.value.assessment_id !== input.assessmentId) {
      return withRequestId(requestId, { outcome: "rejected", error: "Review unavailable. Refresh the assessment and try again." });
    }
    const item = current.value.items.find((candidate) => candidate.item_id === input.itemId);
    const attempt = item?.attempts.find((candidate) => candidate.attempt_id === input.attemptId);
    if (!item || !attempt || attempt.state !== "finished") {
      return withRequestId(requestId, { outcome: "rejected", error: "Review unavailable. Refresh the assessment and try again." });
    }

    const client = await createClient();
    writeStarted = true;
    const { data, error } = await client.rpc("record_form_coach_review", {
      target_attempt_id: input.attemptId,
      // Preserve the posted CAS token: the RPC checks exact request replay before comparing it.
      target_expected_review_sequence: input.expectedSequence,
      target_request_id: input.requestId,
      target_verdict: input.verdict,
      target_feedback: input.feedback,
      open_retry_window: input.openRetryWindow,
      retry_minutes: input.openRetryWindow ? input.retryMinutes : null,
      extra_attempts: input.openRetryWindow ? input.extraAttempts : null,
    });
    if (error) {
      const code = typeof error.code === "string" ? error.code : null;
      const definiteAbort = code !== null && definiteReviewAbortCodes.has(code);
      return {
        ...withRequestId(requestId, { outcome: definiteAbort ? "rejected" : "unknown" }),
        error: code === "40001"
          ? "This assessment changed. Refresh it and review the latest history."
          : definiteAbort
            ? "Review unavailable. Refresh the assessment and try again."
            : "The review could not be confirmed. Retry the exact same review to check its status.",
      };
    }

    const result = ReviewResultSchema.safeParse(data);
    if (!result.success) {
      return withRequestId(requestId, {
        outcome: "unknown",
        error: "The review could not be confirmed. Retry the exact same review to check its status.",
      });
    }
    if (result.data.outcome === "feature_disabled") {
      return withRequestId(requestId, { outcome: "rejected", error: "Form Coach reviews are currently unavailable. The saved history is still available." });
    }
    if (result.data.outcome === "item_learned") {
      return withRequestId(requestId, { outcome: "rejected", error: "This exercise is already marked Learned. Refresh the assessment to see its latest history." });
    }

    confirmedWrite = result.data.outcome;
    try {
      revalidatePath(`/form-coach/assessments/${input.assessmentId}`);
      revalidatePath(`/form-checks/${input.assessmentId}`);
    } catch {
      return withRequestId(requestId, {
        outcome: "saved",
        message: "Review saved. Refresh the assessment to see the latest history.",
      });
    }
    return withRequestId(requestId, {
      outcome: "saved",
      message: result.data.outcome === "recorded" ? "Review saved." : "This review was already saved.",
    });
  } catch (error) {
    if (isNextRedirectControlFlowError(error)) throw error;
    if (confirmedWrite) {
      return withRequestId(requestId, {
        outcome: "saved",
        message: "Review saved. Refresh the assessment to see the latest history.",
      });
    }
    return withRequestId(requestId, writeStarted
      ? { outcome: "unknown", error: "The review could not be confirmed. Retry the exact same review to check its status." }
      : { outcome: "rejected", error: "Review unavailable. Refresh the assessment and try again." });
  }
}
