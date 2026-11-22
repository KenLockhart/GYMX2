import Link from "next/link";
import type {
  CoachFormCoachAssessmentRow,
  MemberFormCoachAssessmentRow,
} from "@/lib/form-coach/workflow-contracts";

type AssessmentRow = CoachFormCoachAssessmentRow | MemberFormCoachAssessmentRow;
type ViewerRole = "coach" | "member";
const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const UTC_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
});

const STATUS_LABELS = {
  sent: "Sent",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
} as const;

function formatUtcDate(value: string): string {
  return `${UTC_DATE_FORMATTER.format(new Date(value))} UTC`;
}

function formatUtcDateTime(value: string): string {
  return `${UTC_DATE_TIME_FORMATTER.format(new Date(value))} UTC`;
}

function assessmentTitle(row: AssessmentRow): string {
  if (row.source_kind === "manual") return "Manual Form Check";
  return row.program_title ?? "Program assessment";
}

function detailHref(role: ViewerRole, assessmentId: string): string {
  const root = role === "coach" ? "/form-coach/assessments" : "/form-checks";
  return `${root}/${encodeURIComponent(assessmentId)}`;
}

function StatusPill({ status }: { status: keyof typeof STATUS_LABELS }) {
  return (
    <span className="inline-flex rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs font-semibold text-foreground">
      {STATUS_LABELS[status]}
    </span>
  );
}

export function AssessmentList({
  role,
  rows,
  page,
  hasMore,
  status,
}: {
  role: ViewerRole;
  rows: readonly AssessmentRow[];
  page: number;
  hasMore: boolean;
  status?: string | null;
}) {
  const root = role === "coach" ? "/form-coach/assessments" : "/form-checks";
  const pageHref = (targetPage: number) => {
    const query = new URLSearchParams({ page: String(targetPage) });
    if (role === "coach" && status) query.set("status", status);
    return `${root}?${query.toString()}`;
  };

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p role="status" className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">
          {page > 1
            ? role === "coach"
              ? "There are no assessments on this page for the selected status. Go to a previous page or change the filter."
              : "There are no assessments on this page. Go to a previous page to review earlier Form Checks."
            : role === "coach"
              ? "No assessments match this view. New coach assessments will appear here when they are sent."
              : "There are no Form Checks in your inbox yet."}
        </p>
      ) : (
        <ul className="grid gap-3" aria-label={role === "coach" ? "Coach assessments" : "Your Form Checks"}>
          {rows.map((row) => {
            const memberId = "member_id" in row ? row.member_id : null;
            return (
              <li key={row.assessment_id}>
                <article className="rounded-xl border border-border bg-surface p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                        {row.source_kind === "program" ? "Program assessment" : "Manual Form Check"}
                      </p>
                      <h2 className="mt-1 break-words text-2xl leading-tight">
                        <Link className="text-link" href={detailHref(role, row.assessment_id)}>
                          {assessmentTitle(row)}
                        </Link>
                      </h2>
                    </div>
                    <StatusPill status={row.status} />
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                    {role === "coach" && memberId && (
                      <div>
                        <dt className="text-muted">Member</dt>
                        <dd className="mt-0.5">
                          <Link className="text-link" href={`/members/${encodeURIComponent(memberId)}`}>
                            View member profile
                          </Link>
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-muted">Sent</dt>
                      <dd className="mt-0.5 tabular-nums"><time dateTime={row.sent_at}>{formatUtcDate(row.sent_at)}</time></dd>
                    </div>
                    <div>
                      <dt className="text-muted">Due</dt>
                      <dd className="mt-0.5 tabular-nums"><time dateTime={row.due_at}>{formatUtcDateTime(row.due_at)}</time></dd>
                    </div>
                    <div>
                      <dt className="text-muted">Exercises</dt>
                      <dd className="mt-0.5 tabular-nums">{row.item_count}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Finished attempts</dt>
                      <dd className="mt-0.5 tabular-nums">{row.finished_attempt_count}</dd>
                    </div>
                  </dl>

                  <div className="mt-4">
                    <Link
                      className="btn-secondary min-h-11 w-full sm:w-auto"
                      href={detailHref(role, row.assessment_id)}
                    >
                      View assessment history
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <nav aria-label="Assessment pages" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Page {page}</p>
        <div className="flex gap-2">
          {page > 1 && (
            <Link className="btn-secondary min-h-11" href={pageHref(page - 1)}>
              Previous
            </Link>
          )}
          {hasMore && (
            <Link className="btn-secondary min-h-11" href={pageHref(page + 1)}>
              Next
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}
