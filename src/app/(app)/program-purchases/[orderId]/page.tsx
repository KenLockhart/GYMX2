import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgramPurchaseCancellationForm } from "@/components/program-purchase-cancel-form";
import { requireAuthenticatedAccount } from "@/lib/auth";
import { parseProgramPurchaseHistoryDetailCommand } from "@/lib/program-purchase-history-contracts";
import { getMyProgramPurchaseHistoryDetail } from "@/lib/program-purchase-history-server";
import {
  checkoutReturnNotice,
  programPurchaseCreatedAtLabel,
  programPurchaseHistoryStatusCopy,
} from "@/lib/program-purchase-history-ui";

type PageProps = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProgramPurchaseDetailPage({ params, searchParams }: PageProps) {
  const account = await requireAuthenticatedAccount();
  const [{ orderId: rawOrderId }, search] = await Promise.all([params, searchParams]);
  const orderId = parseProgramPurchaseHistoryDetailCommand(rawOrderId);
  if (!orderId) notFound();

  const result = await getMyProgramPurchaseHistoryDetail(orderId);
  if (!result.ok && result.reason === "not_found") notFound();
  if (!result.ok) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <Link className="text-sm font-semibold text-lime-300 underline underline-offset-4" href="/program-purchases">
          Back to Program purchases
        </Link>
        <section className="rounded-2xl border border-amber-300/30 bg-amber-300/5 p-6" role="alert">
          <h1 className="text-2xl font-semibold text-amber-100">Purchase details are temporarily unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            We could not verify the saved details for this order. Try again in a moment.
          </p>
          <Link
            className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-white hover:border-lime-300/50"
            href={`/program-purchases/${encodeURIComponent(orderId)}`}
          >
            Try again
          </Link>
        </section>
      </main>
    );
  }

  const item = result.value;
  const copy = programPurchaseHistoryStatusCopy(item);
  const returnNotice = checkoutReturnNotice(search.checkout);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-7 px-4 py-8 sm:px-6">
      <Link className="text-sm font-semibold text-lime-300 underline underline-offset-4" href="/program-purchases">
        Back to Program purchases
      </Link>
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-lime-300">Saved purchase</p>
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">Program</h1>
        <p className="text-sm text-slate-400">Purchased {programPurchaseCreatedAtLabel(item.createdAt)}</p>
      </header>

      {returnNotice ? (
        <p className="rounded-xl border border-lime-300/20 bg-lime-300/5 p-4 text-sm leading-6 text-slate-200" role="status">
          {returnNotice}
        </p>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-5 sm:p-7" aria-labelledby="purchase-status-title">
        <h2 id="purchase-status-title" className="text-xl font-semibold text-white">Purchase status</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fixed total</dt>
            <dd className="mt-1 text-2xl font-semibold text-lime-300">{copy.amount}</dd>
            {item.discountCents > 0 ? (
              <dd className="mt-1 text-sm text-slate-400">
                {copy.listPrice} list price · {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.discountCents / 100)} discount
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plan</dt>
            <dd className="mt-1 text-sm text-white">{copy.plan}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment status</dt>
            <dd className="mt-1 text-sm text-white">{copy.payment}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment progress</dt>
            <dd className="mt-1 text-sm text-white">{copy.progress}</dd>
          </div>
          {copy.cancellation ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cancellation</dt>
              <dd className="mt-1 text-sm text-white">{copy.cancellation}</dd>
            </div>
          ) : null}
          {copy.nextDueDate ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next scheduled charge</dt>
              <dd className="mt-1 text-sm text-white">{copy.nextDueDate}</dd>
            </div>
          ) : null}
          {item.safetyStage !== "clear" ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Additional review</dt>
              <dd className="mt-1 text-sm text-amber-100">We’re checking this purchase. The saved payment stages remain visible above.</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <ProgramPurchaseCancellationForm accountId={account.profile.id} item={item} />
    </main>
  );
}
