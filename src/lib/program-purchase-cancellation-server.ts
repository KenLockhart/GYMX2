import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isProgramPurchaseHistoryUuid } from "./program-purchase-history-contracts";

export type ProgramPurchaseCancellationResult =
  | { status: "cancellation_requested"; revision: number }
  | { status: "already_requested"; billingState: ProgramCancellationBillingState }
  | { status: "already_closed" }
  | { status: "not_found" }
  | { status: "billing_history_only" }
  | { status: "account_fenced" }
  | { status: "invalid_request" }
  | { status: "unavailable" }
  | { status: "invalid_response" };

export type ProgramCancellationBillingState =
  | "terms_saved"
  | "checkout_ready"
  | "active"
  | "cancel_requested"
  | "canceled"
  | "paid"
  | "deletion_pending"
  | "financial_conflict"
  | "manual_review";

type CancellationRpcClient = {
  auth: {
    getUser(): PromiseLike<{
      data?: { user?: { id?: string } | null };
      error?: unknown;
    }>;
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown | null }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isCancellationBillingState(value: unknown): value is ProgramCancellationBillingState {
  return typeof value === "string" && [
    "terms_saved", "checkout_ready", "active", "cancel_requested", "canceled", "paid",
    "deletion_pending", "financial_conflict", "manual_review",
  ].includes(value);
}

export function parseProgramPurchaseCancellationRpcResult(value: unknown): ProgramPurchaseCancellationResult {
  if (!isRecord(value) || typeof value.status !== "string") return { status: "invalid_response" };

  if (value.status === "cancellation_requested") {
    return exactKeys(value, ["status", "revision"]) &&
      typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision > 0
      ? { status: "cancellation_requested", revision: value.revision }
      : { status: "invalid_response" };
  }
  if (value.status === "already_requested") {
    return exactKeys(value, ["status", "billing_state"]) && isCancellationBillingState(value.billing_state)
      ? { status: "already_requested", billingState: value.billing_state }
      : { status: "invalid_response" };
  }

  const emptyStatuses = [
    "already_closed", "not_found", "billing_history_only", "account_fenced", "invalid_request",
  ] as const;
  if (emptyStatuses.includes(value.status as (typeof emptyStatuses)[number]) && exactKeys(value, ["status"])) {
    return { status: value.status as (typeof emptyStatuses)[number] };
  }
  return { status: "invalid_response" };
}

export async function requestProgramPurchaseCancellation(value: {
  orderId: unknown;
  requestId: unknown;
}): Promise<ProgramPurchaseCancellationResult> {
  if (!isRecord(value) || !exactKeys(value, ["orderId", "requestId"]) ||
      !isProgramPurchaseHistoryUuid(value.orderId) || !isProgramPurchaseHistoryUuid(value.requestId)) {
    return { status: "invalid_request" };
  }

  try {
    const client = await createClient() as unknown as CancellationRpcClient;
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !isProgramPurchaseHistoryUuid(authData?.user?.id)) return { status: "unavailable" };
    const { data, error } = await client.rpc("request_program_billing_cancellation", {
      p_order_id: value.orderId.toLowerCase(),
      p_request_id: value.requestId.toLowerCase(),
    });
    if (error) return { status: "unavailable" };
    return parseProgramPurchaseCancellationRpcResult(data);
  } catch {
    return { status: "unavailable" };
  }
}
