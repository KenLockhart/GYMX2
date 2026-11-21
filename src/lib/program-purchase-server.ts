import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  parseProgramPurchaseConfirmCommand,
  parseProgramPurchaseConfirmRpcResult,
  parseProgramPurchaseContextCommand,
  parseProgramPurchaseContextResult,
  parseProgramPurchaseQuoteCommand,
  parseProgramPurchaseQuoteResult,
  parseProgramPurchaseRequestCommand,
  parseProgramPurchaseRequestResult,
  sameProgramPurchasePayload,
  isUuid,
  type ProgramPurchaseConfirmCommand,
  type ProgramPurchaseConfirmResult,
  type ProgramPurchaseContext,
  type ProgramPurchaseQuote,
  type ProgramPurchaseQuoteResult,
  type ProgramPurchaseRead,
  type ProgramPurchaseRequest,
} from "./program-purchase-contracts";

type RpcError = { code?: string; message?: string } | null;
export type ProgramPurchaseRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError }>;
};

type BuyerClient = ProgramPurchaseRpcClient & {
  auth: {
    getUser(): PromiseLike<{
      data?: { user?: { id?: string } | null };
      error?: unknown;
    }>;
  };
};

export type ProgramPurchaseServerStore = {
  quote(programId: string, installmentCount: number, promotionCode: string | null): Promise<ProgramPurchaseQuoteResult>;
  loadRequest(requestId: string): Promise<ProgramPurchaseRead<ProgramPurchaseRequest>>;
  loadContext(orderId: string): Promise<ProgramPurchaseRead<ProgramPurchaseContext>>;
  confirmAtomic(command: ProgramPurchaseConfirmCommand, quote: ProgramPurchaseQuote): Promise<
    | { ok: true; status: "confirmed" | "already_confirmed" | "grant_created" | "already_granted"; orderId: string }
    | { ok: false; reason: string }
  >;
};

async function rpc(client: ProgramPurchaseRpcClient, name: string, args: Record<string, unknown>) {
  try {
    const result = await client.rpc(name, args);
    return result.error ? { data: null, failed: true as const } : { data: result.data, failed: false as const };
  } catch {
    return { data: null, failed: true as const };
  }
}

function safeQuoteFailure(reason: string): ProgramPurchaseQuoteResult {
  switch (reason) {
    case "invalid_request":
    case "buyer_ineligible":
    case "account_fenced":
    case "already_owned":
    case "promotion_unavailable":
    case "installment_invalid":
    case "charge_below_minimum":
      return { ok: false, reason };
    default:
      return { ok: false, reason: "quote_unavailable" };
  }
}

function safeConfirmFailure(reason: string): Extract<ProgramPurchaseConfirmResult, { ok: false }> {
  switch (reason) {
    case "quote_changed":
    case "consent_required":
    case "off_session_consent_required":
    case "terms_missing":
    case "request_conflict":
    case "account_fenced":
    case "buyer_ineligible":
    case "purchase_unavailable":
      return { ok: false, reason };
    default:
      return { ok: false, reason: "purchase_unavailable" };
  }
}

