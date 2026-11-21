import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  createFormCoachSummaryProvider,
  type FormCoachSummaryRequestOptions,
  type FormCoachSummaryResult,
} from "./summary-provider";

export const FORM_COACH_SUMMARY_JOB_BUDGET_MS = 10_000;
export const FORM_COACH_SUMMARY_PROVIDER_MAX_MS = 8_000;
const SUMMARY_CLAIM_RPC = "service_claim_form_coach_summary_jobs_v2";
const SUMMARY_AUTHORIZE_RPC = "service_authorize_form_coach_summary_dispatch";
const SUMMARY_FINISH_RPC = "service_finish_form_coach_summary_dispatch";

export type FormCoachSummaryJobOutcome =
  | "not_claimed"
  | "unconfigured"
  | "complete"
  | "retry_scheduled"
  | "unavailable"
  | "discarded"
  | "failed";

export type FormCoachSummaryJobResult = Readonly<{
  claimed: boolean;
  outcome: FormCoachSummaryJobOutcome;
}>;

export type FormCoachScheduledJobCounts = Readonly<{
  expiredAssessments: number;
  programSendsClaimed: number;
  programSendsProcessed: number;
  summariesClaimed: number;
  summariesCompleted: number;
  summariesRetryScheduled: number;
  summariesUnavailable: number;
  failures: number;
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  rpc(name: string, args?: Record<string, unknown>): Promise<RpcResponse>;
}>;
type RpcRow = Record<string, unknown>;

