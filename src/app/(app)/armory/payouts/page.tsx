import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { PLATFORM_FEE_PERCENT } from "@/lib/armory";
import { requireCoach } from "@/lib/auth";
import { refreshPayoutAccount } from "@/lib/purchases";
import { isStripeConfigured, isStripeTestMode } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { openPayoutDashboard, startPayoutSetup } from "../payments";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Payouts") };
}

export default async function PayoutsPage() {
  const tr = await getTr();
  const { profile } = await requireCoach();

  const supabase = await createClient();
  const { data: account } = await supabase
    .from("payout_accounts")
    .select("stripe_account_id, charges_enabled, payouts_enabled")
    .eq("coach_id", profile.id)
    .maybeSingle();

  // Stripe is the source of truth, so the status is refreshed every time this page opens.
  let status = account
    ? {
        charges_enabled: Boolean(account.charges_enabled),
        payouts_enabled: Boolean(account.payouts_enabled),
      }
    : null;
  if (account && isStripeConfigured()) {
    try {
      status = await refreshPayoutAccount(
        profile.id,
        account.stripe_account_id as string,
      );
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/armory" className="text-link text-sm">
        <T>Back to the Armory</T>
      </Link>
      <div>
        <h1 className="text-5xl">
          <T>Payouts</T>
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          Sell ebooks and programs in the Armory and get paid straight to your
          bank account through Stripe. You get each sale minus GYMX2&apos;s{" "}
          {PLATFORM_FEE_PERCENT}% fee and Stripe&apos;s card fees.
        </p>
        {isStripeTestMode() && (
          <p className="mt-2 text-sm text-accent">
            <T>Test mode: no real money moves yet.</T>
          </p>
        )}
      </div>

      {!isStripeConfigured() ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          <T>Payments aren&apos;t switched on yet. Please check back soon.</T>
        </p>
      ) : (
        <div className="max-w-2xl space-y-4 rounded-lg border border-border bg-surface p-5">
          {!status ? (
            <>
              <p className="font-semibold">
                <T>Not set up yet</T>
              </p>
              <p className="text-sm text-muted">
                <T>
                  Stripe will ask for your details and the bank account to pay
                  you into. It takes a few minutes.
                </T>
              </p>
              <ActionForm action={startPayoutSetup} className="space-y-2">
                <SubmitButton
                  pendingText={tr("Opening Stripe...")}
                  className="btn-primary"
                >
                  <T>Set up payouts</T>
                </SubmitButton>
                <FormStatus />
              </ActionForm>
            </>
          ) : status.charges_enabled ? (
            <>
              <p className="font-semibold text-success">
                <T>Ready to sell</T>
              </p>
              <p className="text-sm text-muted">
                {status.payouts_enabled
                  ? tr(
                      "Members can buy your paid items, and Stripe pays you out on its usual schedule.",
                    )
                  : tr(
                      "Members can buy your paid items. Stripe needs a little more information before it can pay you out.",
                    )}
              </p>
              <div className="flex flex-wrap gap-2">
                <ActionForm action={openPayoutDashboard} className="space-y-2">
                  <SubmitButton
                    pendingText={tr("Opening Stripe...")}
                    className="btn-primary"
                  >
                    <T>Open your Stripe dashboard</T>
                  </SubmitButton>
                  <FormStatus />
                </ActionForm>
                <Link href="/armory/sales" className="btn-secondary">
                  <T>See your sales</T>
                </Link>
                {!status.payouts_enabled && (
                  <ActionForm action={startPayoutSetup} className="space-y-2">
                    <SubmitButton
                      pendingText={tr("Opening Stripe...")}
                      className="btn-secondary"
                    >
                      <T>Finish setup</T>
                    </SubmitButton>
                    <FormStatus />
                  </ActionForm>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="font-semibold">
                <T>Almost there</T>
              </p>
              <p className="text-sm text-muted">
                <T>
                  Stripe still needs some details before members can buy from
                  you. Pick up where you left off.
                </T>
              </p>
              <ActionForm action={startPayoutSetup} className="space-y-2">
                <SubmitButton
                  pendingText={tr("Opening Stripe...")}
                  className="btn-primary"
                >
                  <T>Finish setup</T>
                </SubmitButton>
                <FormStatus />
              </ActionForm>
            </>
          )}
        </div>
      )}
    </div>
  );
}
