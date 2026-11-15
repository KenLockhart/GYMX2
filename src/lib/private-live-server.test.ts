import { createHmac, generateKeyPairSync, verify as verifyBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createLiveInput: vi.fn(),
  deleteLiveInput: vi.fn(),
  findLiveInputsByMetaName: vi.fn(),
  getLiveInputMetaName: vi.fn(),
  getLiveIngestUrl: vi.fn(),
  getLiveStreamAccountId: vi.fn(),
  getLiveStreamCustomerCode: vi.fn(),
  hasDedicatedLiveStreamConfig: vi.fn(),
  isLiveStreamConfigured: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/stream", () => ({
  createLiveInput: mocks.createLiveInput,
  deleteLiveInput: mocks.deleteLiveInput,
  findLiveInputsByMetaName: mocks.findLiveInputsByMetaName,
  getLiveInputMetaName: mocks.getLiveInputMetaName,
  getLiveIngestUrl: mocks.getLiveIngestUrl,
  getLiveStreamAccountId: mocks.getLiveStreamAccountId,
  getLiveStreamCustomerCode: mocks.getLiveStreamCustomerCode,
  hasDedicatedLiveStreamConfig: mocks.hasDedicatedLiveStreamConfig,
  isLiveStreamConfigured: mocks.isLiveStreamConfigured,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import {
  cleanupPrivateLiveInputsAndRecordHeartbeat,
  mintPrivateStreamJwt,
  offerPrivateSession,
  preparePrivateBroadcast,
  privatePlayback,
  readPrivateLiveSession,
  resetSessionToBroadcast,
  verifyLiveCleanupHmac,
} from "./private-live-server";

const sessionId = "d38fce57-073a-4d5a-9cad-73e4d75a7f28";
const grantId = "7a86f017-8ad2-47a2-84c5-863fc9ba5cab";
const coachId = "31dc4305-d759-45a9-9df7-5a91bd681a34";
const memberId = "40708d19-e673-40be-a7e2-7a6078df02a3";
const playbackId = "1234567890abcdef1234567890abcdef";
const accountA = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const accountB = "0123456789abcdef0123456789abcdef";
const providerTag = `gymx2-private:${sessionId}:2:coach`;

function privateSession(mode: "one_on_one" | "broadcast" = "one_on_one") {
  const startsAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString();
  return {
    id: sessionId,
    coach_id: coachId,
    starts_at: startsAt,
    ends_at: endsAt,
    live_mode: mode,
  };
}

function fakeUser(input: {
  session?: ReturnType<typeof privateSession>;
  grant?: Record<string, unknown> | null;
  otherTables?: Record<string, unknown>;
}) {
  const rpc = vi.fn();
  const user = {
    rpc,
    from: vi.fn((table: string) => {
      const data =
        table === "calendar_sessions"
          ? input.session
          : table === "private_session_grants"
            ? input.grant
            : input.otherTables?.[table];
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) {
        query[method] = vi.fn(() => query);
      }
      query.maybeSingle = vi.fn(async () => ({ data: data ?? null, error: null }));
      return query;
    }),
  };
  return user;
}

function fakeAdmin(rpc: ReturnType<typeof vi.fn>, providerState: unknown = null) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data: providerState, error: null }));
  return { rpc, from: vi.fn(() => query) };
}

function validGrant(session = privateSession()) {
  return {
    grant_id: grantId,
    session_id: sessionId,
    generation: 2,
    state: "live",
    expires_at: new Date(Date.parse(session.ends_at) + 60 * 60 * 1000).toISOString(),
    member_camera_allowed: true,
    coach_live_at: new Date().toISOString(),
    member_live_at: null,
  };
}

