import { z } from "zod";
import { canGoLive, LIVE_LATE_MS } from "@/lib/live";

const uuidSchema = z.uuid().transform((value) => value.toLowerCase());

export const privateLiveModeSchema = z.enum(["broadcast", "one_on_one"]);
export const privateLiveDirectionSchema = z.enum(["coach", "member"]);
export const privateLiveGrantStateSchema = z.enum([
  "offered",
  "accepted",
  "live",
  "revoking",
  "revoked",
]);

export const privateLiveSessionInputSchema = z.object({
  sessionId: uuidSchema,
});

export const privateLiveOfferInputSchema = z.object({
  sessionId: uuidSchema,
  memberId: uuidSchema,
});

export const privateLiveGrantInputSchema = z.object({
  sessionId: uuidSchema,
  grantId: uuidSchema,
});

export const privateLiveAcceptInputSchema = privateLiveGrantInputSchema.extend({
  allowMemberCamera: z.boolean(),
});

export const privateLiveProvisionInputSchema = privateLiveGrantInputSchema;

export const privateLiveStartedInputSchema = privateLiveGrantInputSchema.extend({
  generation: z.number().int().positive().safe(),
  leaseToken: uuidSchema,
});

export const privateLivePlaybackInputSchema = privateLiveGrantInputSchema.extend({
  generation: z.number().int().positive().safe(),
});

export const privateLiveGenerationSchema = z
  .union([
    z.number().int().positive().safe(),
    z.string().regex(/^[1-9]\d*$/).transform(Number),
  ])
  .pipe(z.number().int().positive().safe());

const isoTimestampSchema = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)),
  "Expected a valid timestamp",
);

export const privateLiveProviderUidSchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const privateLiveProviderTagSchema = z
  .string()
  .max(120)
  .regex(/^gymx2-private:[0-9a-f-]{36}:[1-9]\d*:(coach|member)$/);

export const privateLiveProvisionLeaseSchema = z.object({
  session_id: uuidSchema,
  grant_id: uuidSchema,
  direction: privateLiveDirectionSchema,
  generation: privateLiveGenerationSchema,
  lease_token: uuidSchema,
  provider_tag: privateLiveProviderTagSchema,
  lease_expires_at: isoTimestampSchema,
});

export const privateLiveCleanupLeaseSchema = z.object({
  cleanup_id: z.uuid(),
  session_id: uuidSchema,
  grant_id: z.uuid(),
  generation: privateLiveGenerationSchema,
  direction: privateLiveDirectionSchema,
  lease_token: z.uuid(),
  input_uid: z.string().min(1).max(64).nullable(),
  provider_tag: privateLiveProviderTagSchema,
});

export const privateLiveGrantRowSchema = z.object({
  grant_id: z.uuid(),
  session_id: z.uuid(),
  generation: privateLiveGenerationSchema,
  state: privateLiveGrantStateSchema,
  expires_at: isoTimestampSchema,
  member_camera_allowed: z.boolean(),
  coach_live_at: isoTimestampSchema.nullable(),
  member_live_at: isoTimestampSchema.nullable(),
});

export const privateLiveProviderStateRowSchema = z.object({
  session_id: uuidSchema,
  grant_id: uuidSchema,
  generation: privateLiveGenerationSchema,
  direction: privateLiveDirectionSchema,
  provider_tag: privateLiveProviderTagSchema,
  state: z.enum(["provisioning", "ready", "live", "cleanup_pending", "revoked"]),
  input_uid: privateLiveProviderUidSchema.nullable(),
  playback_id: privateLiveProviderUidSchema.nullable(),
  provision_actor_id: uuidSchema.nullable(),
  provision_lease_token: uuidSchema.nullable(),
});

export type PrivateLiveMode = z.infer<typeof privateLiveModeSchema>;
export type PrivateLiveDirection = z.infer<typeof privateLiveDirectionSchema>;
export type PrivateLiveGrantState = z.infer<
  typeof privateLiveGrantStateSchema
>;

export type PrivateLiveGrantSnapshot = {
  grantId: string;
  generation: number;
  state: PrivateLiveGrantState;
  expiresAt: string;
  memberCameraAllowed: boolean;
  coachLive: boolean;
  memberLive: boolean;
};

export type PrivateLiveSessionSnapshot = {
  mode: PrivateLiveMode;
  grant: PrivateLiveGrantSnapshot | null;
};

export type PrivateLiveErrorCode =
  | "invalid_request"
  | "not_allowed"
  | "not_found"
  | "wrong_mode"
  | "outside_window"
  | "camera_consent_required"
  | "not_ready"
  | "cleanup_pending"
  | "temporarily_unavailable";

export type PrivateActionResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: PrivateLiveErrorCode };

export type PrivateLiveSessionResult = PrivateActionResult<{
  mode: PrivateLiveMode;
  grant: PrivateLiveGrantSnapshot | null;
}>;

export type PrivateSessionOfferResult = PrivateActionResult<{
  grantId: string;
}>;

export type PrivateBroadcastPreparationResult = PrivateActionResult<{
  direction: PrivateLiveDirection;
  generation: number;
  leaseToken: string;
  ingestUrl: string;
}>;

export type PrivatePlaybackResult = PrivateActionResult<{
  playbackUrl: string;
  expiresAt: string;
}>;

export type PrivateRevokeResult = PrivateActionResult<{
  state: "revoking" | "revoked";
}>;

export function privateLiveProviderTag(
  sessionId: string,
  generation: number,
  direction: PrivateLiveDirection,
) {
  return `gymx2-private:${sessionId.toLowerCase()}:${generation}:${direction}`;
}

export function toPrivateLiveGrantSnapshot(
  row: z.infer<typeof privateLiveGrantRowSchema>,
): PrivateLiveGrantSnapshot {
  return {
    grantId: row.grant_id,
    generation: row.generation,
    state: row.state,
    expiresAt: row.expires_at,
    memberCameraAllowed: row.member_camera_allowed,
    coachLive: row.coach_live_at !== null,
    memberLive: row.member_live_at !== null,
  };
}

export function isPrivateLiveWindowOpen(
  startsAt: string,
  endsAt: string,
  now = new Date(),
) {
  if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)))
    return false;
  return canGoLive({ starts_at: startsAt, ends_at: endsAt }, now);
}

export function privateLiveWindowClosesAt(endsAt: string) {
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(endMs)) return null;
  return endMs + LIVE_LATE_MS;
}
