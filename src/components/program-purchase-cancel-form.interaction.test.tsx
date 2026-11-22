// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgramPurchaseHistoryItem } from "@/lib/program-purchase-history-contracts";
import { programPurchaseCancellationStorageKey } from "@/lib/program-purchase-history-ui";

const mocks = vi.hoisted(() => ({
  requestCancellation: vi.fn(),
  refreshStatus: vi.fn(),
  refreshRoute: vi.fn(),
}));

vi.mock("@/app/(app)/program-purchases/actions", () => ({
  requestProgramPurchaseCancellationAction: mocks.requestCancellation,
  refreshProgramPurchaseCancellationStatusAction: mocks.refreshStatus,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refreshRoute }) }));

import { ProgramPurchaseCancellationForm } from "./program-purchase-cancel-form";

const accountId = "10000000-0000-4000-8000-000000000001";
const otherAccountId = "10000000-0000-4000-8000-000000000009";
const orderId = "40000000-0000-4000-8000-000000000004";
const requestId = "50000000-0000-4000-8000-000000000005";

function historyItem(overrides: Partial<ProgramPurchaseHistoryItem> = {}): ProgramPurchaseHistoryItem {
  return {
    orderId,
    programId: "20000000-0000-4000-8000-000000000002",
    programLabel: "Program",
    createdAt: "2027-01-31T14:30:00.123456+00:00",
    currency: "usd",
    listPriceCents: 12000,
    discountCents: 0,
    effectiveTotalCents: 12000,
    paymentPlan: "installments",
    installmentCount: 3,
    installmentAmountsCents: [4000, 4000, 4000],
    clearedInstallments: 1,
    hasRecordedRefund: false,
    paymentStage: "partially_settled",
    cancellationStage: "none",
    safetyStage: "clear",
    checkoutRetryHint: false,
    nextDueDate: "2027-02-28",
    retryDeadline: null,
    ...overrides,
  };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function click(host: HTMLElement, label: string) {
  await act(async () => {
    button(host, label).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function submit(host: HTMLElement) {
  const form = host.querySelector("form");
  if (!form) throw new Error("Missing cancellation form");
  await act(async () => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function acceptNotice(host: HTMLElement) {
  const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!checkbox) throw new Error("Missing cancellation acknowledgement checkbox");
  act(() => checkbox.click());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

let host: HTMLDivElement;
let root: Root;

async function mount(buyer = accountId, item = historyItem()) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ProgramPurchaseCancellationForm accountId={buyer} item={item} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.requestCancellation.mockResolvedValue({ status: "cancellation_requested" });
  mocks.refreshStatus.mockResolvedValue({ status: "found", item: historyItem() });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.restoreAllMocks();
});

describe("mounted Program purchase cancellation request", () => {
  it("saves the stable request ID before invoking the authenticated action", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    const key = programPurchaseCancellationStorageKey(accountId, orderId);
    mocks.requestCancellation.mockImplementation(async (sentOrderId: string, sentRequestId: string) => {
      const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
      expect(saved).toEqual({ version: 1, accountId, orderId, requestId });
      expect([sentOrderId, sentRequestId]).toEqual([orderId, requestId]);
      return { status: "cancellation_requested" };
    });
    await mount();
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
    acceptNotice(host);
    await submit(host);

    expect(mocks.requestCancellation).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Your request was submitted");
    expect(host.textContent).toContain("Previously paid stages remain available subject to normal access rules");
    expect(JSON.parse(window.sessionStorage.getItem(key) ?? "null").requestId).toBe(requestId);
  });

  it("requires an explicit owner refresh and retries only the same saved request ID", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    mocks.requestCancellation.mockResolvedValueOnce({ status: "unavailable" });
    await mount();
    acceptNotice(host);
    await submit(host);
    expect(host.textContent).toContain("Refresh the saved status before trying again");
    expect(host.querySelector("form")).toBeNull();

    await click(host, "Refresh saved status");
    expect(mocks.refreshStatus).toHaveBeenCalledWith(orderId);
    expect(host.textContent).toContain("reuse the same request identifier");
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(button(host, "Retry the same request")).toBeTruthy();
    acceptNotice(host);
    await submit(host);

    expect(mocks.requestCancellation).toHaveBeenCalledTimes(2);
    expect(mocks.requestCancellation.mock.calls).toEqual([[orderId, requestId], [orderId, requestId]]);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("blocks mutation if session storage cannot persist the request ID", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    await mount();
    acceptNotice(host);
    await submit(host);
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
    expect(host.textContent).toContain("cannot save the request safely");
  });

  it("prevents duplicate requests while the first explicit submission is pending", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    const pending = deferred<{ status: string }>();
    mocks.requestCancellation.mockReturnValueOnce(pending.promise);
    await mount();
    acceptNotice(host);
    const form = host.querySelector("form");
    if (!form) throw new Error("Missing cancellation form");
    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve({ status: "cancellation_requested" });
      await pending.promise;
    });
  });

  it("fences a delayed old-account response after the account namespace changes", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    const pending = deferred<{ status: string }>();
    mocks.requestCancellation.mockReturnValueOnce(pending.promise);
    await mount(accountId);
    acceptNotice(host);
    await submit(host);
    const otherKey = programPurchaseCancellationStorageKey(otherAccountId, orderId);
    await act(async () => {
      root.render(<ProgramPurchaseCancellationForm accountId={otherAccountId} item={historyItem()} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      pending.resolve({ status: "cancellation_requested" });
      await pending.promise;
    });
    expect(window.sessionStorage.getItem(otherKey)).toBeNull();
    expect(host.textContent).not.toContain("Your request was submitted");
  });

  it("hides an authorized retry after a same-order rerender settles the purchase and retains the saved ID", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    mocks.requestCancellation.mockResolvedValueOnce({ status: "unavailable" });
    await mount();
    acceptNotice(host);
    await submit(host);

    const key = programPurchaseCancellationStorageKey(accountId, orderId);
    const savedRequest = window.sessionStorage.getItem(key);
    await click(host, "Refresh saved status");
    expect(button(host, "Retry the same request")).toBeTruthy();
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();

    const staleForm = host.querySelector("form");
    if (!staleForm) throw new Error("Expected an explicitly authorized retry form");
    await act(async () => {
      root.render(<ProgramPurchaseCancellationForm accountId={accountId} item={historyItem({
        paymentStage: "settled",
        clearedInstallments: 3,
        nextDueDate: null,
        retryDeadline: null,
      })} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.querySelector("form")).toBeNull();
    expect(button(host, "Refresh saved status")).toBeTruthy();
    expect(window.sessionStorage.getItem(key)).toBe(savedRequest);
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
    await act(async () => {
      staleForm.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem(key)).toBe(savedRequest);
  });

  it("hides an authorized retry after a same-order rerender adds a safety hold and retains the saved ID", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    mocks.requestCancellation.mockResolvedValueOnce({ status: "unavailable" });
    await mount();
    acceptNotice(host);
    await submit(host);

    const key = programPurchaseCancellationStorageKey(accountId, orderId);
    const savedRequest = window.sessionStorage.getItem(key);
    await click(host, "Refresh saved status");
    expect(button(host, "Retry the same request")).toBeTruthy();
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();

    const staleForm = host.querySelector("form");
    if (!staleForm) throw new Error("Expected an explicitly authorized retry form");
    await act(async () => {
      root.render(<ProgramPurchaseCancellationForm accountId={accountId} item={historyItem({
        paymentStage: "unknown",
        cancellationStage: "none",
        safetyStage: "manual_review",
        clearedInstallments: 0,
        nextDueDate: null,
        retryDeadline: null,
      })} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.querySelector("form")).toBeNull();
    expect(button(host, "Refresh saved status")).toBeTruthy();
    expect(window.sessionStorage.getItem(key)).toBe(savedRequest);
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
    await act(async () => {
      staleForm.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem(key)).toBe(savedRequest);
  });

  it("retains the exact saved request through an unknown manual-review result and retries only after clear recovery", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    const heldItem = historyItem({
      paymentStage: "unknown",
      cancellationStage: "unknown",
      safetyStage: "manual_review",
      clearedInstallments: 0,
      nextDueDate: null,
      retryDeadline: null,
    });
    mocks.requestCancellation
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce({ status: "cancellation_requested" });
    mocks.refreshStatus
      .mockResolvedValueOnce({ status: "found", item: heldItem })
      .mockResolvedValueOnce({ status: "found", item: historyItem() });

    await mount();
    acceptNotice(host);
    await submit(host);
    const key = programPurchaseCancellationStorageKey(accountId, orderId);
    expect(JSON.parse(window.sessionStorage.getItem(key) ?? "null").requestId).toBe(requestId);

    await click(host, "Refresh saved status");
    expect(host.textContent).toContain("request identifier has been retained");
    expect(button(host, "Refresh saved status")).toBeTruthy();
    expect(host.querySelector("form")).toBeNull();
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem(key)).not.toBeNull();
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();

    await click(host, "Refresh saved status");
    expect(host.textContent).toContain("reuse the same request identifier");
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
    acceptNotice(host);
    await submit(host);

    expect(mocks.requestCancellation.mock.calls).toEqual([[orderId, requestId], [orderId, requestId]]);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("retains the exact saved request through a temporary safety hold and retries only after clear recovery", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    const heldItem = historyItem({
      paymentStage: "unknown",
      cancellationStage: "none",
      safetyStage: "manual_review",
      clearedInstallments: 0,
      nextDueDate: null,
      retryDeadline: null,
    });
    mocks.requestCancellation
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce({ status: "cancellation_requested" });
    mocks.refreshStatus
      .mockResolvedValueOnce({ status: "found", item: heldItem })
      .mockResolvedValueOnce({ status: "found", item: historyItem() });

    await mount();
    acceptNotice(host);
    await submit(host);
    const key = programPurchaseCancellationStorageKey(accountId, orderId);
    const savedRequest = window.sessionStorage.getItem(key);
    expect(JSON.parse(savedRequest ?? "null").requestId).toBe(requestId);

    await click(host, "Refresh saved status");
    expect(host.textContent).toContain("request identifier has been retained");
    expect(host.querySelector("form")).toBeNull();
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem(key)).toBe(savedRequest);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();

    await click(host, "Refresh saved status");
    expect(host.textContent).toContain("reuse the same request identifier");
    expect(mocks.requestCancellation).toHaveBeenCalledOnce();
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
    acceptNotice(host);
    await submit(host);

    expect(mocks.requestCancellation.mock.calls).toEqual([[orderId, requestId], [orderId, requestId]]);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("does not expose a cancellation control for a paid-in-full schedule with only a later partial refund", async () => {
    await mount(accountId, historyItem({
      paymentStage: "partially_refunded",
      hasRecordedRefund: true,
      clearedInstallments: 2,
      nextDueDate: null,
      retryDeadline: null,
    }));

    expect(host.textContent).not.toContain("Stop future charges");
    expect(host.querySelector("form")).toBeNull();
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
  });

  it("keeps cancellation available for a partially refunded schedule with a known future due date", async () => {
    await mount(accountId, historyItem({
      paymentStage: "partially_refunded",
      hasRecordedRefund: true,
      clearedInstallments: 1,
      nextDueDate: "2027-03-31",
    }));

    expect(host.textContent).toContain("Stop future charges");
    expect(host.querySelector("form")).toBeTruthy();
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
  });
});