function signingKey() {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateJwk = pair.privateKey.export({ format: "jwk" });
  return {
    publicKey: pair.publicKey,
    signing: {
      keyId: "synthetic-signing-key",
      jwkValue: JSON.stringify({ ...privateJwk, kid: "synthetic-signing-key" }),
    },
  };
}

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_LIVE_ACCOUNT_ID", accountA);
  vi.stubEnv("CLOUDFLARE_LIVE_STREAM_TOKEN", "synthetic-live-token");
  vi.stubEnv("CLOUDFLARE_LIVE_CUSTOMER_CODE", "synthetic-customer");
  vi.stubEnv("LIVE_CLEANUP_SECRET", "synthetic-cleanup-secret");
  const privateJwk = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "jwk" });
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "synthetic-signing-key");
  vi.stubEnv(
    "CLOUDFLARE_STREAM_SIGNING_KEY_JWK",
    JSON.stringify({ ...privateJwk, kid: "synthetic-signing-key" }),
  );
  mocks.hasDedicatedLiveStreamConfig.mockReturnValue(true);
  mocks.isLiveStreamConfigured.mockReturnValue(true);
  mocks.getLiveStreamAccountId.mockReturnValue(accountA);
  mocks.getLiveStreamCustomerCode.mockReturnValue("synthetic-customer");
  mocks.createLiveInput.mockReset();
  mocks.deleteLiveInput.mockReset().mockResolvedValue(undefined);
  mocks.findLiveInputsByMetaName.mockReset();
  mocks.getLiveInputMetaName.mockReset();
  mocks.getLiveIngestUrl.mockReset();
  mocks.createAdminClient.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("private live server boundaries", () => {
  it("mints a verifiable short-lived RS256 playback JWT with the playback UID as subject", () => {
    const { signing, publicKey } = signingKey();
    const now = 1_800_000_000;
    const token = mintPrivateStreamJwt({
      playbackId,
      expiresAtSeconds: now + 120,
      nowSeconds: now,
      signing,
    });
    const [headerPart, payloadPart, signaturePart] = token.split(".");
    const unsigned = `${headerPart}.${payloadPart}`;
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString());

    expect(header).toEqual({ alg: "RS256", kid: signing.keyId });
    expect(payload).toMatchObject({ sub: playbackId, kid: signing.keyId, exp: now + 120 });
    expect(
      verifyBytes(
        "RSA-SHA256",
        Buffer.from(unsigned),
        publicKey,
        Buffer.from(signaturePart, "base64url"),
      ),
    ).toBe(true);
    expect(() =>
      mintPrivateStreamJwt({
        playbackId,
        expiresAtSeconds: now + 121,
        nowSeconds: now,
        signing,
      }),
    ).toThrow();
  });

  it("verifies exact cleanup HMACs and rejects stale, future, and malformed timestamps", () => {
    const secret = "synthetic-cleanup-secret";
    const nowMs = 1_800_000_000_000;
    const timestamp = String(Math.floor(nowMs / 1000));
    const message = `${timestamp}.GET./api/cron/live-cleanup`;
    const signature = createHmac("sha256", secret).update(message).digest("hex");

    expect(verifyLiveCleanupHmac({ timestamp, signature, secret, nowMs })).toBe(true);
    expect(
      verifyLiveCleanupHmac({
        timestamp,
        signature,
        secret,
        nowMs: nowMs + 5 * 60 * 1000 + 1_000,
      }),
    ).toBe(false);
    expect(
      verifyLiveCleanupHmac({
        timestamp: String(Number(timestamp) + 301),
        signature,
        secret,
        nowMs,
      }),
    ).toBe(false);
    expect(verifyLiveCleanupHmac({ timestamp: "not-a-time", signature, secret, nowMs })).toBe(false);
    expect(verifyLiveCleanupHmac({ timestamp, signature: "0", secret, nowMs })).toBe(false);
  });

  it("does not provision or mint playback for an RLS-hidden member grant, admin, or group room", async () => {
    const member = fakeUser({ session: privateSession(), grant: null });
    const deniedPreparation = await preparePrivateBroadcast(
      member as never,
      { id: memberId, role: "member" },
      sessionId,
      grantId,
    );
    const deniedPlayback = await privatePlayback(
      member as never,
      { id: memberId, role: "member" },
      sessionId,
      grantId,
      2,
    );
    const adminSession = privateSession();
    const admin = fakeUser({ session: adminSession, grant: validGrant(adminSession) });
    const deniedAdmin = await preparePrivateBroadcast(
      admin as never,
      { id: "e4f090f4-4b17-4493-b407-85c42b718f6f", role: "admin" },
      sessionId,
      grantId,
    );
    const groupSession = privateSession("broadcast");
    const group = fakeUser({ session: groupSession, grant: validGrant(groupSession) });
    const deniedGroup = await preparePrivateBroadcast(
      group as never,
      { id: coachId, role: "coach" },
      sessionId,
      grantId,
    );

    expect(deniedPreparation).toEqual({ ok: false, error: "not_allowed" });
    expect(deniedPlayback).toEqual({ ok: false, error: "not_allowed" });
    expect(deniedAdmin).toEqual({ ok: false, error: "not_allowed" });
    expect(deniedGroup).toEqual({ ok: false, error: "wrong_mode" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createLiveInput).not.toHaveBeenCalled();
    expect(mocks.getLiveIngestUrl).not.toHaveBeenCalled();
    expect(member.rpc).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects a coach that does not own the session before provider access", async () => {
    const session = privateSession();
    const user = fakeUser({ session, grant: validGrant(session) });
    const result = await preparePrivateBroadcast(
      user as never,
      { id: "e4f090f4-4b17-4493-b407-85c42b718f6f", role: "coach" },
      sessionId,
      grantId,
    );
    expect(result).toEqual({ ok: false, error: "not_allowed" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createLiveInput).not.toHaveBeenCalled();
  });

  it("fails closed when the authenticated offer RPC reports a stale cleanup heartbeat", async () => {
    const session = privateSession();
    const user = fakeUser({ session, grant: null });
    user.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Private live cleanup is not ready" },
    });
    const adminRpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.createAdminClient.mockReturnValue(fakeAdmin(adminRpc));

    const result = await offerPrivateSession(
      user as never,
      { id: coachId, role: "coach" },
      sessionId,
      memberId,
    );
    expect(result).toEqual({ ok: false, error: "not_ready" });
    expect(user.rpc).toHaveBeenCalledWith(
      "set_session_live_mode",
      expect.objectContaining({ target_mode: "one_on_one" }),
    );
    expect(adminRpc.mock.calls.map(([name]) => name)).toEqual([
      "bind_private_live_account",
      "private_live_account_matches",
    ]);
    expect(mocks.createLiveInput).not.toHaveBeenCalled();
  });

  it("returns to broadcast after cleanup even with multiple invites, while SQL rejects pending cleanup", async () => {
    const session = privateSession();
    const user = fakeUser({
      session,
      otherTables: {
        session_invites: [
          { member_id: memberId },
          { member_id: "e4f090f4-4b17-4493-b407-85c42b718f6f" },
        ],
      },
    });
    user.rpc.mockResolvedValueOnce({ data: null, error: null });

    const reset = await resetSessionToBroadcast(
      user as never,
      { id: coachId, role: "coach" },
      sessionId,
    );

    expect(reset).toEqual({ ok: true, mode: "broadcast" });
    expect(user.from.mock.calls.map(([table]) => table)).toEqual([
      "calendar_sessions",
    ]);
    expect(user.rpc).toHaveBeenCalledWith("set_session_live_mode", {
      target_session_id: sessionId,
      target_mode: "broadcast",
      target_member_id: null,
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.deleteLiveInput).not.toHaveBeenCalled();

    const pending = fakeUser({ session });
    pending.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "Private provider cleanup is pending" },
    });
    const rejected = await resetSessionToBroadcast(
      pending as never,
      { id: coachId, role: "coach" },
      sessionId,
    );
    expect(rejected).toEqual({ ok: false, error: "cleanup_pending" });
  });

  it("allows only the owning coach to read a private session snapshot after its grant is gone", async () => {
    const ownerSession = privateSession();
    const owner = fakeUser({ session: ownerSession, grant: null });
    const ownerResult = await readPrivateLiveSession(
      owner as never,
      { id: coachId, role: "coach" },
      sessionId,
    );
    expect(ownerResult).toEqual({
      ok: true,
      mode: "one_on_one",
      grant: null,
    });

    const nonOwnerSession = {
      ...privateSession(),
      coach_id: "e4f090f4-4b17-4493-b407-85c42b718f6f",
    };
    const nonOwner = fakeUser({ session: nonOwnerSession, grant: null });
    const nonOwnerResult = await readPrivateLiveSession(
      nonOwner as never,
      { id: coachId, role: "coach" },
      sessionId,
    );
    const member = fakeUser({ session: ownerSession, grant: null });
    const memberResult = await readPrivateLiveSession(
      member as never,
      { id: memberId, role: "member" },
      sessionId,
    );
    expect(nonOwnerResult).toEqual({ ok: false, error: "not_allowed" });
    expect(memberResult).toEqual({ ok: false, error: "not_allowed" });
  });

  it("prepares with Cloudflare's opaque WHIP publish secret, distinct from its input UID", async () => {
    const session = privateSession();
    const user = fakeUser({ session, grant: validGrant(session) });
    const publishSecret = "b236bde30eb07b9d01318940e5fc3edake34a3efb3896e18f2dc277ce6cc993ad";
    const playbackUrl = `https://customer-synthetic-customer.cloudflarestream.com/${playbackId}/webRTC/play`;
    const ingestUrl = `https://customer-synthetic-customer.cloudflarestream.com/${publishSecret}/webRTC/publish`;
    const leaseToken = "ac3a13db-f9d1-4f3f-9100-4c606ac09e08";
    const adminRpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({
        data: [{
          session_id: sessionId,
          grant_id: grantId,
          direction: "coach",
          generation: 2,
          lease_token: leaseToken,
          lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
          provider_tag: providerTag,
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.createAdminClient.mockReturnValue(fakeAdmin(adminRpc));
    mocks.createLiveInput.mockResolvedValue({ uid: playbackId, playbackUrl });
    mocks.getLiveIngestUrl.mockResolvedValue(ingestUrl);

    const result = await preparePrivateBroadcast(
      user as never,
      { id: coachId, role: "coach" },
      sessionId,
      grantId,
    );

    expect(result).toEqual({
      ok: true,
      direction: "coach",
      generation: 2,
      leaseToken,
      ingestUrl,
    });
    expect(publishSecret).not.toBe(playbackId);
    expect(mocks.createLiveInput).toHaveBeenCalledWith(providerTag, {
      privatePlayback: true,
    });
    expect(adminRpc.mock.calls.map(([name]) => name)).toEqual([
      "bind_private_live_account",
      "private_live_account_matches",
      "claim_private_live_provision",
      "complete_private_live_provision",
      "complete_private_live_provision",
    ]);
  });

  it("records cleanup heartbeat only after all jobs are confirmed, and retries an already deleted input", async () => {
    const cleanupJob = {
      cleanup_id: "b577be28-df7b-492b-a28a-a4aa530ae5f0",
      session_id: sessionId,
      grant_id: grantId,
      generation: 2,
      direction: "coach",
      lease_token: "ac3a13db-f9d1-4f3f-9100-4c606ac09e08",
      input_uid: playbackId,
      provider_tag: providerTag,
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [cleanupJob], error: null })
      .mockResolvedValueOnce({ data: false, error: new Error("synthetic completion outage") })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [cleanupJob], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc });
    mocks.getLiveInputMetaName
      .mockResolvedValueOnce(providerTag)
      .mockResolvedValueOnce(null);

    const first = await cleanupPrivateLiveInputsAndRecordHeartbeat();
    expect(first).toMatchObject({ ok: false, claimed: 1, completed: 0, heartbeatRecorded: false });
    expect(rpc).toHaveBeenCalledTimes(4);
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "record_private_live_cleanup_heartbeat",
    );

    const second = await cleanupPrivateLiveInputsAndRecordHeartbeat();
    expect(second).toMatchObject({ ok: true, claimed: 1, completed: 1, heartbeatRecorded: true });
    expect(mocks.getLiveInputMetaName).toHaveBeenCalledTimes(2);
    expect(mocks.findLiveInputsByMetaName).not.toHaveBeenCalled();
    expect(mocks.deleteLiveInput).toHaveBeenCalledTimes(1);
    expect(mocks.deleteLiveInput).toHaveBeenCalledWith(playbackId);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "bind_private_live_account",
      "private_live_account_matches",
      "claim_private_live_cleanup_batch",
      "complete_private_live_cleanup",
      "bind_private_live_account",
      "private_live_account_matches",
      "claim_private_live_cleanup_batch",
      "complete_private_live_cleanup",
      "bind_private_live_account",
      "private_live_account_matches",
      "record_private_live_cleanup_heartbeat",
    ]);
  });

  it("does not delete another input that shares the provider tag when a cleanup job names one UID", async () => {
    const cleanupJob = {
      cleanup_id: "b577be28-df7b-492b-a28a-a4aa530ae5f0",
      session_id: sessionId,
      grant_id: grantId,
      generation: 2,
      direction: "coach",
      lease_token: "ac3a13db-f9d1-4f3f-9100-4c606ac09e08",
      input_uid: playbackId,
      provider_tag: providerTag,
    };
    const secondInputUid = "abcdef0123456789abcdef0123456789";
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [cleanupJob], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc });
    mocks.getLiveInputMetaName.mockResolvedValueOnce(providerTag);
    mocks.findLiveInputsByMetaName.mockResolvedValueOnce([
      playbackId,
      secondInputUid,
    ]);

    const result = await cleanupPrivateLiveInputsAndRecordHeartbeat();
    expect(result).toMatchObject({ ok: true, claimed: 1, completed: 1 });
    expect(mocks.deleteLiveInput).toHaveBeenCalledTimes(1);
    expect(mocks.deleteLiveInput).toHaveBeenCalledWith(playbackId);
    expect(mocks.deleteLiveInput).not.toHaveBeenCalledWith(secondInputUid);
    expect(mocks.findLiveInputsByMetaName).not.toHaveBeenCalled();
  });

  it("does no cleanup work or heartbeat when the immutable DB account is A but config is B", async () => {
    vi.stubEnv("CLOUDFLARE_LIVE_ACCOUNT_ID", accountB);
    mocks.getLiveStreamAccountId.mockReturnValue(accountB);
    const rpc = vi.fn().mockResolvedValueOnce({ data: false, error: null });
    mocks.createAdminClient.mockReturnValue(fakeAdmin(rpc));

    const result = await cleanupPrivateLiveInputsAndRecordHeartbeat();

    expect(result).toMatchObject({
      ok: false,
      claimed: 0,
      completed: 0,
      heartbeatRecorded: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("bind_private_live_account", {
      target_account_id: accountB,
    });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "claim_private_live_cleanup_batch",
    );
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "record_private_live_cleanup_heartbeat",
    );
    expect(mocks.getLiveInputMetaName).not.toHaveBeenCalled();
    expect(mocks.findLiveInputsByMetaName).not.toHaveBeenCalled();
    expect(mocks.deleteLiveInput).not.toHaveBeenCalled();
  });
});
