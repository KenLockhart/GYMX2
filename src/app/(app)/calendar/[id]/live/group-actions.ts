"use server";

import { requireAccount } from "@/lib/auth";
import {
  acceptGroupCritiqueOffer as acceptGroupCritiqueOfferImpl,
  declineGroupCritiqueOffer as declineGroupCritiqueOfferImpl,
  endGroupCritiqueRoom as endGroupCritiqueRoomImpl,
  joinGroupCritique as joinGroupCritiqueImpl,
  offerGroupCritiqueCameras as offerGroupCritiqueCamerasImpl,
  readGroupCritiqueSnapshot as readGroupCritiqueSnapshotImpl,
  setGroupCritiqueMute as setGroupCritiqueMuteImpl,
  openGroupCritique as openGroupCritiqueImpl,
  type GroupCritiqueActor,
} from "@/lib/group-critique-server";
import type {
  GroupCritiqueJoinResult,
  GroupCritiqueSnapshotResult,
} from "@/lib/group-critique";
import { createClient } from "@/lib/supabase/server";

async function authorizedContext(): Promise<
  | { user: Awaited<ReturnType<typeof createClient>>; actor: GroupCritiqueActor }
  | null
> {
  const { profile } = await requireAccount();
  const user = await createClient();
  const {
    data: { user: authenticatedUser },
    error,
  } = await user.auth.getUser();
  if (error || !authenticatedUser || authenticatedUser.id !== profile.id) return null;
  return { user, actor: { id: authenticatedUser.id, role: profile.role } };
}

function unauthorized() {
  return { ok: false as const, error: "not_allowed" as const } as const;
}

export async function readGroupCritiqueSnapshot(
  sessionId: string,
): Promise<GroupCritiqueSnapshotResult> {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return readGroupCritiqueSnapshotImpl(context.user, context.actor, sessionId);
}

export async function openGroupCritique(sessionId: string) {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return openGroupCritiqueImpl(context.user, context.actor, sessionId);
}

export async function offerGroupCritiqueCameras(
  sessionId: string,
  generation: number,
  memberId?: string | null,
) {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return offerGroupCritiqueCamerasImpl(
    context.user,
    context.actor,
    sessionId,
    generation,
    memberId,
  );
}

export async function acceptGroupCritiqueOffer(sessionId: string, generation: number) {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return acceptGroupCritiqueOfferImpl(context.user, context.actor, sessionId, generation);
}

export async function declineGroupCritiqueOffer(sessionId: string, generation: number) {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return declineGroupCritiqueOfferImpl(context.user, context.actor, sessionId, generation);
}

export async function joinGroupCritique(
  sessionId: string,
  generation: number,
): Promise<GroupCritiqueJoinResult> {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return joinGroupCritiqueImpl(context.user, context.actor, sessionId, generation);
}

export async function setGroupCritiqueMute(
  sessionId: string,
  generation: number,
  memberId: string | null,
  muted: boolean,
) {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return setGroupCritiqueMuteImpl(
    context.user,
    context.actor,
    sessionId,
    generation,
    memberId,
    muted,
  );
}

export async function endGroupCritiqueRoom(sessionId: string, generation: number) {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return endGroupCritiqueRoomImpl(context.user, context.actor, sessionId, generation);
}