function isRecord(value: unknown): value is RpcRow {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstRow(value: unknown): RpcRow | null {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : null;
  return isRecord(value) ? value : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function awaitWithAbort<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Form Coach job deadline expired", "TimeoutError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve(operation).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Form Coach scheduled step expired", "TimeoutError")),
    timeoutMs,
  );
  try {
    return await awaitWithAbort(operation, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function providerOutcome(result: FormCoachSummaryResult): Readonly<{
  category: string;
  summary: string | null;
}> {
  if (result.status === "ready") {
    return { category: "complete", summary: result.text };
  }
  if (result.status === "retryable") {
    return { category: `retryable_${result.category}`, summary: null };
  }
  if (result.status === "unavailable") {
    return { category: `unavailable_${result.category}`, summary: null };
  }
  if (result.status === "invalid_input") {
    return { category: "unavailable_invalid_input", summary: null };
  }
  return { category: "retryable_unconfigured", summary: null };
}

function finishedOutcome(value: unknown): FormCoachSummaryJobOutcome {
  const row = firstRow(value);
  const outcome = row?.outcome;
  if (outcome === "complete" || outcome === "already_recorded") return "complete";
  if (typeof outcome === "string" && outcome.startsWith("retryable_")) {
    return "retry_scheduled";
  }
  if (outcome === "attempt_limit" || (typeof outcome === "string" && outcome.startsWith("unavailable_"))) {
    return "unavailable";
  }
  if (
    outcome === "blocked_deletion" ||
    outcome === "authorization_expired" ||
    outcome === "stale_claim" ||
    outcome === "stale_dispatch" ||
    outcome === "stale_result" ||
    outcome === "ineligible"
  ) {
    return "discarded";
  }
  return "failed";
}

async function executeFormCoachSummaryJob(
  targetAttemptId: string | null,
): Promise<FormCoachSummaryJobResult> {
  if (targetAttemptId !== null && !isUuid(targetAttemptId)) {
    return { claimed: false, outcome: "not_claimed" };
  }

  const provider = createFormCoachSummaryProvider();
  if (!provider.isConfigured()) {
    return { claimed: false, outcome: "unconfigured" };
  }

  const startedAt = performance.now();
  const jobDeadline = startedAt + FORM_COACH_SUMMARY_JOB_BUDGET_MS;
  const abortController = new AbortController();
  let claimReceived = false;
  const budgetTimer = setTimeout(
    () => abortController.abort(new DOMException("Summary job deadline expired", "TimeoutError")),
    FORM_COACH_SUMMARY_JOB_BUDGET_MS,
  );

  try {
    const client = createAdminClient() as unknown as RpcClient;
    const claimResponse = await awaitWithAbort(client.rpc(SUMMARY_CLAIM_RPC, {
      target_limit: 1,
      target_attempt_id: targetAttemptId,
    }), abortController.signal);
    if (claimResponse.error) return { claimed: false, outcome: "failed" };
    const claim = firstRow(claimResponse.data);
    if (!claim) return { claimed: false, outcome: "not_claimed" };
    claimReceived = true;

    const outboxId = claim.outbox_id;
    const attemptId = claim.attempt_id;
    const claimToken = claim.claim_token;
    if (
      typeof outboxId !== "string" ||
      !isUuid(outboxId) ||
      typeof attemptId !== "string" ||
      !isUuid(attemptId) ||
      typeof claimToken !== "string" ||
      !isUuid(claimToken)
    ) {
      return { claimed: true, outcome: "failed" };
    }
    if (jobDeadline - performance.now() <= 0) {
      return { claimed: true, outcome: "failed" };
    }

    const authorizationStartedAt = performance.now();
    const authorizationResponse = await awaitWithAbort(client.rpc(SUMMARY_AUTHORIZE_RPC, {
      target_outbox_id: outboxId,
      target_claim_token: claimToken,
    }), abortController.signal);
    const authorizationElapsed = performance.now() - authorizationStartedAt;
    if (authorizationResponse.error) {
      return { claimed: claimReceived, outcome: "failed" };
    }
    const authorization = firstRow(authorizationResponse.data);
    if (!authorization || authorization.authorized !== true) {
      return { claimed: claimReceived, outcome: "discarded" };
    }

    const dispatchToken = authorization.dispatch_token;
    const dispatchId = authorization.dispatch_id;
    const promptVersion = authorization.prompt_version;
    const remainingBudgetFromDatabase = authorization.remaining_budget_ms;
    const now = performance.now();
    const remainingJobBudget = Math.floor(jobDeadline - now);
    const remainingGrantBudget =
      nonnegativeInteger(remainingBudgetFromDatabase) - authorizationElapsed;
    const timeoutMs = Math.floor(
      Math.min(
        FORM_COACH_SUMMARY_PROVIDER_MAX_MS,
        remainingJobBudget,
        remainingGrantBudget,
      ),
    );

    if (
      typeof dispatchToken !== "string" ||
      !isUuid(dispatchToken) ||
      typeof dispatchId !== "string" ||
      !isUuid(dispatchId) ||
      promptVersion !== "attempt-summary-v1"
    ) {
      return { claimed: claimReceived, outcome: "failed" };
    }

    const finish = async (category: string, summary: string | null) => {
      const response = await awaitWithAbort(client.rpc(SUMMARY_FINISH_RPC, {
        target_outbox_id: outboxId,
        target_claim_token: claimToken,
        target_dispatch_token: dispatchToken,
        target_outcome_category: category,
        target_summary: summary,
      }), abortController.signal);
      if (response.error) return "failed" as const;
      return finishedOutcome(response.data);
    };

    if (timeoutMs <= 0 || abortController.signal.aborted) {
      const outcome = await finish("retryable_timeout", null);
      return { claimed: true, outcome };
    }

    const providerOptions: FormCoachSummaryRequestOptions = {
      signal: abortController.signal,
      timeoutMs,
      deadlineAtMonotonic: now + timeoutMs,
    };
    const generated = await awaitWithAbort(provider.summarize(
      authorization.numeric_payload,
      providerOptions,
    ), abortController.signal);
    const normalized = providerOutcome(generated);
    const outcome = await finish(normalized.category, normalized.summary);
    return { claimed: true, outcome };
  } catch {
    return { claimed: claimReceived, outcome: "failed" };
  } finally {
    clearTimeout(budgetTimer);
  }
}

export function runFormCoachSummaryForAttempt(
  attemptId: string,
): Promise<FormCoachSummaryJobResult> {
  return executeFormCoachSummaryJob(attemptId);
}

export function runNextFormCoachSummaryJob(): Promise<FormCoachSummaryJobResult> {
  return executeFormCoachSummaryJob(null);
}

export async function runFormCoachScheduledJobs(): Promise<FormCoachScheduledJobCounts> {
  const counts = {
    expiredAssessments: 0,
    programSendsClaimed: 0,
    programSendsProcessed: 0,
    summariesClaimed: 0,
    summariesCompleted: 0,
    summariesRetryScheduled: 0,
    summariesUnavailable: 0,
    failures: 0,
  };
  let client: RpcClient;
  try {
    client = createAdminClient() as unknown as RpcClient;
  } catch {
    return { ...counts, failures: 1 };
  }

  try {
    const expiry = await withTimeout(client.rpc("service_expire_form_coach_assessments", {
      target_limit: 25,
    }), 5_000);
    if (expiry.error) counts.failures += 1;
    else counts.expiredAssessments = nonnegativeInteger(expiry.data);
  } catch {
    counts.failures += 1;
  }

  try {
    const claimed = await withTimeout(client.rpc("service_claim_form_coach_program_sends", {
      target_limit: 1,
      lease_seconds: 30,
    }), 5_000);
    if (claimed.error) {
      counts.failures += 1;
    } else {
      const row = firstRow(claimed.data);
      if (row) {
        const outboxId = row.outbox_id;
        const claimToken = row.claim_token;
        if (
          typeof outboxId !== "string" ||
          !isUuid(outboxId) ||
          typeof claimToken !== "string" ||
          !isUuid(claimToken)
        ) {
          counts.failures += 1;
        } else {
          counts.programSendsClaimed = 1;
          const processed = await withTimeout(client.rpc("service_process_form_coach_program_send", {
            target_outbox_id: outboxId,
            target_claim_token: claimToken,
          }), 22_000);
          if (processed.error) counts.failures += 1;
          else counts.programSendsProcessed = 1;
        }
      }
    }
  } catch {
    counts.failures += 1;
  }

  const summary = await runNextFormCoachSummaryJob();
  if (summary.claimed) counts.summariesClaimed = 1;
  if (summary.outcome === "complete") counts.summariesCompleted = 1;
  if (summary.outcome === "retry_scheduled") counts.summariesRetryScheduled = 1;
  if (summary.outcome === "unavailable") counts.summariesUnavailable = 1;
  if (summary.outcome === "failed") counts.failures += 1;

  return counts;
}
