import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ item: {} as Record<string, unknown>, role: "member" }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/auth", () => ({ requireAccount: async () => ({ profile: { id: "00000000-0000-4000-8000-000000000002", role: mocks.role } }) }));
vi.mock("@/lib/purchases", () => ({ confirmCheckoutSession: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ isStripeTestMode: () => false, stripePublishableKey: () => "pk_test_fixture" }));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseEnv: () => ({ url: "https://example.test" }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserSupabase: vi.fn() }));
vi.mock("@/components/buy-panel", () => ({ BuyPanel: () => <button data-checkout="true">Buy now</button> }));
vi.mock("./actions", () => ({ removeArmoryItem: vi.fn(), saveArmoryItem: vi.fn(), prepareArmoryUpload: vi.fn() }));
vi.mock("@/i18n/t", () => ({ T: ({ children }: { children: ReactNode }) => <>{children}</>, useTr: () => (text: string) => text }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "en", getTr: async () => (text: string) => text }));
vi.mock("@/components/form-parts", () => ({
  ActionForm: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  FormStatus: () => null,
  SubmitButton: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  Field: ({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) => <label>{label}<input name={name} defaultValue={defaultValue} /></label>,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: mocks.item }),
    then: (resolve: (value: unknown) => void) => Promise.resolve({ data: table === "armory_items" ? [mocks.item] : [], count: 0 }).then(resolve),
  };
  return query;
} }) }));
import ArmoryItemPage from "./[id]/page";
import ArmoryPage from "./page";
import { ArmoryForm } from "@/components/armory-form";

beforeEach(() => {
  mocks.role = "member";
  mocks.item = {
    id: "00000000-0000-4000-8000-000000000001", coach_id: "00000000-0000-4000-8000-000000000003", kind: "preview", category: "gear", title: "GYMX2 Cap", description: "Preview item", price_cents: 3844,
    shipping_cents: 0, sizes: ["S", "M"], image_path: null, visible_to_all: true, coach: null,
  };
});

describe("display-only rendering", () => {
  it.each(["member", "coach", "admin"])("shows a preview without checkout for %s", async (role) => {
    mocks.role = role;
    const html = renderToStaticMarkup(await ArmoryItemPage({ params: Promise.resolve({ id: String(mocks.item.id) }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Coming soon · Not for sale");
    expect(html).toContain("$38.44");
    expect(html).toContain("Free shipping");
    expect(html).toContain("S, M");
    expect(html).not.toContain('data-checkout="true"');
    expect(html).not.toContain("Buy now");
    expect(html).not.toContain(">Download<");
  });
  it("preserves the existing sellable product checkout", async () => {
    mocks.item.kind = "product";
    const html = renderToStaticMarkup(await ArmoryItemPage({ params: Promise.resolve({ id: String(mocks.item.id) }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('data-checkout="true"');
    expect(html).not.toContain("Coming soon · Not for sale");
  });
  it("labels previews in the catalog", async () => {
    const html = renderToStaticMarkup(await ArmoryPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("GYMX2 Cap");
    expect(html).toContain("Coming soon · Not for sale");
    expect(html).toContain("$38.44");
  });
  it("keeps preview selected when editing rather than switching to sell gear", () => {
    const html = renderToStaticMarkup(<ArmoryForm payouts="platform" submitLabel="Save changes" initial={{ id: String(mocks.item.id), kind: "preview", category: "gear", title: "GYMX2 Cap", description: "", price: "38.44", shipping: "0", sizes: "S, M", buy_url: "", file_path: "", file_name: "", image_path: "", image_url: null, visible_to_all: true }} />);
    expect(html).toContain('name="kind" value="preview"');
    expect(html).toContain("Display only: members can view this product, but cannot purchase it.");
    expect(html).toContain('name="sizes" value="S, M"');
  });
});
