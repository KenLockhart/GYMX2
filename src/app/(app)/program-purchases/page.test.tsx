import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedAccount: vi.fn(),
  getHistory: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuthenticatedAccount: mocks.requireAuthenticatedAccount }));
vi.mock("@/lib/program-purchase-history-server", () => ({ getMyProgramPurchaseHistory: mocks.getHistory }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import ProgramPurchasesPage from "./page";

const accountId = "10000000-0000-4000-8000-000000000001";
const orderId = "40000000-0000-4000-8000-000000000004";
const createdAt = "2027-01-31T14:30:00.123456+00:00";

function historyItem() {
  return {
    orderId,
    programId: "20000000-0000-4000-8000-000000000002",
    programLabel: "Program" as const,
    createdAt,
    currency: "usd" as const,
    listPriceCents: 12000,
    discountCents: 0,
    effectiveTotalCents: 12000,
    paymentPlan: "installments" as const,
    installmentCount: 3,
    installmentAmountsCents: [4000, 4000, 4000],
    clearedInstallments: 1,
    hasRecordedRefund: false,
    paymentStage: "partially_settled" as const,
    cancellationStage: "none" as const,
    safetyStage: "clear" as const,
    checkoutRetryHint: false,
    nextDueDate: "2027-02-28",
    retryDeadline: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: accountId, role: "member", membershipExpired: true } });
  mocks.getHistory.mockResolvedValue({
    ok: true,
    value: { items: [historyItem()], hasMore: false, nextCursor: null },
  });
});

describe("Program purchase history page", () => {
  it("loads a bounded owner history page without membership or feature-flag checks", async () => {
    const html = renderToStaticMarkup(await ProgramPurchasesPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Program purchases");
    expect(html).toContain("Payments are in progress");
    expect(html).toContain("1 of 3 installments cleared");
    expect(html).toContain("$120.00");
    expect(html).toContain(`/program-purchases/${orderId}`);
    expect(mocks.requireAuthenticatedAccount).toHaveBeenCalledOnce();
    expect(mocks.getHistory).toHaveBeenCalledWith({ limit: 20, cursor: null, programId: null });
  });

  it("forwards an exact microsecond cursor and creates the next keyset link", async () => {
    mocks.getHistory.mockResolvedValueOnce({
      ok: true,
      value: {
        items: [historyItem()],
        hasMore: true,
        nextCursor: { createdAt, orderId },
      },
    });
    const html = renderToStaticMarkup(await ProgramPurchasesPage({
      searchParams: Promise.resolve({ cursorCreatedAt: createdAt, cursorOrderId: orderId }),
    }));
    expect(mocks.getHistory).toHaveBeenCalledWith({
      limit: 20,
      cursor: { createdAt, orderId },
      programId: null,
    });
    expect(html).toContain("Next page");
    expect(html).toContain(encodeURIComponent(createdAt));
  });

  it("shows a friendly invalid-link state instead of an empty history page", async () => {
    const html = renderToStaticMarkup(await ProgramPurchasesPage({
      searchParams: Promise.resolve({ cursorCreatedAt: createdAt }),
    }));
    expect(html).toContain("This history page link is invalid");
    expect(html).not.toContain("No Program purchases yet");
    expect(mocks.getHistory).not.toHaveBeenCalled();
  });

  it("distinguishes unavailable data from a successful empty result", async () => {
    mocks.getHistory.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    const unavailable = renderToStaticMarkup(await ProgramPurchasesPage({ searchParams: Promise.resolve({}) }));
    expect(unavailable).toContain("Purchase history is temporarily unavailable");
    expect(unavailable).not.toContain("No Program purchases yet");

    mocks.getHistory.mockResolvedValueOnce({ ok: true, value: { items: [], hasMore: false, nextCursor: null } });
    const empty = renderToStaticMarkup(await ProgramPurchasesPage({ searchParams: Promise.resolve({}) }));
    expect(empty).toContain("No Program purchases yet");
  });
});
