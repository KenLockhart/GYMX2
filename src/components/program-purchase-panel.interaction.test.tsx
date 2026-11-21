// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProgramPurchaseConfirmCommand,
  ProgramPurchaseContext,
  ProgramPurchaseQuote,
  ProgramPurchaseRequest,
} from "@/lib/program-purchase-contracts";
import type { ProgramPurchaseHistoryItem } from "@/lib/program-purchase-history-contracts";

const actionMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  discover: vi.fn(),
  quote: vi.fn(),
  recover: vi.fn(),
  retryCheckout: vi.fn(),
  startCheckout: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/app/(app)/programs/[id]/purchase-actions", () => ({
  confirmProgramPurchaseAction: actionMocks.confirm,
  discoverProgramPurchaseAction: actionMocks.discover,
  quoteProgramPurchaseAction: actionMocks.quote,
  recoverProgramPurchaseAction: actionMocks.recover,
  retryProgramCheckoutAction: actionMocks.retryCheckout,
  startProgramCheckoutAction: actionMocks.startCheckout,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: actionMocks.refresh }),
}));

import { ProgramPurchasePanel } from "./program-purchase-panel";

const BUYER_ID = "20000000-0000-4000-8000-000000000002";
const PROGRAM_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_PROGRAM_ID = "10000000-0000-4000-8000-000000000002";
const OFFER_ID = "30000000-0000-4000-8000-000000000001";
const CONTENT_ID = "40000000-0000-4000-8000-000000000001";
const ORDER_ID = "50000000-0000-4000-8000-000000000001";
const QUOTE_DIGEST = "a".repeat(64);
const PAID_PROPS = {
  buyerId: BUYER_ID,
  programId: PROGRAM_ID,
  programTitle: "Foundations",
  purchaseEnabled: true,
  checkoutEnabled: true,
};

function quote(
  installmentCount = 1,
  promotionCode: string | null = null,
  overrides: Partial<ProgramPurchaseQuote> = {},
): ProgramPurchaseQuote {
  const free = installmentCount === 0;
  const installments = installmentCount > 1;
  const listPriceCents = 10_000;
  const discountCents = free ? listPriceCents : promotionCode ? 1_000 : 0;
  const effectiveTotalCents = listPriceCents - discountCents;
  const installmentAmountsCents = free
    ? []
    : installments
      ? Array.from({ length: installmentCount }, (_, index) =>
          index === installmentCount - 1
            ? effectiveTotalCents - Math.floor(effectiveTotalCents / installmentCount) * (installmentCount - 1)
            : Math.floor(effectiveTotalCents / installmentCount),
        )
      : [effectiveTotalCents];
  return {
    programId: PROGRAM_ID,
    offerVersionId: OFFER_ID,
    contentVersionId: CONTENT_ID,
    lessonCount: 3,
    currency: "usd",
    listPriceCents,
    discountCents,
    effectiveTotalCents,
    paymentPlan: free ? "free" : installments ? "installments" : "pay_in_full",
    installmentCount,
    installmentAmountsCents,
    maximumInstallments: 3,
    promotionCode,
    quoteDate: installments ? "2026-11-21" : null,
    chargeDates: installments ? ["2026-12-21", "2027-01-21"].slice(0, installmentCount - 1) : [],
    offSessionConsent: installments,
    retryWindowDays: installments ? 7 : null,
    cancellationStopsFutureCharges: true,
    schedulePolicyVersion: "monthly_calendar_eom_v1",
    quoteDigest: QUOTE_DIGEST,
    ...overrides,
  };
}

