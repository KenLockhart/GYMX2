import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRealtimeKitApi,
  readRealtimeKitConfiguration,
  type RealtimeKitConfiguration,
} from "./realtimekit-server";

const config: RealtimeKitConfiguration = {
  accountId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  appId: "d38fce57-073a-4d5a-9cad-73e4d75f28a1",
  apiToken: "synthetic-realtime-token",
  hostPreset: "host",
  observerPreset: "observer",
  consentedPreset: "consented",
};
const meetingId = "d38fce57-073a-4d5a-9cad-73e4d75f28a1";
const participantId = "7a86f017-8ad2-47a2-84c5-863fc9ba5cab";

function uuidFrom(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function jsonResponse(data: unknown, paging?: unknown) {
  return new Response(JSON.stringify({ success: true, data, ...(paging ? { paging } : {}) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function jwt(payload: Record<string, unknown>) {
  return `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

describe("RealtimeKit REST adapter", () => {
  it("requires a valid separate configuration bound to the existing live Stream account", () => {
    const env = {
      CLOUDFLARE_REALTIMEKIT_ACCOUNT_ID: config.accountId,
      CLOUDFLARE_REALTIMEKIT_APP_ID: config.appId,
      CLOUDFLARE_REALTIMEKIT_API_TOKEN: config.apiToken,
      CLOUDFLARE_REALTIMEKIT_HOST_PRESET: config.hostPreset,
      CLOUDFLARE_REALTIMEKIT_OBSERVER_PRESET: config.observerPreset,
      CLOUDFLARE_REALTIMEKIT_CONSENTED_PRESET: config.consentedPreset,
      CLOUDFLARE_LIVE_ACCOUNT_ID: config.accountId,
    } as unknown as NodeJS.ProcessEnv;
    expect(readRealtimeKitConfiguration(env)?.accountId).toBe(config.accountId);
    expect(readRealtimeKitConfiguration({
      ...env,
      CLOUDFLARE_LIVE_ACCOUNT_ID: uuidFrom(9).replaceAll("-", "").slice(0, 32),
    } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("reads top-level paging and reconciles every meeting page", async () => {
    const urls: URL[] = [];
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: uuidFrom(index + 1),
      title: index === 0 ? "gymx2-group:target" : `other-${index}`,
      status: "ACTIVE",
    }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      urls.push(url);
      return url.searchParams.get("page_no") === "0"
        ? jsonResponse(firstPage, { start_offset: 1, end_offset: 100, total_count: 101 })
        : jsonResponse([
            { id: uuidFrom(101), title: "gymx2-group:target", status: "ACTIVE" },
          ], { start_offset: 101, end_offset: 101, total_count: 101 });
    });
    const api = createRealtimeKitApi(config, fetcher as typeof fetch);

    await expect(api.listMeetingsByTitle("gymx2-group:target")).resolves.toHaveLength(2);
    expect(urls.map((url) => url.searchParams.get("page_no"))).toEqual(["0", "1"]);
    expect(urls[0].searchParams.get("per_page")).toBe("100");
  });

  it("fails closed on incomplete or gapped pagination", async () => {
    const fetcher = vi.fn(async () => jsonResponse([
      { id: uuidFrom(1), title: "gymx2-group:target", status: "ACTIVE" },
    ], { start_offset: 2, end_offset: 2, total_count: 2 }));
    const api = createRealtimeKitApi(config, fetcher as typeof fetch);
    await expect(api.listMeetingsByTitle("gymx2-group:target")).rejects.toThrow(/pagination has a gap/i);
  });

  it("validates participant-token scope and sends refresh expiry at the documented top level", async () => {
    const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const bodyValues: unknown[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) bodyValues.push(JSON.parse(String(init.body)));
      return jsonResponse({
        id: participantId,
        custom_participant_id: "opaque-idempotency-tag:3",
        preset_name: "consented",
        token: jwt({
          meetingId,
          participantId,
          exp: Math.floor(Date.parse(expiresOn) / 1000),
        }),
      });
    });
    const api = createRealtimeKitApi(config, fetcher as typeof fetch);
    const created = await api.addParticipant({
      meetingId,
      customParticipantId: "opaque-idempotency-tag:3",
      presetName: "consented",
      name: "Member",
      expiresOn,
    });
    expect(created.participant.id).toBe(participantId);
    expect(bodyValues[0]).toEqual({
      custom_participant_id: "opaque-idempotency-tag:3",
      preset_name: "consented",
      name: "Member",
      token: { expires_on: expiresOn },
    });

    await api.refreshParticipantToken({ meetingId, participantId, expiresOn });
    expect(bodyValues[1]).toEqual({ expires_on: expiresOn });
  });

  it("rejects a token scoped to another meeting or participant", async () => {
    const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetcher = vi.fn(async () => jsonResponse({
      id: participantId,
      custom_participant_id: "opaque-idempotency-tag:3",
      preset_name: "consented",
      token: jwt({
        meetingId: uuidFrom(9),
        participantId,
        exp: Math.floor(Date.parse(expiresOn) / 1000),
      }),
    }));
    const api = createRealtimeKitApi(config, fetcher as typeof fetch);
    await expect(api.addParticipant({
      meetingId,
      customParticipantId: "opaque-idempotency-tag:3",
      presetName: "consented",
      name: "Member",
      expiresOn,
    })).rejects.toThrow(/identity did not match/i);
  });

  it("accepts missing custom IDs for unrelated participants without losing paging guarantees", async () => {
    const fetcher = vi.fn(async () => jsonResponse([
      { id: participantId, preset_name: "host" },
      { id: uuidFrom(2), custom_participant_id: "target", preset_name: "consented" },
    ], { start_offset: 1, end_offset: 2, total_count: 2 }));
    const api = createRealtimeKitApi(config, fetcher as typeof fetch);
    await expect(api.listParticipantsByCustomId(meetingId, "target")).resolves.toEqual([
      { id: uuidFrom(2), customParticipantId: "target", presetName: "consented" },
    ]);
  });

  it("accepts only webinar-stage presets with the intended publisher and moderation boundaries", async () => {
    const presetDefinitions = new Map<string, Record<string, unknown>>([
      [uuidFrom(1), {
        id: uuidFrom(1),
        config: { view_type: "WEBINAR" },
        permissions: {
          stage_enabled: true,
          stage_access: "ALLOWED",
          media: { audio: { can_produce: "ALLOWED" }, video: { can_produce: "ALLOWED" }, screenshare: { can_produce: "NOT_ALLOWED" } },
          can_record: false,
          can_livestream: false,
          disable_participant_audio: true,
          disable_participant_video: true,
          kick_participant: true,
          can_accept_production_requests: true,
          can_change_participant_permissions: true,
        },
      }],
      [uuidFrom(2), {
        id: uuidFrom(2),
        config: { view_type: "WEBINAR" },
        permissions: {
          stage_enabled: true,
          stage_access: "NOT_ALLOWED",
          media: { audio: { can_produce: "NOT_ALLOWED" }, video: { can_produce: "NOT_ALLOWED" }, screenshare: { can_produce: "NOT_ALLOWED" } },
          can_record: false,
          can_livestream: false,
          disable_participant_audio: false,
          disable_participant_video: false,
          kick_participant: false,
          can_accept_production_requests: false,
          can_change_participant_permissions: false,
        },
      }],
      [uuidFrom(3), {
        id: uuidFrom(3),
        config: { view_type: "WEBINAR" },
        permissions: {
          stage_enabled: true,
          stage_access: "CAN_REQUEST",
          media: { audio: { can_produce: "CAN_REQUEST" }, video: { can_produce: "CAN_REQUEST" }, screenshare: { can_produce: "NOT_ALLOWED" } },
          can_record: false,
          can_livestream: false,
          disable_participant_audio: false,
          disable_participant_video: false,
          kick_participant: false,
          can_accept_production_requests: false,
          can_change_participant_permissions: false,
        },
      }],
    ]);
    const names = ["host", "observer", "consented"];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const pathParts = url.pathname.split("/");
      if (pathParts.at(-1) === "presets") {
        return jsonResponse(names.map((name, index) => ({ id: uuidFrom(index + 1), name })), {
          start_offset: 1,
          end_offset: 3,
          total_count: 3,
        });
      }
      const preset = presetDefinitions.get(pathParts.at(-1) ?? "");
      return jsonResponse(preset);
    });
    const api = createRealtimeKitApi(config, fetcher as typeof fetch);
    await expect(api.verifyPresetDefinitions()).resolves.toBe(true);

    const unsafeObserver = presetDefinitions.get(uuidFrom(2)) as Record<string, unknown>;
    (unsafeObserver.permissions as Record<string, unknown>).kick_participant = true;
    await expect(api.verifyPresetDefinitions()).resolves.toBe(false);
  });

  it("verifies meeting inactivity after the PATCH and accepts empty 204 responses", async () => {
    const statuses = ["ACTIVE", "INACTIVE"];
    const methods: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "PATCH") return new Response(null, { status: 204 });
      return jsonResponse({ id: meetingId, title: "gymx2-group:room", status: statuses.shift() });
    });
    const api = createRealtimeKitApi(config, fetcher as typeof fetch);
    await expect(api.setMeetingInactive(meetingId)).resolves.toBe(true);
    expect(methods).toEqual(["GET", "PATCH", "GET"]);
  });
});
