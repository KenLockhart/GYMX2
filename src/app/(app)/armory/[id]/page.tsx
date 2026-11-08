import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import { categoryLabel, formatPrice, publicImageUrl } from "@/lib/armory";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ArmoryItem } from "@/lib/types";
import { idSchema } from "@/lib/validation";
import { removeArmoryItem } from "../actions";

export const metadata: Metadata = { title: "The Armory" };

export default async function ArmoryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAccount();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("armory_items")
    .select("*, coach:profiles!coach_id(id, display_name, role)")
    .eq("id", id)
    .maybeSingle();
  const item = data as (ArmoryItem & { coach: { id: string; display_name: string; role: string } | null }) | null;
  if (!item) notFound();

  const isOwner = item.coach_id === profile.id;
  const canRemove = isOwner || profile.role === "admin";
  const image = publicImageUrl(getSupabaseEnv().url, item.image_path);
  const price = formatPrice(item.price_cents);

  return (
    <div className="space-y-6">
      <Link href="/armory" className="text-link text-sm">
        Back to the Armory
      </Link>

      <div className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-raised">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={item.title} className="size-full object-cover" />
          ) : (
            <span className="font-display text-3xl font-bold uppercase text-muted">{categoryLabel(item.category)}</span>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">{categoryLabel(item.category)}</p>
            <h1 className="mt-1 text-4xl">{item.title}</h1>
            {item.coach && !isOwner && (
              <p className="mt-2 text-muted">
                From{" "}
                {item.coach.role === "coach" ? (
                  <Link href={`/coaches/${item.coach.id}`} className="text-link">
                    {item.coach.display_name}
                  </Link>
                ) : (
                  "GYMX2"
                )}
              </p>
            )}
          </div>

          {item.kind === "link" ? (
            <div className="space-y-2">
              {price && <p className="text-2xl font-semibold">{price}</p>}
              <a href={item.buy_url ?? "#"} target="_blank" rel="noopener noreferrer nofollow" className="btn-primary">
                Buy now
              </a>
              <p className="text-xs text-muted">Opens the seller&apos;s shop in a new tab. Payment happens there, not on GYMX2.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-2xl font-semibold">Free</p>
              <a href={`/armory/${item.id}/download`} className="btn-primary">
                Download
              </a>
              {item.file_name && <p className="text-xs text-muted">{item.file_name}</p>}
            </div>
          )}

          {item.description && <p className="max-w-2xl whitespace-pre-line">{item.description}</p>}

          {canRemove && (
            <div className="flex flex-wrap items-start gap-2 border-t border-border pt-5">
              {isOwner && (
                <Link href={`/armory/${item.id}/edit`} className="btn-secondary px-3 py-2 text-sm">
                  Edit
                </Link>
              )}
              <ActionForm
                action={removeArmoryItem}
                confirmMessage={`Remove "${item.title}" from the Armory? Its files will be deleted too.`}
                className="space-y-2"
              >
                <input type="hidden" name="item_id" value={item.id} />
                <SubmitButton pendingText="Removing..." className="btn-secondary px-3 py-2 text-sm">
                  Remove
                </SubmitButton>
                <FormStatus />
              </ActionForm>
              {isOwner && (
                <p className="w-full text-xs text-muted">
                  {item.visible_to_all ? "Everyone on GYMX2 can see this." : "Only members who joined you can see this."}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
