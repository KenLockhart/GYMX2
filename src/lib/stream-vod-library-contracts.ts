import "server-only";

export const STREAM_VOD_LIBRARY_MAX_DURATION_SECONDS = 7_200;
export const STREAM_VOD_LIBRARY_MAX_FILE_BYTES = 30 * 1024 * 1024 * 1024;
export const STREAM_VOD_LIBRARY_UPLOAD_WINDOW_MS = 6 * 60 * 60 * 1_000;
export const STREAM_VOD_LIBRARY_SLOT = "vod_primary" as const;

const POSTGRES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const PROVIDER_UID = /^[A-Za-z0-9_-]{1,64}$/;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

export type StreamVodLibraryRole = "coach" | "admin";
export type StreamVodLibraryOperationState =
  | "reserved"
  | "create_started"
  | "create_unknown"
  | "created_unverified"
  | "provisional_bound"
  | "ready_for_publication"
  | "completed"
  | "canceled"
  | "failed"
  | "cleanup_reserved"
  | "delete_started"
  | "delete_unknown"
  | "source_finalizing"
  | "retained";

export type StreamVodLibraryRegistryProjection = {
  registryId: string;
  providerAccountId: string;
  verificationStatus: "unverified" | "verification_expired" | "verified_current";
  verificationValid: boolean;
};

export type StreamVodLibraryObservation = {
  requestId: string;
  kind: "create_reply" | "exact_uid_get" | "unique_marker_list_match";
  providerUid: string | null;
  httpStatus: number;
  signedUrlsReported: boolean | null;
  creatorMarkerMatched: boolean | null;
  metadataMarkerMatched: boolean | null;
  readyToStreamReported: boolean | null;
  evidenceDigest: string;
};

export type StreamVodLibraryWork = {
  operationId: string;
  operationDigest: string;
  operationState: StreamVodLibraryOperationState;
  operationRevision: number;
  intentId: string;
  actorId: string;
  ownerId: string;
  sourceId: string;
  expectedSourceRevision: number;
  title: string;
  description: string;
  fileDigest: string;
  requestDigest: string;
  registry: StreamVodLibraryRegistryProjection & {
    credentialSlot: typeof STREAM_VOD_LIBRARY_SLOT;
  };
  transport: {
    requestId: string;
    requestDigest: string;
    requestMarker: string;
    providerUid: string | null;
    providerEvidenceDigest: string | null;
    tusLocationPresent: boolean;
    transportExpiresAt: string | null;
    originalMaxDurationSeconds: number;
    originalRequireSignedUrls: boolean;
    originalMetadata: Record<string, string>;
  };
  createClaim: { requestId: string; requestDigest: string } | null;
  latestObservation: StreamVodLibraryObservation | null;
  latestExactUidGet: StreamVodLibraryObservation | null;
  finalizationReceipt: {
    requestId: string;
    requestDigest: string;
    terminalState: string;
    response: Record<string, unknown>;
  } | null;
  actorRole: StreamVodLibraryRole;
  actorRoleEligible: boolean;
  accountVerifiedCurrent: boolean;
  latestReadbackValid: boolean;
  latestReadbackIdentityValid: boolean;
  latestReadbackRetryable: boolean;
  providerPostAuthorized: false;
};

export type StreamVodLibraryWorkProjection =
  | {
      kind: "work";
      outcome: "work_available" | "recovery_required" | "completed";
      work: StreamVodLibraryWork;
      readbackRetryAllowed: boolean;
    }
  | {
      kind: "blocked";
      outcome: string;
      registryId?: string;
      providerAccountId?: string;
      credentialSlot?: string;
      verificationStatus?: string;
    };

export type StreamVodLibraryErrorCode =
  | "disabled"
  | "unauthenticated"
  | "forbidden"
  | "invalid_request"
  | "temporarily_unavailable"
  | "account_unavailable"
  | "account_unverified"
  | "identity_conflict"
  | "recovery_required"
  | "upload_not_ready"
  | "capability_unavailable";

