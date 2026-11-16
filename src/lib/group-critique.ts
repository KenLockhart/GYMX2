import { z } from "zod";

export const groupCritiqueSessionInputSchema = z.object({
  sessionId: z.uuid().transform((value) => value.toLowerCase()),
});

export const groupCritiqueGenerationInputSchema = groupCritiqueSessionInputSchema.extend({
  generation: z.number().int().positive().safe(),
});

export const groupCritiqueOfferInputSchema = groupCritiqueGenerationInputSchema.extend({
  memberId: z.uuid().transform((value) => value.toLowerCase()).nullable().optional(),
});

export const groupCritiqueConsentInputSchema = groupCritiqueGenerationInputSchema.extend({
  allowCamera: z.literal(true),
  allowMicrophone: z.literal(true),
});

export const groupCritiqueMuteInputSchema = groupCritiqueGenerationInputSchema.extend({
  memberId: z.uuid().transform((value) => value.toLowerCase()).nullable(),
  muted: z.boolean(),
});

export const groupCritiqueErrorSchema = z.enum([
  "not_allowed",
  "not_found",
  "invalid_request",
  "not_ready",
  "temporarily_unavailable",
]);

export const groupCritiqueRoomStateSchema = z.enum([
  "provisioning",
  "open",
  "ending",
  "ended",
]);

export const groupCritiqueMembershipStateSchema = z.enum([
  "eligible",
  "removing",
  "removed",
]);

export const groupCritiqueSnapshotMemberSchema = z.object({
  memberId: z.uuid(),
  displayName: z.string().min(1).max(120),
  membershipState: groupCritiqueMembershipStateSchema,
  offeredAt: z.iso.datetime().nullable(),
  cameraAllowed: z.boolean(),
  microphoneAllowed: z.boolean(),
  coachMuted: z.boolean(),
  participantEpoch: z.number().int().nonnegative().safe(),
  customParticipantId: z.string().max(160).nullable(),
});

export const groupCritiqueSnapshotSchema = z.object({
  sessionId: z.uuid(),
  generation: z.number().int().positive().safe(),
  state: groupCritiqueRoomStateSchema,
  joinExpiresAt: z.iso.datetime(),
  role: z.enum(["coach", "member"]),
  allMembersMuted: z.boolean(),
  members: z.array(groupCritiqueSnapshotMemberSchema).max(30),
});

export const groupCritiqueJoinCredentialSchema = z.object({
  meetingId: z.uuid(),
  participantId: z.uuid(),
  customParticipantId: z.string().min(1).max(160),
  authToken: z.string().min(1).max(4096),
  preset: z.enum(["host", "observer", "consented"]),
  canPublishAudio: z.boolean(),
  canPublishVideo: z.boolean(),
  muted: z.boolean(),
  expiresAt: z.iso.datetime(),
});

export type GroupCritiqueError = z.infer<typeof groupCritiqueErrorSchema>;
export type GroupCritiqueRoomState = z.infer<typeof groupCritiqueRoomStateSchema>;
export type GroupCritiqueMembershipState = z.infer<
  typeof groupCritiqueMembershipStateSchema
>;
export type GroupCritiqueSnapshotMember = z.infer<
  typeof groupCritiqueSnapshotMemberSchema
>;
export type GroupCritiqueSnapshot = z.infer<typeof groupCritiqueSnapshotSchema>;
export type GroupCritiqueJoinCredential = z.infer<
  typeof groupCritiqueJoinCredentialSchema
>;

export type GroupCritiqueResult<T extends object = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: GroupCritiqueError };

export type GroupCritiqueSnapshotResult = GroupCritiqueResult<{
  featureEnabled: boolean;
  snapshot: GroupCritiqueSnapshot | null;
}>;

export type GroupCritiqueJoinResult = GroupCritiqueResult<{
  credentials: GroupCritiqueJoinCredential;
}>;
