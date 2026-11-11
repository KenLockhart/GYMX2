import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { CopyField } from "@/components/copy-field";
import { refreshAffiliatePayouts } from "@/lib/affiliate-payouts";
import { loadProgramSettings } from "@/lib/affiliate-server";
import {
  AFFILIATE_STATUS_LABELS,
  earningsSummary,
  effectiveRates,
  referralLink,
  type CommissionRow,
} from "@/lib/affiliates";
import { formatMoney } from "@/lib/armory";
import { requireAccount } from "@/lib/auth";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import {
  applyToAffiliateProgram,
  openAffiliateStripe,
  startAffiliatePayoutSetup,
} from "./actions";
import { T } from "@/i18n/t";
import { getTr, getLocale } from "@/i18n/server";
import { LOCALE_TAG, type Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Affiliate program") };
}

type Commission = CommissionRow & {
  id: string;
  kind: string;
  description: string;
  rate: string;
  created_at: string;
};

function formatDay(iso: string, locale: Locale) {
  return new Date(iso).toLocaleDateString(LOCALE_TAG[locale], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function AffiliatePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const locale = await getLocale();
  const tr = await getTr();
  const { profile } = await requireAccount();
  if (profile.role === "admin") redirect("/admin/affiliates");
  const query = await searchParams;

  const supabase = await createClient();
  const settings = await loadProgramSettings();
  const { data: affiliate } = await supabase
    .from("affiliates")
    .select(
      "code, status, application, sale_percent, signup_bonus_cents, stripe_account_id, payouts_enabled",
    )
    .eq("user_id", profile.id)
    .maybeSingle();

  // Back from Stripe: check straight away whether payouts are ready.
  let payoutsEnabled = Boolean(affiliate?.payouts_enabled);
  if (affiliate?.stripe_account_id && query.setup === "done") {
    payoutsEnabled = await refreshAffiliatePayouts(
      profile.id,
      affiliate.stripe_account_id,
    ).catch(() => payoutsEnabled);
  }

  const rates = effectiveRates(
    settings,
    affiliate ?? { sale_percent: null, signup_bonus_cents: null },
  );
  const terms = [
    tr(
      settings.sale_base === "platform_share"
        ? "{percent}% of GYMX2's share of the sale on every Armory purchase by people you refer, for {months} months after they join"
        : "{percent}% of the full item price on every Armory purchase by people you refer, for {months} months after they join",
      { percent: rates.salePercent, months: settings.attribution_months },
    ),
    tr(
      "{bonus} for each person you refer, paid once they make their first purchase",
      { bonus: formatMoney(rates.signupBonusCents) },
    ),
    tr(
      "Commissions can be paid {days} days after the sale (after the return window), once you have at least {min}",
      { days: settings.hold_days, min: formatMoney(settings.min_payout_cents) },
    ),
    tr("Your link remembers visitors for {days} days", {
      days: settings.cookie_days,
    }),
  ];

  if (!affiliate || affiliate.status === "rejected") {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-5xl">
            <T>Affiliate program</T>
          </h1>
          <p className="mt-2 text-muted">
            <T>Earn by bringing people to GYMX2.</T>
          </p>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {terms.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>
        {affiliate?.status === "rejected" && (
          <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            <T>
              Your last application wasn&apos;t approved. You&apos;re welcome to
              apply again.
            </T>
          </p>
        )}
        <ActionForm action={applyToAffiliateProgram} className="space-y-4">
          <Field
            label={tr("Your link name")}
            name="code"
            defaultValue={affiliate?.code ?? ""}
            placeholder={tr("coach-ken")}
            hint={tr(
              "Your link will be {url}/r/your-link-name. Lowercase letters, numbers and dashes.",
              { url: getSiteUrl() },
            )}
            maxLength={24}
            required
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">
              <T>How will you share GYMX2?</T>
            </span>
            <textarea
              name="application"
              rows={4}
              maxLength={1000}
              required
              className="field-input"
            />
          </label>
          <FormStatus />
          <SubmitButton pendingText={tr("Sending...")} className="btn-primary">
            <T>Apply</T>
          </SubmitButton>
        </ActionForm>
      </div>
    );
  }

  if (affiliate.status !== "approved") {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-5xl">
          <T>Affiliate program</T>
        </h1>
        <p className="rounded-lg border border-border bg-surface p-4">
          <span className="font-semibold">
            <T>{AFFILIATE_STATUS_LABELS[affiliate.status]}</T>.
          </span>{" "}
          {affiliate.status === "pending"
            ? tr("We'll email you when an admin has reviewed your application.")
            : tr(
                "Your link is paused, so it isn't earning right now. Questions? Email support@gymx2.com.",
              )}
        </p>
      </div>
    );
  }

  const [
    { count: clicks },
    { count: signups },
    { data: commissionData },
    { data: payoutData },
  ] = await Promise.all([
    supabase
      .from("affiliate_clicks")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("referrals")
      .select("referred_user_id", { count: "exact", head: true }),
    supabase
      .from("commissions")
      .select(
        "id, kind, description, rate, amount_cents, status, available_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("affiliate_payouts")
      .select("id, amount_cents, created_at")
      .order("created_at", { ascending: false }),
  ]);
  const commissions = (commissionData ?? []) as Commission[];
  const earnings = earningsSummary(commissions);
  // Each referred person earns one sign-up bonus, on their first purchase.
  const buyers = commissions.filter(
    (row) => row.kind === "signup" && row.status !== "void",
  ).length;
  const site = getSiteUrl();

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          <T>Affiliate</T>
        </p>
        <h1 className="mt-1 text-5xl">
          <T>Your affiliate dashboard</T>
        </h1>
      </div>

      <section className="max-w-2xl space-y-3">
        <h2 className="text-2xl">
          <T>Your links</T>
        </h2>
        <CopyField
          label={tr("Sign-up link")}
          value={referralLink(site, affiliate.code)}
        />
        <CopyField
          label={tr("Homepage")}
          value={referralLink(site, affiliate.code, "/")}
        />
        <CopyField
          label={tr("The Armory")}
          value={referralLink(site, affiliate.code, "/armory")}
        />
        <p className="text-xs text-muted">
          Link to any GYMX2 page by adding{" "}
          <code>
            <T>?to=/the-page</T>
          </code>{" "}
          to your link. Visitors are remembered for {settings.cookie_days} days.
        </p>
      </section>

      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Clicks", String(clicks ?? 0)],
          ["Sign-ups", String(signups ?? 0)],
          ["Became buyers", String(buyers)],
          ["Waiting", formatMoney(earnings.waitingCents)],
          ["Ready to pay", formatMoney(earnings.availableCents)],
          ["Paid to you", formatMoney(earnings.paidCents)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <dt className="text-sm text-muted">
              <T>{label}</T>
            </dt>
            <dd className="mt-1 text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="max-w-2xl space-y-3">
        <h2 className="text-2xl">
          <T>Getting paid</T>
        </h2>
        {payoutsEnabled ? (
          <>
            <p className="text-sm">
              <T>
                Payouts are set up. We pay commissions that are ready once they
                reach
              </T>{" "}
              {formatMoney(settings.min_payout_cents)}.
            </p>
            <ActionForm action={openAffiliateStripe}>
              <SubmitButton
                pendingText={tr("Opening Stripe...")}
                className="btn-secondary"
              >
                <T>See payouts in Stripe</T>
              </SubmitButton>
              <FormStatus />
            </ActionForm>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              <T>
                Connect where your money goes. Stripe asks for a few details and
                your bank account; it takes about 5 minutes.
              </T>
            </p>
            <ActionForm action={startAffiliatePayoutSetup}>
              <SubmitButton
                pendingText={tr("Opening Stripe...")}
                className="btn-primary"
              >
                {affiliate.stripe_account_id
                  ? tr("Finish payout setup")
                  : tr("Set up payouts")}
              </SubmitButton>
              <FormStatus />
            </ActionForm>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl">
          <T>Your terms</T>
        </h2>
        <ul className="max-w-2xl list-disc space-y-1 pl-5 text-sm text-muted">
          {terms.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl">
          <T>Commissions</T>
        </h2>
        {commissions.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            <T>None yet. Share your link to get started.</T>
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="p-3 font-medium">
                    <T>Date</T>
                  </th>
                  <th className="p-3 font-medium">
                    <T>What</T>
                  </th>
                  <th className="p-3 font-medium">
                    <T>Rate</T>
                  </th>
                  <th className="p-3 font-medium">
                    <T>Status</T>
                  </th>
                  <th className="p-3 text-right font-medium">
                    <T>Amount</T>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {commissions.map((row) => {
                  const ready = new Date(row.available_at) <= new Date();
                  return (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap p-3">
                        {formatDay(row.created_at, locale)}
                      </td>
                      <td className="p-3">
                        <T>{row.description}</T>
                      </td>
                      <td className="p-3 text-muted">{row.rate}</td>
                      <td className="whitespace-nowrap p-3">
                        {row.status === "paid"
                          ? tr("Paid")
                          : row.status === "void"
                            ? tr("Cancelled (refunded)")
                            : ready
                              ? tr("Ready to pay")
                              : tr("Payable {p0}", {
                                  p0: formatDay(row.available_at, locale),
                                })}
                      </td>
                      <td
                        className={`p-3 text-right ${row.status === "void" ? "text-muted line-through" : ""}`}
                      >
                        {formatMoney(row.amount_cents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(payoutData ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">
            <T>Payouts</T>
          </h2>
          <ul className="max-w-md divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {(payoutData ?? []).map((payout) => (
              <li
                key={payout.id as string}
                className="flex justify-between p-3"
              >
                <span>{formatDay(payout.created_at as string, locale)}</span>
                <span className="font-semibold">
                  {formatMoney(payout.amount_cents as number)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
