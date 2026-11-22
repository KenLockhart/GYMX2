import "server-only";

import { requireCoachOrAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createProgramPromotionCommandSchema,
  discardProgramAuthoringDraftCommandSchema,
  parseProgramAuthoringDiscarded,
  parseProgramAuthoringPromotion,
  parseProgramAuthoringPublished,
  parseProgramAuthoringSavedDraft,
  parseProgramAuthoringSnapshot,
  publishProgramAuthoringDraftCommandSchema,
  publishProgramOfferPriceCommandSchema,
  programAuthoringSnapshotCommandSchema,
  saveProgramAuthoringDraftCommandSchema,
  type ProgramAuthoringPromotion,
  type ProgramAuthoringDiscarded,
  type ProgramAuthoringPublished,
  type ProgramAuthoringResult,
  type ProgramAuthoringSavedDraft,
  type ProgramAuthoringSnapshot,
} from "./program-authoring-contracts";

type AuthoringRpcClient = {
  rpc(name: string, args: Record<string, unknown>): Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export function isProgramPaidAuthoringEnabled(): boolean {
  return process.env.PROGRAM_PAID_AUTHORING_ENABLED === "true";
}

function isAuthoringRpcClient(value: unknown): value is AuthoringRpcClient {
  return typeof value === "object" && value !== null &&
    "rpc" in value && typeof value.rpc === "function";
}

async function getVerifiedActor(): Promise<{ id: string; role: "coach" | "admin" } | null> {
  const { profile } = await requireCoachOrAdmin();
  if ((profile.role !== "coach" && profile.role !== "admin") ||
      typeof profile.id !== "string" || profile.id.length === 0) return null;
  return { id: profile.id, role: profile.role };
}

async function callAuthoringRpc<T>(
  name: string,
  args: Record<string, unknown>,
  parse: (value: unknown) => T | null,
): Promise<ProgramAuthoringResult<T>> {
  const client: unknown = createAdminClient();
  if (!isAuthoringRpcClient(client)) return { ok: false, reason: "unavailable" };
  const { data, error } = await client.rpc(name, args);
  if (error) return { ok: false, reason: "unavailable" };
  const value = parse(data);
  return value ? { ok: true, value } : { ok: false, reason: "unavailable" };
}

export async function loadProgramAuthoringSnapshot(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringSnapshot>> {
  const command = programAuthoringSnapshotCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const actor = await getVerifiedActor();
  if (!actor) return { ok: false, reason: "unavailable" };
  return callAuthoringRpc(
    "get_program_authoring_draft",
    { target_program_id: command.data.programId, target_actor_id: actor.id },
    parseProgramAuthoringSnapshot,
  );
}

export async function saveProgramAuthoringDraft(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringSavedDraft>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = saveProgramAuthoringDraftCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const actor = await getVerifiedActor();
  if (!actor) return { ok: false, reason: "unavailable" };
  return callAuthoringRpc("save_program_authoring_draft", {
    target_program_id: command.data.programId,
    target_actor_id: actor.id,
    target_draft_id: command.data.draftId,
    target_expected_draft_revision: command.data.expectedDraftRevision,
    target_expected_content_version_id: command.data.expectedContentVersionId,
    target_expected_offer_version_id: command.data.expectedOfferVersionId,
    target_lessons: command.data.lessons.map((lesson) => ({
      lesson_ordinal: lesson.lessonOrdinal,
      timeline_day_number: lesson.timelineDayNumber,
      title: lesson.title,
      instructions: lesson.instructions,
      pillar: lesson.pillar,
      video_id: lesson.videoId,
    })),
  }, parseProgramAuthoringSavedDraft);
}

export async function discardProgramAuthoringDraft(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringDiscarded>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = discardProgramAuthoringDraftCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const actor = await getVerifiedActor();
  if (!actor) return { ok: false, reason: "unavailable" };
  const result = await callAuthoringRpc("discard_program_authoring_draft", {
    target_program_id: command.data.programId,
    target_actor_id: actor.id,
    target_draft_id: command.data.draftId,
    target_expected_draft_revision: command.data.expectedDraftRevision,
    target_expected_content_version_id: command.data.expectedContentVersionId,
    target_expected_offer_version_id: command.data.expectedOfferVersionId,
  }, parseProgramAuthoringDiscarded);
  if (!result.ok) return result;
  if (result.value.status === "conflict") return { ok: false, reason: "conflict" };
  return {
    ok: true,
    value: {
      status: result.value.status,
      programId: result.value.programId,
      draftId: result.value.draftId,
      draftRevision: result.value.draftRevision,
    },
  };
}

export async function publishProgramAuthoringDraft(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringPublished>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = publishProgramAuthoringDraftCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const actor = await getVerifiedActor();
  if (!actor) return { ok: false, reason: "unavailable" };
  return callAuthoringRpc("publish_program_authoring_draft", {
    target_program_id: command.data.programId,
    target_actor_id: actor.id,
    target_draft_id: command.data.draftId,
    target_expected_draft_revision: command.data.expectedDraftRevision,
    target_expected_content_version_id: command.data.expectedContentVersionId,
    target_expected_offer_version_id: command.data.expectedOfferVersionId,
    target_request_id: command.data.requestId,
    target_list_price_cents: command.data.listPriceCents,
    target_max_installments: command.data.maxInstallments,
  }, parseProgramAuthoringPublished);
}

export async function publishProgramOfferPrice(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringPublished>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = publishProgramOfferPriceCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const actor = await getVerifiedActor();
  if (!actor) return { ok: false, reason: "unavailable" };
  return callAuthoringRpc("publish_program_offer_price", {
    target_program_id: command.data.programId,
    target_actor_id: actor.id,
    target_expected_content_version_id: command.data.expectedContentVersionId,
    target_expected_offer_version_id: command.data.expectedOfferVersionId,
    target_request_id: command.data.requestId,
    target_list_price_cents: command.data.listPriceCents,
    target_max_installments: command.data.maxInstallments,
  }, parseProgramAuthoringPublished);
}

export async function createProgramPromotion(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringPromotion>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = createProgramPromotionCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const actor = await getVerifiedActor();
  if (!actor) return { ok: false, reason: "unavailable" };
  return callAuthoringRpc("create_program_promotion", {
    target_program_id: command.data.programId,
    target_actor_id: actor.id,
    target_expected_content_version_id: command.data.expectedContentVersionId,
    target_expected_offer_version_id: command.data.expectedOfferVersionId,
    target_request_id: command.data.requestId,
    target_code: command.data.code,
    target_discount_kind: command.data.discountKind,
    target_discount_value: command.data.discountValue,
    target_starts_at: command.data.startsAt,
    target_ends_at: command.data.endsAt,
    target_max_redemptions: command.data.maxRedemptions,
  }, parseProgramAuthoringPromotion);
}
