import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createFormCoachSummaryProvider: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("./summary-provider", () => ({
  createFormCoachSummaryProvider: mocks.createFormCoachSummaryProvider,
}));

import {
  FORM_COACH_SUMMARY_JOB_BUDGET_MS,
  FORM_COACH_SUMMARY_PROVIDER_MAX_MS,
  runFormCoachScheduledJobs,
  runFormCoachSummaryForAttempt,
} from "./jobs-server";

const outboxId = "a1000000-0000-4000-8000-000000000001";
const attemptId = "a1000000-0000-4000-8000-000000000002";
const claimToken = "a1000000-0000-4000-8000-000000000003";
const dispatchId = "a1000000-0000-4000-8000-000000000004";
const dispatchToken = "a1000000-0000-4000-8000-000000000005";
const numericPayload = {
  rep_count: 5,
  average_score: 84,
  minimum_score: 70,
  maximum_score: 92,
  rom_min_angle_average: 30,
  rom_max_angle_average: 120,
  rom_average: 86,
  elbow_average: 82,
  torso_average: 90,
  tempo_average: 85,
  shoulders_average: 84,
  max_upper_arm_drift: 24,
  max_torso_swing: 12,
  max_shrug: 0.22,
  concentric_ms_average: 950,
  top_pause_ms_average: 180,
  eccentric_ms_average: 1_100,
  curve_similarity_average: 88,
  elbow_drift_count: 1,
  torso_swing_count: 0,
  short_rom_count: 0,
  shoulder_shrug_count: 1,
};

const claim = {
  outbox_id: outboxId,
  attempt_id: attemptId,
  claim_token: claimToken,
  lease_expires_at: "2026-11-20T12:00:30.000Z",
};

const authorization = {
  authorized: true,
  outcome: "authorized",
  dispatch_id: dispatchId,
  dispatch_token: dispatchToken,
  remaining_budget_ms: 10_000,
  prompt_version: "attempt-summary-v1",
  numeric_payload: numericPayload,
};

function configuredProvider() {
  return {
    isConfigured: vi.fn(() => true),
    summarize: vi.fn().mockResolvedValue({
      status: "ready",
      promptVersion: "attempt-summary-v1",
      text: "Your range stayed consistent. Keep the lowering controlled.",
    }),
  };
}

