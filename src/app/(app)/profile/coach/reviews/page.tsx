import type { Metadata } from "next";
import Link from "next/link";
import { Stars } from "@/components/coach-profile/profile-parts";
import { ReportReviewButton, ReviewReplyForm } from "@/components/safety";
import { requireCoach } from "@/lib/auth";
import { reviewerName } from "@/lib/public-pages";
import {
  categoryAverages,
  REVIEW_CATEGORIES,
  type ReviewCategoryColumn,
} from "@/lib/reviews";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { T } from "@/i18n/t";
import { getTr, getLocale } from "@/i18n/server";
import { LOCALE_TAG } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Your reviews") };
}

type Row = {
  id: string;
  member_id: string;
  rating: number;
  body: string;
  hidden: boolean;
  reply: string | null;
  created_at: string;
} & Record<ReviewCategoryColumn, number | null>;

// A coach reads their reviews, replies in public, and reports any that break the rules.
export default async function CoachReviewsPage() {
  const locale = await getLocale();
  const tr = await getTr();
  const { profile } = await requireCoach();
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_reviews")
    .select(
      "id, member_id, rating, body, hidden, reply, created_at, rating_communication, rating_knowledge, rating_motivation, rating_results, rating_value",
    )
    .eq("coach_id", profile.id)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];
  // Reviewers may have left this coach, so their names come from the server, only for the people
  // row security just showed as this coach's reviewers.
  const ids = [...new Set(rows.map((r) => r.member_id))];
  const { data: names } = ids.length
    ? await createAdminClient()
        .from("profiles")
        .select("id, display_name")
        .in("id", ids)
    : { data: [] };
  const nameOf = new Map(
    (names ?? []).map((n) => [n.id as string, n.display_name as string]),
  );
  const visible = rows.filter((r) => !r.hidden);
  const average = visible.length
    ? Math.round(
        (visible.reduce((sum, r) => sum + r.rating, 0) / visible.length) * 10,
      ) / 10
    : null;
  const categories = categoryAverages(visible);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/profile/coach" className="text-link text-sm">
          <T>Back to your profile</T>
        </Link>
        <h1 className="mt-2 text-5xl">
          <T>Your reviews</T>
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          <T>
            Members who joined you can review you once. You can reply in public,
            but you can&apos;t edit or remove reviews. If one breaks the rules
            (fake, abusive or sharing private details), report it and an admin
            will check it.
          </T>
        </p>
      </div>

      {average !== null && (
        <div className="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-[10rem_1fr]">
          <div>
            <p className="font-display text-6xl font-bold leading-none">
              {average}
            </p>
            <Stars
              value={average}
              label={tr("Rated {average} out of 5", { average })}
            />
            <p className="mt-1 text-sm text-muted">
              {visible.length} {visible.length === 1 ? "review" : "reviews"}
            </p>
          </div>
          {categories.length > 0 ? (
            <dl className="grid gap-2 sm:grid-cols-2">
              {categories.map((c) => (
                <div
                  key={c.label}
                  className="flex justify-between rounded-lg bg-surface-raised px-3 py-2 text-sm"
                >
                  <dt>
                    <T>{c.label}</T>
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {c.score.toFixed(1)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="self-center text-sm text-muted">
              <T>
                Category scores (communication, knowledge and so on) show once
                three members rate each one.
              </T>
            </p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-muted">
          <T>
            No reviews yet. Members can review you once they&apos;ve joined.
          </T>
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const rated = REVIEW_CATEGORIES.filter((c) => row[c.column]);
            return (
              <li
                key={row.id}
                className={`space-y-3 rounded-2xl border bg-surface p-5 ${row.hidden ? "border-danger/60 opacity-80" : "border-border"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {reviewerName(nameOf.get(row.member_id) ?? "A member")}
                  </p>
                  <Stars value={row.rating} label={`${row.rating} out of 5`} />
                </div>
                <p className="text-xs text-muted">
                  {new Date(row.created_at).toLocaleDateString(
                    LOCALE_TAG[locale],
                    {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "America/New_York",
                    },
                  )}
                  {row.hidden && " · Hidden by a GYMX2 admin"}
                </p>
                {row.body && <p className="whitespace-pre-line">{row.body}</p>}
                {rated.length > 0 && (
                  <p className="text-xs text-muted">
                    {rated
                      .map((c) => `${c.label} ${row[c.column]}/5`)
                      .join(" · ")}
                  </p>
                )}
                {!row.hidden && (
                  <ReviewReplyForm reviewId={row.id} initial={row.reply} />
                )}
                {!row.hidden && <ReportReviewButton reviewId={row.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
