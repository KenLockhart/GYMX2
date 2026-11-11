import type { Metadata } from "next";
import Link from "next/link";
import { ArmoryForm } from "@/components/armory-form";
import { DEFAULT_SIZES } from "@/lib/armory";
import { requireCoachOrAdmin } from "@/lib/auth";
import { loadPayoutStatus } from "../payout-status";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Add to the Armory") };
}

export default async function NewArmoryItemPage() {
  const tr = await getTr();
  const { profile } = await requireCoachOrAdmin();
  const payouts = await loadPayoutStatus(profile);

  return (
    <div className="space-y-6">
      <Link href="/armory" className="text-link text-sm">
        <T>Back to the Armory</T>
      </Link>
      <h1 className="text-5xl">
        <T>Add to the Armory</T>
      </h1>
      {profile.role === "admin" && (
        <p className="max-w-xl text-sm text-muted">
          <T>Items you add show as &quot;From GYMX2&quot;.</T>
        </p>
      )}
      <ArmoryForm
        submitLabel={tr("Add item")}
        payouts={payouts}
        initial={{
          id: "",
          kind: "link",
          category: "ebook",
          title: "",
          description: "",
          price: "",
          shipping: "",
          sizes: DEFAULT_SIZES,
          buy_url: "",
          file_path: "",
          file_name: "",
          image_path: "",
          image_url: null,
          visible_to_all: profile.role === "admin",
        }}
      />
    </div>
  );
}