function contextFor(
  command: ProgramPurchaseConfirmCommand,
  options: { orderId?: string; buyerId?: string } = {},
): ProgramPurchaseContext {
  const free = command.installmentCount === 0;
  const installments = command.installmentCount > 1;
  const listPriceCents = 10_000;
  const discountCents = free ? listPriceCents : command.promotionCode ? 1_000 : 0;
  const effectiveTotalCents = listPriceCents - discountCents;
  const amounts = free
    ? []
    : installments
      ? Array.from({ length: command.installmentCount }, (_, index) =>
          index === command.installmentCount - 1
            ? effectiveTotalCents - Math.floor(effectiveTotalCents / command.installmentCount) * (command.installmentCount - 1)
            : Math.floor(effectiveTotalCents / command.installmentCount),
        )
      : [effectiveTotalCents];
  const chargeDates = installments ? ["2026-12-21", "2027-01-21"].slice(0, command.installmentCount - 1) : [];
  return {
    orderId: options.orderId ?? ORDER_ID,
    requestId: command.requestId,
    buyerId: options.buyerId ?? BUYER_ID,
    programId: PROGRAM_ID,
    offerVersionId: OFFER_ID,
    contentVersionId: CONTENT_ID,
    lessonCount: 3,
    currency: "usd",
    listPriceCents,
    discountCents,
    effectiveTotalCents,
    paymentPlan: free ? "free" : installments ? "installments" : "pay_in_full",
    installmentCount: command.installmentCount,
    installmentAmountsCents: amounts,
    promotionCode: command.promotionCode,
    zeroTotalGrantReason: free ? "promotion_100_percent" : null,
    orderState: "ready",
    billingState: free ? "not_applicable" : "terms_saved",
    billingRevision: free ? 0 : 1,
    terms: free ? null : {
      digest: command.quoteDigest,
      acceptedAt: "2026-11-21T12:00:00Z",
      totalCents: effectiveTotalCents,
      installmentCount: command.installmentCount,
      chargeDates,
      offSessionConsent: installments,
      retryWindowDays: installments ? 7 : null,
      cancellationStopsFutureCharges: true,
    },
    firstSettledAt: null,
    nextAnchorDate: null,
    cancellationRequested: false,
    financialConflict: false,
    canceled: false,
  };
}

function historyFor(
  context: ProgramPurchaseContext,
  paymentStage?: ProgramPurchaseHistoryItem["paymentStage"],
): ProgramPurchaseHistoryItem {
  const free = context.paymentPlan === "free";
  const settled = paymentStage === "settled";
  return {
    orderId: context.orderId,
    programId: PROGRAM_ID,
    programLabel: "Program",
    createdAt: "2026-11-21T12:00:00Z",
    currency: "usd",
    listPriceCents: context.listPriceCents,
    discountCents: context.discountCents,
    effectiveTotalCents: context.effectiveTotalCents,
    paymentPlan: context.paymentPlan,
    installmentCount: context.installmentCount,
    installmentAmountsCents: context.installmentAmountsCents,
    clearedInstallments: settled ? context.installmentCount : 0,
    hasRecordedRefund: false,
    paymentStage: paymentStage ?? (free ? "free_grant" : "checkout_required"),
    cancellationStage: free ? "not_applicable" : "none",
    safetyStage: "clear",
    checkoutRetryHint: paymentStage === "checkout_retryable",
    nextDueDate: null,
    retryDeadline: null,
  };
}

function ownedView(context: ProgramPurchaseContext, paymentStage?: ProgramPurchaseHistoryItem["paymentStage"]) {
  return {
    status: "found" as const,
    orderId: context.orderId,
    context,
    history: historyFor(context, paymentStage),
  };
}

function recovered(command: ProgramPurchaseConfirmCommand) {
  const context = contextFor(command);
  return {
    ...ownedView(context),
    request: {
      requestId: command.requestId,
      orderId: context.orderId,
      buyerId: BUYER_ID,
      programId: PROGRAM_ID,
      offerVersionId: OFFER_ID,
      installmentCount: command.installmentCount,
      promotionCode: command.promotionCode,
    } satisfies ProgramPurchaseRequest,
  };
}