function installRpc(responses: Record<string, unknown>) {
  const rpc = vi.fn(async (name: string) => {
    const response = responses[name];
    return response && typeof response === "object" && "data" in response
      ? response as { data: unknown; error: unknown }
      : { data: response ?? null, error: null };
  });
  mocks.createAdminClient.mockReturnValue({ rpc });
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminClient.mockReset();
  mocks.createFormCoachSummaryProvider.mockReturnValue(configuredProvider());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Form Coach bounded jobs", () => {
  it("checks provider configuration before claiming work", async () => {
    const provider = configuredProvider();
    provider.isConfigured.mockReturnValue(false);
    mocks.createFormCoachSummaryProvider.mockReturnValue(provider);

    await expect(runFormCoachSummaryForAttempt(attemptId)).resolves.toEqual({
      claimed: false,
      outcome: "unconfigured",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(provider.summarize).not.toHaveBeenCalled();
  });

  it("sends only the authorized 22-field payload and persists a sanitized result", async () => {
    const provider = configuredProvider();
    mocks.createFormCoachSummaryProvider.mockReturnValue(provider);
    const rpc = installRpc({
      service_claim_form_coach_summary_jobs_v2: { data: [claim], error: null },
      service_authorize_form_coach_summary_dispatch: { data: authorization, error: null },
      service_finish_form_coach_summary_dispatch: {
        data: { outcome: "complete" },
        error: null,
      },
    });

    await expect(runFormCoachSummaryForAttempt(attemptId)).resolves.toEqual({
      claimed: true,
      outcome: "complete",
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "service_claim_form_coach_summary_jobs_v2",
      "service_authorize_form_coach_summary_dispatch",
      "service_finish_form_coach_summary_dispatch",
    ]);
    expect(rpc).toHaveBeenNthCalledWith(1, "service_claim_form_coach_summary_jobs_v2", {
      target_limit: 1,
      target_attempt_id: attemptId,
    });
    expect(provider.summarize).toHaveBeenCalledTimes(1);
    expect(provider.summarize).toHaveBeenCalledWith(
      numericPayload,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeoutMs: expect.any(Number),
        deadlineAtMonotonic: expect.any(Number),
      }),
    );
    const requestOptions = provider.summarize.mock.calls[0]?.[1];
    expect(requestOptions?.timeoutMs).toBeGreaterThan(0);
    expect(requestOptions?.timeoutMs).toBeLessThanOrEqual(FORM_COACH_SUMMARY_PROVIDER_MAX_MS);
    expect(provider.summarize.mock.calls[0]?.[0]).toEqual(numericPayload);
    expect(Object.keys(provider.summarize.mock.calls[0]?.[0] as object)).toHaveLength(22);
    expect(rpc).toHaveBeenNthCalledWith(3, "service_finish_form_coach_summary_dispatch", {
      target_outbox_id: outboxId,
      target_claim_token: claimToken,
      target_dispatch_token: dispatchToken,
      target_outcome_category: "complete",
      target_summary: "Your range stayed consistent. Keep the lowering controlled.",
    });
    expect(FORM_COACH_SUMMARY_JOB_BUDGET_MS).toBe(10_000);
    expect(FORM_COACH_SUMMARY_PROVIDER_MAX_MS).toBeLessThanOrEqual(8_000);
  });

  it("does not start a provider call when authorization returns no one-use grant", async () => {
    const provider = configuredProvider();
    mocks.createFormCoachSummaryProvider.mockReturnValue(provider);
    const rpc = installRpc({
      service_claim_form_coach_summary_jobs_v2: { data: [claim], error: null },
      service_authorize_form_coach_summary_dispatch: {
        data: { authorized: false, outcome: "already_authorized" },
        error: null,
      },
    });

    await expect(runFormCoachSummaryForAttempt(attemptId)).resolves.toEqual({
      claimed: true,
      outcome: "discarded",
    });
    expect(provider.summarize).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not start a provider call when Form Coach is disabled after the claim", async () => {
    const provider = configuredProvider();
    mocks.createFormCoachSummaryProvider.mockReturnValue(provider);
    const rpc = installRpc({
      service_claim_form_coach_summary_jobs_v2: { data: [claim], error: null },
      service_authorize_form_coach_summary_dispatch: {
        data: { authorized: false, outcome: "feature_disabled" },
        error: null,
      },
    });

    await expect(runFormCoachSummaryForAttempt(attemptId)).resolves.toEqual({
      claimed: true,
      outcome: "discarded",
    });
    expect(provider.summarize).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).not.toHaveBeenCalledWith(
      "service_finish_form_coach_summary_dispatch",
      expect.anything(),
    );
  });

  it("does not start a provider call when the account deletion fence rejects authorization", async () => {
    const provider = configuredProvider();
    mocks.createFormCoachSummaryProvider.mockReturnValue(provider);
    const rpc = installRpc({
      service_claim_form_coach_summary_jobs_v2: { data: [claim], error: null },
      service_authorize_form_coach_summary_dispatch: {
        data: { authorized: false, outcome: "account_deleting" },
        error: null,
      },
    });

    await expect(runFormCoachSummaryForAttempt(attemptId)).resolves.toEqual({
      claimed: true,
      outcome: "discarded",
    });
    expect(provider.summarize).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("settles an exhausted grant budget without calling the provider", async () => {
    const provider = configuredProvider();
    mocks.createFormCoachSummaryProvider.mockReturnValue(provider);
    const rpc = installRpc({
      service_claim_form_coach_summary_jobs_v2: { data: [claim], error: null },
      service_authorize_form_coach_summary_dispatch: {
        data: { ...authorization, remaining_budget_ms: 0 },
        error: null,
      },
      service_finish_form_coach_summary_dispatch: {
        data: { outcome: "retryable_timeout" },
        error: null,
      },
    });

    await expect(runFormCoachSummaryForAttempt(attemptId)).resolves.toEqual({
      claimed: true,
      outcome: "retry_scheduled",
    });
    expect(provider.summarize).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("service_finish_form_coach_summary_dispatch", {
      target_outbox_id: outboxId,
      target_claim_token: claimToken,
      target_dispatch_token: dispatchToken,
      target_outcome_category: "retryable_timeout",
      target_summary: null,
    });
  });

  it("limits each scheduled pass to one Program send and keeps its result aggregate", async () => {
    const provider = configuredProvider();
    provider.isConfigured.mockReturnValue(false);
    mocks.createFormCoachSummaryProvider.mockReturnValue(provider);
    const sendOutboxId = "a2000000-0000-4000-8000-000000000001";
    const sendClaimToken = "a2000000-0000-4000-8000-000000000002";
    const rpc = installRpc({
      service_expire_form_coach_assessments: { data: 2, error: null },
      service_claim_form_coach_program_sends: {
        data: [{ outbox_id: sendOutboxId, claim_token: sendClaimToken }],
        error: null,
      },
      service_process_form_coach_program_send: { data: { outcome: "processed" }, error: null },
    });

    await expect(runFormCoachScheduledJobs()).resolves.toEqual({
      expiredAssessments: 2,
      programSendsClaimed: 1,
      programSendsProcessed: 1,
      summariesClaimed: 0,
      summariesCompleted: 0,
      summariesRetryScheduled: 0,
      summariesUnavailable: 0,
      failures: 0,
    });
    expect(rpc).toHaveBeenCalledWith("service_expire_form_coach_assessments", {
      target_limit: 25,
    });
    expect(rpc).toHaveBeenCalledWith("service_claim_form_coach_program_sends", {
      target_limit: 1,
      lease_seconds: 30,
    });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(provider.summarize).not.toHaveBeenCalled();
  });
});
