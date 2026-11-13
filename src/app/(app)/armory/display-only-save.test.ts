import { beforeEach, describe, expect, it, vi } from "vitest";
const OWNER = "00000000-0000-4000-8000-000000000003";
const mocks = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/auth", () => ({ requireCoachOrAdmin: async () => ({ profile: { id: "00000000-0000-4000-8000-000000000003", role: "admin" } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ remove: vi.fn() }) } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const query = {
    insert: (fields: unknown) => { mocks.insert(fields); return query; },
    update: (fields: unknown) => { mocks.update(fields); return query; },
    select: () => query, eq: () => query,
    single: async () => ({ data: { id: "00000000-0000-4000-8000-000000000001" } }),
    maybeSingle: async () => ({ data: { file_path: null, image_path: null } }),
    then: (resolve: (value: unknown) => void) => Promise.resolve({ error: null }).then(resolve),
  };
  return query;
} }) }));
import { saveArmoryItem } from "./actions";
function request(id = "") {
  const data = new FormData();
  for (const [k, v] of Object.entries({ id, kind: "preview", category: "gear", title: "GYMX2 Cap", price: "38.44", shipping: "0", sizes: "S, M", visible_to_all: "on" })) data.set(k, v);
  return data;
}
beforeEach(() => vi.clearAllMocks());
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
});
