import type { Metadata } from "next";
import Link from "next/link";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { loadProgramSettings } from "@/lib/affiliate-server";
import {
  AFFILIATE_STATUS_LABELS,
  BASE_LABELS,
  earningsSummary,
  effectiveRates,
  referralLink,
  type CommissionRow,
} from "@/lib/affiliates";
import { formatMoney } from "@/lib/armory";
import { requireAdmin } from "@/lib/auth";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { AdminUser } from "@/lib/types";
import {
  decideApplication,
  payAffiliate,
  saveAffiliateRates,
  saveProgramSettings,
  setAffiliatePaused,
} from "./actions";

export const metadata: Metadata = { title: "Affiliates" };

type Affiliate = {
  user_id: string;
  code: string;
  status: string;
  application: string;
  sale_percent: string | null;
  signup_bonus_cents: number | null;
  stripe_account_id: string | null;
  payouts_enabled: boolean;
  created_at: string;
};

function count<T>(rows: T[], key: (row: T) => string) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(key(row), (totals.get(key(row)) ?? 0) + 1);
  return totals;
}

function dollars(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function RateFields({
  affiliate,
}: {
  affiliate?: Pick<Affiliate, "sale_percent" | "signup_bonus_cents">;
}) {
  return (
    <>
      <Field
        label="Sale %"
        name="sale_percent"
        inputMode="decimal"
        placeholder="Default"
        defaultValue={
          affiliate?.sale_percent === null || !affiliate
            ? ""
            : Number(affiliate.sale_percent).toString()
        }
        className="field-input w-24"
      />
      <Field
        label="Sign-up bonus $"
        name="signup_bonus"
        inputMode="decimal"
        placeholder="Default"
        defaultValue={dollars(affiliate?.signup_bonus_cents ?? null)}
        className="field-input w-28"
      />
    </>
  );
}

export default async function AdminAffiliatesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [
    settings,
    { data: affiliateData },
    { data: users },
    { data: clicks },
    { data: referrals },
    { data: commissionData },
  ] = await Promise.all([
    loadProgramSettings(),
    supabase
      .from("affiliates")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.rpc("admin_list_users"),
    supabase.from("affiliate_clicks").select("affiliate_id").limit(50000),
    supabase.from("referrals").select("affiliate_id").limit(50000),
    supabase
      .from("commissions")
      .select("affiliate_id, kind, amount_cents, status, available_at")
      .limit(50000),
  ]);

  const affiliates = (affiliateData ?? []) as Affiliate[];
  const people = new Map(
    ((users ?? []) as AdminUser[]).map((user) => [user.id, user]),
  );
  const clickCounts = count(
    (clicks ?? []) as { affiliate_id: string }[],
    (row) => row.affiliate_id,
  );
  const referralCounts = count(
    (referrals ?? []) as { affiliate_id: string }[],
    (row) => row.affiliate_id,
  );
  const commissions = (commissionData ?? []) as (CommissionRow & {
    affiliate_id: string;
    kind: string;
  })[];
  const byAffiliate = new Map<string, typeof commissions>();
  for (const row of commissions)
    byAffiliate.set(row.affiliate_id, [
      ...(byAffiliate.get(row.affiliate_id) ?? []),
      row,
    ]);
  const totals = earningsSummary(commissions);

  const pending = affiliates.filter(
    (affiliate) => affiliate.status === "pending",
  );
  const active = affiliates.filter(
    (affiliate) =>
      affiliate.status === "approved" || affiliate.status === "paused",
  );
  const site = getSiteUrl();

  return (
    <div className="space-y-10">
      <Link href="/admin" className="text-link text-sm">
        Back to admin
      </Link>
      <div>
        <h1 className="text-5xl">Affiliates</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Approve affiliates, set what they earn, and pay them through Stripe.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Affiliates", String(active.length)],
          ["Applications", String(pending.length)],
          ["Waiting (in hold)", formatMoney(totals.waitingCents)],
          ["Ready to pay", formatMoney(totals.availableCents)],
          ["Paid out", formatMoney(totals.paidCents)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3">
        <h2 className="text-2xl">Applications</h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            No applications waiting.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((affiliate) => {
              const person = people.get(affiliate.user_id);
              return (
                <li
                  key={affiliate.user_id}
                  className="space-y-3 rounded-lg border border-accent bg-surface p-4"
                >
                  <div>
                    <p className="font-semibold">
                      {person?.display_name ?? "Unknown"}{" "}
                      <span className="text-sm font-normal text-muted">
                        {person?.email} · {person?.role} · wants /r/
                        {affiliate.code}
                      </span>
                    </p>
                    <p className="mt-2 whitespace-pre-line text-sm">
                      {affiliate.application}
                    </p>
                  </div>
                  <ActionForm
                    action={decideApplication}
                    className="flex flex-wrap items-end gap-3"
                  >
                    <input
                      type="hidden"
                      name="user_id"
                      value={affiliate.user_id}
                    />
                    <RateFields />
                    <button
                      type="submit"
                      name="decision"
                      value="approve"
                      className="btn-primary px-4 py-2 text-sm"
                    >
                      Approve
                    </button>
                    <button
                      type="submit"
                      name="decision"
                      value="reject"
                      className="btn-secondary px-4 py-2 text-sm"
                    >
                      Decline
                    </button>
                    <div className="w-full">
                      <FormStatus />
                      <p className="text-xs text-muted">
                        Leave the rates blank to use the program defaults.
                      </p>
                    </div>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl">Affiliates</h2>
        {active.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            No affiliates yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((affiliate) => {
              const person = people.get(affiliate.user_id);
              const rows = byAffiliate.get(affiliate.user_id) ?? [];
              const earned = earningsSummary(rows);
              const rates = effectiveRates(settings, affiliate);
              const buyers = rows.filter(
                (row) => row.kind === "signup" && row.status !== "void",
              ).length;
              const canPay =
                affiliate.payouts_enabled &&
                earned.availableCents >= settings.min_payout_cents;
              return (
                <li
                  key={affiliate.user_id}
                  className="space-y-4 rounded-lg border border-border bg-surface p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {person?.display_name ?? "Unknown"}{" "}
                        <span
                          className={`ml-1 rounded px-1.5 py-0.5 text-xs ${
                            affiliate.status === "approved"
                              ? "bg-accent text-accent-foreground"
                              : "bg-surface-raised"
                          }`}
                        >
                          {AFFILIATE_STATUS_LABELS[affiliate.status]}
                        </span>
                      </p>
                      <p className="text-sm text-muted">
                        {referralLink(site, affiliate.code)} ·{" "}
                        {rates.salePercent}% of sales ·{" "}
                        {formatMoney(rates.signupBonusCents)} sign-up bonus{" "}
                        {rates.custom ? "(custom)" : "(default)"} ·{" "}
                        {affiliate.payouts_enabled
                          ? "Payouts set up"
                          : "Payouts not set up"}
                      </p>
                    </div>
                    <ActionForm
                      action={payAffiliate}
                      className="space-y-1 text-right"
                    >
                      <input
                        type="hidden"
                        name="user_id"
                        value={affiliate.user_id}
                      />
                      {canPay ? (
                        <SubmitButton
                          pendingText="Paying..."
                          className="btn-primary px-4 py-2 text-sm"
                        >
                          Pay {formatMoney(earned.availableCents)}
                        </SubmitButton>
                      ) : (
                        <p className="text-xs text-muted">
                          {affiliate.payouts_enabled
                            ? `${formatMoney(earned.availableCents)} ready · minimum ${formatMoney(settings.min_payout_cents)}`
                            : "Can't pay until they set up payouts"}
                        </p>
                      )}
                      <FormStatus />
                    </ActionForm>
                  </div>

                  <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
                    {[
                      [
                        "Clicks",
                        String(clickCounts.get(affiliate.user_id) ?? 0),
                      ],
                      [
                        "Sign-ups",
                        String(referralCounts.get(affiliate.user_id) ?? 0),
                      ],
                      ["Buyers", String(buyers)],
                      ["Waiting", formatMoney(earned.waitingCents)],
                      ["Ready", formatMoney(earned.availableCents)],
                      ["Paid", formatMoney(earned.paidCents)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-muted">{label}</dt>
                        <dd className="font-semibold">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
                    <ActionForm
                      action={saveAffiliateRates}
                      className="flex flex-wrap items-end gap-3"
                    >
                      <input
                        type="hidden"
                        name="user_id"
                        value={affiliate.user_id}
                      />
                      <RateFields affiliate={affiliate} />
                      <SubmitButton
                        pendingText="Saving..."
                        className="btn-secondary px-4 py-2 text-sm"
                      >
                        Save rates
                      </SubmitButton>
                      <FormStatus />
                    </ActionForm>
                    <ActionForm
                      action={setAffiliatePaused}
                      confirmMessage={
                        affiliate.status === "approved"
                          ? `Pause ${person?.display_name ?? "this affiliate"}? Their link stops earning until you resume it.`
                          : undefined
                      }
                    >
                      <input
                        type="hidden"
                        name="user_id"
                        value={affiliate.user_id}
                      />
                      <input
                        type="hidden"
                        name="pause"
                        value={
                          affiliate.status === "approved" ? "true" : "false"
                        }
                      />
                      <SubmitButton
                        pendingText="Saving..."
                        className="text-link text-sm"
                      >
                        {affiliate.status === "approved" ? "Pause" : "Resume"}
                      </SubmitButton>
                      <FormStatus />
                    </ActionForm>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl">Program settings</h2>
        <p className="max-w-2xl text-sm text-muted">
          The defaults for every affiliate without custom rates. Changes apply
          to new commissions only.
        </p>
        <ActionForm
          action={saveProgramSettings}
          className="grid max-w-3xl gap-4 sm:grid-cols-2"
        >
          <Field
            label="Sale commission %"
            name="sale_percent"
            inputMode="decimal"
            defaultValue={String(settings.sale_percent)}
            required
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Percentage of</span>
            <select
              name="sale_base"
              defaultValue={settings.sale_base}
              className="field-input"
            >
              {(Object.keys(BASE_LABELS) as (keyof typeof BASE_LABELS)[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {BASE_LABELS[key]}
                  </option>
                ),
              )}
            </select>
            <span className="block text-xs text-muted">
              GYMX2&apos;s share is its {`10%`} fee on a coach&apos;s item, or
              the whole price on GYMX2&apos;s own items. Shipping never counts.
            </span>
          </label>
          <Field
            label="Sign-up bonus $"
            name="signup_bonus"
            inputMode="decimal"
            defaultValue={dollars(settings.signup_bonus_cents)}
            hint="Paid once a referred person makes their first purchase. 0 to turn off."
            required
          />
          <Field
            label="Referral lasts (months)"
            name="attribution_months"
            type="number"
            min={1}
            max={120}
            defaultValue={String(settings.attribution_months)}
            hint="How long purchases by a referred person earn commission."
            required
          />
          <Field
            label="Hold before payable (days)"
            name="hold_days"
            type="number"
            min={0}
            max={365}
            defaultValue={String(settings.hold_days)}
            hint="Covers the 30-day return window, so refunds cancel commissions first."
            required
          />
          <Field
            label="Link remembers visitors (days)"
            name="cookie_days"
            type="number"
            min={1}
            max={365}
            defaultValue={String(settings.cookie_days)}
            required
          />
          <Field
            label="Minimum payout $"
            name="min_payout"
            inputMode="decimal"
            defaultValue={dollars(settings.min_payout_cents)}
            required
          />
          <div className="flex items-end">
            <SubmitButton pendingText="Saving..." className="btn-primary">
              Save program settings
            </SubmitButton>
          </div>
          <div className="sm:col-span-2">
            <FormStatus />
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
