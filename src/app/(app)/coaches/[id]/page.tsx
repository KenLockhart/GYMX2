import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { idSchema } from "@/lib/validation";
import { joinCoach, leaveCoach } from "../actions";
import { BadgeRow } from "@/components/game-parts";
import { loadBadges } from "@/lib/achievements-data";
import { SubscribePanel } from "@/components/subscribe-panel";
import { formatMoney } from "@/lib/armory";
import { confirmMembershipCheckout } from "@/lib/membership-server";
import { hasAccess, membershipStatusLabel } from "@/lib/memberships";
import { isStripeTestMode, stripePublishableKey } from "@/lib/stripe";

export const metadata: Metadata = { title: "Coach" };

type CoachProfile = Pick<
  Profile,
  | "id"
  | "display_name"
  | "bio"
  | "instagram_url"
  | "tiktok_url"
  | "youtube_url"
  | "x_url"
  | "website_url"
>;

const SOCIAL_LINKS: { key: keyof CoachProfile; label: string }[] = [
  { key: "instagram_url", label: "Instagram" },
  { key: "tiktok_url", label: "TikTok" },
  { key: "youtube_url", label: "YouTube" },
  { key: "x_url", label: "X" },
  { key: "website_url", label: "Website" },
];

export default async function CoachPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { profile } = await requireAccount();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const query = await searchParams;

  // Back from subscribing: update straight away so access is there when the page loads.
  const returned =
    query.membership === "done" && typeof query.session_id === "string";
  if (returned)
    await confirmMembershipCheckout(query.session_id as string, profile.id);

  const supabase = await createClient();
  const [coachResult, joinedResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, display_name, bio, join_mode, instagram_url, tiktok_url, youtube_url, x_url, website_url",
      )
      .eq("id", id)
      .eq("role", "coach")
      .maybeSingle<CoachProfile & { join_mode: string }>(),
    supabase
      .from("coach_members")
      .select("coach_id")
      .eq("coach_id", id)
      .eq("member_id", profile.id)
      .maybeSingle(),
  ]);
  const coach = coachResult.data;
  const badges = coach
    ? ((await loadBadges([coach.id])).get(coach.id) ?? [])
    : [];
  if (!coach) notFound();

  const isMember = profile.role === "member";
  const isJoined = Boolean(joinedResult.data);
  const showPlans = coach.join_mode !== "free";
  const [{ data: planData }, { data: mine }] = await Promise.all([
    showPlans
      ? supabase
          .from("coach_plans")
          .select("id, name, description, price_cents, trial_days")
          .eq("coach_id", coach.id)
          .eq("active", true)
          .not("stripe_price_id", "is", null)
          .order("price_cents")
      : Promise.resolve({ data: [] }),
    supabase
      .from("subscriptions")
      .select(
        "status, plan_name, current_period_end, trial_end, cancel_at_period_end",
      )
      .eq("coach_id", coach.id)
      .eq("member_id", profile.id),
  ]);
  const plans = (planData ?? []) as {
    id: string;
    name: string;
    description: string;
    price_cents: number;
    trial_days: number;
  }[];
  const membership = (mine ?? []).find((row) =>
    hasAccess(row.status as string),
  ) as
    | {
        status: string;
        plan_name: string;
        current_period_end: string | null;
        trial_end: string | null;
        cancel_at_period_end: boolean;
      }
    | undefined;
  const canJoinFree = coach.join_mode !== "paid";
  const links = SOCIAL_LINKS.flatMap(({ key, label }) => {
    const url = coach[key];
    return typeof url === "string" && url ? [{ label, url }] : [];
  });

  return (
    <div className="space-y-6">
      {isMember && (
        <Link href="/coaches" className="text-link text-sm">
          Back to coaches
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">
            Coach
          </p>
          <h1 className="mt-1 text-5xl">{coach.display_name}</h1>
          <div className="mt-3">
            <BadgeRow badges={badges} max={12} />
          </div>
          {coach.bio && (
            <p className="mt-3 max-w-2xl whitespace-pre-line text-muted">
              {coach.bio}
            </p>
          )}
        </div>
        {isMember && (
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            {isJoined && (
              <Link href={`/messages/${coach.id}`} className="btn-primary">
                Message
              </Link>
            )}
            {(isJoined || canJoinFree) && (
              <ActionForm
                action={isJoined ? leaveCoach : joinCoach}
                confirmMessage={
                  isJoined
                    ? `Leave ${coach.display_name}? Your unfinished Tasks and upcoming sessions with them will be removed.`
                    : undefined
                }
                className="space-y-2"
              >
                <input type="hidden" name="coach_id" value={coach.id} />
                <SubmitButton
                  pendingText={isJoined ? "Leaving..." : "Joining..."}
                  className={isJoined ? "btn-secondary" : "btn-primary"}
                >
                  {isJoined
                    ? "Leave"
                    : canJoinFree && showPlans
                      ? "Join free"
                      : "Join"}
                </SubmitButton>
                <FormStatus />
              </ActionForm>
            )}
          </div>
        )}
      </div>

      {returned && membership && (
        <p
          role="status"
          className="rounded-lg border border-accent bg-surface p-4"
        >
          You&apos;re in! Welcome to {membership.plan_name}. Manage your
          membership any time in{" "}
          <Link href="/armory/purchases" className="text-link">
            My purchases
          </Link>
          .
        </p>
      )}

      {showPlans && (plans.length > 0 || membership) && (
        <section className="space-y-3">
          <h2 className="text-2xl">Memberships</h2>
          {membership ? (
            <p className="max-w-2xl rounded-lg border border-accent bg-surface p-4 text-sm">
              You&apos;re on{" "}
              <span className="font-semibold">{membership.plan_name}</span> ·{" "}
              {membershipStatusLabel(membership)} ·{" "}
              <Link href="/armory/purchases" className="text-link">
                Manage
              </Link>
            </p>
          ) : (
            <>
              {coach.join_mode === "paid" && (
                <p className="text-sm text-muted">
                  {coach.display_name} coaches subscribers only. Pick a plan to
                  join.
                </p>
              )}
              <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan) => (
                  <li
                    key={plan.id}
                    className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5"
                  >
                    <div>
                      <p className="text-lg font-semibold">{plan.name}</p>
                      <p className="mt-1 text-3xl font-bold">
                        {formatMoney(plan.price_cents)}
                        <span className="text-base font-normal text-muted">
                          /month
                        </span>
                      </p>
                      {plan.trial_days > 0 && (
                        <p className="text-sm font-semibold text-accent">
                          {plan.trial_days}-day free trial
                        </p>
                      )}
                    </div>
                    {plan.description && (
                      <p className="flex-1 whitespace-pre-line text-sm text-muted">
                        {plan.description}
                      </p>
                    )}
                    {isMember ? (
                      <SubscribePanel
                        planId={plan.id}
                        buttonLabel={
                          plan.trial_days > 0 ? "Start free trial" : "Subscribe"
                        }
                        publishableKey={stripePublishableKey()}
                      />
                    ) : (
                      <p className="text-xs text-muted">
                        Members can subscribe here.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                Billed monthly by Stripe. Cancel any time from My purchases; you
                keep access until the end of the month you&apos;ve paid for.
                {isStripeTestMode() &&
                  " Test mode: use card 4242 4242 4242 4242."}
              </p>
            </>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-2xl">Find {coach.display_name} online</h2>
        {links.length === 0 ? (
          <p className="text-muted">
            {profile.id === coach.id ? (
              <>
                You haven&apos;t added any links yet.{" "}
                <Link href="/profile" className="text-link">
                  Add them on your profile
                </Link>
                .
              </>
            ) : (
              "No links added yet."
            )}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {links.map((link) => (
              <li key={link.label}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
