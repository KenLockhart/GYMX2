import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  encodeStreamVodLibraryTusMetadata,
  isAllowedStreamTusLocation,
  isPostgresUuid,
  parseStreamVodLibraryCapability,
  parseStreamVodLibraryRegistryProjection,
  parseStreamVodLibraryWorkProjection,
} from "./stream-vod-library-contracts";

const ACTOR = "12345678-1234-4234-8234-123456789abc";
const VIDEO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATION = "d6558898-b920-bac8-9f13-9bf12738be84";
const MARKER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REGISTRY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DIGEST = "a".repeat(64);
const ACCOUNT = "0123456789abcdef0123456789abcdef";

function workProjection(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "recovery_required",
    work: {
      operation_id: OPERATION,
      operation_request_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      operation_digest: DIGEST,
      operation_state: "created_unverified",
      operation_revision: 2,
      intent_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      actor_id: ACTOR,
      owner_id: ACTOR,
      source_kind: "video",
      source_id: VIDEO,
      expected_source_revision: 1,
      title: "Lesson one",
      description: "A private lesson",
      file_digest: "f".repeat(64),
      request_digest: "b".repeat(64),
      registry: {
        registry_id: REGISTRY,
        provider: "cloudflare_stream",
        credential_slot: "vod_primary",
        provider_account_id: ACCOUNT,
        verification_status: "verified_current",
        verified_until: "2026-11-21T20:00:00.000Z",
        verification_revision: 1,
        verification_event_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        verification_request_id: "11111111-1111-4111-8111-111111111111",
      },
      transport: {
        request_id: "22222222-2222-4222-8222-222222222222",
        request_digest: DIGEST,
        request_marker: MARKER,
        provider_uid: "syntheticUid_12345",
        provider_evidence_digest: DIGEST,
        tus_location_present: true,
        transport_expires_at: "2030-11-21T20:00:00.000Z",
        original_max_duration_seconds: 7200,
        original_require_signed_urls: true,
        original_metadata: {
          request_marker: MARKER,
          source_kind: "video",
          source_id: VIDEO,
          actor_id: ACTOR,
        },
      },
      create_claim: {
        request_id: "33333333-3333-4333-8333-333333333333",
        request_digest: DIGEST,
        operation_revision: 2,
      },
      latest_observation: null,
      latest_exact_uid_get: null,
      finalization_receipt: null,
      eligibility: {
        actor_role: "coach",
        actor_role_eligible: true,
        actor_tombstoned: false,
        owner_tombstoned: false,
        account_verified_current: true,
      },
      profile_fence: {
        source_revision: 1,
        fence_state: "closing",
        active_operation_id: OPERATION,
        state_revision: 2,
        matches_active_operation: true,
      },
      latest_readback_valid: false,
      latest_readback_identity_valid: false,
      latest_readback_retryable: false,
      provider_post_authorized: false,
      ...overrides,
    },
  };
}

