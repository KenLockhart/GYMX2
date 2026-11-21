import "server-only";

import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFormCoachReviewDetail, type FormCoachReviewDetail } from "./review-contracts";

export type FormCoachReviewRead<T> =
  | Readonly<{ kind: "ready"; value: T }>
  | Readonly<{ kind: "not_found" | "not_authorized" | "unavailable" }>;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Read one current, coach-authorized assessment and its per-item review CAS projection. */
export async function getCoachFormCoachReviewDetail(
  assessmentId: string,
): Promise<FormCoachReviewRead<FormCoachReviewDetail>> {
  if (!isUuid(assessmentId)) return { kind: "not_authorized" };

  const account = await requireCoach();
  if (account.profile.role !== "coach") return { kind: "not_authorized" };

  try {
    const client = await createClient();
    const { data, error } = await client.rpc("get_coach_form_coach_review_detail", {
      target_assessment_id: assessmentId,
    });
    if (error) return { kind: "unavailable" };
    if (data === null) return { kind: "not_found" };
    const detail = parseFormCoachReviewDetail(data);
    if (detail.assessment_id !== assessmentId) return { kind: "unavailable" };
    return { kind: "ready", value: detail };
  } catch {
    return { kind: "unavailable" };
  }
}