export type StreamVodLibraryResult<T extends Record<string, unknown> = Record<string, never>> =
  | { ok: true; outcome: string } & T
  | { ok: false; error: StreamVodLibraryErrorCode };

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPostgresUuid(value: unknown): value is string {
  return typeof value === "string" && POSTGRES_UUID.test(value);
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

export function isProviderUid(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_UID.test(value);
}

export function isCloudflareAccountId(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_ID.test(value);
}

function readString(value: unknown, min = 1, max = 4_096): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function readNullableString(value: unknown, max = 4_096): value is string | null {
  return value === null || readString(value, 1, max);
}

function readNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function readSafeInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function assertNoBearerCapability(value: unknown, path = "projection"): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoBearerCapability(item, path);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (["tus_location", "upload_url", "bearer_url", "uploadurl"].includes(key.toLowerCase())) {
      throw new Error(`${path} unexpectedly contains a bearer capability`);
    }
    assertNoBearerCapability(child, `${path}.${key}`);
  }
}

export function parseStreamVodLibraryRegistryProjection(
  input: unknown,
  expectedAccountId: string,
): StreamVodLibraryRegistryProjection | null {
  if (!isPlainRecord(input) || input.outcome !== "identity_found") return null;
  if (
    input.provider !== "cloudflare_stream" ||
    input.credential_slot !== STREAM_VOD_LIBRARY_SLOT ||
    input.provider_account_id !== expectedAccountId ||
    !isCloudflareAccountId(input.provider_account_id) ||
    !isPostgresUuid(input.registry_id) ||
    !isPostgresUuid(input.attestation_id) ||
    !isPostgresUuid(input.attestation_request_id) ||
    !isSha256(input.attestation_digest) ||
    typeof input.attested_at !== "string" || !Number.isFinite(Date.parse(input.attested_at)) ||
    !["unverified", "verification_expired", "verified_current"].includes(
      String(input.verification_status),
    ) ||
    typeof input.verification_valid !== "boolean" ||
    input.verification_valid !== (input.verification_status === "verified_current") ||
    (input.verification_status === "unverified" &&
      (input.verified_until !== null || input.verification_revision !== null ||
        input.verification_event_id !== null || input.verification_request_id !== null)) ||
    (input.verification_status !== "unverified" &&
      (typeof input.verified_until !== "string" || !Number.isFinite(Date.parse(input.verified_until)) ||
        !readSafeInteger(input.verification_revision, 1) || !isPostgresUuid(input.verification_event_id) ||
        !isPostgresUuid(input.verification_request_id) || typeof input.verification_observed_at !== "string" ||
        !Number.isFinite(Date.parse(input.verification_observed_at))))
  ) {
    return null;
  }
  return {
    registryId: input.registry_id.toLowerCase(),
    providerAccountId: input.provider_account_id,
    verificationStatus: input.verification_status as StreamVodLibraryRegistryProjection["verificationStatus"],
    verificationValid: input.verification_valid,
  };
}

function parseObservation(
  input: unknown,
  projectionKind?: StreamVodLibraryObservation["kind"],
): StreamVodLibraryObservation | null {
  if (input === null) return null;
  if (!isPlainRecord(input)) throw new Error("Invalid Stream observation projection");
  const kind = projectionKind ?? input.kind;
  if (
    !isPostgresUuid(input.request_id) ||
    !["create_reply", "exact_uid_get", "unique_marker_list_match"].includes(String(kind)) ||
    (projectionKind !== undefined && input.kind !== undefined && input.kind !== projectionKind) ||
    !readNullableString(input.provider_uid, 200) ||
    !readSafeInteger(input.http_status, 100, 599) ||
    !readNullableBoolean(input.signed_urls_reported) ||
    !readNullableBoolean(input.creator_marker_matched) ||
    !readNullableBoolean(input.metadata_marker_matched) ||
    !readNullableBoolean(input.ready_to_stream_reported) ||
    !isSha256(input.evidence_digest)
  ) {
    throw new Error("Invalid Stream observation projection");
  }
  return {
    requestId: input.request_id.toLowerCase(),
    kind: kind as StreamVodLibraryObservation["kind"],
    providerUid: input.provider_uid,
    httpStatus: input.http_status,
    signedUrlsReported: input.signed_urls_reported,
    creatorMarkerMatched: input.creator_marker_matched,
    metadataMarkerMatched: input.metadata_marker_matched,
    readyToStreamReported: input.ready_to_stream_reported,
    evidenceDigest: input.evidence_digest,
  };
}

