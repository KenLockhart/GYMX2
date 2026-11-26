import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pending: false, syncAction: vi.fn(), reviewAction: vi.fn() }));
vi.mock("@/app/(app)/admin/printful/actions", () => ({
  beginPrintfulCostReviewAction: mocks.reviewAction,
  syncPrintfulCatalogAction: mocks.syncAction,
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormStatus: () => ({ pending: mocks.pending }) };
});

import { PrintfulOperationForm, PrintfulOperationSubmitButton } from "./printful-operation-form";

beforeEach(() => {
  mocks.pending = false;
});

describe("Printful operation pending feedback", () => {
  it.each([
    ["sync", "syncAction"],
    ["cost-review", "reviewAction"],
  ] as const)("submits the existing %s server action", (operation, action) => {
    const form = PrintfulOperationForm({ operation });

    expect(form.type).toBe("form");
    expect(form.props.action).toBe(mocks[action]);
  });

  it.each([
    ["sync", "Sync catalog now", "Syncing catalog…", "Reading the complete Printful catalog into the private stage…"],
    ["cost-review", "Start configured-cost review", "Preparing review…", "Refreshing the private catalog and preparing the cost-review form…"],
  ] as const)("shows disabled progress feedback for %s", (operation, label, pendingLabel, pendingMessage) => {
    mocks.pending = true;
    const markup = renderToStaticMarkup(
      <form>
        <PrintfulOperationSubmitButton operation={operation} />
      </form>,
    );

    expect(markup).toContain(`>${pendingLabel}</button>`);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain(pendingMessage);
    expect(markup).not.toContain(`>${label}</button>`);
  });

  it.each([
    ["sync", "Sync catalog now"],
    ["cost-review", "Start configured-cost review"],
  ] as const)("keeps %s enabled before submission", (operation, label) => {
    const markup = renderToStaticMarkup(
      <form>
        <PrintfulOperationSubmitButton operation={operation} />
      </form>,
    );

    expect(markup).toContain(`>${label}</button>`);
    expect(markup).toContain('aria-busy="false"');
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain('role="status"');
  });
});
