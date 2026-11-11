import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArmoryForm } from "@/components/armory-form";
import { DEFAULT_SIZES, publicImageUrl } from "@/lib/armory";
import { requireCoachOrAdmin } from "@/lib/auth";
import { loadPayoutStatus } from "../../payout-status";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ArmoryItem } from "@/lib/types";
import { idSchema } from "@/lib/validation";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Edit item") };
}

export default async function EditArmoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tr = await getTr();
  const { profile } = await requireCoachOrAdmin();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("armory_items")
    .select("*")
    .eq("id", id)
    .eq("coach_id", profile.id)
    .maybeSingle<ArmoryItem>();
  if (!data) notFound();
  const payouts = await loadPayoutStatus(profile);

  return (
    <div className="space-y-6">
      <Link href={`/armory/${data.id}`} className="text-link text-sm">
        <T>Back to the item</T>
      </Link>
      <h1 className="text-5xl">
        <T>Edit item</T>
      </h1>
      <ArmoryForm
        submitLabel={tr("Save changes")}
        payouts={payouts}
        initial={{
          id: data.id,
          kind: data.kind,
          category: data.category,
          title: data.title,
          description: data.description,
          price:
            data.price_cents === null
              ? ""
              : (data.price_cents / 100).toFixed(2),
          shipping:
            data.kind === "product"
              ? (data.shipping_cents / 100).toFixed(2)
              : "",
          sizes:
            data.kind === "product" ? data.sizes.join(", ") : DEFAULT_SIZES,
          buy_url: data.buy_url ?? "",
          file_path: data.file_path ?? "",
          file_name: data.file_name ?? "",
          image_path: data.image_path ?? "",
          image_url: publicImageUrl(getSupabaseEnv().url, data.image_path),
          visible_to_all: data.visible_to_all,
        }}
      />
    </div>
  );
}
