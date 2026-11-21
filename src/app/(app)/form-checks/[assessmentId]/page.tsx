import type { Metadata } from "next";
import { AssessmentDetail } from "@/components/form-coach/assessment-detail";
import { AssessmentReadState } from "@/components/form-coach/assessment-read-state";
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
    <AssessmentDetail role="member" detail={result.value} />
  ) : (
    <AssessmentReadState kind={result.kind} />
  );
}
