import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { requireAuthenticatedAccount } from "@/lib/auth";
import {
  loadFormCoachBillingPage,
  reconcileFormCoachCheckoutReturn,
  type FormCoachBillingPageData,
} from "@/lib/form-coach/checkout-server";
import { getFormCoachOfferTitle } from "@/lib/form-coach/offer-title";
import { claimFormCoachAssessmentTrialAction, openFormCoachBillingPortal, startFormCoachCheckout } from "./actions";

type PageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).featurePricing.billing.title };
}

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function formatMoney(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function returnMessage(state: FormCoachBillingPageData["returnState"], copy: Awaited<ReturnType<typeof getT>>["featurePricing"]["billing"]) {
  if (state === "expired") return copy.returnExpired;
  if (state === "processing") return copy.returnProcessing;
  if (state === "unavailable") return copy.returnUnavailable;
  return null;
}

function statusMessage(status: string | null, copy: Awaited<ReturnType<typeof getT>>["featurePricing"]["billing"]): string | null {
  switch (status) {
    case "coming_soon": return copy.status.coming_soon;
    case "unavailable": return copy.status.unavailable;
    case "invalid": return copy.status.invalid;
    case "pending": return copy.status.pending;
    case "expired": return copy.status.expired;
    case "already_active": return copy.status.already_active;
    case "account_deleting": return copy.status.account_deleting;
    case "membership_required": return copy.status.membership_required;
    case "portal_unavailable": return copy.status.portal_unavailable;
    case "trial_claimed": return copy.assessmentTrial.claimed;
    case "trial_already_claimed": return copy.assessmentTrial.alreadyClaimed;
    case "trial_coming_soon": return copy.assessmentTrial.comingSoon;
    case "trial_invalid": return copy.assessmentTrial.invalid;
    case "trial_account_deleting": return copy.status.account_deleting;
    case "trial_payer_mismatch": return copy.assessmentTrial.unavailable;
    case "trial_unavailable": return copy.assessmentTrial.unavailable;
    default: return null;
  }
}

function billingSourceLabel(sourceKind: string, copy: Awaited<ReturnType<typeof getT>>["featurePricing"]["billing"]): string {
  switch (sourceKind) {
    case "subscription": return copy.summary.subscription;
    case "assessment_trial": return copy.summary.assessment_trial;
    case "pack": return copy.summary.pack;
    case "comp": return copy.summary.comp;
    default: return copy.summary.other;
  }
}

function billingStateLabel(state: string, copy: Awaited<ReturnType<typeof getT>>["featurePricing"]["billing"]): string {
  switch (state) {
    case "active": return copy.summary.active;
    case "trialing": return copy.summary.trialing;
    case "past_due": return copy.summary.past_due;
    case "unpaid": return copy.summary.unpaid;
    case "canceled": return copy.summary.canceled;
    case "available": return copy.summary.available;
    case "revoked": return copy.summary.revoked;
    default: return copy.summary.stateUnknown;
  }
}

function historyStatusLabel(status: string, copy: Awaited<ReturnType<typeof getT>>["featurePricing"]["billing"]): string {
  switch (status) {
    case "paid": return copy.history.paid;
    case "trial": return copy.history.trial;
    case "pending": return copy.history.pending;
    case "refunded": return copy.history.refunded;
    case "review": return copy.history.review;
    default: return copy.history.pending;
  }
}

export default async function FormCoachBillingPage({ searchParams }: PageProps) {
  const { profile } = await requireAuthenticatedAccount();
  const params = await searchParams;
  const copy = (await getT()).featurePricing.billing;
  const data = await loadFormCoachBillingPage(profile.id, profile.role);
  const checkoutParam = single(params.checkout);
  const returnedSession = checkoutParam === "returned"
    ? await reconcileFormCoachCheckoutReturn(profile.id, single(params.request_id))
    : "none";
  const returnState: FormCoachBillingPageData["returnState"] = checkoutParam === "returned"
    ? returnedSession === "none" ? "unavailable" : returnedSession
    : "none";
  const message = returnMessage(returnState, copy) ?? statusMessage(single(params.status), copy);
  const locale = profile.locale === "es" ? "es" : "en-US";
  const pricing = data.pricing;
  const payerMatches = Boolean(pricing && pricing.payer === profile.role);
  const checkoutReady = data.checkoutEnabled && payerMatches;

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-muted">{copy.intro}</p>
      </header>

      {message && <p className="rounded-lg border border-accent bg-surface p-4 text-sm" role="status">{message}</p>}
      {data.readError && <p className="rounded-lg border border-warning bg-surface p-4 text-sm" role="status">{copy.loadingError}</p>}

      <section className="space-y-4" aria-labelledby="form-coach-offers">
        <h2 id="form-coach-offers" className="text-xl font-semibold">{pricing?.displayName ?? copy.title}</h2>
        {pricing?.status === "disabled" && <p className="rounded-lg border border-muted p-4 text-sm">{copy.disabled}</p>}
        {pricing?.status === "pricing_pending" && <p className="rounded-lg border border-muted p-4 text-sm">{copy.pricingPending}</p>}
        {!pricing && <p className="rounded-lg border border-muted p-4 text-sm">{copy.noPricing}</p>}
        {pricing?.status === "live" && (
          <>
            {pricing.description && <p className="text-sm text-muted">{pricing.description}</p>}
            {pricing.marketingCopy && <p className="text-sm">{pricing.marketingCopy}</p>}
            {!payerMatches
              ? <p className="rounded-lg border border-muted p-4 text-sm">{copy.noOffer}</p>
              : !checkoutReady && <p className="rounded-lg border border-muted p-4 text-sm">{copy.checkoutComingSoon}</p>}
            {!pricing.offers.length && <p className="rounded-lg border border-muted p-4 text-sm">{copy.checkoutUnavailable}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              {pricing.offers.map((offer) => (
                <article key={offer.priceKey} className="space-y-3 rounded-xl border border-border bg-surface p-5">
                  <h3 className="font-semibold">{getFormCoachOfferTitle(offer, copy.offerTitle)}</h3>
                  <p className="text-2xl font-bold">
                    {formatMoney(offer.amountCents, offer.currency, locale)}
                    {offer.interval && <span className="ml-2 text-sm font-normal text-muted">{copy.interval[offer.interval]}</span>}
                  </p>
                  {offer.creditsPerPack && <p className="text-sm text-muted">{copy.creditsPerPack(offer.creditsPerPack)}</p>}
                  <form action={startFormCoachCheckout} className="space-y-3">
                    <input type="hidden" name="price_key" value={offer.priceKey} />
                    <input type="hidden" name="request_id" value={randomUUID()} />
                    {pricing.billingModel === "per_assessment" && (
                      <label className="block space-y-1.5 text-sm">
                        <span>{copy.quantity}</span>
                        <input className="field-input" type="number" name="quantity" min={1} max={100} step={1} defaultValue={1} required />
                      </label>
                    )}
                    {pricing.billingModel === "subscription" && <input type="hidden" name="quantity" value={1} />}
                    <button type="submit" disabled={!checkoutReady} className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60">
                      {copy.buy}
                    </button>
                  </form>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {data.assessmentTrialEnabled && data.canClaimAssessmentTrial && (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-5" aria-labelledby="form-coach-trial">
          <h2 id="form-coach-trial" className="text-xl font-semibold">{copy.assessmentTrial.title}</h2>
          <p className="text-sm text-muted">{copy.assessmentTrial.description(data.assessmentTrialCount)}</p>
          <form action={claimFormCoachAssessmentTrialAction}>
            <input type="hidden" name="request_id" value={randomUUID()} />
            <button type="submit" className="btn-primary">{copy.assessmentTrial.claim}</button>
          </form>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="form-coach-billing-summary">
        <h2 id="form-coach-billing-summary" className="text-xl font-semibold">{copy.billingHeading}</h2>
        {data.billing.length === 0 ? <p className="text-sm text-muted">{copy.billingEmpty}</p> : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {data.billing.map((entry, index) => (
              <li key={`${entry.sourceKind}-${entry.state}-${index}`} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <span className="font-medium">{billingSourceLabel(entry.sourceKind, copy)}</span>
                <span>{billingStateLabel(entry.state, copy)}</span>
                <span className="text-muted">
                  {entry.remainingCredits !== null ? copy.summary.remaining(entry.remainingCredits) : ""}
                  {entry.validThrough ? ` · ${copy.summary.through(formatDate(entry.validThrough, locale))}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="form-coach-history">
        <h2 id="form-coach-history" className="text-xl font-semibold">{copy.historyHeading}</h2>
        {data.history.length === 0 ? <p className="text-sm text-muted">{copy.historyEmpty}</p> : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {data.history.map((entry, index) => (
              <li key={`${entry.kind}-${entry.recordedAt}-${index}`} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <span>{historyStatusLabel(entry.status, copy)}</span>
                <span>{formatMoney(entry.amountPaidCents, entry.currency, locale)}</span>
                <time className="text-muted" dateTime={entry.recordedAt}>{formatDate(entry.recordedAt, locale)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="form-coach-portal">
        <h2 id="form-coach-portal" className="text-xl font-semibold">{copy.portalHeading}</h2>
        {data.canManageBilling ? (
          <form action={openFormCoachBillingPortal}>
            <button type="submit" className="btn-secondary">{copy.portalButton}</button>
          </form>
        ) : <p className="text-sm text-muted">{copy.portalUnavailable}</p>}
      </section>

      <p className="text-sm text-muted"><Link href="/dashboard" className="link">{(await getT()).nav.links["/dashboard"]}</Link></p>
    </main>
  );
}
