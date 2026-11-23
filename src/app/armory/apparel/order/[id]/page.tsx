import { createHash } from "node:crypto";
import Link from "next/link";
import type { Metadata } from "next";
import { ArmoryPublicHeader } from "@/components/armory-public-header";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Apparel order status",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

type SafeStatus = Readonly<{
  status: "processing" | "partially_shipped" | "fulfilled" | "refunded" | "review_required" | "checkout_expired";
  title: string;
  variant: string;
  priceCents: number;
  shippingCents: number;
  currency: "usd";
}>;

function parseStatus(value: unknown): SafeStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const statuses: SafeStatus["status"][] = ["processing", "partially_shipped", "fulfilled", "refunded", "review_required", "checkout_expired"];
  if (typeof row.status !== "string" || !statuses.includes(row.status as SafeStatus["status"]) ||
    typeof row.title !== "string" || typeof row.variant !== "string" ||
    !Number.isSafeInteger(row.priceCents) || !Number.isSafeInteger(row.shippingCents) || row.currency !== "usd") return null;
  return {
    status: row.status as SafeStatus["status"],
    title: row.title,
    variant: row.variant,
    priceCents: Number(row.priceCents),
    shippingCents: Number(row.shippingCents),
    currency: "usd",
  };
}

const statusLabel: Record<SafeStatus["status"], string> = {
  processing: "We’re preparing your order.",
  partially_shipped: "Your order has started shipping.",
  fulfilled: "Your order has shipped.",
  refunded: "This payment was refunded.",
  review_required: "Your order needs review. Refresh this private page for updates.",
  checkout_expired: "This checkout expired before payment completed.",
};

// The claim token stays request-bound; Next renders this capability-gated status page for each request.
export default async function PrintfulApparelOrderStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ claim?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const token = typeof query.claim === "string" ? query.claim : "";
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);
  let status: SafeStatus | null = null;
  if (validId && validToken) {
    const digest = createHash("sha256").update(token).digest("hex");
    const { data, error } = await createAdminClient().rpc("get_printful_apparel_order_status", {
      target_order_id: id,
      target_status_token_sha256: digest,
    });
    if (!error) status = parseStatus(data);
  }

  return (
    <>
      <ArmoryPublicHeader signedIn={false} />
      <main className="mx-auto max-w-2xl px-4 py-12">
        <section className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">GYMX2 Apparel</p>
          {status ? (
            <>
              <h1 className="mt-3 text-3xl">Order status</h1>
              <p role="status" className="mt-4 text-lg">{statusLabel[status.status]}</p>
              <div className="mt-6 rounded-xl border border-border bg-surface-raised p-4">
                <p className="font-semibold">{status.title}</p>
                <p className="mt-1 text-sm text-muted">{status.variant}</p>
                <p className="mt-3 font-semibold">${(status.priceCents / 100).toFixed(2)}</p>
                <p className="text-sm text-muted">Free U.S. shipping</p>
              </div>
              <p className="mt-4 text-sm text-muted">Save this private link. Refresh this page to check for updates.</p>
            </>
          ) : (
            <>
              <h1 className="mt-3 text-3xl">Order status unavailable</h1>
              <p className="mt-4 text-muted">We couldn’t verify this private order link. Check that you have the complete link, then refresh the page.</p>
            </>
          )}
          <Link href="/armory" className="btn-secondary mt-6">Return to the Armory</Link>
        </section>
      </main>
    </>
  );
}