export function createProgramPurchaseServerStore(input: {
  buyerClient: ProgramPurchaseRpcClient;
  serviceClient?: ProgramPurchaseRpcClient;
  buyerId: string;
}): ProgramPurchaseServerStore {
  return {
    async quote(programId, installmentCount, promotionCode) {
      const response = await rpc(input.buyerClient, "get_my_program_purchase_quote", {
        p_program_id: programId,
        p_installment_count: installmentCount,
        p_promotion_code: promotionCode,
      });
      if (response.failed) return { ok: false, reason: "quote_unavailable" };
      const parsed = parseProgramPurchaseQuoteResult(response.data);
      if (!parsed.ok) return safeQuoteFailure(parsed.reason);
      if (parsed.quote.programId !== programId || parsed.quote.installmentCount !== installmentCount ||
          parsed.quote.promotionCode !== promotionCode) return { ok: false, reason: "invalid_response" };
      return parsed;
    },
    async loadRequest(requestId) {
      const response = await rpc(input.buyerClient, "get_my_program_purchase_request", {
        p_request_id: requestId,
      });
      if (response.failed) return { ok: false, reason: "unavailable" };
      const parsed = parseProgramPurchaseRequestResult(response.data);
      if (!parsed.ok) return { ok: false, reason: parsed.reason === "not_found" ? "not_found" : "invalid_response" };
      if (parsed.request.requestId !== requestId || parsed.request.buyerId !== input.buyerId) {
        return { ok: false, reason: "invalid_response" };
      }
      return { ok: true, value: parsed.request };
    },
    async loadContext(orderId) {
      const response = await rpc(input.buyerClient, "get_my_program_purchase_context", {
        p_order_id: orderId,
      });
      if (response.failed) return { ok: false, reason: "unavailable" };
      const parsed = parseProgramPurchaseContextResult(response.data);
      if (!parsed.ok) return { ok: false, reason: parsed.reason === "not_found" ? "not_found" : "invalid_response" };
      if (parsed.context.orderId !== orderId || parsed.context.buyerId !== input.buyerId) {
        return { ok: false, reason: "invalid_response" };
      }
      return { ok: true, value: parsed.context };
    },
    async confirmAtomic(command, quote) {
      if (!input.serviceClient) return { ok: false, reason: "purchase_unavailable" };
      const response = await rpc(input.serviceClient, "confirm_program_purchase", {
        p_buyer_id: input.buyerId,
        p_program_id: quote.programId,
        p_offer_version_id: quote.offerVersionId,
        p_installment_count: quote.installmentCount,
        p_request_id: command.requestId,
        p_promotion_code: quote.promotionCode,
        p_expected_quote_digest: quote.quoteDigest,
        p_charge_dates: quote.chargeDates,
        p_billing_consent: command.billingConsent,
        p_off_session_consent: command.offSessionConsent,
      });
      if (response.failed) return { ok: false, reason: "purchase_unavailable" };
      const parsed = parseProgramPurchaseConfirmRpcResult(response.data);
      if (!parsed.ok) return safeConfirmFailure(parsed.reason);
      return parsed;
    },
  };
}

export function isProgramPurchaseEnabled() {
  return process.env.PROGRAM_PURCHASE_ENABLED === "true";
}

async function authenticatedBuyer(): Promise<{ client: BuyerClient; buyerId: string } | null> {
  try {
    const client = await createClient() as unknown as BuyerClient;
    const { data, error } = await client.auth.getUser();
    const buyerId = data?.user?.id;
    if (error || !isUuid(buyerId)) return null;
    return { client, buyerId };
  } catch {
    return null;
  }
}

function storeFor(buyer: { client: BuyerClient; buyerId: string }, serviceClient?: ProgramPurchaseRpcClient) {
  return createProgramPurchaseServerStore({
    buyerClient: buyer.client,
    serviceClient,
    buyerId: buyer.buyerId,
  });
}

