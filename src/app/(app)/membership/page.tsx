import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { T } from "@/i18n/t";
import { getLocale, getTr } from "@/i18n/server";
import { LOCALE_TAG } from "@/i18n/config";
import {
  confirmPlatformCheckout,
  getPlatformBillingState,
  getPlatformEntitlement,
  reconcilePlatformMembership,
} from "@/lib/platform-membership-server";
import { PLATFORM_PLANS } from "@/lib/platform-memberships";
import { categoryLabel, formatMoney } from "@/lib/armory";
import { requireAuthenticatedAccount } from "@/lib/auth";
import {
  openPlatformBillingPortal,
  resumePlatformPlan,
  startPlatformCheckout,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Platform membership") };
}

function requestedValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

export default async function PlatformMembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { profile } = await requireAuthenticatedAccount();
  const params = await searchParams;
  const checkout = requestedValue(params.checkout);
  const portalReturn = requestedValue(params.plan);
  const sessionId = requestedValue(params.session_id);
  const tr = await getTr();
  const locale = await getLocale();

  // Stripe IDs in the URL only request a server-side verification. A session/return query never
  // creates entitlement on its own.
  if (checkout === "complete" && sessionId) {
    await confirmPlatformCheckout(sessionId, profile.id);
  } else if (portalReturn === "updated" || portalReturn === "cancelled") {
    await reconcilePlatformMembership(profile.id).catch(() => false);
  }

  let billing = await getPlatformBillingState(profile.id);
  if (
    billing.ok &&
    billing.state.latestSubscription?.status === "active" &&
    !billing.state.activeSubscription
  ) {
    await reconcilePlatformMembership(profile.id).catch(() => false);
    billing = await getPlatformBillingState(profile.id);
  }
  const access = await getPlatformEntitlement(profile.id);
  const billingReady = billing.ok && access.ok;
  const state = billing.ok ? billing.state : null;
  const active = state?.activeSubscription ?? null;
  const testGrant = state?.testEntitlement ?? null;
  const checkoutAttempt = state?.checkoutAttempt ?? null;
  const accountCanChooseRegular = profile.role === "member";

  const endDate = active?.current_period_end
    ? new Date(active.current_period_end).toLocaleDateString(LOCALE_TAG[locale], {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;
  const pendingTier = checkoutAttempt?.tier ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-5xl">
          <T>Platform membership</T>
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          {profile.role === "member" ? (
            <T>Choose a paid platform membership to use GYMX2.</T>
          ) : (
            <T>Premium membership unlocks the Premium Armory categories for shoppers.</T>
          )}
        </p>
      </div>

      {params.issue === "required" && !active && !testGrant && (
        <p role="status" className="rounded-lg border border-accent bg-surface p-4">
          <T>Choose a paid platform membership to continue using member features.</T>
        </p>
      )}
      {(params.issue === "check" || !billingReady) && (
        <p role="alert" className="rounded-lg border border-danger bg-surface p-4 text-danger">
          <T>We couldn&apos;t verify your membership status. Please refresh and try again.</T>
        </p>
      )}
      {checkout === "cancelled" && (
        <p role="status" className="rounded-lg border border-border bg-surface p-4">
          <T>Checkout wasn&apos;t completed. No membership was created.</T>
        </p>
      )}
      {checkout === "complete" && !active && !testGrant && (
        <p role="status" className="rounded-lg border border-border bg-surface p-4">
          <T>We&apos;re waiting for Stripe to confirm your payment. Refresh this page in a moment.</T>
        </p>
      )}
      {portalReturn === "updated" && active && (
        <p role="status" className="rounded-lg border border-accent bg-surface p-4">
          <T>Your plan change was confirmed by Stripe.</T>
        </p>
      )}
      {portalReturn === "cancelled" && active?.cancel_at_period_end && (
        <p role="status" className="rounded-lg border border-accent bg-surface p-4">
          <T>Your membership is scheduled to end at the end of the paid period.</T>
        </p>
      )}

      {active ? (
        <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">
              <T>Current plan</T>
            </p>
            <h2 className="mt-1 text-3xl">
              {active.tier === "premium" ? tr("Premium") : tr("Regular")}
            </h2>
            <p className="mt-1 text-muted">
              {formatMoney(PLATFORM_PLANS.find((plan) => plan.tier === active.tier)!.priceCents)}
              <T>/month</T>
            </p>
            <p className="mt-2 text-sm text-muted">
              {active.cancel_at_period_end && endDate
                ? tr("Your plan ends on {date}. You keep access until then.", { date: endDate })
                : endDate
                  ? tr("Your plan renews on {date}.", { date: endDate })
                  : tr("Your membership is active.")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionForm action={openPlatformBillingPortal}>
              <input type="hidden" name="intent" value="manage" />
              <SubmitButton pendingText={tr("Opening...")} className="btn-secondary">
                <T>Manage billing</T>
              </SubmitButton>
              <FormStatus />
            </ActionForm>

            {active.cancel_at_period_end ? (
              <ActionForm
                action={resumePlatformPlan}
                confirmMessage={tr("Resume your platform membership and monthly billing?")}
              >
                <SubmitButton pendingText={tr("Saving...")} className="btn-secondary">
                  <T>Resume membership</T>
                </SubmitButton>
                <FormStatus />
              </ActionForm>
            ) : (
              <ActionForm
                action={openPlatformBillingPortal}
                confirmMessage={tr("Continue to Stripe to review cancellation. Your paid access lasts through the period end.")}
              >
                <input type="hidden" name="intent" value="cancel" />
                <SubmitButton pendingText={tr("Opening...")} className="btn-secondary">
                  <T>Cancel membership</T>
                </SubmitButton>
                <FormStatus />
              </ActionForm>
            )}

            {(active.tier === "regular" || accountCanChooseRegular) && (
              <ActionForm
                action={openPlatformBillingPortal}
                confirmMessage={tr("Stripe will show the new amount and any proration before you confirm the plan change.")}
              >
                <input type="hidden" name="intent" value="change" />
                <input
                  type="hidden"
                  name="tier"
                  value={active.tier === "regular" ? "premium" : "regular"}
                />
                <SubmitButton pendingText={tr("Opening...")} className="btn-secondary">
                  {active.tier === "regular" ? tr("Review Premium plan") : tr("Review Regular plan")}
                </SubmitButton>
                <FormStatus />
              </ActionForm>
            )}
          </div>
          <p className="text-xs text-muted">
            <T>Stripe asks you to confirm plan changes before applying them.</T>
          </p>
        </section>
      ) : testGrant ? (
        <section className="space-y-2 rounded-xl border border-accent bg-surface p-5">
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">
            <T>Access provided by GYMX2</T>
          </p>
          <h2 className="text-3xl">
            {testGrant.tier === "premium" ? tr("Premium") : tr("Regular")}
          </h2>
          <p className="text-sm text-muted">
            <T>This access is managed by GYMX2 and does not include a Stripe subscription or bill.</T>
          </p>
        </section>
      ) : checkoutAttempt &&
        (!state?.latestSubscription ||
          ["canceled", "incomplete_expired"].includes(
            state.latestSubscription.status,
          )) ? (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <h2 className="text-2xl">
            <T>Checkout in progress</T>
          </h2>
          <p className="text-sm text-muted">
            {tr("A {plan} checkout is already open. Continue it to avoid starting a second subscription.", {
              plan: pendingTier === "premium" ? tr("Premium") : tr("Regular"),
            })}
          </p>
          <ActionForm action={startPlatformCheckout}>
            <input type="hidden" name="tier" value={pendingTier ?? "regular"} />
            <SubmitButton pendingText={tr("Opening...")} className="btn-primary">
              {pendingTier === "premium" ? tr("Continue Premium checkout") : tr("Continue Regular checkout")}
            </SubmitButton>
            <FormStatus />
          </ActionForm>
        </section>
      ) : billingReady && state?.latestSubscription && !["canceled", "incomplete_expired"].includes(state.latestSubscription.status) ? (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <h2 className="text-2xl"><T>Payment status needs attention</T></h2>
          <p className="text-sm text-muted">
            <T>Your Stripe membership is not currently active. Update billing details or contact support before starting another subscription.</T>
          </p>
          <ActionForm action={openPlatformBillingPortal}>
            <input type="hidden" name="intent" value="manage" />
            <SubmitButton pendingText={tr("Opening...")} className="btn-secondary">
              <T>Manage billing</T>
            </SubmitButton>
            <FormStatus />
          </ActionForm>
        </section>
      ) : billingReady ? (
        <section className="grid gap-4 md:grid-cols-2">
          {PLATFORM_PLANS.filter((plan) => accountCanChooseRegular || plan.tier === "premium").map((plan) => (
            <article key={plan.tier} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
              <div>
                <h2 className="text-3xl">{tr(plan.label)}</h2>
                <p className="mt-1 text-2xl font-semibold">
                  {formatMoney(plan.priceCents)}<span className="text-base font-normal text-muted"><T>/month</T></span>
                </p>
              </div>
              <ul className="space-y-1 text-sm text-muted">
                {plan.categoryValues.map((category) => (
                  <li key={category}>· <T>{categoryLabel(category)}</T></li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                <T>Renews monthly until you cancel. No free trial.</T>
              </p>
              <ActionForm action={startPlatformCheckout} className="mt-auto">
                <input type="hidden" name="tier" value={plan.tier} />
                <SubmitButton pendingText={tr("Opening...")} className="btn-primary">
                  {plan.tier === "regular" ? tr("Choose Regular") : tr("Choose Premium")}
                </SubmitButton>
                <FormStatus />
              </ActionForm>
            </article>
          ))}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/armory" className="text-link">
          <T>Browse the Armory</T>
        </Link>
        <Link href="/profile" className="text-link">
          <T>Account and privacy settings</T>
        </Link>
      </div>
    </div>
  );
}
