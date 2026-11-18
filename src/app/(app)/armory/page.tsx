import type { Metadata } from "next";
import Link from "next/link";
import { requireAccount } from "@/lib/auth";
import {
  ARMORY_CATEGORIES,
  categoryLabel,
  deliveryEstimate,
  formatPrice,
  isPremiumCategory,
  isCategory,
  isDisplayOnly,
  publicImageUrl,
} from "@/lib/armory";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getPlatformEntitlement } from "@/lib/platform-membership-server";
import type { ArmoryItem } from "@/lib/types";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("The Armory") };
}

type CatalogItem = Pick<
  ArmoryItem,
  | "id"
  | "coach_id"
  | "kind"
  | "category"
  | "title"
  | "price_cents"
  | "image_path"
  | "visible_to_all"
  | "made_to_order"
  | "delivery_min_weeks"
  | "delivery_max_weeks"
> & { coach: { display_name: string } | null };

export default async function ArmoryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const tr = await getTr();
  const { profile } = await requireAccount();
  const entitlement = await getPlatformEntitlement(profile.id);
  const hasPremium = entitlement.ok && entitlement.entitlement?.tier === "premium";
  const requested = (await searchParams).category;
  const canAdd = profile.role === "coach" || profile.role === "admin";
  const category =
    isCategory(requested) && (requested !== "other" || canAdd)
      ? requested
      : null;
  const categoryOptions = canAdd
    ? ARMORY_CATEGORIES
    : ARMORY_CATEGORIES.filter((option) => option.value !== "other");

  // Row security limits this to items from coaches the viewer joined, their own, and anything shared with everyone.
  const supabase = await createClient();
  let query = supabase
    .from("armory_items")
    .select(
      "id, coach_id, kind, category, title, price_cents, image_path, visible_to_all, made_to_order, delivery_min_weeks, delivery_max_weeks, coach:profiles!coach_id(display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (category) query = query.eq("category", category);
  const { data, error } = await query;
  const items = (data ?? []) as unknown as CatalogItem[];
  const supabaseUrl = getSupabaseEnv().url;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">
            <T>The Armory</T>
          </h1>
          <p className="mt-2 max-w-xl text-muted">
            {profile.role === "coach"
              ? tr(
                  "Ebooks, gear, accessories and programs for your members. Premium adds supplements and doctor network products.",
                )
              : tr(
                  "Ebooks, gear, accessories and programs chosen by your coaches. Premium also includes supplements and doctor network products.",
                )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {profile.role !== "admin" && (
            <Link href="/armory/purchases" className="btn-secondary">
              <T>My purchases</T>
            </Link>
          )}
          {canAdd && (
            <>
              <Link href="/armory/sales" className="btn-secondary">
                <T>Sales</T>
              </Link>
              {profile.role === "coach" && (
                <Link href="/armory/payouts" className="btn-secondary">
                  <T>Payouts</T>
                </Link>
              )}
              <Link href="/armory/new" className="btn-primary">
                <T>Add an item</T>
              </Link>
            </>
          )}
        </div>
      </div>

      <nav
        className="flex flex-wrap gap-2 text-sm"
        aria-label={tr("Filter by category")}
      >
        <Link
          href="/armory"
          className={`rounded-full border px-3 py-1 ${!category ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface-raised"}`}
        >
          <T>All</T>
        </Link>
        {categoryOptions.map((option) => {
          const locked = isPremiumCategory(option.value) && !hasPremium;
          const ownInventoryRole = profile.role === "coach" || profile.role === "admin";
          return (
            <Link
              key={option.value}
              href={locked && !ownInventoryRole ? "/membership?plan=premium" : `/armory?category=${option.value}`}
              className={`rounded-full border px-3 py-1 ${category === option.value ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface-raised"}`}
            >
              <T>{option.label}</T>
              {locked && <span className="ml-2 text-xs text-muted"><T>Premium</T></span>}
            </Link>
          );
        })}
      </nav>

      {category && isPremiumCategory(category) && !hasPremium && items.length === 0 && (
        <p className="rounded-lg border border-accent bg-surface p-4 text-sm">
          <T>Premium membership is required to browse this category.</T>{" "}
          <Link href="/membership?plan=premium" className="text-link">
            <T>View Premium</T>
          </Link>
        </p>
      )}

      {error ? (
        <p role="alert" className="text-danger">
          <T>We couldn&apos;t load the Armory. Please refresh and try again.</T>
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {canAdd
            ? tr("Nothing here yet. Add your first ebook or piece of gear.")
            : profile.role === "member"
              ? category
                ? tr("No {p0} yet.", {
                    p0: categoryLabel(category).toLowerCase(),
                  })
                : tr(
                    "Nothing here yet. Items from coaches you join will appear here.",
                  )
              : tr("Nothing here yet.")}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const image = publicImageUrl(supabaseUrl, item.image_path);
            const delivery = deliveryEstimate(item);
            const price =
              item.kind === "download"
                ? tr("Free download")
                : formatPrice(item.price_cents);
            return (
              <li key={item.id}>
                <Link
                  href={`/armory/${item.id}`}
                  className="group block overflow-hidden rounded-lg border border-border bg-surface hover:border-accent"
                >
                  <div className="flex aspect-square items-center justify-center bg-surface-raised">
                    {image ? (
                      // Covers come from public storage at any size, so a plain image tag is simplest.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="font-display text-2xl font-bold uppercase text-muted">
                        <T>{categoryLabel(item.category)}</T>
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 p-3">
                    <p className="line-clamp-2 font-semibold group-hover:text-accent">
                      {item.title}
                    </p>
                    <p className="text-sm text-muted">
                      {[
                        item.coach_id !== profile.id &&
                          item.coach?.display_name,
                        price,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {isDisplayOnly(item) && (
                      <p className="text-sm font-semibold text-accent">
                        <T>Coming soon · Not for sale</T>
                      </p>
                    )}
                    {delivery && (
                      <p className="text-xs text-muted">
                        {tr("Made to order. Estimated delivery: {min}–{max} weeks.", {
                          min: delivery.minWeeks,
                          max: delivery.maxWeeks,
                        })}
                      </p>
                    )}
                    {item.coach_id === profile.id && (
                      <p className="text-xs text-muted">
                        {item.visible_to_all
                          ? tr("Everyone can see this")
                          : tr("Your members only")}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
