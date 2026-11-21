import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import {
  parseProgramPurchaseCancellationRpcResult,
  requestProgramPurchaseCancellation,
} from "./program-purchase-cancellation-server";

const accountId = "10000000-0000-4000-8000-000000000001";
const orderId = "40000000-0000-4000-8000-000000000004";
const requestId = "50000000-0000-4000-8000-000000000005";

function setup() {
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } }, error: null });
  mocks.rpc.mockResolvedValue({ data: { status: "cancellation_requested", revision: 8 }, error: null });
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
}

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

describe("Program purchase cancellation server adapter", () => {
  it("authenticates through the user client and calls only the owner RPC with the two validated IDs", async () => {
    await expect(requestProgramPurchaseCancellation({
      orderId: orderId.toUpperCase(), requestId: requestId.toUpperCase(),
    })).resolves.toEqual({ status: "cancellation_requested", revision: 8 });
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("request_program_billing_cancellation", {
      p_order_id: orderId,
      p_request_id: requestId,
    });
  });

  it("does not call Supabase for invalid commands and does not accept extra fields", async () => {
    await expect(requestProgramPurchaseCancellation({ orderId: "bad", requestId })).resolves.toEqual({
      status: "invalid_request",
    });
    await expect(requestProgramPurchaseCancellation({ orderId, requestId, buyerId: accountId } as never))
      .resolves.toEqual({ status: "invalid_request" });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a genuine signed-in user before calling the authenticated RPC", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(requestProgramPurchaseCancellation({ orderId, requestId })).resolves.toEqual({ status: "unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("parses only exact whitelisted responses and rejects invalid revision or billing state", () => {
    expect(parseProgramPurchaseCancellationRpcResult({ status: "already_requested", billing_state: "canceled" }))
      .toEqual({ status: "already_requested", billingState: "canceled" });
    expect(parseProgramPurchaseCancellationRpcResult({ status: "already_closed" })).toEqual({ status: "already_closed" });
    expect(parseProgramPurchaseCancellationRpcResult({ status: "cancellation_requested", revision: 0 }))
      .toEqual({ status: "invalid_response" });
    expect(parseProgramPurchaseCancellationRpcResult({ status: "already_requested", billing_state: "provider_paid" }))
      .toEqual({ status: "invalid_response" });
    expect(parseProgramPurchaseCancellationRpcResult({ status: "not_found", detail: "private" }))
      .toEqual({ status: "invalid_response" });
    expect(parseProgramPurchaseCancellationRpcResult({ status: "unknown", message: "private" }))
      .toEqual({ status: "invalid_response" });
  });

  it("hides database errors and raw messages", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private database detail" } });
    await expect(requestProgramPurchaseCancellation({ orderId, requestId })).resolves.toEqual({ status: "unavailable" });
    mocks.rpc.mockRejectedValueOnce(new Error("private exception text"));
    const result = await requestProgramPurchaseCancellation({ orderId, requestId });
    expect(result).toEqual({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
