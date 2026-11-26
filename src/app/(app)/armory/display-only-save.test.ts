import { beforeEach, describe, expect, it, vi } from "vitest";
const OWNER = "00000000-0000-4000-8000-000000000003";
const ADMIN_B = "00000000-0000-4000-8000-000000000004";
const mocks = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn(), adminRpc: vi.fn(), signedUpload: vi.fn(), profileId: "00000000-0000-4000-8000-000000000003", profileRole: "admin", existingAudience: "everyone" }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/auth", () => ({ requireCoachOrAdmin: async () => ({ profile: { id: mocks.profileId, role: mocks.profileRole } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.adminRpc, storage: { from: () => ({ remove: vi.fn(), createSignedUploadUrl: mocks.signedUpload }) } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const query = {
    insert: (fields: unknown) => { mocks.insert(fields); return query; },
    update: (fields: unknown) => { mocks.update(fields); return query; },
    select: () => query, eq: () => query,
    single: async () => ({ data: { id: "00000000-0000-4000-8000-000000000001" } }),
    maybeSingle: async () => ({ data: { file_path: null, image_path: null, category: "gear", required_membership_tier: mocks.existingAudience } }),
    then: (resolve: (value: unknown) => void) => Promise.resolve({ error: null }).then(resolve),
  };
  return query;
} }) }));
import { prepareArmoryUpload, saveArmoryItem } from "./actions";
function request(id = "") {
  const data = new FormData();
  for (const [k, v] of Object.entries({ id, kind: "preview", category: "gear", required_membership_tier: "everyone", title: "GYMX2 Cap", price: "38.44", shipping: "0", sizes: "S, M", visible_to_all: "on" })) data.set(k, v);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profileId = OWNER;
  mocks.profileRole = "admin";
  mocks.existingAudience = "everyone";
  mocks.adminRpc.mockResolvedValue({ data: false, error: null });
  mocks.signedUpload.mockResolvedValue({ data: { path: `${OWNER}/abc-cap.png`, token: "opaque" }, error: null });
});
describe("individual preview saves", () => {
  it("creates a visible preview with price, free shipping and sizes", async () => {
    await expect(saveArmoryItem({}, request())).rejects.toThrow("redirect");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ coach_id: OWNER, kind: "preview", price_cents: 3844, shipping_cents: 0, sizes: ["S", "M"], visible_to_all: true, file_path: null, buy_url: null }));
  });
  it("keeps preview kind on an ordinary edit", async () => {
    await expect(saveArmoryItem({}, request("00000000-0000-4000-8000-000000000001"))).rejects.toThrow("redirect");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ kind: "preview", sizes: ["S", "M"] }));
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("keeps existing sellable product saves as products", async () => {
    const data = request(); data.set("kind", "product");
    await expect(saveArmoryItem({}, data)).rejects.toThrow("redirect");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "product", shipping_cents: 0 }));
  });
  it("saves the selected Premium audience on every item kind", async () => {
    const data = request(); data.set("required_membership_tier", "premium");
    await expect(saveArmoryItem({}, data)).rejects.toThrow("redirect");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ required_membership_tier: "premium" }));
  });
  it("rejects malformed audience values instead of treating them as Everyone", async () => {
    const data = request(); data.set("required_membership_tier", "admin");
    const result = await saveArmoryItem({}, data);
    expect(result).toHaveProperty("error");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("preserves the stored audience when an old edit tab omits the new field", async () => {
    mocks.existingAudience = "premium";
    const data = request("00000000-0000-4000-8000-000000000001");
    data.delete("required_membership_tier");

    await expect(saveArmoryItem({}, data)).rejects.toThrow("redirect");

    expect(mocks.update.mock.calls[0]?.[0]).not.toHaveProperty("required_membership_tier");
  });
  it("requires an explicit audience when creating a new item", async () => {
    const data = request();
    data.delete("required_membership_tier");
    const result = await saveArmoryItem({}, data);
    expect(result).toHaveProperty("error");
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("clears hidden sizes and Printful references for non-gear categories", async () => {
    const data = request();
    data.set("category", "peptides");
    data.set("sizes", "S, M");
    data.set("printful_sku", "STALE-SKU");
    data.set("printful_sync_variant_id", "987654");
    data.set("printful_variant_mappings", JSON.stringify([{ option: "S", sku: "S-SKU", sync_variant_id: null }]));

    await expect(saveArmoryItem({}, data)).rejects.toThrow("redirect");

    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      category: "peptides",
      sizes: [],
      printful_sku: null,
      printful_sync_variant_id: null,
      printful_variant_mappings: [],
    }));
  });
  it("blocks generic edits to a Printful-managed preview", async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: true, error: null });
    const result = await saveArmoryItem({}, request("00000000-0000-4000-8000-000000000001"));
    expect(result).toEqual({ error: "Use the Printful catalog page to edit this preview." });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("fails closed when managed-item membership cannot be checked", async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
    const result = await saveArmoryItem({}, request("00000000-0000-4000-8000-000000000001"));
    expect(result).toEqual({ error: "We couldn't verify whether this item is managed. Please try again." });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("prepares a draft image under the authoritative owner when another admin edits it", async () => {
    const itemId = "00000000-0000-4000-8000-000000000077";
    mocks.profileId = ADMIN_B;
    mocks.adminRpc.mockResolvedValueOnce({ data: OWNER, error: null });
    const result = await prepareArmoryUpload({
      bucket: "armory-images",
      file_name: "cap.png",
      size: 2048,
      managed_item_id: itemId,
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith("get_printful_armory_draft_upload_owner", {
      target_item_id: itemId,
      target_admin_id: ADMIN_B,
    });
    expect(mocks.signedUpload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${OWNER}/`)));
    expect(result.path).toMatch(new RegExp(`^${OWNER}/`));
  });
});
