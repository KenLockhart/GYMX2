import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedAccount: vi.fn(),
  requestCancellation: vi.fn(),
  getDetail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuthenticatedAccount: mocks.requireAuthenticatedAccount }));
vi.mock("@/lib/program-purchase-cancellation-server", () => ({
  requestProgramPurchaseCancellation: mocks.requestCancellation,
}));
vi.mock("@/lib/program-purchase-history-server", () => ({ getMyProgramPurchaseHistoryDetail: mocks.getDetail }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  refreshProgramPurchaseCancellationStatusAction,
  requestProgramPurchaseCancellationAction,
} from "./actions";

const orderId = "40000000-0000-4000-8000-000000000004";
const requestId = "50000000-0000-4000-8000-000000000005";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PROGRAM_CHECKOUT_ENABLED;
  mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { role: "member" } });
  mocks.requestCancellation.mockResolvedValue({ status: "cancellation_requested", revision: 2 });
  mocks.getDetail.mockResolvedValue({ ok: true, value: { orderId, cancellationStage: "none" } });
});

afterEach(() => {
  delete process.env.PROGRAM_CHECKOUT_ENABLED;
});

describe("Program purchase cancellation Server Action", () => {
  it("requires authentication and revalidates owner history after a validated request", async () => {
    process.env.PROGRAM_CHECKOUT_ENABLED = "false";
    await expect(requestProgramPurchaseCancellationAction(orderId, requestId)).resolves.toEqual({
      status: "cancellation_requested",
    });
    expect(mocks.requireAuthenticatedAccount).toHaveBeenCalledOnce();
    expect(mocks.requestCancellation).toHaveBeenCalledWith({ orderId, requestId });
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/program-purchases");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, `/program-purchases/${orderId}`);
  });

  it("keeps cancellation available without membership gating and maps prior request states without claiming completion", async () => {
    mocks.requestCancellation.mockResolvedValueOnce({ status: "already_requested", billingState: "canceled" });
    await expect(requestProgramPurchaseCancellationAction(orderId, requestId)).resolves.toEqual({
      status: "already_requested",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);

    mocks.revalidatePath.mockClear();
    mocks.requestCancellation.mockResolvedValueOnce({ status: "already_closed" });
    await expect(requestProgramPurchaseCancellationAction(orderId, requestId)).resolves.toEqual({ status: "already_closed" });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    expect(mocks.revalidatePath.mock.calls.flat()).not.toContain("/membership");
  });

  it("rejects malformed IDs before calling the cancellation RPC", async () => {
    await expect(requestProgramPurchaseCancellationAction("bad", requestId)).resolves.toEqual({
      status: "invalid_request",
    });
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not return database details or revalidate on unavailable results", async () => {
    mocks.requestCancellation.mockResolvedValueOnce({ status: "unavailable", message: "private DB details" });
    const result = await requestProgramPurchaseCancellationAction(orderId, requestId);
    expect(result).toEqual({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("allows Next authentication redirects to abort the action before any RPC", async () => {
    mocks.requireAuthenticatedAccount.mockRejectedValueOnce(new Error("redirect sentinel"));
    await expect(requestProgramPurchaseCancellationAction(orderId, requestId)).rejects.toThrow("redirect sentinel");
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
  });

  it("provides explicit owner status refresh without exposing database errors or revalidating", async () => {
    await expect(refreshProgramPurchaseCancellationStatusAction(orderId)).resolves.toEqual({
      status: "found", item: { orderId, cancellationStage: "none" },
    });
    expect(mocks.requireAuthenticatedAccount).toHaveBeenCalledOnce();
    expect(mocks.getDetail).toHaveBeenCalledWith(orderId);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    mocks.getDetail.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    await expect(refreshProgramPurchaseCancellationStatusAction(orderId)).resolves.toEqual({ status: "unavailable" });
    mocks.getDetail.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(refreshProgramPurchaseCancellationStatusAction(orderId)).resolves.toEqual({ status: "not_found" });
  });
});
