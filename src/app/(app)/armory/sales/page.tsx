import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatMoney } from "@/lib/armory";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sales" };

type Sale = {
  id: string;
  item_id: string | null;
  item_title: string;
  amount_cents: number;
  fee_cents: number;
  created_at: string;
  seller_id: string | null;
  buyer: { display_name: string } | null;
  seller: { display_name: string } | null;
};

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function SalesPage() {
  const { profile } = await requireAccount();
  if (profile.role === "member") redirect("/armory");
  const isAdmin = profile.role === "admin";

  // Row security: coaches see their own sales, admins see every sale.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchases")
    .select(
      "id, item_id, item_title, amount_cents, fee_cents, created_at, seller_id, buyer:profiles!member_id(display_name), seller:profiles!seller_id(display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  const sales = (data ?? []) as unknown as Sale[];

  const total = sales.reduce((sum, sale) => sum + sale.amount_cents, 0);
  const fees = sales.reduce((sum, sale) => sum + sale.fee_cents, 0);

  return (
    <div className="space-y-6">
      <Link href="/armory" className="text-link text-sm">
        Back to the Armory
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">Sales</h1>
          <p className="mt-2 max-w-xl text-muted">
            {isAdmin ? "Every paid download sold on GYMX2." : "Your paid downloads sold in the Armory."}
          </p>
        </div>
        {!isAdmin && (
          <Link href="/armory/payouts" className="btn-secondary">
            Payouts
          </Link>
        )}
      </div>

      <dl className="grid max-w-2xl grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <dt className="text-sm text-muted">Sales</dt>
          <dd className="mt-1 text-2xl font-semibold">{sales.length}</dd>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <dt className="text-sm text-muted">Total paid</dt>
          <dd className="mt-1 text-2xl font-semibold">{formatMoney(total)}</dd>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <dt className="text-sm text-muted">{isAdmin ? "GYMX2 kept" : "Your share"}</dt>
          <dd className="mt-1 text-2xl font-semibold">
            {formatMoney(isAdmin ? fees : total - fees)}
          </dd>
        </div>
      </dl>
      {!isAdmin && (
        <p className="text-xs text-muted">Your share is before Stripe&apos;s card fees. Your Stripe dashboard shows exact payouts.</p>
      )}

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load sales. Please refresh and try again.
        </p>
      ) : sales.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">No sales yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="p-3 font-medium">Date</th>
                <th className="p-3 font-medium">Item</th>
                <th className="p-3 font-medium">Buyer</th>
                {isAdmin && <th className="p-3 font-medium">Seller</th>}
                <th className="p-3 text-right font-medium">Paid</th>
                <th className="p-3 text-right font-medium">{isAdmin ? "GYMX2 kept" : "Your share"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="p-3 whitespace-nowrap">{formatDay(sale.created_at)}</td>
                  <td className="p-3">
                    {sale.item_id ? (
                      <Link href={`/armory/${sale.item_id}`} className="text-link">
                        {sale.item_title}
                      </Link>
                    ) : (
                      sale.item_title
                    )}
                  </td>
                  <td className="p-3">{sale.buyer?.display_name ?? "A member"}</td>
                  {isAdmin && <td className="p-3">{sale.seller?.display_name ?? "—"}</td>}
                  <td className="p-3 text-right">{formatMoney(sale.amount_cents)}</td>
                  <td className="p-3 text-right">
                    {formatMoney(isAdmin ? sale.fee_cents : sale.amount_cents - sale.fee_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
