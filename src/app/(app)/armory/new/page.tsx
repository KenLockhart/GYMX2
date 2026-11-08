import type { Metadata } from "next";
import Link from "next/link";
import { ArmoryForm } from "@/components/armory-form";
import { requireCoachOrAdmin } from "@/lib/auth";

export const metadata: Metadata = { title: "Add to the Armory" };

export default async function NewArmoryItemPage() {
  const { profile } = await requireCoachOrAdmin();

  return (
    <div className="space-y-6">
      <Link href="/armory" className="text-link text-sm">
        Back to the Armory
      </Link>
      <h1 className="text-5xl">Add to the Armory</h1>
      {profile.role === "admin" && (
        <p className="max-w-xl text-sm text-muted">Items you add show as &quot;From GYMX2&quot;.</p>
      )}
      <ArmoryForm
        submitLabel="Add item"
        initial={{
          id: "",
          kind: "link",
          category: "ebook",
          title: "",
          description: "",
          price: "",
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
