import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  isProgramPurchaseHistoryUuid,
  parseProgramPurchaseHistoryDetailCommand,
  parseProgramPurchaseHistoryDetailResult,
  parseProgramPurchaseHistoryListCommand,
  parseProgramPurchaseHistoryListResult,
  parseProgramPurchaseHistoryProgramId,
  type ExistingProgramPurchaseRead,
  type ProgramPurchaseHistoryItem,
  type ProgramPurchaseHistoryListCommand,
  type ProgramPurchaseHistoryPage,
  type ProgramPurchaseHistoryRead,
} from "./program-purchase-history-contracts";

type RpcError = { code?: string; message?: string } | null;

export type ProgramPurchaseHistoryRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError }>;
};

type AuthenticatedHistoryClient = ProgramPurchaseHistoryRpcClient & {
  auth: {
    getUser(): PromiseLike<{
      data?: { user?: { id?: string } | null };
      error?: unknown;
    }>;
  };
};

export type ProgramPurchaseHistoryServerStore = {
  list(value: unknown): Promise<ProgramPurchaseHistoryRead<ProgramPurchaseHistoryPage>>;
  detail(value: unknown): Promise<ProgramPurchaseHistoryRead<ProgramPurchaseHistoryItem>>;
  findExistingProgramPurchase(value: unknown): Promise<ExistingProgramPurchaseRead>;
};

async function rpc(client: ProgramPurchaseHistoryRpcClient, name: string, args: Record<string, unknown>) {
  try {
    const response = await client.rpc(name, args);
    return response.error ? { data: null, failed: true as const } : { data: response.data, failed: false as const };
  } catch {
    return { data: null, failed: true as const };
  }
}

export function createProgramPurchaseHistoryServerStore(
  buyerClient: ProgramPurchaseHistoryRpcClient,
): ProgramPurchaseHistoryServerStore {
  async function list(command: ProgramPurchaseHistoryListCommand): Promise<ProgramPurchaseHistoryRead<ProgramPurchaseHistoryPage>> {
    const response = await rpc(buyerClient, "get_my_program_purchase_history", {
      p_limit: command.limit,
      p_cursor_created_at: command.cursor?.createdAt ?? null,
      p_cursor_order_id: command.cursor?.orderId ?? null,
      p_program_id: command.programId,
    });
    if (response.failed) return { ok: false, reason: "unavailable" };
    const parsed = parseProgramPurchaseHistoryListResult(response.data);
    if (!parsed.ok) return parsed;
    if (parsed.value.items.length > command.limit ||
        (command.programId !== null && parsed.value.items.some((item) => item.programId !== command.programId)) ||
        (parsed.value.hasMore && parsed.value.items.length !== command.limit)) {
      return { ok: false, reason: "invalid_response" };
    }
    return parsed;
  }

  return {
    async list(value) {
      const command = parseProgramPurchaseHistoryListCommand(value);
      return command ? list(command) : { ok: false, reason: "invalid_request" };
    },
    async detail(value) {
      const orderId = parseProgramPurchaseHistoryDetailCommand(value);
      if (!orderId) return { ok: false, reason: "invalid_request" };
      const response = await rpc(buyerClient, "get_my_program_purchase_history_detail", { p_order_id: orderId });
      if (response.failed) return { ok: false, reason: "unavailable" };
      const parsed = parseProgramPurchaseHistoryDetailResult(response.data);
      if (!parsed.ok) return parsed;
      return parsed.value.orderId === orderId ? parsed : { ok: false, reason: "invalid_response" };
    },
    async findExistingProgramPurchase(value) {
      const programId = parseProgramPurchaseHistoryProgramId(value);
      if (!programId) return { ok: false, reason: "invalid_request" };
      const page = await list({ limit: 1, cursor: null, programId });
      if (!page.ok) {
        const reason = page.reason === "invalid_request" || page.reason === "unavailable"
          ? page.reason
          : "invalid_response";
        return { ok: false, reason };
      }
      // Program orders are unique for a buyer and Program. A second page means the
      // supposedly unique relationship is inconsistent, so callers must not treat
      // the first row as an authoritative existing purchase.
      if (page.value.hasMore || page.value.items.length > 1) return { ok: false, reason: "invalid_response" };
      return { ok: true, orderId: page.value.items[0]?.orderId ?? null };
    },
  };
}

async function authenticatedBuyerClient(): Promise<AuthenticatedHistoryClient | null> {
  try {
    const client = await createClient() as unknown as AuthenticatedHistoryClient;
    const { data, error } = await client.auth.getUser();
    if (error || !isProgramPurchaseHistoryUuid(data?.user?.id)) return null;
    return client;
  } catch {
    return null;
  }
}

export async function getMyProgramPurchaseHistory(
  value: unknown,
): Promise<ProgramPurchaseHistoryRead<ProgramPurchaseHistoryPage>> {
  const command = parseProgramPurchaseHistoryListCommand(value);
  if (!command) return { ok: false, reason: "invalid_request" };
  const buyerClient = await authenticatedBuyerClient();
  if (!buyerClient) return { ok: false, reason: "unavailable" };
  return createProgramPurchaseHistoryServerStore(buyerClient).list(command);
}

export async function getMyProgramPurchaseHistoryDetail(
  value: unknown,
): Promise<ProgramPurchaseHistoryRead<ProgramPurchaseHistoryItem>> {
  const orderId = parseProgramPurchaseHistoryDetailCommand(value);
  if (!orderId) return { ok: false, reason: "invalid_request" };
  const buyerClient = await authenticatedBuyerClient();
  if (!buyerClient) return { ok: false, reason: "unavailable" };
  return createProgramPurchaseHistoryServerStore(buyerClient).detail(orderId);
}

export async function findExistingProgramPurchase(value: unknown): Promise<ExistingProgramPurchaseRead> {
  const programId = parseProgramPurchaseHistoryProgramId(value);
  if (!programId) return { ok: false, reason: "invalid_request" };
  const buyerClient = await authenticatedBuyerClient();
  if (!buyerClient) return { ok: false, reason: "unavailable" };
  return createProgramPurchaseHistoryServerStore(buyerClient).findExistingProgramPurchase(programId);
}
