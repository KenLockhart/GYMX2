"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedAccount } from "@/lib/auth";
import {
  isProgramPurchaseHistoryUuid,
  type ProgramPurchaseHistoryItem,
} from "@/lib/program-purchase-history-contracts";
import { getMyProgramPurchaseHistoryDetail } from "@/lib/program-purchase-history-server";
import { requestProgramPurchaseCancellation } from "@/lib/program-purchase-cancellation-server";

export type ProgramPurchaseCancellationActionResult =
  | { status: "cancellation_requested" }
  | { status: "already_requested" }
  | { status: "already_closed" }
  | { status: "not_found" }
  | { status: "billing_history_only" }
  | { status: "account_fenced" }
  | { status: "invalid_request" }
  | { status: "unavailable" };

export type ProgramPurchaseCancellationRefreshResult =
  | { status: "found"; item: ProgramPurchaseHistoryItem }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "invalid_request" };

export async function refreshProgramPurchaseCancellationStatusAction(
  orderId: unknown,
): Promise<ProgramPurchaseCancellationRefreshResult> {
  await requireAuthenticatedAccount();
  if (!isProgramPurchaseHistoryUuid(orderId)) return { status: "invalid_request" };
  const result = await getMyProgramPurchaseHistoryDetail(orderId);
  if (result.ok) return { status: "found", item: result.value };
  if (result.reason === "not_found") return { status: "not_found" };
  return { status: "unavailable" };
}

export async function requestProgramPurchaseCancellationAction(
  orderId: unknown,
  requestId: unknown,
): Promise<ProgramPurchaseCancellationActionResult> {
  await requireAuthenticatedAccount();
  if (!isProgramPurchaseHistoryUuid(orderId) || !isProgramPurchaseHistoryUuid(requestId)) {
    return { status: "invalid_request" };
  }

  const result = await requestProgramPurchaseCancellation({ orderId, requestId });
  if (result.status === "cancellation_requested" || result.status === "already_requested") {
    revalidatePath("/program-purchases");
    revalidatePath(`/program-purchases/${orderId.toLowerCase()}`);
    return { status: result.status };
  }
  if (result.status === "already_closed") {
    revalidatePath("/program-purchases");
    revalidatePath(`/program-purchases/${orderId.toLowerCase()}`);
    return { status: "already_closed" };
  }
  if (result.status === "not_found" || result.status === "billing_history_only" ||
      result.status === "account_fenced" || result.status === "invalid_request") {
    return { status: result.status };
  }
  return { status: "unavailable" };
}
