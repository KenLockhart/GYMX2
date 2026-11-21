import type { Metadata } from "next";
import { AssessmentDetail } from "@/components/form-coach/assessment-detail";
import { AssessmentReadState } from "@/components/form-coach/assessment-read-state";
import { getFormCoachWorkflowDetail } from "@/lib/form-coach/workflow-server";

export const metadata: Metadata = { title: "Assessment history" };

export default async function CoachAssessmentDetailPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  const result = await getFormCoachWorkflowDetail(assessmentId, "coach");

  return result.kind === "ready" ? (
    <AssessmentDetail role="coach" detail={result.value} />
  ) : (
    <AssessmentReadState kind={result.kind} />
  );
}