export async function getProgramPurchaseQuote(value: unknown): Promise<ProgramPurchaseQuoteResult> {
  if (!isProgramPurchaseEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = parseProgramPurchaseQuoteCommand(value);
  if (!command) return { ok: false, reason: "invalid_request" };
  const buyer = await authenticatedBuyer();
  if (!buyer) return { ok: false, reason: "buyer_auth_required" };
  const response = await rpc(buyer.client, "get_my_program_purchase_quote", {
    p_program_id: command.programId,
    p_installment_count: command.installmentCount,
    p_promotion_code: command.promotionCode,
  });
  if (response.failed) return { ok: false, reason: "quote_unavailable" };
  const parsed = parseProgramPurchaseQuoteResult(response.data);
  if (!parsed.ok) return safeQuoteFailure(parsed.reason);
  if (parsed.quote.programId !== command.programId || parsed.quote.installmentCount !== command.installmentCount ||
      parsed.quote.promotionCode !== command.promotionCode) return { ok: false, reason: "invalid_response" };
  return parsed;
}

export async function getMyProgramPurchaseRequest(value: unknown): Promise<ProgramPurchaseRead<ProgramPurchaseRequest>> {
  const command = parseProgramPurchaseRequestCommand(value);
  if (!command) return { ok: false, reason: "invalid_request" };
  const buyer = await authenticatedBuyer();
  if (!buyer) return { ok: false, reason: "unavailable" };
  return storeFor(buyer).loadRequest(command.requestId);
}

export async function getMyProgramPurchaseContext(value: unknown): Promise<ProgramPurchaseRead<ProgramPurchaseContext>> {
  const command = parseProgramPurchaseContextCommand(value);
  if (!command) return { ok: false, reason: "invalid_request" };
  const buyer = await authenticatedBuyer();
  if (!buyer) return { ok: false, reason: "unavailable" };
  return storeFor(buyer).loadContext(command.orderId);
}

function contextMatchesCommand(context: ProgramPurchaseContext, command: ProgramPurchaseConfirmCommand) {
  return context.requestId === command.requestId && context.programId === command.programId &&
    context.offerVersionId === command.offerVersionId && context.installmentCount === command.installmentCount &&
    context.promotionCode === command.promotionCode;
}

function recoveredResult(context: ProgramPurchaseContext): ProgramPurchaseConfirmResult {
  if (context.paymentPlan === "free") return { ok: true, status: "already_granted", context };
  if (!context.terms || context.billingRevision < 1) return { ok: false, reason: "terms_missing" };
  return { ok: true, status: "already_confirmed", context };
}

export async function confirmProgramPurchase(value: unknown): Promise<ProgramPurchaseConfirmResult> {
  if (!isProgramPurchaseEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = parseProgramPurchaseConfirmCommand(value);
  if (!command) return { ok: false, reason: "invalid_request" };
  const buyer = await authenticatedBuyer();
  if (!buyer) return { ok: false, reason: "buyer_auth_required" };

  const store = storeFor(buyer);
  const prior = await store.loadRequest(command.requestId);
  if (prior.ok) {
    if (!sameProgramPurchasePayload(prior.value, command) || prior.value.buyerId !== buyer.buyerId) {
      return { ok: false, reason: "request_conflict" };
    }
    const context = await store.loadContext(prior.value.orderId);
    if (!context.ok || !contextMatchesCommand(context.value, command)) return { ok: false, reason: "context_unavailable" };
    return recoveredResult(context.value);
  }
  if (prior.reason !== "not_found") return { ok: false, reason: "purchase_unavailable" };

  const quoteResponse = await rpc(buyer.client, "get_my_program_purchase_quote", {
    p_program_id: command.programId,
    p_installment_count: command.installmentCount,
    p_promotion_code: command.promotionCode,
  });
  if (quoteResponse.failed) return { ok: false, reason: "purchase_unavailable" };
  const quoteResult = parseProgramPurchaseQuoteResult(quoteResponse.data);
  if (!quoteResult.ok) return safeConfirmFailure(quoteResult.reason);
  const quote = quoteResult.quote;
  if (quote.programId !== command.programId || quote.offerVersionId !== command.offerVersionId ||
      quote.installmentCount !== command.installmentCount || quote.promotionCode !== command.promotionCode ||
      quote.quoteDigest !== command.quoteDigest) return { ok: false, reason: "quote_changed" };
  if (quote.effectiveTotalCents > 0 && !command.billingConsent) return { ok: false, reason: "consent_required" };
  if (command.offSessionConsent !== quote.offSessionConsent) return { ok: false, reason: "off_session_consent_required" };

  let serviceClient: ProgramPurchaseRpcClient;
  try {
    serviceClient = createAdminClient() as unknown as ProgramPurchaseRpcClient;
  } catch {
    return { ok: false, reason: "purchase_unavailable" };
  }
  const confirmed = await storeFor(buyer, serviceClient).confirmAtomic(command, quote);
  if (!confirmed.ok) return safeConfirmFailure(confirmed.reason);
  const context = await store.loadContext(confirmed.orderId);
  if (!context.ok || !contextMatchesCommand(context.value, command)) return { ok: false, reason: "context_unavailable" };
  if (context.value.paymentPlan === "free") {
    if (confirmed.status !== "grant_created" && confirmed.status !== "already_granted") {
      return { ok: false, reason: "invalid_response" };
    }
  } else if (confirmed.status !== "confirmed" && confirmed.status !== "already_confirmed") {
    return { ok: false, reason: "invalid_response" };
  }
  return { ok: true, status: confirmed.status, context: context.value };
}
