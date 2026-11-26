import type { Metadata } from "next";
import Link from "next/link";
import { ArmoryPublicHeader } from "@/components/armory-public-header";
import { categoryLabel, deliveryEstimate, formatPrice, isCategory, isDisplayOnly, ARMORY_CATEGORIES, publicImageUrl } from "@/lib/armory";
import { getCurrentAccount } from "@/lib/auth";
import { getPlatformEntitlement } from "@/lib/platform-membership-server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ArmoryItem, PublicArmoryItem } from "@/lib/types";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("The Armory") };
}

type SignedInCatalogItem = Pick<
  ArmoryItem,
  | "id" | "coach_id" | "kind" | "category" | "title" | "description"
  | "required_membership_tier" | "price_cents" | "buy_url" | "sizes" | "shipping_cents" | "image_path"
  | "visible_to_all" | "made_to_order" | "delivery_min_weeks" | "delivery_max_weeks" | "created_at"
> & { coach: { display_name: string; role: string } | null };

type CatalogItem = PublicArmoryItem | SignedInCatalogItem;

const SAFE_MEMBER_COLUMNS =
  "id, coach_id, kind, category, title, description, required_membership_tier, price_cents, buy_url, sizes, shipping_cents, image_path, visible_to_all, made_to_order, delivery_min_weeks, delivery_max_weeks, created_at, coach:profiles!coach_id(display_name, role)";

export default async function PublicArmoryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [tr, account] = await Promise.all([getTr(), getCurrentAccount()]);
  const entitlement = account
    ? await getPlatformEntitlement(account.profile.id)
    : null;
  const canManage = account?.profile.role === "coach" || account?.profile.role === "admin";
  const requested = (await searchParams).category;
  const category = isCategory(requested) && (requested !== "other" || canManage)
    ? requested
    : null;
  const categories = canManage
    ? ARMORY_CATEGORIES
    : ARMORY_CATEGORIES.filter(({ value }) => value !== "other");

  const supabase = await createClient();
  let items: CatalogItem[] = [];
  let error = false;
  const accountCanReadPrivateInventory = Boolean(
    account && (account.profile.role !== "member" || entitlement?.ok && entitlement.entitlement),
  );
  if (accountCanReadPrivateInventory) {
    let query = supabase
      .from("armory_items")
      .select(SAFE_MEMBER_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(200);
    if (category) query = query.eq("category", category);
    const result = await query;
    error = Boolean(result.error);
    items = (result.data ?? []) as unknown as SignedInCatalogItem[];
  } else {
    let query = supabase
      .from("public_armory_catalog")
      .select("id, coach_id, seller_label, kind, category, required_membership_tier, title, description, price_cents, buy_url, sizes, shipping_cents, image_path, made_to_order, delivery_min_weeks, delivery_max_weeks, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (category && category !== "other") query = query.eq("category", category);
    else if (category === "other") query = query.limit(0);
    const result = await query;
    error = Boolean(result.error);
    items = (result.data ?? []) as unknown as PublicArmoryItem[];
  }

  // Authenticated rows are already filtered by audience and visibility in RLS;
  // anonymous rows come from the Everyone-only public projection.
  const visibleItems = items;
  const publicBaseUrl = getSupabaseEnv().url;
  return (
    <>
      <ArmoryPublicHeader signedIn={Boolean(account)} />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-5xl"><T>The Armory</T></h1>
            <p className="mt-2 max-w-2xl text-muted">
              <T>Shop ebooks, gear, accessories and programs. Regular items are available without a paid membership.</T>
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Link href="/armory/sales" className="btn-secondary"><T>Sales</T></Link>
              {account?.profile.role === "coach" && <Link href="/armory/payouts" className="btn-secondary"><T>Payouts</T></Link>}
              <Link href="/armory/new" className="btn-primary"><T>Add an item</T></Link>
            </div>
          )}
        </div>

        <nav className="flex flex-wrap gap-2 text-sm" aria-label={tr("Filter by category")}>
          <Link href="/armory" className={`rounded-full border px-3 py-1 ${!category ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface-raised"}`}><T>All</T></Link>
          {categories.map((option) => {
            return (
              <Link
                key={option.value}
                href={`/armory?category=${option.value}`}
                className={`rounded-full border px-3 py-1 ${category === option.value ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface-raised"}`}
              >
                <T>{option.label}</T>
              </Link>
            );
          })}
        </nav>

        {error ? (
          <p role="alert" className="text-danger"><T>We couldn&apos;t load the Armory. Please refresh and try again.</T></p>
        ) : visibleItems.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">
            {category ? tr("No {p0} yet.", { p0: categoryLabel(category).toLowerCase() }) : tr("Nothing here yet. Check back soon.")}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visibleItems.map((item) => {
              const image = publicImageUrl(publicBaseUrl, item.image_path);
              const delivery = deliveryEstimate(item);
              const price = item.kind === "download" ? tr("Free download") : formatPrice(item.price_cents);
              const sellerLabel = "seller_label" in item
                ? item.seller_label
                : item.coach?.role === "admin"
                  ? "GYMX2"
                  : item.coach?.display_name ?? "Coach";
              return (
                <li key={item.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                  <Link href={`/armory/${item.id}`} className="block focus-visible:outline-accent">
                    <div className="flex aspect-square items-center justify-center overflow-hidden bg-surface-raised">
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={image} alt={item.title} className="size-full object-cover" />
                      ) : (
                        <span className="font-display text-2xl font-bold uppercase text-muted"><T>{categoryLabel(item.category)}</T></span>
                      )}
                    </div>
                    <div className="space-y-1 p-3">
                      <p className="text-xs font-semibold uppercase tracking-widest text-accent"><T>{categoryLabel(item.category)}</T></p>
                      <h2 className="font-semibold">{item.title}</h2>
                      {"required_membership_tier" in item && item.required_membership_tier === "premium" && (
                        <p className="text-xs font-semibold text-accent"><T>Premium</T></p>
                      )}
                      <p className="text-sm text-muted"><T>From</T> {sellerLabel}</p>
                      {price && <p className="font-semibold">{price}</p>}
                      {item.kind === "product" && item.shipping_cents > 0 && <p className="text-xs text-muted">+ {tr("{p0} shipping", { p0: formatPrice(item.shipping_cents) ?? "" })}</p>}
                      {delivery && <p className="text-xs text-muted">{tr("Made to order. Estimated delivery: {min}–{max} weeks.", { min: delivery.minWeeks, max: delivery.maxWeeks })}</p>}
                      {isDisplayOnly(item) && <p className="text-xs text-accent"><T>Coming soon · Not for sale</T></p>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
