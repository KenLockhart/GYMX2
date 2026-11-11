import type { Metadata } from "next";
import Link from "next/link";
import { requireAccount } from "@/lib/auth";
import {
  ARMORY_CATEGORIES,
  categoryLabel,
  formatPrice,
  isCategory,
  publicImageUrl,
} from "@/lib/armory";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
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
> & { coach: { display_name: string } | null };

export default async function ArmoryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const tr = await getTr();
  const { profile } = await requireAccount();
  const requested = (await searchParams).category;
  const category = isCategory(requested) ? requested : null;
  const canAdd = profile.role === "coach" || profile.role === "admin";

  // Row security limits this to items from coaches the viewer joined, their own, and anything shared with everyone.
  const supabase = await createClient();
  let query = supabase
    .from("armory_items")
    .select(
      "id, coach_id, kind, category, title, price_cents, image_path, visible_to_all, coach:profiles!coach_id(display_name)",
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
                  "Ebooks, gear and programs for your members. Sell them here, link to where you already sell, or share free downloads.",
                )
              : tr("Ebooks, gear and programs chosen by your coaches.")}
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
        {ARMORY_CATEGORIES.map((option) => (
          <Link
            key={option.value}
            href={`/armory?category=${option.value}`}
            className={`rounded-full border px-3 py-1 ${category === option.value ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface-raised"}`}
          >
            <T>{option.label}</T>
          </Link>
        ))}
      </nav>

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