function parseWork(input: unknown, expectedActorId: string): StreamVodLibraryWork {
  if (!isPlainRecord(input)) throw new Error("Invalid Stream upload work projection");
  assertNoBearerCapability(input, "work");
  const registry = input.registry;
  const transport = input.transport;
  const eligibility = input.eligibility;
  if (!isPlainRecord(registry) || !isPlainRecord(transport) || !isPlainRecord(eligibility)) {
    throw new Error("Invalid Stream upload work projection");
  }
  const operationState = input.operation_state;
  const validStates: readonly string[] = [
    "reserved", "create_started", "create_unknown", "created_unverified", "provisional_bound",
    "ready_for_publication", "completed", "canceled", "failed", "cleanup_reserved",
    "delete_started", "delete_unknown", "source_finalizing", "retained",
  ];
  const actorId = input.actor_id;
  const ownerId = input.owner_id;
  const sourceId = input.source_id;
  const originalMetadata = transport.original_metadata;
  if (
    !isPostgresUuid(input.operation_id) || !isPostgresUuid(input.operation_request_id) || !isSha256(input.operation_digest) ||
    !validStates.includes(String(operationState)) || !readSafeInteger(input.operation_revision, 1) ||
    !isPostgresUuid(input.intent_id) || !isPostgresUuid(actorId) || !isPostgresUuid(ownerId) ||
    !isPostgresUuid(sourceId) || actorId.toLowerCase() !== expectedActorId.toLowerCase() ||
    ownerId.toLowerCase() !== expectedActorId.toLowerCase() || input.source_kind !== "video" ||
    !readSafeInteger(input.expected_source_revision, 1) || !readString(input.title, 1, 120) ||
    !readString(input.description, 0, 2_000) || !isSha256(input.file_digest) ||
    !isSha256(input.request_digest) || registry.provider !== "cloudflare_stream" ||
    registry.credential_slot !== STREAM_VOD_LIBRARY_SLOT || !isPostgresUuid(registry.registry_id) ||
    !isCloudflareAccountId(registry.provider_account_id) ||
    !["unverified", "verification_expired", "verified_current"].includes(String(registry.verification_status)) ||
    typeof eligibility.actor_role_eligible !== "boolean" || eligibility.actor_role_eligible !== true ||
    !["coach", "admin"].includes(String(eligibility.actor_role)) ||
    eligibility.actor_tombstoned !== false || eligibility.owner_tombstoned !== false ||
    typeof eligibility.account_verified_current !== "boolean" ||
    !isPostgresUuid(transport.request_id) || !isSha256(transport.request_digest) ||
    !isPostgresUuid(transport.request_marker) ||
    (transport.provider_uid !== null && !isProviderUid(transport.provider_uid)) ||
    !readNullableString(transport.provider_evidence_digest, 64) ||
    (transport.provider_evidence_digest !== null && !isSha256(transport.provider_evidence_digest)) ||
    typeof transport.tus_location_present !== "boolean" ||
    !readNullableString(transport.transport_expires_at, 80) ||
    transport.original_max_duration_seconds !== STREAM_VOD_LIBRARY_MAX_DURATION_SECONDS ||
    transport.original_require_signed_urls !== true || !isPlainRecord(originalMetadata) ||
    typeof input.latest_readback_valid !== "boolean" ||
    typeof input.latest_readback_identity_valid !== "boolean" ||
    typeof input.latest_readback_retryable !== "boolean" || input.provider_post_authorized !== false
  ) {
    throw new Error("Invalid or ineligible Stream upload work projection");
  }
  const canonicalMetadata = {
    request_marker: transport.request_marker,
    source_kind: "video",
    source_id: sourceId.toLowerCase(),
    actor_id: expectedActorId.toLowerCase(),
  };
  if (JSON.stringify(sortRecord(originalMetadata)) !== JSON.stringify(sortRecord(canonicalMetadata))) {
    throw new Error("Stream upload projection metadata does not match its immutable intent");
  }
  if (transport.request_digest !== input.operation_digest) {
    throw new Error("Stream upload projection request digest is inconsistent");
  }

  let createClaim: StreamVodLibraryWork["createClaim"] = null;
  if (input.create_claim !== null) {
    if (!isPlainRecord(input.create_claim) || !isPostgresUuid(input.create_claim.request_id) ||
      input.create_claim.request_digest !== input.operation_digest) {
      throw new Error("Invalid Stream create claim projection");
    }
    createClaim = {
      requestId: input.create_claim.request_id.toLowerCase(),
      requestDigest: input.create_claim.request_digest,
    };
  }

  let finalizationReceipt: StreamVodLibraryWork["finalizationReceipt"] = null;
  if (input.finalization_receipt !== null) {
    const receipt = input.finalization_receipt;
    if (!isPlainRecord(receipt) || !isPostgresUuid(receipt.request_id) || !isSha256(receipt.request_digest) ||
      receipt.terminal_state !== "completed" || !isPlainRecord(receipt.response)) {
      throw new Error("Invalid Stream finalization receipt projection");
    }
    finalizationReceipt = {
      requestId: receipt.request_id.toLowerCase(),
      requestDigest: receipt.request_digest,
      terminalState: "completed",
      response: receipt.response,
    };
  }

  const work: StreamVodLibraryWork = {
    operationId: input.operation_id.toLowerCase(),
    operationDigest: input.operation_digest,
    operationState: operationState as StreamVodLibraryOperationState,
    operationRevision: input.operation_revision,
    intentId: input.intent_id.toLowerCase(),
    actorId: actorId.toLowerCase(),
    ownerId: ownerId.toLowerCase(),
    sourceId: sourceId.toLowerCase(),
    expectedSourceRevision: input.expected_source_revision,
    title: input.title,
    description: input.description,
    fileDigest: input.file_digest,
    requestDigest: input.request_digest,
    registry: {
      registryId: registry.registry_id.toLowerCase(),
      providerAccountId: registry.provider_account_id,
      credentialSlot: STREAM_VOD_LIBRARY_SLOT,
      verificationStatus: registry.verification_status as StreamVodLibraryRegistryProjection["verificationStatus"],
      verificationValid: eligibility.account_verified_current,
    },
    transport: {
      requestId: transport.request_id.toLowerCase(),
      requestDigest: transport.request_digest,
      requestMarker: transport.request_marker.toLowerCase(),
      providerUid: transport.provider_uid,
      providerEvidenceDigest: transport.provider_evidence_digest,
      tusLocationPresent: transport.tus_location_present,
      transportExpiresAt: transport.transport_expires_at,
      originalMaxDurationSeconds: transport.original_max_duration_seconds,
      originalRequireSignedUrls: transport.original_require_signed_urls,
      originalMetadata: canonicalMetadata,
    },
    createClaim,
    latestObservation: parseObservation(input.latest_observation),
    // The 615 projection selects only exact_uid_get rows here and intentionally omits kind.
    latestExactUidGet: parseObservation(input.latest_exact_uid_get, "exact_uid_get"),
    finalizationReceipt,
    actorRole: eligibility.actor_role as StreamVodLibraryRole,
    actorRoleEligible: eligibility.actor_role_eligible,
    accountVerifiedCurrent: eligibility.account_verified_current,
    latestReadbackValid: input.latest_readback_valid,
    latestReadbackIdentityValid: input.latest_readback_identity_valid,
    latestReadbackRetryable: input.latest_readback_retryable,
    providerPostAuthorized: false,
  };
  if (work.createClaim && work.createClaim.requestDigest !== work.operationDigest) {
    throw new Error("Stream create claim digest does not match operation");
  }
  if (work.operationState === "completed" &&
    (!work.finalizationReceipt || work.finalizationReceipt.response.video_id !== work.sourceId ||
      work.finalizationReceipt.response.outcome !== "ready_for_publication")) {
    throw new Error("Completed Stream work is missing its matching receipt");
  }
  return work;
}

function sortRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

export function parseStreamVodLibraryWorkProjection(
  input: unknown,
  expectedActorId: string,
): StreamVodLibraryWorkProjection | null {
  if (!isPlainRecord(input) || typeof input.outcome !== "string") return null;
  if (input.outcome === "work_available" || input.outcome === "recovery_required" || input.outcome === "completed") {
    if (!input.work) return null;
    return {
      kind: "work",
      outcome: input.outcome,
      work: parseWork(input.work, expectedActorId),
      readbackRetryAllowed: input.readback_retry_allowed === true,
    };
  }
  if (["account_unverified", "account_identity_inconsistent", "account_deleting", "not_eligible", "unavailable",
    "operation_inconsistent", "observation_conflict", "source_changed", "source_fence_changed", "canceled_or_cleanup_held"].includes(input.outcome)) {
    return {
      kind: "blocked",
      outcome: input.outcome,
      registryId: isPostgresUuid(input.registry_id) ? input.registry_id.toLowerCase() : undefined,
      providerAccountId: isCloudflareAccountId(input.provider_account_id) ? input.provider_account_id : undefined,
      credentialSlot: typeof input.credential_slot === "string" ? input.credential_slot : undefined,
      verificationStatus: typeof input.verification_status === "string" ? input.verification_status : undefined,
    };
  }
  return null;
}

