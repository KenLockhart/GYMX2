"use server";

import { requireAccount } from "@/lib/auth";
import {
  acceptPrivateSession as acceptPrivateSessionImpl,
  markPrivateBroadcastLive as markPrivateBroadcastLiveImpl,
  offerPrivateSession as offerPrivateSessionImpl,
  preparePrivateBroadcast as preparePrivateBroadcastImpl,
  privatePlayback as privatePlaybackImpl,
  readPrivateLiveSession as readPrivateLiveSessionImpl,
  resetSessionToBroadcast as resetSessionToBroadcastImpl,
  revokePrivateSession as revokePrivateSessionImpl,
  type PrivateLiveActor,
} from "@/lib/private-live-server";
import type {
  PrivateActionResult,
  PrivateBroadcastPreparationResult,
  PrivateLiveSessionResult,
  PrivatePlaybackResult,
  PrivateRevokeResult,
  PrivateSessionOfferResult,
} from "@/lib/private-live";
import { createClient } from "@/lib/supabase/server";

async function authorizedContext(): Promise<
  | { user: Awaited<ReturnType<typeof createClient>>; actor: PrivateLiveActor }
  | null
> {
  const { profile } = await requireAccount();
  const user = await createClient();
  const {
    data: { user: authenticatedUser },
    error,
  } = await user.auth.getUser();
  if (error || !authenticatedUser || authenticatedUser.id !== profile.id)
    return null;
  return {
    user,
    actor: { id: authenticatedUser.id, role: profile.role },
  };
}

function unauthorized<T extends object>() {
  return { ok: false as const, error: "not_allowed" as const } satisfies
    | PrivateActionResult<T>;
}

export async function readPrivateLiveSession(
  sessionId: string,
): Promise<PrivateLiveSessionResult> {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return readPrivateLiveSessionImpl(context.user, context.actor, sessionId);
}

export async function resetSessionToBroadcast(
  sessionId: string,
): Promise<PrivateActionResult<{ mode: "broadcast" }>> {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return resetSessionToBroadcastImpl(
    context.user,
    context.actor,
    sessionId,
  );
}

export async function offerPrivateSession(
  sessionId: string,
  memberId: string,
): Promise<PrivateSessionOfferResult> {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return offerPrivateSessionImpl(
    context.user,
    context.actor,
    sessionId,
    memberId,
  );
}

export async function acceptPrivateSession(
  sessionId: string,
  grantId: string,
  allowMemberCamera: boolean,
): Promise<PrivateActionResult> {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return acceptPrivateSessionImpl(
    context.user,
    context.actor,
    sessionId,
    grantId,
    allowMemberCamera,
  );
}

export async function preparePrivateBroadcast(
  sessionId: string,
  grantId: string,
): Promise<PrivateBroadcastPreparationResult> {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return preparePrivateBroadcastImpl(
    context.user,
    context.actor,
    sessionId,
    grantId,
  );
}

export async function markPrivateBroadcastLive(
  sessionId: string,
  grantId: string,
  generation: number,
  leaseToken: string,
): Promise<PrivateActionResult> {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return markPrivateBroadcastLiveImpl(
    context.user,
    context.actor,
    sessionId,
    grantId,
    generation,
    leaseToken,
  );
}

export async function privatePlayback(
  sessionId: string,
  grantId: string,
  generation: number,
): Promise<PrivatePlaybackResult> {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return privatePlaybackImpl(
    context.user,
    context.actor,
    sessionId,
    grantId,
    generation,
  );
}

export async function revokePrivateSession(
  sessionId: string,
  grantId: string,
): Promise<PrivateRevokeResult> {
  const context = await authorizedContext();
  if (!context) return unauthorized();
  return revokePrivateSessionImpl(
    context.user,
    context.actor,
    sessionId,
    grantId,
  );
}
