import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  buyerRpc: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import {
  createProgramPurchaseHistoryServerStore,
  findExistingProgramPurchase,
  getMyProgramPurchaseHistory,
  getMyProgramPurchaseHistoryDetail,
} from "./program-purchase-history-server";

const userId = "63010000-0000-4000-8000-000000000001";
const programId = "63030000-0000-4000-8000-000000000001";
const otherProgramId = "63030000-0000-4000-8000-000000000002";
const orderId = "63090000-0000-4000-8000-000000000001";
const createdAt = "2027-01-31T14:30:00.123456+00:00";

function rpcOk(data: unknown) {
  return { data, error: null };
}

function historyItem(overrides: Record<string, unknown> = {}) {
  return {
    order_id: orderId,
    program_id: programId,
    program_label: "Program",
    created_at: createdAt,
    currency: "usd",
    list_price_cents: 1200,
    discount_cents: 200,
    effective_total_cents: 1000,
    payment_plan: "pay_in_full",
    installment_count: 1,
    installment_amounts_cents: [1000],
    cleared_installments: 0,
    has_recorded_refund: false,
    payment_stage: "checkout_open",
    cancellation_stage: "none",
    safety_stage: "clear",
    checkout_retry_hint: false,
    next_due_date: null,
    retry_deadline: null,
    ...overrides,
  };
}

function readyPage(overrides: Record<string, unknown> = {}) {
  return { status: "ready", items: [historyItem()], has_more: false, next_cursor: null, ...overrides };
}

function setupBuyer() {
  const client = { auth: { getUser: mocks.authGetUser }, rpc: mocks.buyerRpc };
  mocks.authGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.createClient.mockResolvedValue(client);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PROGRAM_PURCHASE_ENABLED;
  mocks.buyerRpc.mockResolvedValue(rpcOk(readyPage()));
  setupBuyer();
});

describe("Program purchase history server adapter", () => {
  it("authenticates before listing with the same user-scoped client and exact RPC arguments", async () => {
    const cursorCreatedAt = "2027-01-31T14:30:00.123456+00:00";
    await expect(getMyProgramPurchaseHistory({
      limit: 20,
      cursor: { createdAt: cursorCreatedAt, orderId: orderId.toUpperCase() },
      programId: programId.toUpperCase(),
    })).resolves.toMatchObject({ ok: true, value: { items: [{ orderId }], hasMore: false } });
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.authGetUser).toHaveBeenCalledOnce();
    expect(mocks.buyerRpc).toHaveBeenCalledWith("get_my_program_purchase_history", {
      p_limit: 20,
      p_cursor_created_at: cursorCreatedAt,
      p_cursor_order_id: orderId,
      p_program_id: programId,
    });
  });

  it("does not call a privileged client or require membership, role, or purchase flag for owner reads", async () => {
    process.env.PROGRAM_PURCHASE_ENABLED = "false";
    await expect(getMyProgramPurchaseHistory({ limit: 10 })).resolves.toMatchObject({ ok: true });
    expect(mocks.buyerRpc).toHaveBeenCalledOnce();
    expect(mocks.buyerRpc.mock.calls[0][0]).toBe("get_my_program_purchase_history");
    expect(mocks.buyerRpc.mock.calls[0][1]).not.toHaveProperty("p_buyer_id");
    expect(mocks.createClient).toHaveBeenCalledOnce();
  });

  it("returns no RPC for anonymous or malformed authenticated user identity", async () => {
    mocks.authGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(getMyProgramPurchaseHistory({ limit: 10 })).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(mocks.buyerRpc).not.toHaveBeenCalled();

    mocks.authGetUser.mockResolvedValueOnce({ data: { user: { id: "not-a-uuid" } }, error: null });
    await expect(getMyProgramPurchaseHistoryDetail(orderId)).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(mocks.buyerRpc).not.toHaveBeenCalled();
  });

  it("validates requests before auth and never accepts a caller-supplied buyer", async () => {
    await expect(getMyProgramPurchaseHistory({ limit: 10, buyerId: userId })).resolves.toEqual({
      ok: false, reason: "invalid_request",
    });
    await expect(getMyProgramPurchaseHistoryDetail({ orderId })).resolves.toEqual({
      ok: false, reason: "invalid_request",
    });
    await expect(findExistingProgramPurchase({ programId })).resolves.toEqual({ ok: false, reason: "invalid_request" });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.buyerRpc).not.toHaveBeenCalled();
  });

  it("loads owner detail by order ID and rejects a mismatched row", async () => {
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk({ status: "ready", item: historyItem() }));
    await expect(getMyProgramPurchaseHistoryDetail(orderId)).resolves.toMatchObject({
      ok: true, value: { orderId, programId, programLabel: "Program" },
    });
    expect(mocks.buyerRpc).toHaveBeenCalledWith("get_my_program_purchase_history_detail", { p_order_id: orderId });

    mocks.buyerRpc.mockResolvedValueOnce(rpcOk({
      status: "ready", item: historyItem({ order_id: "63090000-0000-4000-8000-000000000099" }),
    }));
    await expect(getMyProgramPurchaseHistoryDetail(orderId)).resolves.toEqual({
      ok: false, reason: "invalid_response",
    });
  });

  it("rejects a wrong Program filter and duplicate or inconsistent pages", async () => {
    const client = setupBuyer();
    const store = createProgramPurchaseHistoryServerStore(client);
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk(readyPage({ items: [historyItem({ program_id: otherProgramId })] })));
    await expect(store.list({ limit: 10, programId })).resolves.toEqual({ ok: false, reason: "invalid_response" });

    mocks.buyerRpc.mockResolvedValueOnce(rpcOk(readyPage({ items: [historyItem(), historyItem()] })));
    await expect(store.list({ limit: 10 })).resolves.toEqual({ ok: false, reason: "invalid_response" });

    mocks.buyerRpc.mockResolvedValueOnce(rpcOk(readyPage({ has_more: true })));
    await expect(store.list({ limit: 2 })).resolves.toEqual({ ok: false, reason: "invalid_response" });
  });

  it("distinguishes a successful empty discovery from unavailable data", async () => {
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk({ status: "ready", items: [], has_more: false, next_cursor: null }));
    await expect(findExistingProgramPurchase(programId)).resolves.toEqual({ ok: true, orderId: null });
    expect(mocks.buyerRpc).toHaveBeenLastCalledWith("get_my_program_purchase_history", {
      p_limit: 1,
      p_cursor_created_at: null,
      p_cursor_order_id: null,
      p_program_id: programId,
    });

    mocks.buyerRpc.mockRejectedValueOnce(new Error("private backend details"));
    await expect(findExistingProgramPurchase(programId)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns an owned order ID for a unique filtered result and rejects duplicate history", async () => {
    await expect(findExistingProgramPurchase(programId)).resolves.toEqual({ ok: true, orderId });
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk({
      status: "ready", items: [historyItem()], has_more: true,
      next_cursor: { created_at: createdAt, order_id: orderId },
    }));
    await expect(findExistingProgramPurchase(programId)).resolves.toEqual({ ok: false, reason: "invalid_response" });
  });

  it("does not expose database or transport errors, and maps owner not-found honestly", async () => {
    mocks.buyerRpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret internal text" } });
    await expect(getMyProgramPurchaseHistory({ limit: 10 })).resolves.toEqual({ ok: false, reason: "unavailable" });
    mocks.buyerRpc.mockResolvedValueOnce(rpcOk({ status: "not_found" }));
    await expect(getMyProgramPurchaseHistoryDetail(orderId)).resolves.toEqual({ ok: false, reason: "not_found" });
  });
});
