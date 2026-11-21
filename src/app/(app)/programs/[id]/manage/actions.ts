"use server";

import {
  createProgramPromotionCommandSchema,
  discardProgramAuthoringDraftCommandSchema,
  programAuthoringSnapshotCommandSchema,
  publishProgramAuthoringDraftCommandSchema,
  publishProgramOfferPriceCommandSchema,
  saveProgramAuthoringDraftCommandSchema,
  type ProgramAuthoringPromotion,
  type ProgramAuthoringDiscarded,
  type ProgramAuthoringPublished,
  type ProgramAuthoringResult,
  type ProgramAuthoringSavedDraft,
  type ProgramAuthoringSnapshot,
} from "@/lib/program-authoring-contracts";
import {
  createProgramPromotion,
  discardProgramAuthoringDraft,
  isProgramPaidAuthoringEnabled,
  loadProgramAuthoringSnapshot,
  publishProgramAuthoringDraft,
  publishProgramOfferPrice,
  saveProgramAuthoringDraft,
} from "@/lib/program-authoring-server";

function sameProgram<T extends { programId: string }>(
  programId: string,
  result: ProgramAuthoringResult<T>,
): ProgramAuthoringResult<T> {
  if (!result.ok) return result;
  return result.value.programId === programId
    ? result
    : { ok: false, reason: "unavailable" };
}

export async function loadProgramAuthoringSnapshotAction(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringSnapshot>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = programAuthoringSnapshotCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const result = await loadProgramAuthoringSnapshot(command.data);
  return sameProgram(command.data.programId, result);
}

export async function saveProgramAuthoringDraftAction(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringSavedDraft>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = saveProgramAuthoringDraftCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const result = await saveProgramAuthoringDraft(command.data);
  return sameProgram(command.data.programId, result);
}

export async function discardProgramAuthoringDraftAction(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringDiscarded>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = discardProgramAuthoringDraftCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const result = await discardProgramAuthoringDraft(command.data);
  if (!result.ok) return result;
  return result.value.programId === command.data.programId
      && result.value.draftId === command.data.draftId
      && result.value.draftRevision === command.data.expectedDraftRevision
    ? result
    : { ok: false, reason: "unavailable" };
}

export async function publishProgramAuthoringDraftAction(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringPublished>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = publishProgramAuthoringDraftCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const result = await publishProgramAuthoringDraft(command.data);
  return sameProgram(command.data.programId, result);
}

export async function publishProgramOfferPriceAction(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringPublished>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = publishProgramOfferPriceCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const result = await publishProgramOfferPrice(command.data);
  return sameProgram(command.data.programId, result);
}

export async function createProgramPromotionAction(
  input: unknown,
): Promise<ProgramAuthoringResult<ProgramAuthoringPromotion>> {
  if (!isProgramPaidAuthoringEnabled()) return { ok: false, reason: "feature_disabled" };
  const command = createProgramPromotionCommandSchema.safeParse(input);
  if (!command.success) return { ok: false, reason: "invalid_request" };
  const result = await createProgramPromotion(command.data);
  return sameProgram(command.data.programId, result);
}
