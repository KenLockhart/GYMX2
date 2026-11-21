import type { Metadata } from "next";
import { AssessmentList } from "@/components/form-coach/assessment-list";
import { AssessmentReadState } from "@/components/form-coach/assessment-read-state";
import { listMyFormCoachAssessments } from "@/lib/form-coach/workflow-server";

export const metadata: Metadata = { title: "Form Checks" };

type SearchValue = string | string[] | undefined;
type SearchParams = Record<string, SearchValue>;

function queryPage(value: SearchValue): number | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? Number.NaN : Number(value);
}

export default async function MemberFormChecksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const page = queryPage(query.page);
  const result = await listMyFormCoachAssessments({ page, pageSize: 20 });

  return (
    <div className="space-y-7">
      <header className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">Your training</p>
          <h1 className="mt-1 text-5xl">Form Checks</h1>
        </div>
        <p className="max-w-2xl text-muted">
          See assessments sent to you, their due dates and the results already recorded in your history.
        </p>
      </header>

      {result.kind === "ready" ? (
        <AssessmentList
          role="member"
          rows={result.value.rows}
          page={result.value.page}
          hasMore={result.value.has_more}
        />
      ) : (
        <AssessmentReadState kind={result.kind} />
      )}
    </div>
  );
}
