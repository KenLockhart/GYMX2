import type { Metadata } from "next";
import { AssessmentDetail } from "@/components/form-coach/assessment-detail";
import { AssessmentReadState } from "@/components/form-coach/assessment-read-state";
import { createFormCoachSummaryProvider } from "@/lib/form-coach/summary-provider";
import { getFormCoachWorkflowDetail } from "@/lib/form-coach/workflow-server";

export const metadata: Metadata = { title: "Form Check history" };

export default async function MemberFormCheckDetailPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  const result = await getFormCoachWorkflowDetail(assessmentId, "member");

  return result.kind === "ready" ? (
    <AssessmentDetail
      role="member"
      detail={result.value}
      summaryProviderConfigured={createFormCoachSummaryProvider().isConfigured()}
    />
  ) : (
    <AssessmentReadState kind={result.kind} />
  );
}
