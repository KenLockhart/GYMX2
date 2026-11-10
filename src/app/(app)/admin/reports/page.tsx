import type { Metadata } from "next";
import Link from "next/link";
import {
  CoachReportDecision,
  ReviewReportDecision,
} from "@/components/report-decision";
import { requireAdmin } from "@/lib/auth";
import { reportReasonLabel } from "@/lib/reviews";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review and coach reports" };

type ReviewReport = {
  id: string;
  reason: string;
  details: string;
  created_at: string;
  reporter: { display_name: string } | null;
  review: {
    id: string;
    rating: number;
    body: string;
    hidden: boolean;
    coach: { id: string; display_name: string } | null;
    member: { display_name: string } | null;
  } | null;
};

type CoachReport = {
  id: string;
  reason: string;
  details: string;
  created_at: string;
  reporter: { display_name: string } | null;
  coach: { id: string; display_name: string } | null;
};

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

// Open reports about reviews and coaches. A decision on a review closes every report on it.
export default async function ReportsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: reviewData }, { data: coachData }, { count: handled }] =
    await Promise.all([
      supabase
        .from("review_reports")
        .select(
          "id, reason, details, created_at, reporter:profiles!reporter_id(display_name), review:coach_reviews!review_id(id, rating, body, hidden, coach:profiles!coach_id(id, display_name), member:profiles!member_id(display_name))",
        )
        .eq("status", "open")
        .order("created_at"),
      supabase
        .from("coach_reports")
        .select(
          "id, reason, details, created_at, reporter:profiles!reporter_id(display_name), coach:profiles!coach_id(id, display_name)",
        )
        .eq("status", "open")
        .order("created_at"),
      supabase
        .from("coach_reports")
        .select("id", { count: "exact", head: true })
        .neq("status", "open"),
    ]);
  const reviewReports = (reviewData ?? []) as unknown as ReviewReport[];
  const coachReports = (coachData ?? []) as unknown as CoachReport[];

  // Several reports on one review show as one item.
  const byReview = new Map<string, ReviewReport[]>();
  for (const report of reviewReports) {
    const key = report.review?.id ?? report.id;
    byReview.set(key, [...(byReview.get(key) ?? []), report]);
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="text-link text-sm">
          Back to admin
        </Link>
        <h1 className="mt-2 text-5xl">Review and coach reports</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Reports from members and coaches. The person reported never sees who
          reported them. Community post reports are on the{" "}
          <Link href="/moderation" className="text-link">
            moderation page
          </Link>
          .
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="review-reports">
        <h2 id="review-reports" className="text-3xl">
          Reviews ({byReview.size})
        </h2>
        {byReview.size === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-5 text-muted">
            No open review reports.
          </p>
        ) : (
          <ul className="space-y-3">
            {[...byReview.values()].map((reports) => {
              const review = reports[0].review;
              return (
                <li
                  key={reports[0].id}
                  className="space-y-3 rounded-2xl border border-border bg-surface p-5"
                >
                  <p className="text-sm text-muted">
                    Review of{" "}
                    {review?.coach ? (
                      <Link
                        href={`/coaches/${review.coach.id}`}
                        className="text-link"
                      >
                        {review.coach.display_name}
                      </Link>
                    ) : (
                      "a coach"
                    )}{" "}
                    by {review?.member?.display_name ?? "a member"} ·{" "}
                    {review?.rating}★{review?.hidden && " · already hidden"}
                  </p>
                  <blockquote className="whitespace-pre-line border-l-2 border-border pl-3">
                    {review?.body || (
                      <span className="text-muted">(No written review)</span>
                    )}
                  </blockquote>
                  <ul className="space-y-1 text-sm">
                    {reports.map((r) => (
                      <li key={r.id}>
                        <span className="font-semibold">
                          {reportReasonLabel(r.reason)}
                        </span>
                        <span className="text-muted">
                          {" "}
                          · {r.reporter?.display_name ?? "Someone"} ·{" "}
                          {when(r.created_at)}
                        </span>
                        {r.details && (
                          <span className="block text-muted">
                            &ldquo;{r.details}&rdquo;
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <ReviewReportDecision reportId={reports[0].id} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="coach-reports">
        <h2 id="coach-reports" className="text-3xl">
          Coaches ({coachReports.length})
        </h2>
        {coachReports.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-5 text-muted">
            No open coach reports.{handled ? ` ${handled} handled so far.` : ""}
          </p>
        ) : (
          <ul className="space-y-3">
            {coachReports.map((r) => (
              <li
                key={r.id}
                className="space-y-3 rounded-2xl border border-border bg-surface p-5"
              >
                <p>
                  <span className="font-semibold">
                    {reportReasonLabel(r.reason)}
                  </span>
                  <span className="text-muted">
                    {" "}
                    about{" "}
                    {r.coach ? (
                      <Link
                        href={`/coaches/${r.coach.id}`}
                        className="text-link"
                      >
                        {r.coach.display_name}
                      </Link>
                    ) : (
                      "a coach"
                    )}{" "}
                    · from {r.reporter?.display_name ?? "someone"} ·{" "}
                    {when(r.created_at)}
                  </span>
                </p>
                {r.details && (
                  <p className="whitespace-pre-line text-sm">
                    &ldquo;{r.details}&rdquo;
                  </p>
                )}
                {r.coach && (
                  <p className="flex flex-wrap gap-3 text-sm">
                    <Link
                      href={`/admin/coach-profiles/${r.coach.id}`}
                      className="text-link"
                    >
                      Their profile review
                    </Link>
                    <Link href="/admin/credentials" className="text-link">
                      Credentials
                    </Link>
                    <Link href="/admin/messages" className="text-link">
                      Conversations
                    </Link>
                  </p>
                )}
                <CoachReportDecision reportId={r.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
