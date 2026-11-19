"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  matchesPricingRequest,
  loadAllAdminUsers,
  normalizePricingCandidate,
  pricingAdminErrorCode,
  pricingCandidateDigest,
  type ExistingPricingRequest,
  type PricingCandidate,
} from "@/lib/form-coach/pricing-admin-server";

const PAGE_PATH = "/admin/monetization/feature-pricing";
const UuidSchema = z.string().uuid();
const RevisionSchema = z.number().int().positive().safe();

export type FeaturePricingActionState = {
  status?: "saved" | "reserved" | "already_applied" | "granted" | "revoked" | "searched" | "error";
  errorCode?: string;
  recipients?: FeaturePricingRecipient[];
};

export type FeaturePricingRecipient = { id: string; displayName: string; email: string; role: string };

function error(errorCode: string): FeaturePricingActionState {
  return { status: "error", errorCode };
}

function firstRpcRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row !== null && typeof row === "object" && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null;
}

function parseCandidateJson(value: FormDataEntryValue | null): PricingCandidate | null {
  if (typeof value !== "string" || value.length > 40_000) return null;
  try {
    return normalizePricingCandidate(JSON.parse(value));
  } catch {
    return null;
  }
}

async function readExistingRequest(requestId: string): Promise<ExistingPricingRequest | null> {
  const { data, error: queryError } = await createAdminClient()
    .from("feature_pricing_sync_requests")
    .select("request_id,feature_key,expected_revision,requested_by,request_digest,candidate_payload,state,published_revision")
    .eq("request_id", requestId)
    .maybeSingle();
  if (queryError) throw queryError;
  return data as ExistingPricingRequest | null;
}

function matchesSubmittedRequest(
  request: ExistingPricingRequest | null,
  input: {
    requestId: string;
    adminId: string;
    expectedRevision: number;
    digest: string;
    candidate: PricingCandidate;
  },
): request is ExistingPricingRequest {
  return request !== null && matchesPricingRequest({ request, ...input });
}

async function publishExistingRequest(
  requestId: string,
  expectedRevision: number,
  candidate: PricingCandidate,
): Promise<FeaturePricingActionState> {
  if (candidate.status === "live") return { status: "reserved" };
  const session = await createClient();
  const { data, error: rpcError } = await session.rpc("admin_publish_feature_pricing_sync", {
    p_request_id: requestId,
    p_expected_revision: expectedRevision,
  });
  if (rpcError) {
    return error(pricingAdminErrorCode(rpcError) === "23505" ? "stale" : "save_failed");
  }
  const result = firstRpcRow(data);
  const outcome = result?.outcome;
  if (outcome === "applied") {
    revalidatePath(PAGE_PATH);
    return { status: "saved" };
  }
  if (outcome === "already_applied") {
    revalidatePath(PAGE_PATH);
    return { status: "already_applied" };
  }
  if (outcome === "cas_stale") return error("stale");
  if (outcome === "objects_unverified") return error("sync_pending");
  return error("save_failed");
}

async function reconcileExactRequest(input: {
  requestId: string;
  adminId: string;
  expectedRevision: number;
  digest: string;
  candidate: PricingCandidate;
}): Promise<FeaturePricingActionState | null> {
  const request = await readExistingRequest(input.requestId);
  if (!request) return null;
  if (!matchesSubmittedRequest(request, input)) return error("request_id_reused");
  if (request.state === "cas_stale") return error("stale");
  if (request.state === "failed") return error("save_failed");
  // Calling the same publish RPC after a lost response returns `already_applied` without
  // allocating a new UUID or creating another revision.
  if (request.state === "cas_applied") {
    if (request.published_revision === null || !Number.isSafeInteger(request.published_revision)) {
      return error("save_failed");
    }
    if (input.candidate.status === "live") {
      revalidatePath(PAGE_PATH);
      return { status: "already_applied" };
    }
    return publishExistingRequest(input.requestId, input.expectedRevision, input.candidate);
  }
  return input.candidate.status === "live"
    ? { status: "reserved" }
    : publishExistingRequest(input.requestId, input.expectedRevision, input.candidate);
}

