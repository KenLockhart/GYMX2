import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney, orderStatusLabel } from "@/lib/armory";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My purchases" };

type Purchase = {
  id: string;
  item_id: string | null;
  item_title: string;
  amount_cents: number;
  created_at: string;
  size: string | null;
  fulfillment_status: string;
  tracking_number: string | null;
  refunded_at: string | null;
  item: { kind: string } | null;
};

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function MyPurchasesPage() {
  const { profile } = await requireAccount();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchases")
    .select(
      "id, item_id, item_title, amount_cents, created_at, size, fulfillment_status, tracking_number, refunded_at, item:armory_items(kind)",
    )
    .eq("member_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(500);
  const purchases = (data ?? []) as unknown as Purchase[];

  return (
    <div className="space-y-6">
      <Link href="/armory" className="text-link text-sm">
        Back to the Armory
      </Link>
      <div>
        <h1 className="text-5xl">My purchases</h1>
        <p className="mt-2 max-w-xl text-muted">
          Everything you&apos;ve bought on GYMX2. Questions about an order? Message the seller, or see our{" "}
          <Link href="/refunds" className="text-link">
            refund policy
          </Link>
          .
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load your purchases. Please refresh and try again.
        </p>
      ) : purchases.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          Nothing yet.{" "}
          <Link href="/armory" className="text-link">
            Browse the Armory
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {purchases.map((purchase) => {
            const digital = purchase.fulfillment_status === "not_needed";
            const canDownload = digital && !purchase.refunded_at && purchase.item?.kind === "paid" && purchase.item_id;
            return (
              <li key={purchase.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {purchase.item_id ? (
                      <Link href={`/armory/${purchase.item_id}`} className="hover:text-accent">
                        {purchase.item_title}
                      </Link>
                    ) : (
                      purchase.item_title
                    )}
                    {purchase.size && <span className="ml-2 text-sm font-normal text-muted">Size {purchase.size}</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {formatDay(purchase.created_at)} · {formatMoney(purchase.amount_cents)} ·{" "}
                    <span className={purchase.refunded_at ? "text-danger" : ""}>
                      {digital && !purchase.refunded_at ? "Digital" : orderStatusLabel(purchase)}
                    </span>
                  </p>
                </div>
                {canDownload && (
                  <a href={`/armory/${purchase.item_id}/download`} className="btn-secondary px-3 py-2 text-sm">
                    Download
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