export function encodeStreamVodLibraryTusMetadata(
  work: StreamVodLibraryWork,
  expiresAt: string,
): string {
  const values: Record<string, string | null> = {
    name: work.title,
    requiresignedurls: null,
    maxdurationseconds: String(STREAM_VOD_LIBRARY_MAX_DURATION_SECONDS),
    expiry: expiresAt,
    request_marker: work.transport.requestMarker,
    source_kind: "video",
    source_id: work.sourceId,
    actor_id: work.actorId,
  };
  return Object.entries(values)
    .map(([key, value]) => value === null ? key : `${key} ${Buffer.from(value, "utf8").toString("base64")}`)
    .join(",");
}

export function isAllowedStreamTusLocation(input: unknown, expectedAccountId: string): input is string {
  if (!readString(input, 1, 4_096)) return false;
  let location: URL;
  try {
    location = new URL(input);
  } catch {
    return false;
  }
  if (location.protocol !== "https:" || location.username || location.password || location.port || location.hash) {
    return false;
  }
  if (location.hostname === "api.cloudflare.com") {
    if (!isCloudflareAccountId(expectedAccountId)) return false;
    const prefix = `/client/v4/accounts/${expectedAccountId}/stream/`;
    return location.pathname.startsWith(prefix) &&
      /^[A-Za-z0-9_-]{1,200}$/.test(location.pathname.slice(prefix.length));
  }
  if (location.hostname === "upload.videodelivery.net") {
    return /^\/[A-Za-z0-9_-]{16,200}\/?$/.test(location.pathname);
  }
  return false;
}

export function parseStreamVodLibraryCapability(
  input: unknown,
  work: StreamVodLibraryWork,
): { location: string; expiresAt: string } | null {
  if (!isPlainRecord(input) || input.outcome !== "available" ||
    !isAllowedStreamTusLocation(input.tus_location, work.registry.providerAccountId) ||
    typeof input.expires_at !== "string" || !Number.isFinite(Date.parse(input.expires_at)) ||
    input.max_duration_seconds !== STREAM_VOD_LIBRARY_MAX_DURATION_SECONDS ||
    input.require_signed_urls !== true || !isPlainRecord(input.metadata)) {
    return null;
  }
  if (
    input.metadata.request_marker !== work.transport.requestMarker ||
    input.metadata.source_kind !== "video" || input.metadata.source_id !== work.sourceId ||
    input.metadata.actor_id !== work.actorId ||
    (work.transport.transportExpiresAt !== null &&
      Date.parse(String(work.transport.transportExpiresAt)) !== Date.parse(input.expires_at))
  ) return null;
  return { location: input.tus_location, expiresAt: input.expires_at };
}

export function parseStreamVodLibraryStatus(input: unknown): {
  state: StreamVodLibraryOperationState;
  revision: number;
} | null {
  if (!isPlainRecord(input) || input.outcome !== "available" ||
    !["reserved", "create_started", "create_unknown", "created_unverified", "provisional_bound",
      "ready_for_publication", "completed", "canceled", "failed", "cleanup_reserved", "delete_started",
      "delete_unknown", "source_finalizing", "retained"].includes(String(input.operation_state)) ||
    !readSafeInteger(input.operation_revision, 1)) return null;
  return { state: input.operation_state as StreamVodLibraryOperationState, revision: input.operation_revision };
}

export function isStreamVodLibraryInput(input: unknown): input is {
  requestId: string;
  title: string;
  description: string;
  fileDigest: string;
} {
  if (!isPlainRecord(input)) return false;
  return isPostgresUuid(input.requestId) &&
    readString(input.title, 1, 120) && input.title.trim().length > 0 &&
    readString(input.description, 0, 2_000) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.description) &&
    isSha256(input.fileDigest);
}

export function isValidStreamVodLibraryUploadLength(input: unknown): input is number {
  return readSafeInteger(input, 1, STREAM_VOD_LIBRARY_MAX_FILE_BYTES);
}
