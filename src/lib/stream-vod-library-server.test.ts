import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createStreamVodLibraryAdapter } from "./stream-vod-library-server";

const ACTOR = "12345678-1234-4234-8234-123456789abc";
const VIDEO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATION = "d6558898-b920-bac8-9f13-9bf12738be84";
const INTENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const REGISTRY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MARKER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const UID = "syntheticUid_12345";
const DIGEST = "a".repeat(64);
const EXPIRY = "2030-11-21T20:00:00.000Z";
const LOCATION = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/opaque-upload-token-123456`;

type HarnessOptions = {
  enabled?: boolean;
  noCredentials?: boolean;
  credentialsAccountId?: string;
  role?: string;
  accountOutcome?: string;
  verificationExpired?: boolean;
  workState?: string;
  providerReplies?: Array<Response | Error>;
  providerTimeoutMs?: number;
  accountVerificationBody?: Response;
  unknownClaim?: boolean;
  unknownTransport?: boolean;
  lostAdvanceReply?: boolean;
  lostCommitReply?: boolean;
  readbackBodies?: Array<Response | Error>;
  metadataMismatch?: boolean;
  creatorMismatch?: boolean;
  ready?: boolean;
};

function registryProjection(expired = false) {
  return {
    outcome: "identity_found",
    registry_id: REGISTRY,
    provider: "cloudflare_stream",
    credential_slot: "vod_primary",
    provider_account_id: ACCOUNT,
    attestation_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    attestation_request_id: "11111111-1111-4111-8111-111111111111",
    attestation_digest: DIGEST,
    attested_at: "2026-11-21T12:00:00Z",
    verification_status: expired ? "verification_expired" : "verified_current",
    verification_valid: !expired,
    verified_until: expired ? "2020-01-01T00:00:00Z" : EXPIRY,
    verification_revision: 1,
    verification_event_id: "22222222-2222-4222-8222-222222222222",
    verification_request_id: "33333333-3333-4333-8333-333333333333",
    verification_observed_at: "2026-11-21T12:00:00Z",
  };
}

function cfEnvelope(result: unknown) {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function workDto(state: string, options: {
  uid?: string | null;
  locationPresent?: boolean;
  latestObservation?: Record<string, unknown> | null;
  latestExact?: Record<string, unknown> | null;
  latestValid?: boolean;
  latestIdentityValid?: boolean;
  retryable?: boolean;
} = {}) {
  const uid = options.uid === undefined ? (state === "reserved" ? null : UID) : options.uid;
  const operationDigest = DIGEST;
  const canonicalMetadata = {
    request_marker: MARKER,
    source_kind: "video",
    source_id: VIDEO,
    actor_id: ACTOR,
  };
  const completed = state === "completed";
  return {
    outcome: completed ? "completed" : (state === "reserved" ? "work_available" : "recovery_required"),
    work: {
      operation_id: OPERATION,
      operation_request_id: "44444444-4444-4444-8444-444444444444",
      operation_digest: operationDigest,
      operation_state: state,
      operation_revision: state === "reserved" ? 1 : 2,
      intent_id: INTENT,
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
        verified_until: EXPIRY,
        verification_revision: 1,
        verification_event_id: "55555555-5555-4555-8555-555555555555",
        verification_request_id: "66666666-6666-4666-8666-666666666666",
      },
      transport: {
        request_id: "77777777-7777-4777-8777-777777777777",
        request_digest: operationDigest,
        request_marker: MARKER,
        provider_uid: uid,
        provider_evidence_digest: uid ? DIGEST : null,
        tus_location_present: options.locationPresent ?? (state !== "reserved"),
        transport_expires_at: options.locationPresent === false ? null : EXPIRY,
        original_max_duration_seconds: 7200,
        original_require_signed_urls: true,
        original_metadata: canonicalMetadata,
      },
      create_claim: state === "reserved" ? null : {
        request_id: "88888888-8888-4888-8888-888888888888",
        request_digest: operationDigest,
        operation_revision: 2,
      },
      latest_observation: options.latestObservation ?? null,
      latest_exact_uid_get: options.latestExact ?? null,
      finalization_receipt: completed ? {
        request_id: "99999999-9999-4999-8999-999999999999",
        request_digest: DIGEST,
        terminal_state: "completed",
        response: { outcome: "ready_for_publication", video_id: VIDEO },
        created_at: EXPIRY,
      } : null,
      eligibility: {
        actor_role: "coach",
        actor_role_eligible: true,
        actor_tombstoned: false,
        owner_tombstoned: false,
        account_verified_current: true,
      },
      profile_fence: {
        source_revision: 1,
        fence_state: completed ? "open" : "closing",
        active_operation_id: completed ? null : OPERATION,
        state_revision: 2,
        matches_active_operation: !completed,
      },
      latest_readback_valid: options.latestValid ?? false,
      latest_readback_identity_valid: options.latestIdentityValid ?? false,
      latest_readback_retryable: options.retryable ?? false,
      provider_post_authorized: false,
    },
  };
}

function readyProviderBody(options: {
  ready?: boolean;
  metadataMismatch?: boolean;
  creatorMismatch?: boolean;
  signedMismatch?: boolean;
  omitOptionalFields?: boolean;
  maxDurationSeconds?: number;
  omitRequiredField?: "uid" | "creator" | "signed" | "canonical";
} = {}) {
  const result: Record<string, unknown> = {
    uid: UID,
    creator: options.creatorMismatch ? "another-creator" : ACTOR,
    requireSignedURLs: options.signedMismatch ? false : true,
    maxDurationSeconds: options.maxDurationSeconds ?? 7200,
    uploadExpiry: EXPIRY,
    readyToStream: options.ready ?? true,
    meta: {
      name: "Lesson one",
      expiry: EXPIRY,
      request_marker: options.metadataMismatch ? "bad-marker" : MARKER,
      source_kind: "video",
      source_id: VIDEO,
      actor_id: ACTOR,
    },
  };
  if (options.omitOptionalFields) {
    delete result.maxDurationSeconds;
    delete result.uploadExpiry;
    delete (result.meta as Record<string, unknown>).expiry;
  }
  if (options.omitRequiredField === "uid") delete result.uid;
  if (options.omitRequiredField === "creator") delete result.creator;
  if (options.omitRequiredField === "signed") delete result.requireSignedURLs;
  if (options.omitRequiredField === "canonical") {
    delete (result.meta as Record<string, unknown>).actor_id;
  }
  return cfEnvelope(result);
}

function stalledBodyResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
    },
    pull() {
      return new Promise<void>(() => undefined);
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
}

function createHarness(options: HarnessOptions = {}) {
  let enabled = options.enabled ?? true;
  let role = options.role ?? "coach";
  let accountExpired = options.verificationExpired ?? false;
  let accountOutcome = options.accountOutcome ?? "identity_found";
  let state = options.workState ?? "reserved";
  let locationPresent = state !== "reserved";
  let providerUid: string | null = state === "reserved" ? null : UID;
  let exactCounter = 0;
  let latestExactRequestId = "";
  let latestExactStatus = 200;
  let latestExactUid: string | null = null;
  let latestExactSigned: boolean | null = null;
  let latestExactCreator: boolean | null = null;
  let latestExactMetadata: boolean | null = null;
  let latestExactReady: boolean | null = null;
  let latestExactDigest = DIGEST;
  let latestExactValid = false;
  let latestExactIdentityValid = false;
  let latestExactRetryable = false;
  let exactConflict = false;
  let completed = state === "completed";
  let claimCalls = 0;
  const providerReplies = [...(options.providerReplies ?? [])];
  const readbackBodies = [...(options.readbackBodies ?? [])];
  let readbackReady = options.ready ?? true;
  let readbackMetadataMismatch = options.metadataMismatch ?? false;
  let readbackCreatorMismatch = options.creatorMismatch ?? false;
  let commitLost = options.lostCommitReply ?? false;
  const transportLost = options.unknownTransport ?? false;
  let advanceLost = options.lostAdvanceReply ?? false;
  const serviceCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const userCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  const activity: string[] = [];
  const observationArguments: Array<Record<string, unknown>> = [];
  const delays: number[] = [];
  const observations: Array<{ kind: string; requestId: string; digest: string }> = [];
  let preparedArgs: Record<string, unknown> | null = null;

  function currentWork() {
    if (exactConflict) return { outcome: "observation_conflict" };
    const latestExact = exactCounter ? {
      observation_id: "aaaaaaaa-0000-4000-8000-000000000001",
      request_id: latestExactRequestId || "aaaaaaaa-0000-4000-8000-000000000002",
      provider_uid: latestExactUid,
      http_status: latestExactStatus,
      signed_urls_reported: latestExactSigned,
      creator_marker_matched: latestExactCreator,
      metadata_marker_matched: latestExactMetadata,
      ready_to_stream_reported: latestExactReady,
      evidence_digest: latestExactDigest,
      observed_at: EXPIRY,
      order_sequence: exactCounter,
    } : null;
    const latestObservation = latestExact ? { ...latestExact, kind: "exact_uid_get" } : null;
    const dto = workDto(state, {
      uid: providerUid,
      locationPresent,
      latestExact,
      latestObservation,
      latestValid: latestExactValid,
      latestIdentityValid: latestExactIdentityValid,
      retryable: latestExactRetryable,
    });
    if (completed) {
      (dto.work as Record<string, unknown>).operation_state = "completed";
      (dto.work as Record<string, unknown>).finalization_receipt = {
        request_id: "99999999-9999-4999-8999-999999999999",
        request_digest: DIGEST,
        terminal_state: "completed",
        response: { outcome: "ready_for_publication", video_id: VIDEO },
        created_at: EXPIRY,
      };
    }
    return dto;
  }

  const context = {
    actor: { id: ACTOR, role },
    userRpc: async (name: string, args: Record<string, unknown>) => {
      userCalls.push({ name, args });
      if (name === "prepare_stream_library_video_upload") {
        if (preparedArgs && Object.entries(args).some(([key, value]) => preparedArgs?.[key] !== value)) {
          return { outcome: "identity_mismatch" };
        }
        preparedArgs = args;
        return {
          outcome: "reserved",
          operation_id: OPERATION,
          source_id: args.target_video_id,
          operation_state: "reserved",
        };
      }
      if (name === "get_stream_media_upload_tus_location") {
        if (!locationPresent || !providerUid) return { outcome: "unavailable" };
        return {
          outcome: "available",
          tus_location: LOCATION,
          expires_at: EXPIRY,
          max_duration_seconds: 7200,
          require_signed_urls: true,
          metadata: {
            request_marker: MARKER,
            source_kind: "video",
            source_id: VIDEO,
            actor_id: ACTOR,
          },
        };
      }
      if (name === "get_stream_media_upload_status") {
        return { outcome: "available", operation_state: state, operation_revision: 2 };
      }
      if (name === "commit_stream_library_video_upload") {
        activity.push("commit");
        if (commitLost) {
          commitLost = false;
          completed = true;
          state = "completed";
          throw new Error("simulated lost response");
        }
        completed = true;
        state = "completed";
        return { outcome: "ready_for_publication", video_id: VIDEO, source_revision: 2 };
      }
      throw new Error(`unexpected user rpc ${name}`);
    },
    serviceRpc: async (name: string, args: Record<string, unknown>) => {
      serviceCalls.push({ name, args });
      if (name === "get_stream_provider_account_projection") {
        if (accountOutcome !== "identity_found") return { outcome: accountOutcome };
        return registryProjection(accountExpired);
      }
      if (name === "record_stream_account_path_verification") {
        accountExpired = false;
        return { outcome: "verified", registry_id: REGISTRY, event_id: ACTOR };
      }
      if (name === "get_stream_library_upload_work") {
        if (accountExpired && state !== "completed") {
          return {
            outcome: "account_unverified",
            registry_id: REGISTRY,
            credential_slot: "vod_primary",
            provider_account_id: ACCOUNT,
            verification_status: "verification_expired",
          };
        }
        return currentWork();
      }
      if (name === "claim_stream_media_create") {
        claimCalls += 1;
        if (claimCalls > 1 || options.unknownClaim) {
          state = "create_started";
          return { outcome: "recovery_required", create_authorized: false, operation_state: state };
        }
        state = "create_started";
        return { outcome: "create_authorized", create_authorized: true, operation_id: OPERATION, operation_revision: 2 };
      }
      if (name === "record_stream_media_upload_observation") {
        const kind = String(args.target_kind);
        observations.push({ kind, requestId: String(args.target_request_id), digest: String(args.target_evidence_digest) });
        if (kind === "exact_uid_get") {
          activity.push("record_exact_uid_get");
          observationArguments.push({ ...args });
          exactCounter += 1;
          latestExactRequestId = String(args.target_request_id);
          latestExactStatus = Number(args.target_http_status);
          latestExactUid = typeof args.target_uid === "string" ? args.target_uid : null;
          latestExactSigned = typeof args.target_signed_urls === "boolean" ? args.target_signed_urls : null;
          latestExactCreator = typeof args.target_creator_match === "boolean" ? args.target_creator_match : null;
          latestExactMetadata = typeof args.target_marker_match === "boolean" ? args.target_marker_match : null;
          latestExactReady = typeof args.target_ready === "boolean" ? args.target_ready : null;
          latestExactDigest = String(args.target_evidence_digest);
          const identityValid = latestExactUid === providerUid && latestExactStatus === 200 &&
            latestExactSigned === true && latestExactCreator === true && latestExactMetadata === true;
          latestExactValid = identityValid && latestExactReady === true;
          latestExactIdentityValid = identityValid;
          const transient = latestExactStatus === 408 || latestExactStatus === 425 || latestExactStatus === 429 ||
            (latestExactStatus >= 500 && latestExactStatus <= 599);
          latestExactRetryable = (transient && latestExactUid === providerUid && latestExactSigned !== false &&
            latestExactCreator !== false && latestExactMetadata !== false) ||
            (identityValid && latestExactReady !== true);
          if (!latestExactValid && !latestExactRetryable) exactConflict = true;
          readbackReady = latestExactReady === true;
        }
        return { outcome: "recorded" };
      }
      if (name === "record_stream_media_upload_transport") {
        if (transportLost) throw new Error("simulated lost record response");
        providerUid = String(args.target_provider_uid);
        locationPresent = typeof args.target_tus_location === "string";
        return { outcome: locationPresent ? "recorded" : "known_uid_location_missing" };
      }
      if (name === "advance_stream_media_upload") {
        const target = String(args.target_next_state);
        state = target;
        if (advanceLost) {
          advanceLost = false;
          throw new Error("simulated lost transition response");
        }
        return { outcome: "advanced", state: target, revision: 3 };
      }
      if (name === "bind_stream_media_upload_readback") {
        activity.push("bind");
        state = "provisional_bound";
        return { outcome: "provisional_bound", publication_ready: false };
      }
      throw new Error(`unexpected service rpc ${name}`);
    },
  };

  const adapter = createStreamVodLibraryAdapter({
    enabled: () => enabled,
    credentials: () => options.noCredentials ? null : ({ accountId: options.credentialsAccountId ?? ACCOUNT, token: "synthetic-provider-token" }),
    openContext: async () => context,
    now: () => Date.parse("2026-11-21T12:00:00.000Z"),
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    providerTimeoutMs: options.providerTimeoutMs ?? 8_000,
    fetch: async (input, init = {}) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.includes("?limit=1")) return options.accountVerificationBody ?? cfEnvelope([]);
      if (init.method === "POST") {
        activity.push("create_post");
        const reply = providerReplies.shift();
        if (reply instanceof Error) throw reply;
        return reply ?? new Response(null, {
          status: 201,
          headers: { "stream-media-id": UID, Location: LOCATION },
        });
      }
      activity.push("exact_uid_get_http");
      const reply = readbackBodies.shift();
      if (reply instanceof Error) throw reply;
      if (reply) return reply;
      return readyProviderBody({ ready: readbackReady, metadataMismatch: readbackMetadataMismatch, creatorMismatch: readbackCreatorMismatch });
    },
  });

  return {
    adapter,
    serviceCalls,
    userCalls,
    fetchCalls,
    delays,
    observations,
    observationArguments,
    activity,
    setRole: (value: string) => { role = value; context.actor.role = value; },
    setEnabled: (value: boolean) => { enabled = value; },
    setState: (value: string) => { state = value; completed = value === "completed"; providerUid = value === "reserved" ? null : UID; locationPresent = value !== "reserved"; },
    setAccountExpired: (value: boolean) => { accountExpired = value; },
    setReadback: (value: { ready?: boolean; metadataMismatch?: boolean; creatorMismatch?: boolean }) => {
      readbackReady = value.ready ?? readbackReady;
      readbackMetadataMismatch = value.metadataMismatch ?? readbackMetadataMismatch;
      readbackCreatorMismatch = value.creatorMismatch ?? readbackCreatorMismatch;
    },
    setAccountOutcome: (value: string) => { accountOutcome = value; },
    claimCount: () => claimCalls,
    state: () => state,
    preparedArgs: () => preparedArgs,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Stream Library server adapter", () => {
  it("checks the feature flag before auth, RPC, or provider access", async () => {
    const harness = createHarness({ enabled: false });
    expect(await harness.adapter.prepare({ requestId: OPERATION, title: "x", description: "", fileDigest: DIGEST })).toMatchObject({ error: "disabled" });
    expect(await harness.adapter.start({ operationId: OPERATION, uploadLengthBytes: 1 })).toMatchObject({ error: "disabled" });
    expect(await harness.adapter.getUploadCapability({ operationId: OPERATION })).toMatchObject({ error: "disabled" });
    expect(await harness.adapter.verifyAndCommit({ operationId: OPERATION })).toMatchObject({ error: "disabled" });
    expect(harness.serviceCalls).toHaveLength(0);
    expect(harness.userCalls).toHaveLength(0);
    expect(harness.fetchCalls).toHaveLength(0);
  });

  it("rejects a member before privileged projections or provider HTTP", async () => {
    const harness = createHarness({ role: "member" });
    const result = await harness.adapter.prepare({ requestId: OPERATION, title: "x", description: "", fileDigest: DIGEST });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(harness.serviceCalls).toHaveLength(0);
    expect(harness.userCalls).toHaveLength(0);
    expect(harness.fetchCalls).toHaveLength(0);
  });

  it("fails closed on a configured-account mismatch without automatic attestation", async () => {
    const harness = createHarness({ accountOutcome: "account_binding_mismatch" });
    const result = await harness.adapter.prepare({ requestId: OPERATION, title: "x", description: "", fileDigest: DIGEST });
    expect(result).toEqual({ ok: false, error: "identity_conflict" });
    expect(harness.serviceCalls.map((call) => call.name)).toEqual(["get_stream_provider_account_projection"]);
    expect(harness.fetchCalls).toHaveLength(0);
    expect(harness.serviceCalls.some((call) => call.name === "record_stream_account_path_verification")).toBe(false);
  });

  it("rejects current work proof for account A under configured account B before mutations or HTTP", async () => {
    const otherAccount = "f".repeat(32);
    const activeStart = createHarness({ credentialsAccountId: otherAccount });
    expect(await activeStart.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 })).toEqual({
      ok: false,
      error: "identity_conflict",
    });
    expect(activeStart.fetchCalls).toHaveLength(0);
    expect(activeStart.serviceCalls.some((call) => [
      "claim_stream_media_create",
      "record_stream_media_upload_transport",
      "record_stream_media_upload_observation",
    ].includes(call.name))).toBe(false);

    const activeVerify = createHarness({ credentialsAccountId: otherAccount, workState: "created_unverified" });
    expect(await activeVerify.adapter.verifyAndCommit({ operationId: OPERATION })).toEqual({
      ok: false,
      error: "identity_conflict",
    });
    expect(activeVerify.fetchCalls).toHaveLength(0);
    expect(activeVerify.serviceCalls.some((call) => call.name === "record_stream_media_upload_observation")).toBe(false);
    expect(activeVerify.serviceCalls.some((call) => call.name === "bind_stream_media_upload_readback")).toBe(false);
    expect(activeVerify.userCalls.some((call) => call.name === "commit_stream_library_video_upload")).toBe(false);
  });

  it("derives a stable prospective video UUID and prepares with only client request facts", async () => {
    const harness = createHarness();
    const input = { requestId: OPERATION, title: "Lesson one", description: "Notes", fileDigest: DIGEST };
    const first = await harness.adapter.prepare(input);
    const second = await harness.adapter.prepare(input);
    if (!first.ok || !second.ok) throw new Error("expected prepared upload result");
    expect(first).toMatchObject({ ok: true, outcome: "prepared", operationId: OPERATION, videoId: harness.preparedArgs()?.target_video_id });
    expect(second).toMatchObject({ ok: true, outcome: "prepared", videoId: first.videoId });
    expect(harness.preparedArgs()).toMatchObject({
      target_request_id: OPERATION,
      target_title: "Lesson one",
      target_description: "Notes",
      target_file_digest: DIGEST,
    });
    expect(harness.preparedArgs()).not.toHaveProperty("target_actor_id");
    expect(harness.preparedArgs()).not.toHaveProperty("target_provider_uid");
    expect(harness.userCalls.filter((call) => call.name === "prepare_stream_library_video_upload")).toHaveLength(2);
  });

  it("denies request UUID reuse when immutable prepare parameters change", async () => {
    const harness = createHarness();
    await harness.adapter.prepare({ requestId: OPERATION, title: "Lesson one", description: "Notes", fileDigest: DIGEST });
    const changed = await harness.adapter.prepare({ requestId: OPERATION, title: "Changed title", description: "Notes", fileDigest: DIGEST });
    expect(changed).toEqual({ ok: false, error: "identity_conflict" });
    expect(harness.fetchCalls).toHaveLength(0);
  });

  it("refreshes an expired account proof only after the fixed-account GET succeeds", async () => {
    const harness = createHarness({ verificationExpired: true });
    const result = await harness.adapter.prepare({ requestId: OPERATION, title: "Lesson one", description: "", fileDigest: DIGEST });
    expect(result.ok).toBe(true);
    expect(harness.fetchCalls.map((call) => call.url)).toEqual([
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream?limit=1`,
    ]);
    expect(harness.serviceCalls.map((call) => call.name)).toContain("record_stream_account_path_verification");
    expect(harness.userCalls.map((call) => call.name)).toContain("prepare_stream_library_video_upload");
  });

  it("bounds account-verification response bodies before any upload claim or provider POST", async () => {
    const harness = createHarness({
      verificationExpired: true,
      accountVerificationBody: stalledBodyResponse(),
      providerTimeoutMs: 15,
    });
    const result = await harness.adapter.start({ operationId: OPERATION, uploadLengthBytes: 32 });
    expect(result).toMatchObject({ ok: false, error: "account_unverified" });
    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.serviceCalls.some((call) => call.name === "record_stream_account_path_verification")).toBe(false);
    expect(harness.serviceCalls.some((call) => call.name === "claim_stream_media_create")).toBe(false);
    expect(harness.serviceCalls.some((call) => call.name === "record_stream_media_upload_transport")).toBe(false);
    expect(harness.serviceCalls.some((call) => call.name === "record_stream_media_upload_observation")).toBe(false);
    expect(harness.fetchCalls.some((call) => call.init.method === "POST")).toBe(false);
  });

  it("allows exactly one POST from one fresh create claim and stores transport before advancing", async () => {
    const harness = createHarness();
    const result = await harness.adapter.start({ operationId: OPERATION, uploadLengthBytes: 1024 });
    expect(result).toMatchObject({ ok: true, outcome: "upload_capability", tusUrl: LOCATION, maxDurationSeconds: 7200, requireSignedUrls: true });
    expect(harness.claimCount()).toBe(1);
    expect(harness.fetchCalls).toHaveLength(1);
    const post = harness.fetchCalls[0];
    expect(post.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream?direct_user=true`);
    expect(post.init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    const headers = new Headers(post.init.headers);
    expect(headers.get("Tus-Resumable")).toBe("1.0.0");
    expect(headers.get("Upload-Length")).toBe("1024");
    expect(headers.get("Upload-Creator")).toBe(ACTOR);
    const names = harness.serviceCalls.map((call) => call.name);
    expect(names.indexOf("record_stream_media_upload_transport")).toBeGreaterThan(-1);
    expect(names.indexOf("record_stream_media_upload_transport")).toBeLessThan(names.indexOf("advance_stream_media_upload"));
  });

  it("never posts again when a previous claim is already present or its reply was lost", async () => {
    const unknownClaim = createHarness({ unknownClaim: true });
    const first = await unknownClaim.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 });
    const second = await unknownClaim.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 });
    expect(first).toMatchObject({ ok: true, outcome: "recovery_required" });
    expect(second).toMatchObject({ ok: true, outcome: "recovery_required" });
    expect(unknownClaim.fetchCalls).toHaveLength(0);

    const lostReply = createHarness({ providerReplies: [new Error("connection lost after dispatch")] });
    expect(await lostReply.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 })).toMatchObject({ outcome: "recovery_required" });
    expect(await lostReply.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 })).toMatchObject({ outcome: "recovery_required" });
    expect(lostReply.fetchCalls).toHaveLength(1);
    expect(lostReply.state()).toBe("create_unknown");
  });

  it("lets concurrent starts race through the database claim but issues only one POST", async () => {
    const harness = createHarness();
    const results = await Promise.all([
      harness.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 }),
      harness.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 }),
    ]);
    expect(harness.claimCount()).toBe(2);
    expect(harness.fetchCalls.filter((call) => call.init.method === "POST")).toHaveLength(1);
    expect(results.some((result) => result.ok && result.outcome === "upload_capability")).toBe(true);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("accepts a 201 with an empty body but requires stream-media-id, never inferring UID from Location", async () => {
    const missingUid = createHarness({
      providerReplies: [new Response(null, { status: 201, headers: { Location: LOCATION } })],
    });
    const missing = await missingUid.adapter.start({ operationId: OPERATION, uploadLengthBytes: 25 });
    expect(missing).toMatchObject({ ok: true, outcome: "recovery_required", state: "create_unknown" });
    expect(missingUid.serviceCalls.some((call) => call.name === "record_stream_media_upload_transport")).toBe(false);
    expect(missingUid.fetchCalls).toHaveLength(1);

    const valid = createHarness();
    expect((await valid.adapter.start({ operationId: OPERATION, uploadLengthBytes: 25 })).ok).toBe(true);
    expect(valid.fetchCalls).toHaveLength(1);
    expect(valid.serviceCalls.find((call) => call.name === "record_stream_media_upload_transport")?.args.target_provider_uid).toBe(UID);
  });

  it("persists a trusted UID without exposing an invalid or missing Location", async () => {
    const missingLocation = createHarness({
      providerReplies: [new Response(null, { status: 201, headers: { "stream-media-id": UID } })],
    });
    const result = await missingLocation.adapter.start({ operationId: OPERATION, uploadLengthBytes: 1024 });
    expect(result).toMatchObject({ ok: true, outcome: "recovery_required" });
    expect(missingLocation.serviceCalls.find((call) => call.name === "record_stream_media_upload_transport")?.args).toMatchObject({
      target_provider_uid: UID,
      target_tus_location: null,
      target_expires_at: null,
    });
    expect(missingLocation.userCalls.some((call) => call.name === "get_stream_media_upload_tus_location")).toBe(false);

    const invalidLocation = createHarness({
      providerReplies: [new Response(null, {
        status: 201,
        headers: { "stream-media-id": UID, Location: "https://attacker.test/upload/token" },
      })],
    });
    expect(await invalidLocation.adapter.start({ operationId: OPERATION, uploadLengthBytes: 1024 })).toMatchObject({ outcome: "recovery_required" });
    expect(invalidLocation.serviceCalls.find((call) => call.name === "record_stream_media_upload_transport")?.args).toMatchObject({
      target_provider_uid: UID,
      target_tus_location: null,
      target_expires_at: null,
    });
    expect(invalidLocation.userCalls.some((call) => call.name === "get_stream_media_upload_tus_location")).toBe(false);
  });

  it("keeps UID-only transport in recovery without treating absent local expiry as a readback mismatch", async () => {
    const uidOnly = createHarness({
      providerReplies: [new Response(null, { status: 201, headers: { "stream-media-id": UID } })],
      readbackBodies: [readyProviderBody({ omitOptionalFields: true })],
    });
    expect(await uidOnly.adapter.start({ operationId: OPERATION, uploadLengthBytes: 1024 })).toMatchObject({
      ok: true,
      outcome: "recovery_required",
    });
    expect(await uidOnly.adapter.verifyAndCommit({ operationId: OPERATION })).toMatchObject({
      ok: true,
      outcome: "ready_for_publication",
      videoId: VIDEO,
    });
    const transport = uidOnly.serviceCalls.find((call) => call.name === "record_stream_media_upload_transport");
    expect(transport?.args).toMatchObject({ target_tus_location: null, target_expires_at: null });
    expect(uidOnly.observations).toHaveLength(2);
    expect(uidOnly.serviceCalls.filter((call) => call.name === "record_stream_media_upload_observation")
      .at(-1)?.args.target_marker_match).toBe(true);
    expect(uidOnly.fetchCalls.filter((call) => call.init.method === "POST")).toHaveLength(1);
    expect(uidOnly.userCalls.some((call) => call.name === "get_stream_media_upload_tus_location")).toBe(false);
  });

  it("does not follow provider redirects and holds malformed exact UID readbacks", async () => {
    const redirected = createHarness({
      providerReplies: [new Response(null, { status: 302, headers: { Location: "https://attacker.test/" } })],
    });
    expect(await redirected.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 })).toMatchObject({ outcome: "recovery_required" });
    expect(redirected.fetchCalls[0].init.redirect).toBe("error");
    expect(redirected.serviceCalls.some((call) => call.name === "record_stream_media_upload_transport")).toBe(false);

    const malformed = createHarness({
      workState: "created_unverified",
      readbackBodies: [
        new Response(JSON.stringify({ success: false, errors: [{ code: 1000 }], result: {} }), { status: 200 }),
        new Response(JSON.stringify({ success: false, errors: [{ code: 1000 }], result: {} }), { status: 200 }),
        new Response(JSON.stringify({ success: false, errors: [{ code: 1000 }], result: {} }), { status: 200 }),
      ],
    });
    expect(await malformed.adapter.verifyAndCommit({ operationId: OPERATION })).toMatchObject({ ok: true, outcome: "recovery_required" });
    expect(malformed.serviceCalls.some((call) => call.name === "record_stream_media_upload_observation")).toBe(false);
    expect(malformed.serviceCalls.some((call) => call.name === "bind_stream_media_upload_readback")).toBe(false);
  });

  it("does not repeat POST when transport persistence is unknown and recovers a lost advance from projection", async () => {
    const transportUnknown = createHarness({ unknownTransport: true });
    expect(await transportUnknown.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 })).toMatchObject({ outcome: "recovery_required" });
    expect(await transportUnknown.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 })).toMatchObject({ outcome: "recovery_required" });
    expect(transportUnknown.fetchCalls).toHaveLength(1);

    const advanceLost = createHarness({ lostAdvanceReply: true });
    expect(await advanceLost.adapter.start({ operationId: OPERATION, uploadLengthBytes: 10 })).toMatchObject({ outcome: "upload_capability" });
    expect(advanceLost.fetchCalls).toHaveLength(1);
    expect(advanceLost.state()).toBe("created_unverified");
  });

  it("uses bounded read-only GET retries and only binds/commits a matching ready exact UID", async () => {
    const transient = createHarness({
      workState: "create_unknown",
      readbackBodies: [new Response(null, { status: 503 }), readyProviderBody()],
    });
    const result = await transient.adapter.verifyAndCommit({ operationId: OPERATION });
    expect(result).toMatchObject({ ok: true, outcome: "ready_for_publication", videoId: VIDEO });
    expect(transient.fetchCalls.map((call) => call.init.method)).toEqual(["GET", "GET"]);
    expect(transient.delays).toEqual([150]);
    expect(transient.observationArguments[0]).toMatchObject({
      target_http_status: 503,
      target_signed_urls: null,
      target_creator_match: null,
      target_marker_match: null,
      target_ready: null,
    });
    expect(transient.serviceCalls.filter((call) => call.name === "bind_stream_media_upload_readback")).toHaveLength(1);
    expect(transient.userCalls.filter((call) => call.name === "commit_stream_library_video_upload")).toHaveLength(1);
  });

  it("does not record incomplete successful identity readbacks and retries until a complete proof", async () => {
    const incompleteBodies = [
      cfEnvelope({ uid: UID }),
      readyProviderBody({ omitRequiredField: "uid" }),
      readyProviderBody({ omitRequiredField: "creator" }),
      readyProviderBody({ omitRequiredField: "signed" }),
      readyProviderBody({ omitRequiredField: "canonical" }),
    ];
    for (const incomplete of incompleteBodies) {
      const harness = createHarness({
        workState: "created_unverified",
        readbackBodies: [incomplete, readyProviderBody()],
      });
      expect(await harness.adapter.verifyAndCommit({ operationId: OPERATION })).toMatchObject({
        ok: true,
        outcome: "ready_for_publication",
        videoId: VIDEO,
      });
      expect(harness.fetchCalls.map((call) => call.init.method)).toEqual(["GET", "GET"]);
      expect(harness.observationArguments).toHaveLength(1);
      expect(harness.observationArguments[0]).toMatchObject({
        target_http_status: 200,
        target_signed_urls: true,
        target_creator_match: true,
        target_marker_match: true,
        target_ready: true,
      });
      expect(harness.activity).toEqual([
        "exact_uid_get_http",
        "exact_uid_get_http",
        "record_exact_uid_get",
        "bind",
        "commit",
      ]);
      expect(harness.serviceCalls.filter((call) => call.name === "bind_stream_media_upload_readback")).toHaveLength(1);
      expect(harness.userCalls.filter((call) => call.name === "commit_stream_library_video_upload")).toHaveLength(1);
    }
  });

  it("accepts canonical readback when optional expiry fields are absent or duration is unknown", async () => {
    for (const body of [
      readyProviderBody({ omitOptionalFields: true }),
      readyProviderBody({ maxDurationSeconds: -1 }),
    ]) {
      const harness = createHarness({ workState: "created_unverified", readbackBodies: [body] });
      expect(await harness.adapter.verifyAndCommit({ operationId: OPERATION })).toMatchObject({
        ok: true,
        outcome: "ready_for_publication",
        videoId: VIDEO,
      });
      const observation = harness.serviceCalls.find((call) => call.name === "record_stream_media_upload_observation");
      expect(observation?.args.target_marker_match).toBe(true);
      expect(observation?.args.target_creator_match).toBe(true);
      expect(observation?.args.target_signed_urls).toBe(true);
    }
  });

  it("bounds exact GET body reads and records no partial observation on timeout", async () => {
    const harness = createHarness({
      workState: "created_unverified",
      readbackBodies: [stalledBodyResponse(), stalledBodyResponse(), stalledBodyResponse()],
      providerTimeoutMs: 15,
    });
    const startedAt = Date.now();
    const result = await harness.adapter.verifyAndCommit({ operationId: OPERATION });
    const elapsedMs = Date.now() - startedAt;
    expect(result).toMatchObject({ ok: true, outcome: "recovery_required" });
    expect(elapsedMs).toBeLessThan(500);
    expect(harness.fetchCalls).toHaveLength(3);
    expect(harness.serviceCalls.some((call) => call.name === "record_stream_media_upload_observation")).toBe(false);
    expect(harness.serviceCalls.some((call) => call.name === "bind_stream_media_upload_readback")).toBe(false);
    expect(harness.userCalls.some((call) => call.name === "commit_stream_library_video_upload")).toBe(false);
  });

  it("keeps a valid but unready UID in read-only recovery without binding or committing", async () => {
    const unready = createHarness({ workState: "created_unverified", ready: false });
    const result = await unready.adapter.verifyAndCommit({ operationId: OPERATION });
    expect(result).toMatchObject({ ok: true, outcome: "upload_not_ready" });
    expect(unready.fetchCalls).toHaveLength(3);
    expect(unready.serviceCalls.filter((call) => call.name === "record_stream_media_upload_observation")).toHaveLength(3);
    expect(unready.serviceCalls.some((call) => call.name === "bind_stream_media_upload_readback")).toBe(false);
    expect(unready.userCalls.some((call) => call.name === "commit_stream_library_video_upload")).toBe(false);
  });

  it("records creator or marker contradictions as a permanent hold", async () => {
    for (const options of [
      { metadataMismatch: true },
      { creatorMismatch: true },
      { readbackBodies: [readyProviderBody({ signedMismatch: true })] },
      { readbackBodies: [readyProviderBody({ maxDurationSeconds: 600 })] },
      { readbackBodies: [readyProviderBody({ omitRequiredField: "creator", metadataMismatch: true })] },
    ]) {
      const conflict = createHarness({ workState: "created_unverified", ...options });
      const result = await conflict.adapter.verifyAndCommit({ operationId: OPERATION });
      expect(result, JSON.stringify(options)).toEqual({ ok: false, error: "identity_conflict" });
      expect(conflict.serviceCalls.some((call) => call.name === "bind_stream_media_upload_readback")).toBe(false);
      expect(conflict.userCalls.some((call) => call.name === "commit_stream_library_video_upload")).toBe(false);
    }
  });

  it("refreshes an expired proof before exact GET and survives a lost commit response by reading its receipt", async () => {
    const expired = createHarness({ workState: "create_unknown", verificationExpired: true, lostCommitReply: true });
    const result = await expired.adapter.verifyAndCommit({ operationId: OPERATION });
    expect(result).toMatchObject({ ok: true, outcome: "completed", videoId: VIDEO });
    expect(expired.fetchCalls[0].url).toContain("?limit=1");
    expect(expired.fetchCalls[1].url).toContain(`/stream/${UID}`);
    expect(expired.serviceCalls.some((call) => call.name === "record_stream_account_path_verification")).toBe(true);
    expect(expired.userCalls.filter((call) => call.name === "commit_stream_library_video_upload")).toHaveLength(1);
  });

  it("recovers a completed receipt without provider HTTP and keeps status flag-independent and URL-free", async () => {
    const complete = createHarness({ workState: "completed", noCredentials: true });
    expect(await complete.adapter.verifyAndCommit({ operationId: OPERATION })).toMatchObject({ ok: true, outcome: "completed" });
    expect(complete.fetchCalls).toHaveLength(0);

    const status = createHarness({ enabled: false, workState: "create_unknown" });
    expect(await status.adapter.status({ operationId: OPERATION })).toMatchObject({ ok: true, outcome: "status", state: "create_unknown" });
    expect(status.fetchCalls).toHaveLength(0);
    expect(status.userCalls.map((call) => call.name)).toEqual(["get_stream_media_upload_status"]);
  });

  it("checks capability ownership through the authenticated RPC and never exposes it through work/status", async () => {
    const harness = createHarness({ workState: "created_unverified" });
    const capability = await harness.adapter.getUploadCapability({ operationId: OPERATION });
    expect(capability).toMatchObject({ ok: true, outcome: "upload_capability", tusUrl: LOCATION });
    expect(harness.userCalls.some((call) => call.name === "get_stream_media_upload_tus_location")).toBe(true);
    const status = await harness.adapter.status({ operationId: OPERATION });
    expect(status).not.toHaveProperty("tusUrl");
  });

  it("rejects malformed requests before service/provider activity", async () => {
    const harness = createHarness();
    expect(await harness.adapter.prepare({ requestId: OPERATION, title: "", description: "", fileDigest: DIGEST })).toMatchObject({ error: "invalid_request" });
    expect(await harness.adapter.start({ operationId: OPERATION, uploadLengthBytes: 0 })).toMatchObject({ error: "invalid_request" });
    expect(await harness.adapter.start({ operationId: OPERATION, uploadLengthBytes: 30 * 1024 * 1024 * 1024 + 1 })).toMatchObject({ error: "invalid_request" });
    expect(harness.serviceCalls).toHaveLength(0);
    expect(harness.fetchCalls).toHaveLength(0);
  });
});