function paidCurrentPurchase(
  paymentStage: ProgramPurchaseHistoryItem["paymentStage"] = "checkout_required",
  billingRevision = 1,
) {
  const context: ProgramPurchaseContext = {
    ...contextFor({
      programId: PROGRAM_ID,
      offerVersionId: OFFER_ID,
      installmentCount: 1,
      promotionCode: null,
      requestId: "60000000-0000-4000-8000-000000000001",
      quoteDigest: QUOTE_DIGEST,
      billingConsent: true,
      offSessionConsent: false,
    }),
    requestId: null,
    billingRevision,
  };
  return ownedView(context, paymentStage);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function click(host: HTMLElement, label: string) {
  await act(async () => {
    button(host, label).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setValue(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("The DOM value setter is unavailable.");
  act(() => {
    setter.call(control, value);
    control.dispatchEvent(new window.Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    if (control instanceof HTMLSelectElement) {
      control.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
  });
}

let host: HTMLDivElement;
let root: Root;

async function mount(props = PAID_PROPS, key = props.programId) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ProgramPurchasePanel key={key} {...props} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

async function rerender(props = PAID_PROPS, key = props.programId) {
  await act(async () => {
    root.render(<ProgramPurchasePanel key={key} {...props} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  actionMocks.discover.mockResolvedValue({ status: "empty" });
  actionMocks.quote.mockImplementation(async (_programId: string, count: number, code: string | null) => ({
    ok: true,
    quote: quote(count, code),
  }));
  actionMocks.confirm.mockImplementation(async (command: ProgramPurchaseConfirmCommand) => ({
    ok: true,
    status: command.installmentCount === 0 ? "grant_created" : "confirmed",
    context: contextFor(command),
  }));
  actionMocks.recover.mockResolvedValue({ status: "not_found" });
  actionMocks.startCheckout.mockResolvedValue({ status: "unknown" });
  actionMocks.retryCheckout.mockResolvedValue({ status: "unknown" });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
});

describe("mounted Program purchase panel (synthetic actions, jsdom)", () => {
  it("keeps existing owned-order recovery available when new purchases and checkout are off", async () => {
    actionMocks.discover.mockResolvedValue(paidCurrentPurchase());
    await mount({ ...PAID_PROPS, purchaseEnabled: false, checkoutEnabled: false });

    expect(host.textContent).toContain("Ready for secure checkout");
    expect(host.querySelector("input[aria-label='Promotion code']")).toBeNull();
    expect(actionMocks.discover).toHaveBeenCalledWith(PROGRAM_ID);
    expect(actionMocks.quote).not.toHaveBeenCalled();
    expect(actionMocks.confirm).not.toHaveBeenCalled();
    const continueButton = button(host, "Continue to checkout");
    expect(continueButton.disabled).toBe(true);
    await click(host, "Continue to checkout");
    expect(actionMocks.startCheckout).not.toHaveBeenCalled();
  });

  it("keeps an unresolved saved request readable but blocks its mutation while purchases are off", async () => {
    const savedCommand: ProgramPurchaseConfirmCommand = {
      programId: PROGRAM_ID,
      offerVersionId: OFFER_ID,
      installmentCount: 1,
      promotionCode: null,
      requestId: "90000000-0000-4000-8000-000000000009",
      quoteDigest: QUOTE_DIGEST,
      billingConsent: true,
      offSessionConsent: false,
    };
    window.sessionStorage.setItem(`gymx2:program-purchase:1:${BUYER_ID}:${PROGRAM_ID}`, JSON.stringify({
      version: 1,
      buyerId: BUYER_ID,
      programId: PROGRAM_ID,
      confirmation: savedCommand,
      checkoutRetry: null,
    }));
    actionMocks.recover.mockResolvedValue({ status: "not_found" });
    actionMocks.discover.mockResolvedValue({ status: "empty" });
    await mount({ ...PAID_PROPS, purchaseEnabled: false });

    expect(host.textContent).toContain("Your saved request can still be checked later.");
    expect(button(host, "Retry saved purchase").disabled).toBe(true);
    await click(host, "Retry saved purchase");
    expect(actionMocks.confirm).not.toHaveBeenCalled();
    expect(actionMocks.quote).not.toHaveBeenCalled();
  });

  it("blocks a saved paid retry when checkout is off while retaining the request", async () => {
    const savedCommand: ProgramPurchaseConfirmCommand = {
      programId: PROGRAM_ID,
      offerVersionId: OFFER_ID,
      installmentCount: 1,
      promotionCode: null,
      requestId: "90000000-0000-4000-8000-000000000009",
      quoteDigest: QUOTE_DIGEST,
      billingConsent: true,
      offSessionConsent: false,
    };
    window.sessionStorage.setItem(`gymx2:program-purchase:1:${BUYER_ID}:${PROGRAM_ID}`, JSON.stringify({
      version: 1,
      buyerId: BUYER_ID,
      programId: PROGRAM_ID,
      confirmation: savedCommand,
      checkoutRetry: null,
    }));
    actionMocks.recover.mockResolvedValue({ status: "not_found" });
    actionMocks.discover.mockResolvedValue({ status: "empty" });
    await mount({ ...PAID_PROPS, checkoutEnabled: false });

    expect(host.textContent).toContain("Paid checkout is not available right now.");
    expect(button(host, "Retry saved purchase").disabled).toBe(true);
    const stored = window.sessionStorage.getItem(`gymx2:program-purchase:1:${BUYER_ID}:${PROGRAM_ID}`);
    await click(host, "Retry saved purchase");
    expect(actionMocks.confirm).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(`gymx2:program-purchase:1:${BUYER_ID}:${PROGRAM_ID}`)).toBe(stored);
  });

  it("retains the saved command and requests the originating account after a server account mismatch", async () => {
    const savedCommand: ProgramPurchaseConfirmCommand = {
      programId: PROGRAM_ID,
      offerVersionId: OFFER_ID,
      installmentCount: 1,
      promotionCode: null,
      requestId: "90000000-0000-4000-8000-000000000009",
      quoteDigest: QUOTE_DIGEST,
      billingConsent: true,
      offSessionConsent: false,
    };
    window.sessionStorage.setItem(`gymx2:program-purchase:1:${BUYER_ID}:${PROGRAM_ID}`, JSON.stringify({
      version: 1,
      buyerId: BUYER_ID,
      programId: PROGRAM_ID,
      confirmation: savedCommand,
      checkoutRetry: null,
    }));
    actionMocks.recover.mockResolvedValue({ status: "not_found" });
    actionMocks.discover.mockResolvedValue({ status: "empty" });
    actionMocks.confirm.mockResolvedValue({ ok: false, reason: "buyer_auth_required" });
    await mount();

    await click(host, "Retry saved purchase");

    expect(actionMocks.confirm).toHaveBeenCalledWith(savedCommand, BUYER_ID);
    expect(host.textContent).toContain("Sign in to that account to continue checking it.");
    expect(JSON.parse(window.sessionStorage.getItem(`gymx2:program-purchase:1:${BUYER_ID}:${PROGRAM_ID}`) ?? "null").confirmation)
      .toEqual(savedCommand);
  });

  it("saves the exact paid command before sending and retries it unchanged after a lost reply", async () => {
    let attempts = 0;
    let firstCommand: ProgramPurchaseConfirmCommand | null = null;
    actionMocks.confirm.mockImplementation(async (command: ProgramPurchaseConfirmCommand) => {
      attempts += 1;
      if (attempts === 1) {
        firstCommand = command;
        throw new Error("Synthetic lost response");
      }
      return { ok: true, status: "confirmed", context: contextFor(command) };
    });
    actionMocks.recover.mockImplementation(async (requestId: string) => {
      if (attempts > 1 && firstCommand?.requestId === requestId) return recovered(firstCommand);
      return { status: "not_found" };
    });
    await mount();

    await click(host, "Check price");
    expect(host.textContent).toContain("$100.00");
    const billing = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!billing) throw new Error("Missing payment consent checkbox");
    await act(async () => billing.click());
    await click(host, "Confirm purchase");

    expect(actionMocks.confirm).toHaveBeenCalledTimes(1);
    const firstPayload = actionMocks.confirm.mock.calls[0]?.[0];
    expect(firstPayload).toMatchObject({
      programId: PROGRAM_ID,
      offerVersionId: OFFER_ID,
      installmentCount: 1,
      promotionCode: null,
      quoteDigest: QUOTE_DIGEST,
      billingConsent: true,
      offSessionConsent: false,
    });
    expect((firstPayload as ProgramPurchaseConfirmCommand).requestId).toMatch(/^[0-9a-f-]{36}$/i);
    const persisted = JSON.parse(window.sessionStorage.getItem(`gymx2:program-purchase:1:${BUYER_ID}:${PROGRAM_ID}`) ?? "null");
    expect(persisted.confirmation).toEqual(firstPayload);
    expect(host.textContent).toContain("Retry saved purchase");

    await click(host, "Retry saved purchase");

    expect(actionMocks.confirm).toHaveBeenCalledTimes(2);
    expect(actionMocks.confirm.mock.calls[1]?.[0]).toEqual(firstPayload);
    expect(host.textContent).toContain("Ready for secure checkout");
    expect(actionMocks.refresh).not.toHaveBeenCalled();
  });

  it("claims a 100% promotion without paid-checkout consent and leaves access to progress", async () => {
    actionMocks.quote.mockImplementation(async (_programId: string, count: number, code: string | null) => ({
      ok: true,
      quote: quote(count, code, count === 0 ? { paymentPlan: "free" } : {}),
    }));
    const promoQuote = quote(0, "GIVEAWAY");
    actionMocks.quote.mockResolvedValueOnce({ ok: true, quote: promoQuote });
    const grantCommand = {
      programId: PROGRAM_ID,
      offerVersionId: OFFER_ID,
      installmentCount: 0,
      promotionCode: "GIVEAWAY",
      requestId: "70000000-0000-4000-8000-000000000007",
      quoteDigest: QUOTE_DIGEST,
      billingConsent: false,
      offSessionConsent: false,
    } satisfies ProgramPurchaseConfirmCommand;
    actionMocks.confirm.mockResolvedValue({
      ok: true,
      status: "grant_created",
      context: contextFor(grantCommand),
    });
    actionMocks.recover.mockResolvedValue(recovered(grantCommand));
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(grantCommand.requestId);
    await mount({ ...PAID_PROPS, checkoutEnabled: false });

    setValue(host.querySelector<HTMLInputElement>("input[aria-label='Promotion code']")!, "giveaway");
    await click(host, "Apply code");
    expect(actionMocks.quote).toHaveBeenCalledWith(PROGRAM_ID, 0, "GIVEAWAY");
    expect(host.textContent).toContain("This offer has no charge.");
    expect(button(host, "Claim free access").disabled).toBe(false);
    await click(host, "Claim free access");

    expect(actionMocks.confirm).toHaveBeenCalledWith(grantCommand, BUYER_ID);
    expect(host.textContent).toContain("Free access granted");
    expect(host.textContent).toContain("Your access is checked from your Program progress.");
    expect(host.textContent).not.toContain("Full access is available");
    expect(actionMocks.refresh).toHaveBeenCalledOnce();
  });

  it("uses the count-one promo fallback only for an installment error and clears a code on the no-code quote action", async () => {
    actionMocks.quote
      .mockResolvedValueOnce({ ok: false, reason: "installment_invalid" })
      .mockResolvedValueOnce({ ok: true, quote: quote(1, "SAVE10") })
      .mockResolvedValueOnce({ ok: true, quote: quote(1, null) });
    await mount();

    setValue(host.querySelector<HTMLInputElement>("input[aria-label='Promotion code']")!, " save10 ");
    await click(host, "Apply code");
    expect(actionMocks.quote.mock.calls.slice(0, 2)).toEqual([
      [PROGRAM_ID, 0, "SAVE10"],
      [PROGRAM_ID, 1, "SAVE10"],
    ]);
    expect(host.textContent).toContain("$90.00");

    await click(host, "Check price without code");
    expect(host.querySelector<HTMLInputElement>("input[aria-label='Promotion code']")?.value).toBe("");
    expect(actionMocks.quote).toHaveBeenLastCalledWith(PROGRAM_ID, 1, null);
    expect(host.textContent).toContain("$100.00");
    expect(button(host, "Confirm purchase").disabled).toBe(true);
  });

  it("does not fall back to a different quote when a promotion probe is unavailable", async () => {
    actionMocks.quote.mockRejectedValueOnce(new Error("Synthetic quote transport interruption"));
    await mount();

    setValue(host.querySelector<HTMLInputElement>("input[aria-label='Promotion code']")!, "SAVE10");
    await click(host, "Apply code");

    expect(actionMocks.quote).toHaveBeenCalledTimes(1);
    expect(actionMocks.quote).toHaveBeenCalledWith(PROGRAM_ID, 0, "SAVE10");
    expect(host.textContent).toContain("We couldn’t get the current price.");
  });

  it("keeps the newest quote locked and visible when an older success resolves after an edit", async () => {
    const oldRequest = deferred<{ ok: true; quote: ProgramPurchaseQuote }>();
    const newRequest = deferred<{ ok: true; quote: ProgramPurchaseQuote }>();
    actionMocks.quote.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    await mount();

    await click(host, "Check price");
    setValue(host.querySelector<HTMLInputElement>("input[aria-label='Promotion code']")!, "GIVEAWAY");
    await click(host, "Apply code");

    expect(actionMocks.quote.mock.calls).toEqual([
      [PROGRAM_ID, 1, null],
      [PROGRAM_ID, 0, "GIVEAWAY"],
    ]);
    await act(async () => {
      oldRequest.resolve({ ok: true, quote: quote(1, null) });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(button(host, "Checking…").disabled).toBe(true);
    expect(host.textContent).not.toContain("Total");

    await act(async () => {
      newRequest.resolve({ ok: true, quote: quote(0, "GIVEAWAY") });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain("This offer has no charge.");
    expect(host.textContent).toContain("$0.00");
    expect(button(host, "Claim free access").disabled).toBe(false);
    expect(host.querySelector("button")?.textContent).not.toBe("Checking…");
  });

  it("allows a fresh quote after an invalidated request rejects", async () => {
    const oldRequest = deferred<{ ok: true; quote: ProgramPurchaseQuote }>();
    actionMocks.quote.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce({ ok: true, quote: quote(1, "SAVE10") });
    await mount();

    await click(host, "Check price");
    setValue(host.querySelector<HTMLInputElement>("input[aria-label='Promotion code']")!, "SAVE10");
    await act(async () => {
      oldRequest.reject(new Error("Synthetic stale request rejection"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).not.toContain("We couldn’t get the current price.");

    await click(host, "Apply code");
    expect(actionMocks.quote).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("$90.00");
    expect(host.textContent).not.toContain("Checking…");
  });

  it("fences a delayed quote response after the signed-in account and Program change", async () => {
    const delayed = deferred<{ ok: true; quote: ProgramPurchaseQuote }>();
    actionMocks.quote.mockReturnValueOnce(delayed.promise);
    await mount();
    await click(host, "Check price");

    await rerender({
      ...PAID_PROPS,
      buyerId: "20000000-0000-4000-8000-000000000003",
      programId: OTHER_PROGRAM_ID,
      programTitle: "Other Program",
    }, "20000000-0000-4000-8000-000000000003:other");
    await act(async () => {
      delayed.resolve({ ok: true, quote: quote(1, null) });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain("Purchase Other Program");
    expect(host.textContent).not.toContain("$100.00");
    expect(host.textContent).not.toContain("Total");
    expect(actionMocks.discover).toHaveBeenLastCalledWith(OTHER_PROGRAM_ID);
  });

  it("clears consent when an installment choice changes and shows the quoted future date", async () => {
    actionMocks.quote.mockImplementation(async (_programId: string, count: number, code: string | null) => ({
      ok: true,
      quote: quote(count, code),
    }));
    await mount();
    await click(host, "Check price");

    const billing = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!billing) throw new Error("Missing payment consent checkbox");
    await act(async () => billing.click());
    const plan = host.querySelector<HTMLSelectElement>("select");
    if (!plan) throw new Error("Missing installment choice");
    setValue(plan, "2");
    expect(plan.value).toBe("2");
    expect(host.textContent).toContain("Your selected plan changed.");
    await click(host, "Update payment plan");

    expect(actionMocks.quote).toHaveBeenLastCalledWith(PROGRAM_ID, 2, null);
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(host.textContent).toContain("Fixed total, not a subscription.");
    expect(host.textContent).toContain("Dec 21, 2026");
    expect(host.textContent).toContain("If a payment fails, it can be retried for 7 days.");
  });

  it("does not interpret an unknown checkout result as access or navigate automatically", async () => {
    actionMocks.discover.mockResolvedValue(paidCurrentPurchase());
    actionMocks.startCheckout.mockResolvedValue({ status: "paid_awaiting_ledger" });
    await mount();

    await click(host, "Continue to checkout");

    expect(actionMocks.startCheckout).toHaveBeenCalledWith(ORDER_ID, 1, BUYER_ID);
    expect(host.textContent).toContain("We’re checking the payment. Access updates only after it is confirmed.");
    expect(host.querySelector("a[href^='https://']")).toBeNull();
    expect(actionMocks.refresh).not.toHaveBeenCalled();
  });

  it("persists and reuses the exact explicit checkout retry id after an uncertain response and reload", async () => {
    const retryRequestId = "80000000-0000-4000-8000-000000000008";
    actionMocks.discover.mockResolvedValue(paidCurrentPurchase("checkout_retryable"));
    actionMocks.retryCheckout.mockResolvedValue({ status: "unknown" });
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(retryRequestId);
    await mount();

    await click(host, "Retry checkout");
    expect(actionMocks.retryCheckout).toHaveBeenCalledWith(ORDER_ID, 1, retryRequestId, BUYER_ID);
    expect(JSON.parse(window.sessionStorage.getItem(`gymx2:program-purchase:1:${BUYER_ID}:${PROGRAM_ID}`) ?? "null").checkoutRetry)
      .toEqual({ orderId: ORDER_ID, requestId: retryRequestId });

    await act(async () => root.unmount());
    host.remove();
    actionMocks.retryCheckout.mockClear();
    await mount();
    await click(host, "Retry checkout");

    expect(actionMocks.retryCheckout).toHaveBeenCalledOnce();
    expect(actionMocks.retryCheckout).toHaveBeenCalledWith(ORDER_ID, 1, retryRequestId, BUYER_ID);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("retires an old retry only after current checkout is ready, then creates a fresh retry for the next attempt", async () => {
    const retry1 = "80000000-0000-4000-8000-000000000018";
    const retry2 = "80000000-0000-4000-8000-000000000019";
    const stages = [
      paidCurrentPurchase("checkout_retryable", 1),
      paidCurrentPurchase("checkout_retryable", 1),
      paidCurrentPurchase("checkout_open", 2),
      paidCurrentPurchase("checkout_open", 2),
      paidCurrentPurchase("checkout_retryable", 3),
      paidCurrentPurchase("checkout_retryable", 3),
      paidCurrentPurchase("checkout_retryable", 3),
    ];
    actionMocks.discover.mockImplementation(async () => stages.shift() ?? paidCurrentPurchase("checkout_retryable", 3));
    actionMocks.retryCheckout.mockResolvedValue({ status: "unknown" });
    actionMocks.startCheckout.mockResolvedValue({
      status: "checkout_ready",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test#fidkdWxOYHwnPyd1blpxYHZxWjA0TnJq",
    });
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValueOnce(retry1).mockReturnValueOnce(retry2);
    await mount();
    const storageKey = `gymx2:program-purchase:1:${BUYER_ID}:${PROGRAM_ID}`;

    await click(host, "Retry checkout");
    expect(actionMocks.retryCheckout).toHaveBeenCalledWith(ORDER_ID, 1, retry1, BUYER_ID);
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null").checkoutRetry)
      .toEqual({ orderId: ORDER_ID, requestId: retry1 });
    expect(host.textContent).toContain("Checkout is ready");
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null").checkoutRetry)
      .toEqual({ orderId: ORDER_ID, requestId: retry1 });

    await click(host, "Continue to checkout");
    expect(actionMocks.startCheckout).toHaveBeenCalledWith(ORDER_ID, 2, BUYER_ID);
    expect(host.querySelector<HTMLAnchorElement>("a[href^='https://checkout.stripe.com/']")?.href)
      .toBe("https://checkout.stripe.com/c/pay/cs_test#fidkdWxOYHwnPyd1blpxYHZxWjA0TnJq");
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null").checkoutRetry).toBeNull();

    await click(host, "Refresh purchase status");
    expect(host.textContent).toContain("Checkout expired");
    await click(host, "Retry checkout");
    expect(actionMocks.retryCheckout).toHaveBeenLastCalledWith(ORDER_ID, 3, retry2, BUYER_ID);
    expect(retry2).not.toBe(retry1);
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null").checkoutRetry)
      .toEqual({ orderId: ORDER_ID, requestId: retry2 });
  });

  it("fences a delayed old-Program lookup after the keyed route changes", async () => {
    const delayed = deferred<ReturnType<typeof paidCurrentPurchase>>();
    actionMocks.discover.mockReturnValueOnce(delayed.promise).mockResolvedValue({ status: "empty" });
    await mount(PAID_PROPS, PROGRAM_ID);
    await rerender({ ...PAID_PROPS, programId: OTHER_PROGRAM_ID, programTitle: "Other Program" }, OTHER_PROGRAM_ID);

    await act(async () => {
      delayed.resolve(paidCurrentPurchase());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain("Purchase Other Program");
    expect(host.textContent).not.toContain("Ready for secure checkout");
    expect(actionMocks.discover).toHaveBeenNthCalledWith(2, OTHER_PROGRAM_ID);
  });

  it("preserves the promotion input across a same-Program server prop refresh", async () => {
    await mount();
    const promotion = host.querySelector<HTMLInputElement>("input[aria-label='Promotion code']");
    if (!promotion) throw new Error("Missing promotion code input");
    setValue(promotion, "KEEP-ME");

    await rerender({ ...PAID_PROPS, programTitle: "Foundations updated" }, PROGRAM_ID);

    expect(host.querySelector<HTMLInputElement>("input[aria-label='Promotion code']")?.value).toBe("KEEP-ME");
    expect(host.textContent).toContain("Purchase Foundations updated");
  });
});
