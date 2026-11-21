import Link from "next/link";
import { requireAuthenticatedAccount } from "@/lib/auth";
import { getMyProgramPurchaseHistory } from "@/lib/program-purchase-history-server";
import {
  parseProgramPurchaseHistoryCursorSearch,
  programPurchaseCreatedAtLabel,
  programPurchaseHistoryPageHref,
  programPurchaseHistoryStatusCopy,
} from "@/lib/program-purchase-history-ui";

const PAGE_SIZE = 20;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProgramPurchasesPage({ searchParams }: PageProps) {
  await requireAuthenticatedAccount();
  const search = await searchParams;
  const cursor = parseProgramPurchaseHistoryCursorSearch(search);
  const content = cursor.status === "invalid"
    ? (
      <section className="rounded-2xl border border-amber-300/30 bg-amber-300/5 p-5" role="alert">
        <h2 className="font-semibold text-amber-100">This history page link is invalid</h2>
        <p className="mt-2 text-sm text-slate-300">Open the first page of your purchase history to continue.</p>
        <Link className="mt-4 inline-flex text-sm font-semibold text-lime-300 underline underline-offset-4" href="/program-purchases">
          Open purchase history
        </Link>
      </section>
    )
    : await renderHistoryPage(cursor.status === "cursor" ? cursor.value : null);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-lime-300">Account</p>
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">Program purchases</h1>
        <p className="max-w-2xl text-sm leading-6 text-slate-300">
          Review your saved order history, payment progress, and cancellation status.
        </p>
      </header>

      {content}
    </main>
  );
}

async function renderHistoryPage(cursor: { createdAt: string; orderId: string } | null) {
  const result = await getMyProgramPurchaseHistory({ limit: PAGE_SIZE, cursor, programId: null });
  if (!result.ok) {
    const isInvalid = result.reason === "invalid_request" || result.reason === "invalid_response";
    return (
      <section className="rounded-2xl border border-amber-300/30 bg-amber-300/5 p-5" role="alert">
        <h2 className="font-semibold text-amber-100">
          {isInvalid ? "This history page could not be verified" : "Purchase history is temporarily unavailable"}
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          {isInvalid
            ? "The saved page cursor was not valid. Start from the first page to continue."
            : "Your saved purchases have not been changed. Try loading this page again."}
        </p>
        <Link className="mt-4 inline-flex text-sm font-semibold text-lime-300 underline underline-offset-4" href="/program-purchases">
          {isInvalid ? "Open first page" : "Try again"}
        </Link>
      </section>
    );
  }

  if (result.value.items.length === 0) {
    return (
      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-6">
        <h2 className="font-semibold text-white">No Program purchases yet</h2>
        <p className="mt-2 text-sm text-slate-300">Your saved Program orders will appear here.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-label="Saved Program purchases">
      {result.value.items.map((item) => {
        const copy = programPurchaseHistoryStatusCopy(item);
        return (
          <article key={item.orderId} className="rounded-2xl border border-white/10 bg-slate-950/60 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-white">Program</h2>
                <p className="text-sm text-slate-400">Purchased {programPurchaseCreatedAtLabel(item.createdAt)}</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-2xl font-semibold text-lime-300">{copy.amount}</p>
                <p className="text-sm text-slate-400">Fixed total · {copy.plan}</p>
              </div>
            </div>
            <dl className="mt-5 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2">
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
            </dl>
            <Link
              className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-lime-300/40 px-4 text-sm font-semibold text-lime-200 transition hover:bg-lime-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
              href={`/program-purchases/${encodeURIComponent(item.orderId)}`}
            >
              View purchase details
            </Link>
          </article>
        );
      })}
      <nav className="flex items-center justify-between pt-2" aria-label="Purchase history pages">
        {cursor ? (
          <Link className="text-sm font-semibold text-lime-300 underline underline-offset-4" href="/program-purchases">
            First page
          </Link>
        ) : <span />}
        {result.value.hasMore && result.value.nextCursor ? (
          <Link
            className="ml-auto inline-flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-white hover:border-lime-300/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
            href={programPurchaseHistoryPageHref(result.value.nextCursor)}
          >
            Next page
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
