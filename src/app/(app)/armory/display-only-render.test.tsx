import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ item: {} as Record<string, unknown>, role: "member", account: true, privateVisible: true }));
vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/auth", () => ({ getCurrentAccount: async () => mocks.account ? ({ profile: { id: "00000000-0000-4000-8000-000000000002", role: mocks.role } }) : null }));
vi.mock("@/lib/platform-membership-server", () => ({ getPlatformEntitlement: async () => ({ ok: true, entitlement: null }) }));
vi.mock("@/lib/purchases", () => ({ confirmCheckoutSession: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ isStripeTestMode: () => false, stripePublishableKey: () => "pk_test_fixture" }));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseEnv: () => ({ url: "https://example.test" }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserSupabase: vi.fn() }));
vi.mock("@/components/buy-panel", () => ({ BuyPanel: () => <button data-checkout="true">Buy now</button> }));
vi.mock("@/app/(app)/armory/actions", () => ({ removeArmoryItem: vi.fn(), saveArmoryItem: vi.fn(), prepareArmoryUpload: vi.fn() }));
vi.mock("@/i18n/t", () => ({ T: ({ children }: { children: ReactNode }) => <>{children}</>, useTr: () => (text: string) => text }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "en", getTr: async () => (text: string) => text }));
vi.mock("@/components/form-parts", () => ({
  ActionForm: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  FormStatus: () => null,
  SubmitButton: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  Field: ({ label, name, defaultValue, value }: { label: string; name?: string; defaultValue?: string; value?: string }) => <label>{label}<input name={name} defaultValue={defaultValue} value={value} /></label>,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const data = table === "public_armory_catalog"
    ? { ...mocks.item, seller_label: "Coach" }
    : table === "armory_items" && !mocks.privateVisible ? null : mocks.item;
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data }),
    then: (resolve: (value: unknown) => void) => Promise.resolve({ data: table === "armory_items" || table === "public_armory_catalog" ? [data] : [], count: 0 }).then(resolve),
  };
  return query;
} }) }));
import ArmoryItemPage from "../../armory/[id]/page";
import ArmoryPage from "../../armory/page";
import { ArmoryForm } from "@/components/armory-form";

