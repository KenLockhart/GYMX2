import type { Metadata } from "next";
import Link from "next/link";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { formatMoney } from "@/lib/armory";
import { requireCoach } from "@/lib/auth";
import type { Plan } from "@/lib/membership-server";
import {
  JOIN_MODES,
  MEMBERSHIP_FEE_PERCENT,
  TRIAL_DAYS,
  membershipStatusLabel,
  monthlyRecurringCents,
} from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";
import { saveJoinMode, savePlan } from "./actions";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Memberships") };
}

type Subscriber = {
  id: string;
  plan_name: string;
  price_cents: number;
  status: string;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  member: { display_name: string } | null;
};

async function PlanForm({ plan }: { plan?: Plan }) {
  const tr = await getTr();
  return (
    <ActionForm action={savePlan} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={plan?.id ?? ""} />
      <Field
        label={tr("Plan name")}
        name="name"
        maxLength={60}
        placeholder={tr("Monthly Coaching")}
        defaultValue={plan?.name}
        required
      />
      <Field
        label={tr("Price per month (USD)")}
        name="price"
        inputMode="decimal"
        placeholder="29"
        defaultValue={plan ? (plan.price_cents / 100).toFixed(2) : ""}
        hint={
          plan ? tr("Changing it only affects new subscribers.") : undefined
        }
        required
      />
      <label className="block space-y-1.5 sm:col-span-2">
        <span className="text-sm font-medium">
          <T>What&apos;s included</T>
        </span>
        <textarea
          name="description"
          rows={3}
          maxLength={1000}
          defaultValue={plan?.description}
          placeholder={tr(
            "Weekly Tasks, two live sessions a month, direct messaging and a monthly check-in call.",
          )}
          className="field-input"
        />
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="trial"
          defaultChecked={plan ? plan.trial_days > 0 : false}
          className="mt-0.5 size-4 accent-accent"
        />
        <span>
          {TRIAL_DAYS}-day free trial
          <span className="block text-muted">
            Members add a card, and the first charge comes after {TRIAL_DAYS}{" "}
            <T>days.</T>
          </span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={plan ? plan.active : true}
          className="mt-0.5 size-4 accent-accent"
        />
        <span>
          <T>Open to new subscribers</T>
          <span className="block text-muted">
            <T>
              Turn off to stop new sign-ups. Current subscribers keep their
              plan.
            </T>
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <SubmitButton pendingText={tr("Saving...")} className="btn-primary">
          {plan ? tr("Save plan") : tr("Add plan")}
        </SubmitButton>
        <FormStatus />
      </div>
    </ActionForm>
  );
}

export default async function PlansPage() {
  const tr = await getTr();
  const { profile } = await requireCoach();
  const supabase = await createClient();
  const [{ data: planData }, { data: subscriberData }, { data: payout }] =
    await Promise.all([
      supabase
        .from("coach_plans")
        .select("*")
        .eq("coach_id", profile.id)
        .order("price_cents"),
      supabase
        .from("subscriptions")
        .select(
          "id, plan_name, price_cents, status, current_period_end, trial_end, cancel_at_period_end, created_at, member:profiles!member_id(display_name)",
        )
        .eq("coach_id", profile.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("payout_accounts")
        .select("charges_enabled")
        .eq("coach_id", profile.id)
        .maybeSingle(),
    ]);
  const plans = (planData ?? []) as Plan[];
  const subscribers = (subscriberData ?? []) as unknown as Subscriber[];
  const live = subscribers.filter((row) =>
    ["active", "trialing", "past_due"].includes(row.status),
  );
  const mrr = monthlyRecurringCents(subscribers);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-5xl">
          <T>Memberships</T>
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          Offer monthly plans. Members are charged automatically each month; you
          get the payment minus GYMX2&apos;s {MEMBERSHIP_FEE_PERCENT}% fee and
          Stripe&apos;s card fee, paid out through Stripe.
        </p>
      </div>

      {!payout?.charges_enabled && (
        <p
          role="status"
          className="max-w-2xl rounded-lg border border-accent bg-surface p-4 text-sm"
        >
          <T>Before members can subscribe, connect where your money goes.</T>{" "}
          <Link href="/armory/payouts" className="text-link">
            <T>Set up payouts</T>
          </Link>
          . You can create plans now.
        </p>
      )}

      <dl className="grid max-w-2xl grid-cols-3 gap-3">
        {[
          ["Members on plans", String(live.length)],
          [
            "On free trial",
            String(live.filter((row) => row.status === "trialing").length),
          ],
          ["Monthly revenue", formatMoney(mrr)],
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
          <T>How members join you</T>
        </h2>
        <ActionForm action={saveJoinMode} className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {JOIN_MODES.map((mode) => (
              <label
                key={mode.value}
                className="cursor-pointer rounded-lg border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-surface-raised"
              >
                <input
                  type="radio"
                  name="join_mode"
                  value={mode.value}
                  defaultChecked={profile.join_mode === mode.value}
                  className="sr-only"
                />
                <span className="block font-semibold">
                  <T>{mode.label}</T>
                </span>
                <span className="block text-sm text-muted">{mode.detail}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <SubmitButton
              pendingText={tr("Saving...")}
              className="btn-secondary"
            >
              <T>Save</T>
            </SubmitButton>
            <FormStatus />
          </div>
        </ActionForm>
        {profile.join_mode === "free" && plans.length > 0 && (
          <p className="text-sm text-muted">
            <T>
              Your plans are hidden while joining is free only. Choose another
              option to show them.
            </T>
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">
          <T>Your plans</T>
        </h2>
        {plans.map((plan) => (
          <div
            key={plan.id}
            className="max-w-3xl space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <p className="font-semibold">
              {plan.name} · {formatMoney(plan.price_cents)}/month
              {!plan.active && (
                <span className="ml-2 text-sm font-normal text-muted">
                  <T>(closed to new subscribers)</T>
                </span>
              )}
            </p>
            <PlanForm plan={plan} />
          </div>
        ))}
        <div className="max-w-3xl space-y-3 rounded-lg border border-dashed border-border p-4">
          <p className="font-semibold">
            <T>Add a plan</T>
          </p>
          <PlanForm />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl">
          <T>Subscribers</T>
        </h2>
        {subscribers.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            <T>No subscribers yet.</T>
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="p-3 font-medium">
                    <T>Member</T>
                  </th>
                  <th className="p-3 font-medium">
                    <T>Plan</T>
                  </th>
                  <th className="p-3 font-medium">
                    <T>Status</T>
                  </th>
                  <th className="p-3 text-right font-medium">
                    <T>Per month</T>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {subscribers.map((row) => (
                  <tr key={row.id}>
                    <td className="p-3 font-medium">
                      {row.member?.display_name ?? tr("Former member")}
                    </td>
                    <td className="p-3">{row.plan_name}</td>
                    <td className="p-3 text-muted">
                      <T>{membershipStatusLabel(row)}</T>
                    </td>
                    <td className="p-3 text-right">
                      {formatMoney(row.price_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
