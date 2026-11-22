import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedAccount: vi.fn(),
  getDetail: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not found sentinel"); }),
}));

vi.mock("@/lib/auth", () => ({ requireAuthenticatedAccount: mocks.requireAuthenticatedAccount }));
vi.mock("@/lib/program-purchase-history-server", () => ({ getMyProgramPurchaseHistoryDetail: mocks.getDetail }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/program-purchase-cancel-form", () => ({
  ProgramPurchaseCancellationForm: ({ accountId }: { accountId: string }) => <aside>cancel-owner:{accountId}</aside>,
}));

import ProgramPurchaseDetailPage from "./page";

const accountId = "10000000-0000-4000-8000-000000000001";
const orderId = "40000000-0000-4000-8000-000000000004";

function historyItem(overrides: Record<string, unknown> = {}) {
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
    paymentStage: "payment_pending",
    cancellationStage: "none",
    safetyStage: "clear",
    checkoutRetryHint: false,
    nextDueDate: "2027-02-28",
    retryDeadline: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: accountId, role: "member", membershipExpired: true } });
  mocks.getDetail.mockResolvedValue({ ok: true, value: historyItem() });
});

describe("Program purchase detail page", () => {
  it("loads the saved owner DTO without membership or checkout checks and treats return query as display only", async () => {
    const html = renderToStaticMarkup(await ProgramPurchaseDetailPage({
      params: Promise.resolve({ orderId }),
      searchParams: Promise.resolve({ checkout: "success", order_id: "not-authoritative" }),
    }));
    expect(html).toContain("Payment is processing");
    expect(html).toContain("does not confirm payment");
    expect(html).not.toContain("Paid in full");
    expect(html).toContain(`cancel-owner:${accountId}`);
    expect(mocks.requireAuthenticatedAccount).toHaveBeenCalledOnce();
    expect(mocks.getDetail).toHaveBeenCalledWith(orderId);
  });

  it("shows a cancel return notice without claiming that the order was cancelled", async () => {
    const html = renderToStaticMarkup(await ProgramPurchaseDetailPage({
      params: Promise.resolve({ orderId }),
      searchParams: Promise.resolve({ checkout: "cancel" }),
    }));
    expect(html).toContain("does not cancel the purchase");
    expect(html).toContain("Payment is processing");
    expect(html).not.toContain("Cancellation requested");
  });

  it("uses notFound only for invalid or owner not-found orders", async () => {
    await expect(ProgramPurchaseDetailPage({
      params: Promise.resolve({ orderId: "bad" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("not found sentinel");
    expect(mocks.getDetail).not.toHaveBeenCalled();

    mocks.getDetail.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    await expect(ProgramPurchaseDetailPage({
      params: Promise.resolve({ orderId }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("not found sentinel");
  });

  it("renders a retryable unavailable state instead of pretending missing data is not found", async () => {
    mocks.getDetail.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    const html = renderToStaticMarkup(await ProgramPurchaseDetailPage({
      params: Promise.resolve({ orderId }),
      searchParams: Promise.resolve({}),
    }));
    expect(html).toContain("Purchase details are temporarily unavailable");
    expect(html).toContain("Try again");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("ignores duplicated or unknown checkout query values", async () => {
    const html = renderToStaticMarkup(await ProgramPurchaseDetailPage({
      params: Promise.resolve({ orderId }),
      searchParams: Promise.resolve({ checkout: ["success", "cancel"] }),
    }));
    expect(html).not.toContain("returning here does not");
    expect(html).toContain("Payment is processing");
  });
});