beforeEach(() => {
  mocks.role = "member";
  mocks.account = true;
  mocks.privateVisible = true;
  mocks.item = {
    id: "00000000-0000-4000-8000-000000000001", coach_id: "00000000-0000-4000-8000-000000000003", kind: "preview", category: "gear", title: "GYMX2 Cap", description: "Preview item", price_cents: 3844,
    shipping_cents: 0, sizes: ["S", "M"], image_path: null, visible_to_all: true, coach: null,
    made_to_order: false, delivery_min_weeks: null, delivery_max_weeks: null,
    required_membership_tier: "everyone",
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
  it.each(["anonymous", "signed-in public fallback"])("does not offer guest checkout for a public display-only category to %s", async (viewer) => {
    mocks.item = { ...mocks.item, kind: "product", category: "partners", required_membership_tier: "everyone" };
    if (viewer === "anonymous") mocks.account = false;
    else mocks.privateVisible = false;

    const html = renderToStaticMarkup(await ArmoryItemPage({ params: Promise.resolve({ id: String(mocks.item.id) }), searchParams: Promise.resolve({}) }));

    expect(html).toContain("This item is not available for guest checkout.");
    expect(html).not.toContain('data-checkout="true"');
    expect(html).not.toContain("Buy now");
    if (viewer === "anonymous") expect(html).toContain("/login");
  });
  it("keeps preview selected when editing rather than switching to sell gear", () => {
    const html = renderToStaticMarkup(<ArmoryForm payouts="platform" submitLabel="Save changes" initial={{ id: String(mocks.item.id), kind: "preview", category: "gear", required_membership_tier: "everyone", title: "GYMX2 Cap", description: "", price: "38.44", shipping: "0", sizes: "S, M", buy_url: "", file_path: "", file_name: "", image_path: "", image_url: null, visible_to_all: true, made_to_order: false, delivery_min_weeks: null, delivery_max_weeks: null, printful_sku: null, printful_sync_variant_id: null, printful_variant_mappings: [] }} />);
    expect(html).toContain('name="kind" value="preview"');
    expect(html).toContain("Display only: members can view this product, but cannot purchase it.");
    expect(html).toContain('name="sizes" value="S, M"');
  });

  it("submits Printful references only for supported physical categories", () => {
    const physical = renderToStaticMarkup(
      <ArmoryForm
        payouts="platform"
        submitLabel="Save changes"
        initial={{
          id: String(mocks.item.id),
          kind: "product",
          category: "gear",
          required_membership_tier: "everyone",
          title: "GYMX2 Cap",
          description: "",
          price: "38.44",
          shipping: "0",
          sizes: "",
          buy_url: "",
          file_path: "",
          file_name: "",
          image_path: "",
          image_url: null,
          visible_to_all: true,
          made_to_order: false,
          delivery_min_weeks: null,
          delivery_max_weeks: null,
          printful_sku: "GYM-CAP-01",
          printful_sync_variant_id: "0009007199254740993",
          printful_variant_mappings: [],
        }}
      />,
    );
    expect(physical).toContain('name="printful_sku" value="GYM-CAP-01"');
    expect(physical).toContain('name="printful_sync_variant_id" value="0009007199254740993"');
    expect(physical).toContain('name="printful_variant_mappings" value=""');
    expect(physical).toContain("Sizes (optional)");
    expect(physical).toContain("Printful reference");

    const accessory = renderToStaticMarkup(<ArmoryForm payouts="platform" submitLabel="Save changes" initial={{ id: String(mocks.item.id), kind: "product", category: "accessories", required_membership_tier: "everyone", title: "Bag", description: "", price: "20", shipping: "0", sizes: "S", buy_url: "", file_path: "", file_name: "", image_path: "", image_url: null, visible_to_all: true, made_to_order: false, delivery_min_weeks: null, delivery_max_weeks: null, printful_sku: "BAG-S", printful_sync_variant_id: "9007199254740993", printful_variant_mappings: [] }} />);
    expect(accessory).toContain("Sizes (optional)");
    expect(accessory).toContain("Printful reference");

    const unsupportedCategory = renderToStaticMarkup(
      <ArmoryForm
        payouts="platform"
        submitLabel="Save changes"
        initial={{
          id: String(mocks.item.id),
          kind: "product",
          category: "supplements",
          required_membership_tier: "premium",
          title: "GYMX2 Supplements",
          description: "",
          price: "38.44",
          shipping: "0",
          sizes: "",
          buy_url: "",
          file_path: "",
          file_name: "",
          image_path: "",
          image_url: null,
          visible_to_all: true,
          made_to_order: false,
          delivery_min_weeks: null,
          delivery_max_weeks: null,
          printful_sku: "LEGACY-SKU",
          printful_sync_variant_id: "42",
          printful_variant_mappings: [],
        }}
      />,
    );
    expect(unsupportedCategory).toContain('name="printful_sku" value=""');
    expect(unsupportedCategory).toContain('name="printful_sync_variant_id" value=""');
    expect(unsupportedCategory).toContain('name="printful_variant_mappings" value=""');
    expect(unsupportedCategory).not.toContain("LEGACY-SKU");
    expect(unsupportedCategory).toContain('name="sizes" value=""');
    expect(unsupportedCategory).not.toContain("Sizes (optional)");
    expect(unsupportedCategory).not.toContain("Printful");
    expect(unsupportedCategory).toContain('name="required_membership_tier"');
    expect(unsupportedCategory).toContain('value="premium"');
  });

  it("offers the new Other category separately from the legacy placeholder", () => {
    const html = renderToStaticMarkup(<ArmoryForm payouts="platform" submitLabel="Add item" initial={{ id: "", kind: "preview", category: "gear", required_membership_tier: "everyone", title: "", description: "", price: "", shipping: "", sizes: "S, M", buy_url: "", file_path: "", file_name: "", image_path: "", image_url: null, visible_to_all: true, made_to_order: false, delivery_min_weeks: null, delivery_max_weeks: null, printful_sku: null, printful_sync_variant_id: null, printful_variant_mappings: [] }} />);
    expect(html).toContain('value="partners"');
    expect(html).toContain('value="peptides"');
    expect(html).toContain('value="other_products"');
    expect(html).not.toContain('value="other"');
    const legacyHtml = renderToStaticMarkup(<ArmoryForm payouts="platform" submitLabel="Save changes" initial={{ id: String(mocks.item.id), kind: "preview", category: "other", required_membership_tier: "everyone", title: "Old item", description: "", price: "10", shipping: "0", sizes: "", buy_url: "", file_path: "", file_name: "", image_path: "", image_url: null, visible_to_all: false, made_to_order: false, delivery_min_weeks: null, delivery_max_weeks: null, printful_sku: null, printful_sync_variant_id: null, printful_variant_mappings: [] }} />);
    expect(legacyHtml).toContain("Legacy / Other");
  });
});