describe("Stream Library adapter contracts", () => {
  it("accepts PostgreSQL UUIDs without imposing RFC version or variant bits", () => {
    expect(isPostgresUuid(OPERATION)).toBe(true);
    expect(isPostgresUuid("d6558898-b920-0000-0000-9bf12738be84")).toBe(true);
    expect(isPostgresUuid("not-a-uuid")).toBe(false);
  });

  it("parses only the exact fixed account identity and trusted verification state", () => {
    const account = {
      outcome: "identity_found",
      registry_id: REGISTRY,
      provider: "cloudflare_stream",
      credential_slot: "vod_primary",
      provider_account_id: ACCOUNT,
      attestation_id: ACTOR,
      attestation_request_id: VIDEO,
      attestation_digest: DIGEST,
      attested_at: "2026-11-21T12:00:00Z",
      verification_status: "verified_current",
      verification_valid: true,
      verified_until: "2026-11-21T12:01:00Z",
      verification_revision: 1,
      verification_event_id: VIDEO,
      verification_request_id: ACTOR,
      verification_observed_at: "2026-11-21T12:00:00Z",
    };
    expect(parseStreamVodLibraryRegistryProjection(account, ACCOUNT)?.verificationValid).toBe(true);
    expect(parseStreamVodLibraryRegistryProjection(account, "f".repeat(32))).toBeNull();
    expect(parseStreamVodLibraryRegistryProjection({ ...account, credential_slot: "vod_secondary" }, ACCOUNT)).toBeNull();
  });

  it("keeps exact work IDs and immutable metadata while rejecting any projected bearer URL", () => {
    const projection = parseStreamVodLibraryWorkProjection(workProjection(), ACTOR);
    expect(projection?.kind).toBe("work");
    if (projection?.kind !== "work") throw new Error("expected valid work");
    expect(projection.work.operationId).toBe(OPERATION);
    expect(projection.work.operationState).toBe("created_unverified");
    expect(projection.work.transport.originalMaxDurationSeconds).toBe(7200);
    expect(projection.work.providerPostAuthorized).toBe(false);
    expect(() => parseStreamVodLibraryWorkProjection(workProjection({ tus_location: "https://secret" }), ACTOR)).toThrow();
    expect(() => parseStreamVodLibraryWorkProjection(workProjection({ actor_id: VIDEO }), ACTOR)).toThrow();
    expect(() => parseStreamVodLibraryWorkProjection(workProjection({ provider_post_authorized: true }), ACTOR)).toThrow();
  });

  it("parses the 615 latest exact GET projection without an invented kind field", () => {
    const projection = workProjection();
    const work = (projection as { work: Record<string, unknown> }).work;
    const exactGet = {
      observation_id: "22222222-2222-4222-8222-222222222222",
      request_id: "33333333-3333-4333-8333-333333333333",
      provider_uid: "syntheticUid_12345",
      http_status: 200,
      signed_urls_reported: true,
      creator_marker_matched: true,
      metadata_marker_matched: true,
      ready_to_stream_reported: true,
      evidence_digest: DIGEST,
      observed_at: "2026-11-21T12:00:00Z",
      order_sequence: 1,
    };
    work.latest_exact_uid_get = exactGet;
    work.latest_observation = { ...exactGet, kind: "exact_uid_get" };
    const parsed = parseStreamVodLibraryWorkProjection(projection, ACTOR);
    expect(parsed?.kind).toBe("work");
    if (parsed?.kind !== "work") throw new Error("expected valid work");
    expect(parsed.work.latestExactUidGet?.kind).toBe("exact_uid_get");

    work.latest_exact_uid_get = { ...exactGet, kind: "create_reply" };
    expect(() => parseStreamVodLibraryWorkProjection(projection, ACTOR)).toThrow();
  });

  it("allows only HTTPS TUS URLs on the documented Cloudflare hosts and exact account API path", () => {
    expect(isAllowedStreamTusLocation(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/upload_token_123`, ACCOUNT,
    )).toBe(true);
    expect(isAllowedStreamTusLocation("https://upload.videodelivery.net/a1b2c3d4e5f60789", ACCOUNT)).toBe(true);
    for (const location of [
      "//api.cloudflare.com/client/v4/accounts/" + ACCOUNT + "/stream/x",
      `https://api.cloudflare.com.evil.test/client/v4/accounts/${ACCOUNT}/stream/x`,
      `https://attacker.test/client/v4/accounts/${ACCOUNT}/stream/x`,
      `http://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/x`,
      `https://user:pass@api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/x`,
      `https://api.cloudflare.com:8443/client/v4/accounts/${ACCOUNT}/stream/x`,
      "https://upload.videodelivery.net/too/long/a/path",
    ]) {
      expect(isAllowedStreamTusLocation(location, ACCOUNT)).toBe(false);
    }
  });

  it("encodes the exact fixed Library duration, signed flag, expiry, and server-owned marker fields", () => {
    const parsed = parseStreamVodLibraryWorkProjection(workProjection(), ACTOR);
    if (parsed?.kind !== "work") throw new Error("expected valid work");
    const header = encodeStreamVodLibraryTusMetadata(parsed.work, "2026-11-21T20:00:00.000Z");
    const decoded = Object.fromEntries(header.split(",").map((part) => {
      const [key, value] = part.split(" ");
      return [key, value === undefined ? null : Buffer.from(value, "base64").toString("utf8")];
    }));
    expect(decoded).toEqual({
      name: "Lesson one",
      requiresignedurls: null,
      maxdurationseconds: "7200",
      expiry: "2026-11-21T20:00:00.000Z",
      request_marker: MARKER,
      source_kind: "video",
      source_id: VIDEO,
      actor_id: ACTOR,
    });
  });

  it("rejects capability responses unless location, expiry, duration, signing, and marker match the durable work", () => {
    const parsed = parseStreamVodLibraryWorkProjection(workProjection(), ACTOR);
    if (parsed?.kind !== "work") throw new Error("expected valid work");
    const capability = {
      outcome: "available",
      tus_location: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/upload_token_123`,
      expires_at: parsed.work.transport.transportExpiresAt,
      max_duration_seconds: 7200,
      require_signed_urls: true,
      metadata: parsed.work.transport.originalMetadata,
    };
    expect(parseStreamVodLibraryCapability(capability, parsed.work)).not.toBeNull();
    expect(parseStreamVodLibraryCapability({ ...capability, require_signed_urls: false }, parsed.work)).toBeNull();
    expect(parseStreamVodLibraryCapability({ ...capability, metadata: { ...parsed.work.transport.originalMetadata, actor_id: VIDEO } }, parsed.work)).toBeNull();
    expect(parseStreamVodLibraryCapability({ ...capability, tus_location: "https://evil.test/upload" }, parsed.work)).toBeNull();
  });
});
