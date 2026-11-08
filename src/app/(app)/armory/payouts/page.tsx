import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { PLATFORM_FEE_PERCENT } from "@/lib/armory";
import { requireCoach } from "@/lib/auth";
import { refreshPayoutAccount } from "@/lib/purchases";
import { isStripeConfigured, isStripeTestMode } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { openPayoutDashboard, startPayoutSetup } from "../payments";

export const metadata: Metadata = { title: "Payouts" };

export default async function PayoutsPage() {
  const { profile } = await requireCoach();

  const supabase = await createClient();
  const { data: account } = await supabase
    .from("payout_accounts")
    .select("stripe_account_id, charges_enabled, payouts_enabled")
    .eq("coach_id", profile.id)
    .maybeSingle();

  // Stripe is the source of truth, so the status is refreshed every time this page opens.
  let status = account
    ? { charges_enabled: Boolean(account.charges_enabled), payouts_enabled: Boolean(account.payouts_enabled) }
    : null;
  if (account && isStripeConfigured()) {
    try {
      status = await refreshPayoutAccount(profile.id, account.stripe_account_id as string);
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/armory" className="text-link text-sm">
        Back to the Armory
      </Link>
      <div>
        <h1 className="text-5xl">Payouts</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Sell ebooks and programs in the Armory and get paid straight to your bank account through Stripe.
          You get each sale minus GYMX2&apos;s {PLATFORM_FEE_PERCENT}% fee and Stripe&apos;s card fees.
        </p>
        {isStripeTestMode() && (
          <p className="mt-2 text-sm text-accent">Test mode: no real money moves yet.</p>
        )}
      </div>

      {!isStripeConfigured() ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          Payments aren&apos;t switched on yet. Please check back soon.
        </p>
      ) : (
        <div className="max-w-2xl space-y-4 rounded-lg border border-border bg-surface p-5">
          {!status ? (
            <>
              <p className="font-semibold">Not set up yet</p>
              <p className="text-sm text-muted">
                Stripe will ask for your details and the bank account to pay you into. It takes a few minutes.
              </p>
              <ActionForm action={startPayoutSetup} className="space-y-2">
                <SubmitButton pendingText="Opening Stripe..." className="btn-primary">
                  Set up payouts
                </SubmitButton>
                <FormStatus />
              </ActionForm>
            </>
          ) : status.charges_enabled ? (
            <>
              <p className="font-semibold text-success">Ready to sell</p>
              <p className="text-sm text-muted">
                {status.payouts_enabled
                  ? "Members can buy your paid items, and Stripe pays you out on its usual schedule."
                  : "Members can buy your paid items. Stripe needs a little more information before it can pay you out."}
              </p>
              <div className="flex flex-wrap gap-2">
                <ActionForm action={openPayoutDashboard} className="space-y-2">
                  <SubmitButton pendingText="Opening Stripe..." className="btn-primary">
                    Open your Stripe dashboard
                  </SubmitButton>
                  <FormStatus />
                </ActionForm>
                <Link href="/armory/sales" className="btn-secondary">
                  See your sales
                </Link>
                {!status.payouts_enabled && (
                  <ActionForm action={startPayoutSetup} className="space-y-2">
                    <SubmitButton pendingText="Opening Stripe..." className="btn-secondary">
                      Finish setup
                    </SubmitButton>
                    <FormStatus />
                  </ActionForm>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="font-semibold">Almost there</p>
              <p className="text-sm text-muted">
                Stripe still needs some details before members can buy from you. Pick up where you left off.
              </p>
              <ActionForm action={startPayoutSetup} className="space-y-2">
                <SubmitButton pendingText="Opening Stripe..." className="btn-primary">
                  Finish setup
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
