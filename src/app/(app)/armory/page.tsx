import type { Metadata } from "next";
import Link from "next/link";
import { requireAccount } from "@/lib/auth";
import { ARMORY_CATEGORIES, categoryLabel, formatPrice, isCategory, publicImageUrl } from "@/lib/armory";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ArmoryItem } from "@/lib/types";

export const metadata: Metadata = { title: "The Armory" };

type CatalogItem = Pick<
  ArmoryItem,
  "id" | "coach_id" | "kind" | "category" | "title" | "price_cents" | "image_path" | "visible_to_all"
> & { coach: { display_name: string } | null };

export default async function ArmoryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { profile } = await requireAccount();
  const requested = (await searchParams).category;
  const category = isCategory(requested) ? requested : null;
  const canAdd = profile.role === "coach" || profile.role === "admin";

  // Row security limits this to items from coaches the viewer joined, their own, and anything shared with everyone.
  const supabase = await createClient();
  let query = supabase
    .from("armory_items")
    .select("id, coach_id, kind, category, title, price_cents, image_path, visible_to_all, coach:profiles!coach_id(display_name)")
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
          <h1 className="text-5xl">The Armory</h1>
          <p className="mt-2 max-w-xl text-muted">
            {profile.role === "coach"
              ? "Ebooks, gear and programs for your members. Sell them here, link to where you already sell, or share free downloads."
              : "Ebooks, gear and programs chosen by your coaches."}
          </p>
        </div>
        {canAdd && (
          <div className="flex flex-wrap gap-2">
            <Link href="/armory/sales" className="btn-secondary">
              Sales
            </Link>
            {profile.role === "coach" && (
              <Link href="/armory/payouts" className="btn-secondary">
                Payouts
              </Link>
            )}
            <Link href="/armory/new" className="btn-primary">
              Add an item
            </Link>
          </div>
        )}
      </div>

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filter by category">
        <Link
          href="/armory"
          className={`rounded-full border px-3 py-1 ${!category ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface-raised"}`}
        >
          All
        </Link>
        {ARMORY_CATEGORIES.map((option) => (
          <Link
            key={option.value}
            href={`/armory?category=${option.value}`}
            className={`rounded-full border px-3 py-1 ${category === option.value ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface-raised"}`}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the Armory. Please refresh and try again.
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {canAdd
            ? "Nothing here yet. Add your first ebook or piece of gear."
            : profile.role === "member"
              ? category
                ? `No ${categoryLabel(category).toLowerCase()} yet.`
                : "Nothing here yet. Items from coaches you join will appear here."
              : "Nothing here yet."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const image = publicImageUrl(supabaseUrl, item.image_path);
            const price = item.kind === "download" ? "Free download" : formatPrice(item.price_cents);
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
                      <img src={image} alt="" className="size-full object-cover" loading="lazy" />
                    ) : (
                      <span className="font-display text-2xl font-bold uppercase text-muted">
                        {categoryLabel(item.category)}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 p-3">
                    <p className="line-clamp-2 font-semibold group-hover:text-accent">{item.title}</p>
                    <p className="text-sm text-muted">
                      {[item.coach_id !== profile.id && item.coach?.display_name, price].filter(Boolean).join(" · ")}
                    </p>
                    {item.coach_id === profile.id && (
                      <p className="text-xs text-muted">{item.visible_to_all ? "Everyone can see this" : "Your members only"}</p>
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
