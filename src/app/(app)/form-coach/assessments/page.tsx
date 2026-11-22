import Link from "next/link";
import type { Metadata } from "next";
import { AssessmentList } from "@/components/form-coach/assessment-list";
import { AssessmentReadState } from "@/components/form-coach/assessment-read-state";
import { listCoachFormCoachAssessments } from "@/lib/form-coach/workflow-server";
import { FormCoachAssessmentStatusSchema } from "@/lib/form-coach/workflow-contracts";

export const metadata: Metadata = { title: "Form Coach Assessments" };

type SearchValue = string | string[] | undefined;
type SearchParams = Record<string, SearchValue>;
const STATUS_LABELS = {
  sent: "Sent",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
} as const;

function queryPage(value: SearchValue): number | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? Number.NaN : Number(value);
}

export default async function CoachAssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const page = queryPage(query.page);
  const statusText = Array.isArray(query.status) ? "__invalid__" : query.status;
  const status = statusText === undefined || statusText === "" ? null : statusText;
  const result = await listCoachFormCoachAssessments({ page, pageSize: 20, status });

  return (
    <div className="space-y-7">
      <header className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">Coach workspace</p>
          <h1 className="mt-1 text-5xl">Form Coach Assessments</h1>
        </div>
        <p className="max-w-2xl text-muted">
          Review assessment status and finished numeric results for members currently connected to you.
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4" method="get">
        <label className="min-w-52 space-y-1.5">
          <span className="block text-sm font-medium">Assessment status</span>
          <select className="field-input" name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {FormCoachAssessmentStatusSchema.options.map((statusOption) => (
              <option key={statusOption} value={statusOption}>
                {STATUS_LABELS[statusOption]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-secondary min-h-11" type="submit">Filter assessments</button>
        <Link className="text-link text-sm" href="/form-coach/assessments">Clear filter</Link>
      </form>

      {result.kind === "ready" ? (
        <AssessmentList
          role="coach"
          rows={result.value.rows}
          page={result.value.page}
          hasMore={result.value.has_more}
          status={status}
        />
      ) : (
        <AssessmentReadState kind={result.kind} />
      )}
    </div>
  );
}
