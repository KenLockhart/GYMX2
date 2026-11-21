import "server-only";
import { requireAuthenticatedAccount, requireCoach } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ListCoachFormCoachAssessmentsInputSchema,
  ListMyFormCoachAssessmentsInputSchema,
  FormCoachWorkflowDetailSchema,
  FORM_COACH_REFERENCE_SIGNING_RESERVE_SECONDS,
  formCoachReferenceUrlTtlSeconds,
  parseCoachFormCoachAssessmentPage,
  parseMemberFormCoachAssessmentPage,
  parsePinnedFormCoachReferenceAsset,
  type CoachFormCoachAssessmentPage,
  type MemberFormCoachAssessmentPage,
  type FormCoachWorkflowDetail,
} from "@/lib/form-coach/workflow-contracts";

const REFERENCE_BUCKET = "form-coach-reference";

export type FormCoachWorkflowRead<T> =
  | Readonly<{ kind: "ready"; value: T }>
  | Readonly<{ kind: "not_found" | "not_authorized" | "unavailable" }>;

export type FormCoachReferenceUrl = Readonly<{
  signedUrl: string;
  templateVersionId: string;
}>;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function listCoachFormCoachAssessments(
  input: Readonly<{ page?: number; pageSize?: number; status?: string | null }> = {},
): Promise<FormCoachWorkflowRead<CoachFormCoachAssessmentPage>> {
  const parsedInput = ListCoachFormCoachAssessmentsInputSchema.safeParse(input);
  if (!parsedInput.success) return { kind: "unavailable" };

  await requireCoach();
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("list_coach_form_coach_assessments", {
      target_page: parsedInput.data.page,
      target_page_size: parsedInput.data.pageSize,
      target_status: parsedInput.data.status,
    });
    if (error) return { kind: "unavailable" };
    const page = parseCoachFormCoachAssessmentPage(data);
    if (page.page !== parsedInput.data.page || page.rows.length > parsedInput.data.pageSize) {
      return { kind: "unavailable" };
    }
    return { kind: "ready", value: page };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function listMyFormCoachAssessments(
  input: Readonly<{ page?: number; pageSize?: number }> = {},
): Promise<FormCoachWorkflowRead<MemberFormCoachAssessmentPage>> {
  const parsedInput = ListMyFormCoachAssessmentsInputSchema.safeParse(input);
  if (!parsedInput.success) return { kind: "unavailable" };

  const account = await requireAuthenticatedAccount();
  if (account.profile.role !== "member") return { kind: "not_authorized" };

  try {
    const client = await createClient();
    const { data, error } = await client.rpc("list_my_form_coach_assessments", {
      target_page: parsedInput.data.page,
      target_page_size: parsedInput.data.pageSize,
    });
    if (error) return { kind: "unavailable" };
    const page = parseMemberFormCoachAssessmentPage(data);
    if (page.page !== parsedInput.data.page || page.rows.length > parsedInput.data.pageSize) {
      return { kind: "unavailable" };
    }
    return { kind: "ready", value: page };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function getFormCoachWorkflowDetail(
  assessmentId: string,
  expectedRole?: "member" | "coach",
): Promise<FormCoachWorkflowRead<FormCoachWorkflowDetail>> {
  if (!isUuid(assessmentId)) return { kind: "not_authorized" };
  const account = await requireAuthenticatedAccount();
  if (account.profile.role !== "member" && account.profile.role !== "coach") {
    return { kind: "not_authorized" };
  }
  if (expectedRole && account.profile.role !== expectedRole) return { kind: "not_authorized" };
  if (account.profile.role === "coach") await requireCoach();

  try {
    const client = await createClient();
    const { data, error } = await client.rpc("get_form_coach_workflow_detail", {
      target_assessment_id: assessmentId,
    });
    if (error) return { kind: "unavailable" };
    if (data === null) return { kind: "not_found" };
    const detail = FormCoachWorkflowDetailSchema.parse(data);
    if (detail.assessment_id !== assessmentId) return { kind: "unavailable" };
    return { kind: "ready", value: detail };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Sign the reference that the database resolved for this authenticated assessment item. The
 * public entry accepts only assessment and item identifiers; actor, bucket, path, and TTL are
 * derived and checked on the server.
 */
export async function createFormCoachReferenceReadUrl(
  assessmentId: string,
  itemId: string,
): Promise<FormCoachWorkflowRead<FormCoachReferenceUrl>> {
  if (!isUuid(assessmentId) || !isUuid(itemId)) return { kind: "not_authorized" };
  const account = await requireAuthenticatedAccount();
  if (account.profile.role !== "member" && account.profile.role !== "coach") {
    return { kind: "not_authorized" };
  }

  try {
    const db = createAdminClient();
    const authorizationStartedAt = performance.now();
    const { data, error } = await db.rpc("service_read_form_coach_reference_asset", {
      target_actor_id: account.profile.id,
      target_assessment_id: assessmentId,
      target_item_id: itemId,
    });
    if (error) return { kind: "unavailable" };
    const asset = parsePinnedFormCoachReferenceAsset(data);
    if (!asset) return { kind: "not_authorized" };
    if (asset.authorized_actor_id !== account.profile.id
      || asset.authorized_role !== account.profile.role
      || asset.assessment_id !== assessmentId
      || asset.item_id !== itemId
      || asset.bucket_id !== REFERENCE_BUCKET) {
      return { kind: "not_authorized" };
    }

    const elapsedAfterAuthorizationMs = performance.now() - authorizationStartedAt;
    const ttlSeconds = formCoachReferenceUrlTtlSeconds(
      asset.authorized_ttl_seconds,
      elapsedAfterAuthorizationMs,
      FORM_COACH_REFERENCE_SIGNING_RESERVE_SECONDS,
    );
    if (ttlSeconds === null) return { kind: "not_authorized" };

    const { data: signed, error: signingError } = await db.storage
      .from(REFERENCE_BUCKET)
      .createSignedUrl(asset.storage_path, ttlSeconds);
    if (signingError || !signed?.signedUrl) return { kind: "unavailable" };

    const elapsedAtResponseMs = performance.now() - authorizationStartedAt;
    const remainingAtResponseSeconds = formCoachReferenceUrlTtlSeconds(
      asset.authorized_ttl_seconds,
      elapsedAtResponseMs,
      0,
    );
    if (remainingAtResponseSeconds === null || ttlSeconds > remainingAtResponseSeconds) {
      return { kind: "not_authorized" };
    }

    return {
      kind: "ready",
      value: {
        signedUrl: signed.signedUrl,
        templateVersionId: asset.template_version_id,
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}
