"use server";

import {
  confirmProgramPurchase,
  getMyProgramPurchaseContext,
  getMyProgramPurchaseRequest,
  getProgramPurchaseQuote,
  isProgramPurchaseEnabled,
} from "@/lib/program-purchase-server";
import {
  findExistingProgramPurchase,
  getMyProgramPurchaseHistoryDetail,
} from "@/lib/program-purchase-history-server";
import { isProgramCheckoutEnabled, retryProgramCheckoutForBuyer, startProgramCheckout } from "@/lib/program-checkout-server";
import { createClient } from "@/lib/supabase/server";
import { parseProgramCheckoutRetryCommand, parseProgramCheckoutStartCommand } from "@/lib/program-checkout-contracts";
import { isUuid, parseProgramPurchaseConfirmCommand } from "@/lib/program-purchase-contracts";
import type { ProgramPurchaseContext, ProgramPurchaseRequest } from "@/lib/program-purchase-contracts";
import type { ProgramPurchaseHistoryItem } from "@/lib/program-purchase-history-contracts";

type OwnedPurchaseView = {
  status: "found";
  orderId: string;
  context: ProgramPurchaseContext;
  history: ProgramPurchaseHistoryItem;
};

type OwnedPurchaseLoad =
  | OwnedPurchaseView
  | { status: "not_found" | "unavailable" | "invalid_response" };

type PurchaseViewRead = OwnedPurchaseLoad | { status: "empty" };

type PurchaseRecoveryRead =
  | (OwnedPurchaseView & { request: ProgramPurchaseRequest })
  | { status: "not_found" | "unavailable" | "invalid_response" };

function safeReadStatus(reason: string): "not_found" | "unavailable" | "invalid_response" {
  if (reason === "not_found") return "not_found";
  if (reason === "invalid_response") return "invalid_response";
  return "unavailable";
}

async function loadOwnedPurchaseView(orderId: string, programId: string): Promise<OwnedPurchaseLoad> {
  const contextResult = await getMyProgramPurchaseContext({ orderId });
  if (!contextResult.ok) return { status: safeReadStatus(contextResult.reason) };
  if (contextResult.value.orderId !== orderId || contextResult.value.programId !== programId) {
    return { status: "invalid_response" };
  }

  const historyResult = await getMyProgramPurchaseHistoryDetail(orderId);
  if (!historyResult.ok) return { status: safeReadStatus(historyResult.reason) };
  if (historyResult.value.orderId !== orderId || historyResult.value.programId !== programId) {
    return { status: "invalid_response" };
  }

  return { status: "found", orderId, context: contextResult.value, history: historyResult.value };
}

export async function discoverProgramPurchaseAction(programId: string): Promise<PurchaseViewRead> {
  const existing = await findExistingProgramPurchase(programId);
  if (!existing.ok) return { status: safeReadStatus(existing.reason) };
  if (existing.orderId === null) return { status: "empty" };
  return loadOwnedPurchaseView(existing.orderId, programId);
}

export async function recoverProgramPurchaseAction(
  requestId: string,
  programId: string,
): Promise<PurchaseRecoveryRead> {
  const requestResult = await getMyProgramPurchaseRequest({ requestId });
  if (!requestResult.ok) return { status: safeReadStatus(requestResult.reason) };
  const request = requestResult.value;
  if (request.requestId !== requestId || request.programId !== programId) return { status: "invalid_response" };

  const view = await loadOwnedPurchaseView(request.orderId, programId);
  if (view.status !== "found" || view.context.requestId !== requestId) {
    return view.status === "found" ? { status: "invalid_response" } : view;
  }
  return { ...view, request };
}

export async function quoteProgramPurchaseAction(
  programId: string,
  installmentCount: number,
  promotionCode: string | null,
) {
  return getProgramPurchaseQuote({ programId, installmentCount, promotionCode });
}

async function matchesExpectedBuyer(expectedBuyerId: string): Promise<boolean> {
  if (!isUuid(expectedBuyerId)) return false;
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    return !error && data?.user?.id === expectedBuyerId;
  } catch {
    return false;
  }
}

export async function confirmProgramPurchaseAction(value: unknown, expectedBuyerId: string) {
  if (!isProgramPurchaseEnabled()) return { ok: false as const, reason: "feature_disabled" as const };
  const command = parseProgramPurchaseConfirmCommand(value);
  if (!command) return confirmProgramPurchase(value);
  if (command.installmentCount > 0 && !isProgramCheckoutEnabled()) {
    return { ok: false as const, reason: "checkout_disabled" as const };
  }
  if (!(await matchesExpectedBuyer(expectedBuyerId))) {
    return { ok: false as const, reason: "buyer_auth_required" as const };
  }
  return confirmProgramPurchase(value);
}

export async function startProgramCheckoutAction(orderId: string, expectedRevision: number, expectedBuyerId: string) {
  if (!isProgramCheckoutEnabled()) return { status: "blocked" as const, reason: "feature_disabled" };
  const command = parseProgramCheckoutStartCommand({ orderId, expectedRevision });
  if (!command) return startProgramCheckout({ orderId, expectedRevision });
  if (!(await matchesExpectedBuyer(expectedBuyerId))) {
    return { status: "blocked" as const, reason: "buyer_auth_or_membership_required" };
  }
  return startProgramCheckout(command);
}

export async function retryProgramCheckoutAction(
  orderId: string,
  expectedRevision: number,
  requestId: string,
  expectedBuyerId: string,
) {
  if (!isProgramCheckoutEnabled()) return { status: "blocked" as const, reason: "feature_disabled" };
  const command = parseProgramCheckoutRetryCommand({ orderId, expectedRevision, requestId });
  if (!command) return retryProgramCheckoutForBuyer({ orderId, expectedRevision, requestId });
  if (!(await matchesExpectedBuyer(expectedBuyerId))) {
    return { status: "blocked" as const, reason: "buyer_auth_or_membership_required" };
  }
  return retryProgramCheckoutForBuyer(command);
}
