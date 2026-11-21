import type { Metadata } from "next";
import { AssessmentDetail } from "@/components/form-coach/assessment-detail";
import { AssessmentReadState } from "@/components/form-coach/assessment-read-state";
import { recordFormCoachReviewAction } from "./actions";
import { getCoachFormCoachReviewDetail } from "@/lib/form-coach/review-server";

export const metadata: Metadata = { title: "Assessment history" };

export default async function CoachAssessmentDetailPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  const result = await getCoachFormCoachReviewDetail(assessmentId);

  return result.kind === "ready" ? (
    <AssessmentDetail role="coach" detail={result.value} reviewAction={recordFormCoachReviewAction} />
  ) : (
    <AssessmentReadState kind={result.kind} />
  );
}
