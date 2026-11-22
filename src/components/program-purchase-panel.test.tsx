import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  discover: vi.fn(),
  quote: vi.fn(),
  recover: vi.fn(),
  retryCheckout: vi.fn(),
  startCheckout: vi.fn(),
}));

vi.mock("@/app/(app)/programs/[id]/purchase-actions", () => ({
  confirmProgramPurchaseAction: actionMocks.confirm,
  discoverProgramPurchaseAction: actionMocks.discover,
  quoteProgramPurchaseAction: actionMocks.quote,
  recoverProgramPurchaseAction: actionMocks.recover,
  retryProgramCheckoutAction: actionMocks.retryCheckout,
  startProgramCheckoutAction: actionMocks.startCheckout,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ProgramPurchasePanel } from "./program-purchase-panel";

describe("ProgramPurchasePanel initial render", () => {
  it("renders a neutral loading state without starting a quote, order, or checkout", () => {
    const html = renderToStaticMarkup(
      <ProgramPurchasePanel
        buyerId="20000000-0000-4000-8000-000000000002"
        programId="10000000-0000-4000-8000-000000000001"
        programTitle="Foundations"
        purchaseEnabled={false}
        checkoutEnabled={false}
      />,
    );

    expect(html).toContain("Purchase Foundations");
    expect(html).toContain("Loading purchase information");
    expect(actionMocks.discover).not.toHaveBeenCalled();
    expect(actionMocks.quote).not.toHaveBeenCalled();
    expect(actionMocks.confirm).not.toHaveBeenCalled();
    expect(actionMocks.startCheckout).not.toHaveBeenCalled();
  });
});
