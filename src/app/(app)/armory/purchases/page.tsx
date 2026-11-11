import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney, orderStatusLabel } from "@/lib/armory";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import { hasAccess, membershipStatusLabel } from "@/lib/memberships";
import {
  cancelMembership,
  openBillingPortal,
  resumeMembership,
} from "../../plans/actions";
import { createClient } from "@/lib/supabase/server";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";
import { LOCALE_TAG, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("My purchases") };
}

type Purchase = {
  id: string;
  item_id: string | null;
  item_title: string;
  amount_cents: number;
  created_at: string;
  size: string | null;
  fulfillment_status: string;
  tracking_number: string | null;
  refunded_at: string | null;
  kind: string;
  item: { kind: string } | null;
};

function formatDay(iso: string, locale: Locale) {
  return new Date(iso).toLocaleDateString(LOCALE_TAG[locale], {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function MyPurchasesPage() {
  const locale = await getLocale();
  const tr = await getTr();
  const { profile } = await requireAccount();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchases")
    .select(
      "id, item_id, item_title, amount_cents, created_at, size, fulfillment_status, tracking_number, refunded_at, kind, item:armory_items(kind)",
    )
    .eq("member_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(500);
  const purchases = (data ?? []) as unknown as Purchase[];
  const { data: membershipData } = await supabase
    .from("subscriptions")
    .select(
      "id, coach_id, plan_name, price_cents, status, current_period_end, trial_end, cancel_at_period_end, coach:profiles!coach_id(display_name)",
    )
    .eq("member_id", profile.id)
    .order("created_at", { ascending: false });
  const memberships = (membershipData ?? []) as unknown as {
    id: string;
    coach_id: string;
    plan_name: string;
    price_cents: number;
    status: string;
    current_period_end: string | null;
    trial_end: string | null;
    cancel_at_period_end: boolean;
    coach: { display_name: string } | null;
  }[];

  return (
    <div className="space-y-6">
      <Link href="/armory" className="text-link text-sm">
        <T>Back to the Armory</T>
      </Link>
      <div>
        <h1 className="text-5xl">
          <T>My purchases</T>
        </h1>
        <p className="mt-2 max-w-xl text-muted">
          <T>
            Everything you&apos;ve bought on GYMX2. Questions about an order?
            Message the seller, or see our
          </T>{" "}
          <Link href="/refunds" className="text-link">
            <T>refund policy</T>
          </Link>
          .
        </p>
      </div>

      {memberships.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl">
            <T>Memberships</T>
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {memberships.map((membership) => {
              const live = hasAccess(membership.status);
              return (
                <li
                  key={membership.id}
                  className="flex flex-wrap items-start justify-between gap-3 p-4"
                >
                  <div>
                    <p className="font-semibold">
                      {membership.plan_name} with{" "}
                      <Link
                        href={`/coaches/${membership.coach_id}`}
                        className="hover:text-accent"
                      >
                        {membership.coach?.display_name ?? "a coach"}
                      </Link>
                    </p>
                    <p
                      className={`text-sm ${membership.status === "past_due" ? "text-danger" : "text-muted"}`}
                    >
                      {formatMoney(membership.price_cents)}/month ·{" "}
                      <T>{membershipStatusLabel(membership)}</T>
                    </p>
                  </div>
                  {live && (
                    <div className="flex flex-wrap items-start gap-2">
                      <ActionForm action={openBillingPortal}>
                        <input
                          type="hidden"
                          name="subscription_id"
                          value={membership.id}
                        />
                        <SubmitButton
                          pendingText={tr("Opening...")}
                          className="btn-secondary px-3 py-2 text-sm"
                        >
                          <T>Update card</T>
                        </SubmitButton>
                        <FormStatus />
                      </ActionForm>
                      <ActionForm
                        action={
                          membership.cancel_at_period_end
                            ? resumeMembership
                            : cancelMembership
                        }
                        confirmMessage={
                          membership.cancel_at_period_end
                            ? undefined
                            : tr(
                                "Cancel {plan_name}? You keep access until the end of the period you've paid for, and won't be charged again.",
                                { plan_name: membership.plan_name },
                              )
                        }
                      >
                        <input
                          type="hidden"
                          name="subscription_id"
                          value={membership.id}
                        />
                        <SubmitButton
                          pendingText={tr("Saving...")}
                          className="btn-secondary px-3 py-2 text-sm"
                        >
                          {membership.cancel_at_period_end
                            ? tr("Keep my membership")
                            : tr("Cancel membership")}
                        </SubmitButton>
                        <FormStatus />
                      </ActionForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {error ? (
        <p role="alert" className="text-danger">
          <T>
            We couldn&apos;t load your purchases. Please refresh and try again.
          </T>
        </p>
      ) : purchases.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          <T>Nothing yet.</T>{" "}
          <Link href="/armory" className="text-link">
            <T>Browse the Armory</T>
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {purchases.map((purchase) => {
            const digital = purchase.fulfillment_status === "not_needed";
            const canDownload =
              digital &&
              !purchase.refunded_at &&
              purchase.item?.kind === "paid" &&
              purchase.item_id;
            return (
              <li
                key={purchase.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {purchase.item_id ? (
                      <Link
                        href={`/armory/${purchase.item_id}`}
                        className="hover:text-accent"
                      >
                        {purchase.item_title}
                      </Link>
                    ) : (
                      purchase.item_title
                    )}
                    {purchase.size && (
                      <span className="ml-2 text-sm font-normal text-muted">
                        Size {purchase.size}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted">
                    {formatDay(purchase.created_at, locale)} ·{" "}
                    {formatMoney(purchase.amount_cents)} ·{" "}
                    <span className={purchase.refunded_at ? "text-danger" : ""}>
                      {purchase.kind === "membership"
                        ? purchase.refunded_at
                          ? tr("Membership payment · Refunded")
                          : tr("Membership payment")
                        : digital && !purchase.refunded_at
                          ? tr("Digital")
                          : orderStatusLabel(purchase)}
                    </span>
                  </p>
                </div>
                {canDownload && (
                  <a
                    href={`/armory/${purchase.item_id}/download`}
                    className="btn-secondary px-3 py-2 text-sm"
                  >
                    <T>Download</T>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
