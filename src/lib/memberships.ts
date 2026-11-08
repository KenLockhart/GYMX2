// Coach membership rules, shared by the server and the pages.

export const MEMBERSHIP_FEE_PERCENT = 10;
export const TRIAL_DAYS = 7;

export type JoinMode = "free" | "paid" | "both";

export const JOIN_MODES: { value: JoinMode; label: string; detail: string }[] = [
  { value: "free", label: "Free to join", detail: "Anyone can join you. Paid plans are hidden." },
  { value: "both", label: "Free or paid", detail: "Anyone can join for free, and members can subscribe to a plan for more." },
  { value: "paid", label: "Subscribers only", detail: "Members join you by subscribing to a plan. Current members stay." },
];

export function isJoinMode(value: unknown): value is JoinMode {
  return value === "free" || value === "paid" || value === "both";
}

export function membershipFeeCents(amountCents: number) {
  return Math.round((amountCents * MEMBERSHIP_FEE_PERCENT) / 100);
}

// Stripe statuses where the member keeps access: paying, trying it out, or a card retry in progress.
export const ACCESS_STATUSES = ["trialing", "active", "past_due"] as const;
// Statuses where the subscription is over for good.
export const ENDED_STATUSES = ["canceled", "unpaid", "incomplete_expired"] as const;

export function hasAccess(status: string) {
  return (ACCESS_STATUSES as readonly string[]).includes(status);
}

export function hasEnded(status: string) {
  return (ENDED_STATUSES as readonly string[]).includes(status);
}

type SubscriptionView = {
  status: string;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
};

function day(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "soon";
}

export function membershipStatusLabel(subscription: SubscriptionView) {
  const ending = subscription.cancel_at_period_end;
  switch (subscription.status) {
    case "trialing":
      return ending ? `Free trial, ends ${day(subscription.trial_end)}` : `Free trial until ${day(subscription.trial_end)}`;
    case "active":
      return ending ? `Ends ${day(subscription.current_period_end)}` : `Renews ${day(subscription.current_period_end)}`;
    case "past_due":
      return "Payment failed. Update your card to keep access.";
    case "incomplete":
      return "Waiting for payment";
    case "unpaid":
      return "Paused: payment failed";
    default:
      return "Ended";
  }
}

// Monthly recurring revenue: paying subscriptions only (not free trials).
export function monthlyRecurringCents(subscriptions: { status: string; price_cents: number }[]) {
  return subscriptions
    .filter((subscription) => subscription.status === "active" || subscription.status === "past_due")
    .reduce((sum, subscription) => sum + subscription.price_cents, 0);
}
