import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProgramPurchaseHistoryItem } from "@/lib/program-purchase-history-contracts";

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
const orderId = "40000000-0000-4000-8000-000000000004";

function item(overrides: Partial<ProgramPurchaseHistoryItem> = {}): ProgramPurchaseHistoryItem {
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

describe("ProgramPurchaseCancellationForm initial render", () => {
  it("explains the cancellation boundary before showing a request control", () => {
    const html = renderToStaticMarkup(<ProgramPurchaseCancellationForm accountId={accountId} item={item()} />);
    expect(html).toContain("Stop future charges");
    expect(html).toContain("A payment already in flight may still finish");
    expect(html).toContain("Previously paid stages remain available subject to normal access rules");
    expect(html).toContain("does not automatically refund prior payments");
    expect(html).toContain("refund requests follow the existing policy");
    expect(html).toContain("paid stages remain available subject to normal access rules");
    expect(html).toContain("Checking for a saved cancellation request");
    expect(html).not.toContain("Request cancellation</button>");
  });

  it("renders nothing for settled, free, refunded, or non-clear purchases", () => {
    for (const value of [
      item({ paymentStage: "settled", clearedInstallments: 3 }),
      item({ paymentStage: "refunded", clearedInstallments: 0 }),
      // A prior full settlement followed by a partial refund does not prove future collection remains.
      item({ paymentStage: "partially_refunded", hasRecordedRefund: true, clearedInstallments: 2, nextDueDate: null }),
      item({ safetyStage: "manual_review", paymentStage: "unknown" }),
      item({
        paymentPlan: "free", installmentCount: 0, installmentAmountsCents: [], listPriceCents: 0,
        effectiveTotalCents: 0, paymentStage: "free_grant", cancellationStage: "not_applicable", clearedInstallments: 0,
      }),
    ]) {
      expect(renderToStaticMarkup(<ProgramPurchaseCancellationForm accountId={accountId} item={value} />)).toBe("");
    }
  });

  it("shows cancellation information for an active partially refunded installment with a future due date", () => {
    const html = renderToStaticMarkup(<ProgramPurchaseCancellationForm accountId={accountId} item={item({
      paymentStage: "partially_refunded", hasRecordedRefund: true, clearedInstallments: 1,
      nextDueDate: "2027-03-31",
    })} />);
    expect(html).toContain("Stop future charges");
    expect(html).not.toContain("Request cancellation</button>");
  });
});
