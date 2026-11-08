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

export const metadata: Metadata = { title: "Memberships" };

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

function PlanForm({ plan }: { plan?: Plan }) {
  return (
    <ActionForm action={savePlan} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={plan?.id ?? ""} />
      <Field
        label="Plan name"
        name="name"
        maxLength={60}
        placeholder="Monthly Coaching"
        defaultValue={plan?.name}
        required
      />
      <Field
        label="Price per month (USD)"
        name="price"
        inputMode="decimal"
        placeholder="29"
        defaultValue={plan ? (plan.price_cents / 100).toFixed(2) : ""}
        hint={plan ? "Changing it only affects new subscribers." : undefined}
        required
      />
      <label className="block space-y-1.5 sm:col-span-2">
        <span className="text-sm font-medium">What&apos;s included</span>
        <textarea
          name="description"
          rows={3}
          maxLength={1000}
          defaultValue={plan?.description}
          placeholder="Weekly Tasks, two live sessions a month, direct messaging and a monthly check-in call."
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
            days.
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
          Open to new subscribers
          <span className="block text-muted">
            Turn off to stop new sign-ups. Current subscribers keep their plan.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <SubmitButton pendingText="Saving..." className="btn-primary">
          {plan ? "Save plan" : "Add plan"}
        </SubmitButton>
        <FormStatus />
      </div>
    </ActionForm>
  );
}

export default async function PlansPage() {
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
        <h1 className="text-5xl">Memberships</h1>
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
          Before members can subscribe, connect where your money goes.{" "}
          <Link href="/armory/payouts" className="text-link">
            Set up payouts
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
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="max-w-2xl space-y-3">
        <h2 className="text-2xl">How members join you</h2>
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
                <span className="block font-semibold">{mode.label}</span>
                <span className="block text-sm text-muted">{mode.detail}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <SubmitButton pendingText="Saving..." className="btn-secondary">
              Save
            </SubmitButton>
            <FormStatus />
          </div>
        </ActionForm>
        {profile.join_mode === "free" && plans.length > 0 && (
          <p className="text-sm text-muted">
            Your plans are hidden while joining is free only. Choose another
            option to show them.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">Your plans</h2>
        {plans.map((plan) => (
          <div
            key={plan.id}
            className="max-w-3xl space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <p className="font-semibold">
              {plan.name} · {formatMoney(plan.price_cents)}/month
              {!plan.active && (
                <span className="ml-2 text-sm font-normal text-muted">
                  (closed to new subscribers)
                </span>
              )}
            </p>
            <PlanForm plan={plan} />
          </div>
        ))}
        <div className="max-w-3xl space-y-3 rounded-lg border border-dashed border-border p-4">
          <p className="font-semibold">Add a plan</p>
          <PlanForm />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl">Subscribers</h2>
        {subscribers.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            No subscribers yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="p-3 font-medium">Member</th>
                  <th className="p-3 font-medium">Plan</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 text-right font-medium">Per month</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {subscribers.map((row) => (
                  <tr key={row.id}>
                    <td className="p-3 font-medium">
                      {row.member?.display_name ?? "Former member"}
                    </td>
                    <td className="p-3">{row.plan_name}</td>
                    <td className="p-3 text-muted">
                      {membershipStatusLabel(row)}
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