export async function saveFeaturePricingRevision(
  _previous: FeaturePricingActionState,
  formData: FormData,
): Promise<FeaturePricingActionState> {
  const { profile } = await requireAdmin();
  const requestId = UuidSchema.safeParse(formData.get("request_id"));
  const expectedRevisionValue = Number(formData.get("expected_revision"));
  const expectedRevision = RevisionSchema.safeParse(expectedRevisionValue);
  const candidate = parseCandidateJson(formData.get("candidate_json"));
  if (!requestId.success || !expectedRevision.success || !candidate) return error("invalid_input");
  if (candidate.currency !== "USD") return error("unsupported_currency");

  const digest = pricingCandidateDigest(candidate);
  const identity = {
    requestId: requestId.data,
    adminId: profile.id,
    expectedRevision: expectedRevision.data,
    digest,
    candidate,
  };

  try {
    const reconciled = await reconcileExactRequest(identity);
    if (reconciled) {
      if (reconciled.status === "saved" || reconciled.status === "already_applied") revalidatePath(PAGE_PATH);
      return reconciled.status === "reserved" ? { status: "reserved" } : reconciled;
    }
  } catch {
    return error("save_failed");
  }

  const session = await createClient();
  const { data, error: rpcError } = await session.rpc("admin_reserve_feature_pricing_sync", {
    p_expected_revision: expectedRevision.data,
    p_request_id: requestId.data,
    p_request_digest: digest,
    p_candidate_payload: candidate,
  });
  if (rpcError) {
    if (pricingAdminErrorCode(rpcError) === "23505") {
      try {
        const reconciled = await reconcileExactRequest(identity);
        if (reconciled) return reconciled.status === "reserved" ? { status: "reserved" } : reconciled;
      } catch {
        return error("save_failed");
      }
      return error("request_id_reused");
    }
    return error(pricingAdminErrorCode(rpcError) === "22023" ? "invalid_input" : "save_failed");
  }

  const reserved = firstRpcRow(data);
  if (reserved?.outcome === "cas_stale") {
    // 2 admins can race after the pre-read. If the exact request won that race,
    // reconcile its persisted identity before reporting a conflict.
    try {
      const reconciled = await reconcileExactRequest(identity);
      if (reconciled) return reconciled.status === "reserved" ? { status: "reserved" } : reconciled;
    } catch {
      return error("save_failed");
    }
    return error("stale");
  }
  if (reserved?.outcome !== "reserved" && reserved?.outcome !== "existing") return error("save_failed");

  if (reserved.outcome === "existing") {
    try {
      const reconciled = await reconcileExactRequest(identity);
      if (reconciled) return reconciled.status === "reserved" ? { status: "reserved" } : reconciled;
    } catch {
      return error("save_failed");
    }
    return error("save_failed");
  }

  if (candidate.status === "live") {
    revalidatePath(PAGE_PATH);
    return { status: "reserved" };
  }
  const result = await publishExistingRequest(requestId.data, expectedRevision.data, candidate);
  return result;
}

const CompGrantFormSchema = z.object({
  userId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  reason: z.string().trim().min(1).max(500),
  requestId: z.string().uuid(),
}).strict().superRefine((grant, context) => {
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(grant.startsAt)) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "expiry must follow start" });
  }
});

