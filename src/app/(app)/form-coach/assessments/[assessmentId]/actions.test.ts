import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCoach: vi.fn(),
  getDetail: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireCoach: mocks.requireCoach }));
vi.mock("@/lib/form-coach/review-server", () => ({ getCoachFormCoachReviewDetail: mocks.getDetail }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { recordFormCoachReviewAction } from "./actions";
const idleState = { outcome: "idle" as const };

const coachId = "f1000000-0000-4000-8000-000000000001";
const assessmentId = "f1000000-0000-4000-8000-000000000003";
const itemId = "f1000000-0000-4000-8000-000000000004";
const attemptId = "f1000000-0000-4000-8000-000000000005";
const requestId = "f1000000-0000-4000-8000-000000000006";

function detail(overrides: Record<string, unknown> = {}) {
  return {
    assessment_id: assessmentId,
    items: [{
      item_id: itemId,
      can_review: false,
      expected_review_sequence: 8,
      attempts: [{ attempt_id: attemptId, state: "finished" }],
    }],
    ...overrides,
  };
}

function formData(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    assessment_id: assessmentId,
    item_id: itemId,
    attempt_id: attemptId,
    expected_review_sequence: "2",
    request_id: requestId,
    verdict: "needs_work",
    feedback: "Keep the elbow steady.",
    ...overrides,
  })) form.set(name, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCoach.mockResolvedValue({ profile: { id: coachId, role: "coach" } });
  mocks.getDetail.mockResolvedValue({ kind: "ready", value: detail() });
});

describe("coach review action", () => {
  it("posts the submitted CAS sequence unchanged and revalidates both authorized histories", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "recorded" }, error: null });
    mocks.createClient.mockResolvedValue({ rpc });

    await expect(recordFormCoachReviewAction(idleState, formData({
      feedback: "  Keep the elbow steady.  ",
      open_retry_window: "on", retry_minutes: "60", extra_attempts: "2",
    }))).resolves.toEqual({ outcome: "saved", requestId, message: "Review saved." });
    expect(rpc).toHaveBeenCalledWith("record_form_coach_review", {
      target_attempt_id: attemptId,
      target_expected_review_sequence: 2,
      target_request_id: requestId,
      target_verdict: "needs_work",
      target_feedback: "  Keep the elbow steady.  ",
      open_retry_window: true,
      retry_minutes: 60,
      extra_attempts: 2,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/form-coach/assessments/${assessmentId}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/form-checks/${assessmentId}`);
  });

  it("allows an exact idempotency replay even when the current capability has closed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "already_recorded" }, error: null });
    mocks.createClient.mockResolvedValue({ rpc });

    await expect(recordFormCoachReviewAction(idleState, formData({ verdict: "learned" }))).resolves.toEqual({
      outcome: "saved",
      requestId,
      message: "This review was already saved.",
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][1]).toMatchObject({
      target_expected_review_sequence: 2,
      target_request_id: requestId,
      target_verdict: "learned",
      open_retry_window: false,
      retry_minutes: null,
      extra_attempts: null,
    });
  });

  it("rejects malformed retry requests and a forged item or unfinished attempt before writing", async () => {
    mocks.createClient.mockResolvedValue({ rpc: vi.fn() });
    await expect(recordFormCoachReviewAction(idleState, formData({
      verdict: "learned", open_retry_window: "on", retry_minutes: "60", extra_attempts: "1",
    }))).resolves.toMatchObject({ outcome: "rejected", error: expect.stringContaining("only be opened") });
    await expect(recordFormCoachReviewAction(idleState, formData({ feedback: "x".repeat(1001) })))
      .resolves.toMatchObject({ outcome: "rejected", error: "Check the review fields and try again." });
    expect(mocks.createClient).not.toHaveBeenCalled();

    mocks.getDetail.mockResolvedValue({ kind: "ready", value: detail({ items: [] }) });
    await expect(recordFormCoachReviewAction(idleState, formData())).resolves.toMatchObject({
      outcome: "rejected",
      error: "Review unavailable. Refresh the assessment and try again.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does not call the write RPC for a mismatched assessment or non-finished attempt", async () => {
    mocks.createClient.mockResolvedValue({ rpc: vi.fn() });
    mocks.getDetail.mockResolvedValue({ kind: "ready", value: detail({ assessment_id: "f1000000-0000-4000-8000-000000000099" }) });
    await recordFormCoachReviewAction(idleState, formData());
    expect(mocks.createClient).not.toHaveBeenCalled();

    mocks.getDetail.mockResolvedValue({ kind: "ready", value: detail({
      items: [{ item_id: itemId, attempts: [{ attempt_id: attemptId, state: "running" }] }],
    }) });
    await recordFormCoachReviewAction(idleState, formData());
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("maps stale database conflicts to refresh copy without exposing database details", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "40001", message: "private SQL detail" } });
    mocks.createClient.mockResolvedValue({ rpc });
    await expect(recordFormCoachReviewAction(idleState, formData())).resolves.toEqual({
      outcome: "rejected",
      requestId,
      error: "This assessment changed. Refresh it and review the latest history.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps exact-retry available for coded transport and unclassified RPC failures", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST301", message: "transport failed" } })
      .mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "unclassified failure" } });
    mocks.createClient.mockResolvedValue({ rpc });

    await expect(recordFormCoachReviewAction(idleState, formData())).resolves.toEqual({
      outcome: "unknown",
      requestId,
      error: "The review could not be confirmed. Retry the exact same review to check its status.",
    });
    await expect(recordFormCoachReviewAction(idleState, formData())).resolves.toEqual({
      outcome: "unknown",
      requestId,
      error: "The review could not be confirmed. Retry the exact same review to check its status.",
    });
  });

  it("classifies known database validation failures as definite rejections", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "22023", message: "private SQL detail" } });
    mocks.createClient.mockResolvedValue({ rpc });
    await expect(recordFormCoachReviewAction(idleState, formData())).resolves.toEqual({
      outcome: "rejected",
      requestId,
      error: "Review unavailable. Refresh the assessment and try again.",
    });
  });

  it("fails closed if authentication does not resolve to a coach", async () => {
    mocks.requireCoach.mockResolvedValue({ profile: { id: "f1000000-0000-4000-8000-000000000002", role: "member" } });
    await expect(recordFormCoachReviewAction(idleState, formData())).resolves.toEqual({
      outcome: "rejected",
      requestId,
      error: "Review unavailable. Refresh the assessment and try again.",
    });
    expect(mocks.getDetail).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("preserves Next authentication redirects instead of converting them to review errors", async () => {
    const redirect = Object.assign(new Error("Redirect to login."), {
      digest: "NEXT_REDIRECT;push;/login;307;",
    });
    mocks.requireCoach.mockRejectedValue(redirect);
    await expect(recordFormCoachReviewAction(idleState, formData())).rejects.toBe(redirect);
    expect(mocks.getDetail).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
