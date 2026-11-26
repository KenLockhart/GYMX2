import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ adminRpc: vi.fn(), sync: vi.fn(), redirect: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ profile: { id: "00000000-0000-4000-8000-000000000001", role: "admin" } }) }));
vi.mock("@/lib/printful/catalog-runtime", () => ({ syncPrintfulCatalogToPrivateStage: mocks.sync }));
vi.mock("@/lib/printful/catalog-provider", () => ({
  createPrintfulStoreCatalogReader: vi.fn(),
  getPrintfulCatalogSyncConfig: () => ({ enabled: false, reason: "disabled" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.adminRpc }) }));

import { beginPrintfulCostReviewAction, syncPrintfulCatalogAction, updatePrintfulPreviewCurationAction } from "./actions";

function curationForm(audience?: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    item_id: "00000000-0000-4000-8000-000000000099",
    title: "Approved cap",
    description: "Curated preview",
    image_path: "00000000-0000-4000-8000-000000000001/cap.webp",
    price: "30.00",
    shipping: "0.00",
    visible_to_all: "on",
  })) form.set(key, value);
  if (audience !== undefined) form.set("required_membership_tier", audience);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sync.mockResolvedValue({ status: "synced", productCount: 16, variantCount: 95, availableVariantCount: 93, revision: "2" });
  mocks.adminRpc.mockResolvedValue({ data: "00000000-0000-4000-8000-000000000099", error: null });
  mocks.redirect.mockImplementation((target: string) => { throw new Error(`NEXT_REDIRECT:${target}`); });
});

describe("Printful admin actions", () => {
  it("redirects to the existing success banner after a verified catalog sync", async () => {
    await expect(syncPrintfulCatalogAction()).rejects.toThrow("NEXT_REDIRECT:/admin/printful?result=synced-16-95");
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/printful");
  });

  it("redirects catalog failures to the existing result banner without revalidating", async () => {
    mocks.sync.mockResolvedValue({ status: "provider_failed" });
    await expect(syncPrintfulCatalogAction()).rejects.toThrow("NEXT_REDIRECT:/admin/printful?result=provider_failed");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("shows a safe result when an unexpected sync error interrupts the action", async () => {
    mocks.sync.mockRejectedValue(new Error("private transport detail"));
    await expect(syncPrintfulCatalogAction()).rejects.toThrow("NEXT_REDIRECT:/admin/printful?result=sync_failed");
    expect(mocks.redirect).not.toHaveBeenCalledWith(expect.stringContaining("private transport detail"));
  });

  it("redirects to the created cost-review session after sync succeeds", async () => {
    await expect(beginPrintfulCostReviewAction()).rejects.toThrow("NEXT_REDIRECT:/admin/printful?review=00000000-0000-4000-8000-000000000099#cost-review");
    expect(mocks.adminRpc).toHaveBeenCalledWith("begin_printful_ui_cost_review", {
      target_admin_id: "00000000-0000-4000-8000-000000000001",
    });
    expect(mocks.redirect).toHaveBeenCalledOnce();
  });

  it("does not create a cost-review session when the catalog read fails", async () => {
    mocks.sync.mockResolvedValue({ status: "provider_failed" });
    await expect(beginPrintfulCostReviewAction()).rejects.toThrow("NEXT_REDIRECT:/admin/printful?result=provider_failed");
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("redirects to the existing error banner when review-session creation fails", async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    await expect(beginPrintfulCostReviewAction()).rejects.toThrow("NEXT_REDIRECT:/admin/printful?result=review_unavailable");
  });

  it("saves Printful preview audience through the atomic curation RPC", async () => {
    await expect(updatePrintfulPreviewCurationAction(curationForm("premium")))
      .rejects.toThrow("NEXT_REDIRECT:/admin/printful?result=curation_saved");
    expect(mocks.adminRpc).toHaveBeenCalledWith("update_printful_armory_preview", expect.objectContaining({
      target_item_id: "00000000-0000-4000-8000-000000000099",
      target_required_membership_tier: "premium",
      target_visible_to_all: true,
    }));
  });

  it("rejects an old curation form with no audience before the atomic update RPC", async () => {
    await expect(updatePrintfulPreviewCurationAction(curationForm()))
      .rejects.toThrow("NEXT_REDIRECT:/admin/printful?result=invalid_curation");
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed Printful audience instead of defaulting it to Everyone", async () => {
    await expect(updatePrintfulPreviewCurationAction(curationForm("regular")))
      .rejects.toThrow("NEXT_REDIRECT:/admin/printful?result=invalid_curation");
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});
