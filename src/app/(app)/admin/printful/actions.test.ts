import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ adminRpc: vi.fn(), sync: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ profile: { id: "00000000-0000-4000-8000-000000000001", role: "admin" } }) }));
vi.mock("@/lib/printful/catalog-runtime", () => ({ syncPrintfulCatalogToPrivateStage: mocks.sync }));
vi.mock("@/lib/printful/catalog-provider", () => ({
  createPrintfulStoreCatalogReader: vi.fn(),
  getPrintfulCatalogSyncConfig: () => ({ enabled: false, reason: "disabled" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.adminRpc }) }));

import { beginPrintfulCostReviewAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sync.mockResolvedValue({ status: "synced", productCount: 16, variantCount: 95, availableVariantCount: 93, revision: "2" });
  mocks.adminRpc.mockResolvedValue({ data: "00000000-0000-4000-8000-000000000099", error: null });
  mocks.redirect.mockImplementation((target: string) => { throw new Error(`NEXT_REDIRECT:${target}`); });
});

describe("Printful admin actions", () => {
  it("redirects to the created cost-review session after sync succeeds", async () => {
    await expect(beginPrintfulCostReviewAction()).rejects.toThrow("NEXT_REDIRECT:/admin/printful?review=00000000-0000-4000-8000-000000000099");
    expect(mocks.adminRpc).toHaveBeenCalledWith("begin_printful_ui_cost_review", {
      target_admin_id: "00000000-0000-4000-8000-000000000001",
    });
    expect(mocks.redirect).toHaveBeenCalledOnce();
  });
});
