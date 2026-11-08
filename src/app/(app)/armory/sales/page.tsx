import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { addressLines, formatMoney, fulfillmentLabel, type ShippingAddress } from "@/lib/armory";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { markOrderShipped } from "../payments";

export const metadata: Metadata = { title: "Sales" };

type Sale = {
  id: string;
  item_id: string | null;
  item_title: string;
  amount_cents: number;
  fee_cents: number;
  created_at: string;
  seller_id: string | null;
  size: string | null;
  shipping_name: string | null;
  shipping_address: ShippingAddress | null;
  fulfillment_status: string;
  tracking_number: string | null;
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
      "id, item_id, item_title, amount_cents, fee_cents, created_at, seller_id, size, shipping_name, shipping_address, fulfillment_status, tracking_number, buyer:profiles!member_id(display_name), seller:profiles!seller_id(display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  const sales = (data ?? []) as unknown as Sale[];

  const total = sales.reduce((sum, sale) => sum + sale.amount_cents, 0);
  const fees = sales.reduce((sum, sale) => sum + sale.fee_cents, 0);
  // Oldest first, so the order waiting longest is shipped first.
  const toShip = sales.filter((sale) => sale.fulfillment_status === "to_ship").reverse();

  return (
    <div className="space-y-6">
      <Link href="/armory" className="text-link text-sm">
        Back to the Armory
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">Sales</h1>
          <p className="mt-2 max-w-xl text-muted">
            {isAdmin ? "Every paid item sold on GYMX2." : "Your paid downloads and gear sold in the Armory."}
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

      {toShip.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">Orders to ship ({toShip.length})</h2>
          <p className="max-w-2xl text-sm text-muted">
            Ship each order to the address below, then mark it shipped. Add the tracking number so the buyer can follow it.
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {toShip.map((order) => (
              <li key={order.id} className="space-y-3 rounded-lg border border-accent bg-surface p-4">
                <div>
                  <p className="font-semibold">
                    {order.item_title}
                    {order.size && <span className="ml-2 rounded bg-surface-raised px-2 py-0.5 text-sm">Size {order.size}</span>}
                  </p>
                  <p className="text-xs text-muted">
                    Ordered {formatDay(order.created_at)} by {order.buyer?.display_name ?? "a member"}
                    {isAdmin && order.seller && ` · Seller: ${order.seller.display_name}`}
                  </p>
                </div>
                <address className="text-sm not-italic">
                  {order.shipping_name && <span className="block font-medium">{order.shipping_name}</span>}
                  {addressLines(order.shipping_address).map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </address>
                <ActionForm action={markOrderShipped} className="flex flex-wrap items-start gap-2">
                  <input type="hidden" name="purchase_id" value={order.id} />
                  <label className="sr-only" htmlFor={`tracking-${order.id}`}>
                    Tracking number
                  </label>
                  <input
                    id={`tracking-${order.id}`}
                    name="tracking"
                    maxLength={100}
                    placeholder="Tracking number (optional)"
                    className="field-input min-w-0 flex-1"
                  />
                  <SubmitButton pendingText="Saving..." className="btn-primary px-3 py-2 text-sm">
                    Mark shipped
                  </SubmitButton>
                  <div className="w-full">
                    <FormStatus />
                  </div>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
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
                <th className="p-3 font-medium">Status</th>
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
                  <td className="p-3 whitespace-nowrap">
                    {fulfillmentLabel[sale.fulfillment_status] ?? sale.fulfillment_status}
                    {sale.size && ` · ${sale.size}`}
                    {sale.tracking_number && <span className="block text-xs text-muted">{sale.tracking_number}</span>}
                  </td>
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