export async function searchFeatureCompRecipients(
  _previous: FeaturePricingActionState,
  formData: FormData,
): Promise<FeaturePricingActionState> {
  await requireAdmin();
  const query = z.string().trim().min(2).max(100).safeParse(formString(formData, "query"));
  if (!query.success) return { status: "error", errorCode: "invalid_search", recipients: [] };

  const session = await createClient();
  let data: Record<string, unknown>[];
  try {
    data = await loadAllAdminUsers(session);
  } catch {
    return { status: "error", errorCode: "search_failed", recipients: [] };
  }
  const words = query.data.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const recipients = data
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      displayName: typeof row.display_name === "string" ? row.display_name : "",
      email: typeof row.email === "string" ? row.email : "",
      role: typeof row.role === "string" ? row.role : "member",
    }))
    .filter((row) => row.id && words.every((word) => `${row.displayName} ${row.email}`.toLocaleLowerCase().includes(word)))
    .slice(0, 20);
  return { status: "searched", recipients };
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function grantFeatureComp(
  _previous: FeaturePricingActionState,
  formData: FormData,
): Promise<FeaturePricingActionState> {
  await requireAdmin();
  const parsed = CompGrantFormSchema.safeParse({
    userId: formString(formData, "user_id"),
    startsAt: formString(formData, "starts_at"),
    expiresAt: formString(formData, "expires_at") || null,
    reason: formString(formData, "reason"),
    requestId: formString(formData, "request_id"),
  });
  if (!parsed.success) return error("invalid_comp");

  const startsAt = new Date(parsed.data.startsAt).toISOString();
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt).toISOString() : null;
  const adminDb = createAdminClient();
  const { data: existing, error: lookupError } = await adminDb
    .from("feature_access_grants")
    .select("id,feature_key,grant_kind,user_id,starts_at,expires_at,reason,request_id")
    .eq("request_id", parsed.data.requestId)
    .maybeSingle();
  if (lookupError) return error("comp_failed");
  if (existing) {
    const exact = existing.feature_key === "form_coach"
      && existing.grant_kind === "comp"
      && existing.user_id === parsed.data.userId
      && Date.parse(existing.starts_at) === Date.parse(startsAt)
      && (existing.expires_at === null ? expiresAt === null : Date.parse(existing.expires_at) === (expiresAt === null ? Number.NaN : Date.parse(expiresAt)))
      && existing.reason === parsed.data.reason;
    if (!exact) return error("request_id_reused");
    const { data: revokeEvent, error: eventError } = await adminDb
      .from("feature_access_grant_events")
      .select("grant_id")
      .eq("grant_id", existing.id)
      .eq("action", "revoked")
      .maybeSingle();
    if (eventError) return error("comp_failed");
    return revokeEvent ? { status: "revoked" } : { status: "granted" };
  }

  const session = await createClient();
  const { error: rpcError } = await session.rpc("admin_grant_feature_comp", {
    p_user_id: parsed.data.userId,
    p_feature_key: "form_coach",
    p_starts_at: startsAt,
    p_expires_at: expiresAt,
    p_reason: parsed.data.reason,
    p_request_id: parsed.data.requestId,
  });
  if (rpcError) return error(pricingAdminErrorCode(rpcError) === "23505" ? "request_id_reused" : "comp_failed");
  revalidatePath(PAGE_PATH);
  return { status: "granted" };
}

export async function revokeFeatureComp(
  _previous: FeaturePricingActionState,
  formData: FormData,
): Promise<FeaturePricingActionState> {
  await requireAdmin();
  const grantId = UuidSchema.safeParse(formData.get("grant_id"));
  if (!grantId.success) return error("invalid_comp");

  const adminDb = createAdminClient();
  const { data: grant, error: grantError } = await adminDb
    .from("feature_access_grants")
    .select("id,feature_key,grant_kind")
    .eq("id", grantId.data)
    .maybeSingle();
  if (grantError) return error("comp_failed");
  if (!grant || grant.feature_key !== "form_coach" || grant.grant_kind !== "comp") return error("comp_not_found");

  const { data: existingEvent, error: eventError } = await adminDb
    .from("feature_access_grant_events")
    .select("grant_id")
    .eq("grant_id", grantId.data)
    .eq("action", "revoked")
    .maybeSingle();
  if (eventError) return error("comp_failed");
  if (existingEvent) return { status: "revoked" };

  const session = await createClient();
  const { error: rpcError } = await session.rpc("admin_revoke_feature_comp", {
    p_grant_id: grantId.data,
  });
  if (rpcError) return error("comp_failed");
  revalidatePath(PAGE_PATH);
  return { status: "revoked" };
}
