import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BadgeRow } from "@/components/game-parts";
import { loadBadges } from "@/lib/achievements-data";
import { formatMoney } from "@/lib/armory";
import { getCurrentAccount } from "@/lib/auth";
import { goalLabel } from "@/lib/onboarding";
import { weeksLabel } from "@/lib/programs";
import { ratingSummary, reviewerName, stars } from "@/lib/public-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";

const SOCIALS = [
  { key: "instagram_url", label: "Instagram" },
  { key: "tiktok_url", label: "TikTok" },
  { key: "youtube_url", label: "YouTube" },
  { key: "x_url", label: "X" },
  { key: "website_url", label: "Website" },
] as const;

type Coach = {
  id: string;
  display_name: string;
  bio: string;
  specialties: string[];
  join_mode: string;
  public_slug: string;
  instagram_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  x_url: string | null;
  website_url: string | null;
};

// Only public fields, only for coaches who turned their page on. Read with the server key
// because visitors aren't signed in.
const loadCoach = cache(async (slug: string) => {
  const { data } = await createAdminClient()
    .from("profiles")
    .select(
      "id, display_name, bio, specialties, join_mode, public_slug, instagram_url, tiktok_url, youtube_url, x_url, website_url",
    )
    .eq("public_slug", slug.toLowerCase())
    .eq("public_page", true)
    .eq("role", "coach")
    .maybeSingle<Coach>();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const coach = await loadCoach((await params).slug);
  if (!coach) return { title: "Coach not found" };
  const description =
    coach.bio.slice(0, 155) ||
    `Train with ${coach.display_name} on GYMX2: programs, live sessions and coaching for mind, body and spirit.`;
  const url = `${getSiteUrl()}/c/${coach.public_slug}`;
  return {
    title: `${coach.display_name} · Coach`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `Train with ${coach.display_name} on GYMX2`,
      description,
      url,
      type: "profile",
    },
    twitter: {
      card: "summary",
      title: `Train with ${coach.display_name} on GYMX2`,
      description,
    },
  };
}

export default async function PublicCoachPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const coach = await loadCoach((await params).slug);
  if (!coach) notFound();

  const db = createAdminClient();
  const [
    { data: programData },
    { data: planData },
    { data: reviewData },
    { count: memberCount },
    badges,
    account,
  ] = await Promise.all([
    db
      .from("programs")
      .select("id, title, description, program_days(count)")
      .eq("coach_id", coach.id)
      .eq("published", true)
      .order("created_at", { ascending: false }),
    coach.join_mode === "free"
      ? Promise.resolve({ data: [] })
      : db
          .from("coach_plans")
          .select("id, name, description, price_cents, trial_days")
          .eq("coach_id", coach.id)
          .eq("active", true)
          .not("stripe_price_id", "is", null)
          .order("price_cents"),
    db
      .from("coach_reviews")
      .select(
        "id, rating, body, created_at, member:profiles!member_id(display_name)",
      )
      .eq("coach_id", coach.id)
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("coach_members")
      .select("member_id", { count: "exact", head: true })
      .eq("coach_id", coach.id),
    loadBadges([coach.id]),
    getCurrentAccount(),
  ]);

  const programs = (programData ?? []) as unknown as {
    id: string;
    title: string;
    description: string;
    program_days: { count: number }[];
  }[];
  const plans = (planData ?? []) as {
    id: string;
    name: string;
    description: string;
    price_cents: number;
    trial_days: number;
  }[];
  const reviews = (reviewData ?? []) as unknown as {
    id: string;
    rating: number;
    body: string;
    created_at: string;
    member: { display_name: string } | null;
  }[];
  const rating = ratingSummary(reviews.map((review) => review.rating));
  const links = SOCIALS.flatMap(({ key, label }) =>
    coach[key] ? [{ label, url: coach[key] as string }] : [],
  );

  // Signed-in people go straight to the coach inside GYMX2; visitors sign up first, then land there.
  const inApp = `/coaches/${coach.id}`;
  const join = account ? inApp : `/signup?next=${encodeURIComponent(inApp)}`;
  const joinLabel = account
    ? `Open ${coach.display_name} in GYMX2`
    : `Train with ${coach.display_name}`;

  return (
    <article className="space-y-12">
      <header className="space-y-4">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          Coach on GYMX2
        </p>
        <h1 className="text-5xl sm:text-6xl">{coach.display_name}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {rating && (
            <span>
              <span className="text-accent" aria-hidden="true">
                {stars(rating.average)}
              </span>{" "}
              {rating.average} from {rating.count}{" "}
              {rating.count === 1 ? "review" : "reviews"}
            </span>
          )}
          {(memberCount ?? 0) > 0 && <span>{memberCount} members</span>}
          <BadgeRow badges={badges.get(coach.id) ?? []} max={6} />
        </div>
        {coach.bio && (
          <p className="max-w-2xl whitespace-pre-line text-lg">{coach.bio}</p>
        )}
        {coach.specialties.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-sm">
            {coach.specialties.map((goal) => (
              <li key={goal} className="rounded bg-surface-raised px-2 py-1">
                {goalLabel(goal)}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href={join} className="btn-primary">
            {joinLabel}
          </Link>
          {links.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="btn-secondary"
            >
              {link.label}
            </a>
          ))}
        </div>
      </header>

      {programs.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-3xl">Programs</h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {programs.map((program) => (
              <li
                key={program.id}
                className="space-y-2 rounded-lg border border-border bg-surface p-5"
              >
                <p className="text-xl font-semibold">{program.title}</p>
                <p className="text-sm text-muted">
                  {weeksLabel(program.program_days[0]?.count ?? 0)}
                </p>
                {program.description && (
                  <p className="line-clamp-4 whitespace-pre-line text-sm">
                    {program.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plans.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-3xl">Memberships</h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <li
                key={plan.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5"
              >
                <p className="text-xl font-semibold">{plan.name}</p>
                <p className="text-2xl font-bold">
                  {formatMoney(plan.price_cents)}
                  <span className="text-sm font-normal text-muted">/month</span>
                </p>
                {plan.trial_days > 0 && (
                  <p className="text-sm text-accent">
                    {plan.trial_days}-day free trial
                  </p>
                )}
                {plan.description && (
                  <p className="whitespace-pre-line text-sm text-muted">
                    {plan.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {coach.join_mode === "both" && (
            <p className="text-sm text-muted">You can also join for free.</p>
          )}
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-3xl">What members say</h2>
        {reviews.length === 0 ? (
          <p className="text-muted">
            No reviews yet. Members can review {coach.display_name} after
            joining.
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {reviews.map((review) => (
              <li
                key={review.id}
                className="space-y-2 rounded-lg border border-border bg-surface p-5"
              >
                <p
                  className="text-accent"
                  aria-label={`${review.rating} out of 5 stars`}
                >
                  {stars(review.rating)}
                </p>
                {review.body && (
                  <p className="whitespace-pre-line">{review.body}</p>
                )}
                <p className="text-sm text-muted">
                  {reviewerName(review.member?.display_name ?? "")} ·{" "}
                  {new Date(review.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">
          Reviews come only from members who joined {coach.display_name} on
          GYMX2.
        </p>
      </section>

      <section className="rounded-lg border border-accent bg-surface p-6 text-center">
        <h2 className="text-3xl">Mind · Body · Spirit</h2>
        <p className="mx-auto mt-2 max-w-xl text-muted">
          GYMX2 is where coaches and members unite to get fit, learn nutrition
          and get their mind right.
        </p>
        <Link href={join} className="btn-primary mt-4 inline-block">
          {joinLabel}
        </Link>
      </section>
    </article>
  );
}
