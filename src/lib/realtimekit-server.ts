import "server-only";

import { z } from "zod";

const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
const providerIdSchema = uuidSchema;
const presetNameSchema = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;

export type RealtimeKitConfiguration = {
  accountId: string;
  appId: string;
  apiToken: string;
  hostPreset: string;
  observerPreset: string;
  consentedPreset: string;
};

export type RealtimeKitMeeting = {
  id: string;
  title: string;
  status: "ACTIVE" | "INACTIVE";
};

export type RealtimeKitParticipant = {
  id: string;
  customParticipantId: string;
  presetName: string;
};

export class RealtimeKitApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "RealtimeKitApiError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readRealtimeKitConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): RealtimeKitConfiguration | null {
  const raw = {
    accountId: env.CLOUDFLARE_REALTIMEKIT_ACCOUNT_ID,
    appId: env.CLOUDFLARE_REALTIMEKIT_APP_ID,
    apiToken: env.CLOUDFLARE_REALTIMEKIT_API_TOKEN,
    hostPreset: env.CLOUDFLARE_REALTIMEKIT_HOST_PRESET,
    observerPreset: env.CLOUDFLARE_REALTIMEKIT_OBSERVER_PRESET,
    consentedPreset: env.CLOUDFLARE_REALTIMEKIT_CONSENTED_PRESET,
  };
  if (Object.values(raw).some((value) => !value)) return null;

  const accountId = z.string().regex(/^[0-9a-fA-F]{32}$/).safeParse(raw.accountId);
  const appId = providerIdSchema.safeParse(raw.appId);
  const apiToken = z.string().min(1).max(512).safeParse(raw.apiToken);
  const hostPreset = presetNameSchema.safeParse(raw.hostPreset);
  const observerPreset = presetNameSchema.safeParse(raw.observerPreset);
  const consentedPreset = presetNameSchema.safeParse(raw.consentedPreset);
  if (
    !accountId.success ||
    !appId.success ||
    !apiToken.success ||
    !hostPreset.success ||
    !observerPreset.success ||
    !consentedPreset.success
  )
    return null;
  const liveAccountId = env.CLOUDFLARE_LIVE_ACCOUNT_ID?.trim().toLowerCase();
  if (liveAccountId && accountId.data.toLowerCase() !== liveAccountId) return null;
  if (
    new Set([hostPreset.data, observerPreset.data, consentedPreset.data]).size !== 3
  )
    return null;

  return {
      accountId: accountId.data.toLowerCase(),
    appId: appId.data,
    apiToken: apiToken.data,
    hostPreset: hostPreset.data,
    observerPreset: observerPreset.data,
    consentedPreset: consentedPreset.data,
  };
}

function parseMeeting(value: unknown): RealtimeKitMeeting {
  if (!record(value)) throw new RealtimeKitApiError("Invalid meeting response.");
  const id = providerIdSchema.safeParse(value.id);
  const title = z.string().min(1).max(256).safeParse(value.title);
  const status = z.enum(["ACTIVE", "INACTIVE"]).safeParse(value.status);
  if (!id.success || !title.success || !status.success)
    throw new RealtimeKitApiError("Invalid meeting response.");
  return { id: id.data, title: title.data, status: status.data };
}

function parseParticipant(value: unknown): RealtimeKitParticipant {
  if (!record(value))
    throw new RealtimeKitApiError("Invalid participant response.");
  const id = providerIdSchema.safeParse(value.id);
  const customParticipantId = z.string().min(1).max(160).safeParse(
    value.custom_participant_id,
  );
  const presetName = presetNameSchema.safeParse(value.preset_name);
  if (!id.success || !customParticipantId.success || !presetName.success)
    throw new RealtimeKitApiError("Invalid participant response.");
  return {
    id: id.data,
    customParticipantId: customParticipantId.data,
    presetName: presetName.data,
  };
}

function parseListedParticipant(value: unknown): RealtimeKitParticipant {
  if (!record(value))
    throw new RealtimeKitApiError("Invalid participant list response.");
  const id = providerIdSchema.safeParse(value.id);
  const customParticipantId = typeof value.custom_participant_id === "string"
    ? value.custom_participant_id
    : "";
  const presetName = presetNameSchema.safeParse(value.preset_name);
  if (!id.success || !presetName.success)
    throw new RealtimeKitApiError("Invalid participant list response.");
  return { id: id.data, customParticipantId, presetName: presetName.data };
}

type CloudflareResponse = {
  success: true;
  data: unknown;
  paging?: unknown;
};

function parseEnvelope(value: unknown): CloudflareResponse {
  if (!record(value) || value.success !== true || !("data" in value))
    throw new RealtimeKitApiError("RealtimeKit returned an invalid response.");
  return { success: true, data: value.data, paging: value.paging };
}

function pageState(value: CloudflareResponse) {
  if (!record(value.paging) || !Array.isArray(value.data))
    throw new RealtimeKitApiError("RealtimeKit returned an incomplete list.");
  const paging = value.paging;
  const start = paging.start_offset;
  const end = paging.end_offset;
  const total = paging.total_count;
  if (
    typeof start !== "number" ||
    !Number.isSafeInteger(start) ||
    typeof end !== "number" ||
    !Number.isSafeInteger(end) ||
    typeof total !== "number" ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    total < 0 ||
    end > total ||
    (total === 0 && (start !== 0 && start !== 1 || end !== 0)) ||
    (total > 0 && (start < 1 || end < start))
  ) {
    throw new RealtimeKitApiError("RealtimeKit returned invalid pagination data.");
  }
  if ((total === 0 && value.data.length !== 0) ||
      (total > 0 && value.data.length !== end - start + 1))
    throw new RealtimeKitApiError("RealtimeKit returned an incomplete page.");
  return { data: value.data as unknown[], start, end, total };
}

function tokenMatchesScope(
  token: string,
  expiresOn: string,
  meetingId: string,
  participantId: string,
) {
  const segments = token.split(".");
  if (segments.length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    );
    if (!record(payload) || typeof payload.exp !== "number" ||
        payload.meetingId !== meetingId || payload.participantId !== participantId)
      return false;
    const expMs = payload.exp * 1000;
    const requestedMs = Date.parse(expiresOn);
    return Number.isFinite(expMs) && expMs > Date.now() && expMs <= requestedMs + 5_000;
  } catch {
    return false;
  }
}

export function createRealtimeKitApi(
  configuration: RealtimeKitConfiguration,
  fetcher: typeof fetch = fetch,
) {
  const baseUrl = `${API_BASE}/${encodeURIComponent(configuration.accountId)}/realtime/kit/${encodeURIComponent(configuration.appId)}`;

  async function request(
    path: string,
    init: Pick<RequestInit, "method" | "body"> = {},
    allowNotFound = false,
  ): Promise<CloudflareResponse | null> {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${configuration.apiToken}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new RealtimeKitApiError("RealtimeKit request failed.");
    }
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok)
      throw new RealtimeKitApiError("RealtimeKit request failed.", response.status);

    if (response.status === 204) return { success: true, data: null };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RealtimeKitApiError("RealtimeKit returned an invalid response.");
    }
    return parseEnvelope(payload);
  }

  async function getMeeting(meetingId: string) {
    const id = providerIdSchema.parse(meetingId);
    const response = await request(`/meetings/${encodeURIComponent(id)}`);
    return parseMeeting(response?.data);
  }

  async function listMeetingsByTitle(title: string) {
    const cleanTitle = z.string().min(1).max(256).parse(title);
    const matches: RealtimeKitMeeting[] = [];
    let pageNo = 0;
    let expectedTotal: number | null = null;
    let previousEnd = 0;
    let observedCount = 0;
    const observedIds = new Set<string>();

    while (true) {
      const query = new URLSearchParams({
        search: cleanTitle,
        per_page: String(PAGE_SIZE),
        page_no: String(pageNo),
      });
      const raw = await request(`/meetings?${query.toString()}`);
      if (!raw) throw new RealtimeKitApiError("RealtimeKit returned an incomplete list.");
      const page = pageState(raw);
      if (expectedTotal !== null && expectedTotal !== page.total)
        throw new RealtimeKitApiError("RealtimeKit list changed during reconciliation.");
      expectedTotal = page.total;

      if ((page.total === 0 && page.start !== 0 && page.start !== 1) ||
          (page.total > 0 && page.start !== previousEnd + 1))
        throw new RealtimeKitApiError("RealtimeKit meeting pagination has a gap.");

      for (const rawMeeting of page.data) {
        const meeting = parseMeeting(rawMeeting);
        if (observedIds.has(meeting.id))
          throw new RealtimeKitApiError("RealtimeKit meeting pagination repeated an item.");
        observedIds.add(meeting.id);
        if (meeting.title === cleanTitle) matches.push(meeting);
      }
      observedCount += page.data.length;
      if (page.total === 0) return matches;
      if (page.end === page.total) {
        if (observedCount !== page.total)
          throw new RealtimeKitApiError("RealtimeKit meeting pagination was incomplete.");
        return matches;
      }
      if (page.end <= previousEnd || page.data.length === 0)
        throw new RealtimeKitApiError("RealtimeKit meeting pagination did not advance.");
      previousEnd = page.end;
      pageNo += 1;
    }
  }

  async function listPresetDefinitions() {
    const presets: { id: string; name: string }[] = [];
    let pageNo = 0;
    let expectedTotal: number | null = null;
    let previousEnd = 0;
    let observedCount = 0;
    const ids = new Set<string>();
    while (true) {
      const query = new URLSearchParams({
        per_page: String(PAGE_SIZE),
        page_no: String(pageNo),
      });
      const response = await request(`/presets?${query.toString()}`);
      if (!response)
        throw new RealtimeKitApiError("RealtimeKit preset list was incomplete.");
      const page = pageState(response);
      if (expectedTotal !== null && expectedTotal !== page.total)
        throw new RealtimeKitApiError("RealtimeKit preset list changed during verification.");
      expectedTotal = page.total;
      if ((page.total === 0 && page.start !== 0 && page.start !== 1) ||
          (page.total > 0 && page.start !== previousEnd + 1))
        throw new RealtimeKitApiError("RealtimeKit preset pagination has a gap.");
      for (const value of page.data) {
        if (!record(value))
          throw new RealtimeKitApiError("RealtimeKit returned an invalid preset.");
        const id = providerIdSchema.safeParse(value.id);
        const name = z.string().min(1).max(80).safeParse(value.name);
        if (!id.success || !name.success || ids.has(id.data))
          throw new RealtimeKitApiError("RealtimeKit returned an invalid preset.");
        ids.add(id.data);
        presets.push({ id: id.data, name: name.data });
      }
      observedCount += page.data.length;
      if (page.total === 0) return presets;
      if (page.end === page.total) {
        if (observedCount !== page.total)
          throw new RealtimeKitApiError("RealtimeKit preset pagination was incomplete.");
        return presets;
      }
      if (page.end <= previousEnd || page.data.length === 0)
        throw new RealtimeKitApiError("RealtimeKit preset pagination did not advance.");
      previousEnd = page.end;
      pageNo += 1;
    }
  }

  async function listParticipantsByCustomId(meetingId: string, customParticipantId: string) {
    const meeting = providerIdSchema.parse(meetingId);
    const target = z.string().min(1).max(160).parse(customParticipantId);
    const matches: RealtimeKitParticipant[] = [];
    let pageNo = 0;
    let expectedTotal: number | null = null;
    let previousEnd = 0;
    let observedCount = 0;
    const ids = new Set<string>();
    while (true) {
      const query = new URLSearchParams({
        per_page: String(PAGE_SIZE),
        page_no: String(pageNo),
      });
      const response = await request(
        `/meetings/${encodeURIComponent(meeting)}/participants?${query.toString()}`,
      );
      if (!response)
        throw new RealtimeKitApiError("RealtimeKit participant list was incomplete.");
      const page = pageState(response);
      if (expectedTotal !== null && expectedTotal !== page.total)
        throw new RealtimeKitApiError("RealtimeKit participant list changed during reconciliation.");
      expectedTotal = page.total;
      if ((page.total === 0 && page.start !== 0 && page.start !== 1) ||
          (page.total > 0 && page.start !== previousEnd + 1))
        throw new RealtimeKitApiError("RealtimeKit participant pagination has a gap.");
      for (const rawParticipant of page.data) {
        const participant = parseListedParticipant(rawParticipant);
        if (ids.has(participant.id))
          throw new RealtimeKitApiError("RealtimeKit participant pagination repeated an item.");
        ids.add(participant.id);
        if (participant.customParticipantId === target) matches.push(participant);
      }
      observedCount += page.data.length;
      if (page.total === 0) return matches;
      if (page.end === page.total) {
        if (observedCount !== page.total)
          throw new RealtimeKitApiError("RealtimeKit participant pagination was incomplete.");
        return matches;
      }
      if (page.end <= previousEnd || page.data.length === 0)
        throw new RealtimeKitApiError("RealtimeKit participant pagination did not advance.");
      previousEnd = page.end;
      pageNo += 1;
    }
  }

  async function verifyPresetDefinitions() {
    const names = [configuration.hostPreset, configuration.observerPreset, configuration.consentedPreset];
    if (new Set(names).size !== names.length) return false;
    const listed = await listPresetDefinitions();
    const selected = names.map((name) => listed.filter((preset) => preset.name === name));
    if (selected.some((matches) => matches.length !== 1)) return false;
    const [hostId, observerId, consentedId] = selected.map((matches) => matches[0].id);
    const [hostResponse, observerResponse, consentedResponse] = await Promise.all([
      request(`/presets/${encodeURIComponent(hostId)}`),
      request(`/presets/${encodeURIComponent(observerId)}`),
      request(`/presets/${encodeURIComponent(consentedId)}`),
    ]);
    const parsePreset = (response: CloudflareResponse | null) => {
      const data = response?.data;
      if (!record(data) || !record(data.config) || !record(data.permissions)) return null;
      return { config: data.config, permissions: data.permissions };
    };
    const host = parsePreset(hostResponse);
    const observer = parsePreset(observerResponse);
    const consented = parsePreset(consentedResponse);
    if (!host || !observer || !consented) return false;

    const definition = (value: { config: Record<string, unknown>; permissions: Record<string, unknown> }) => {
      const permissions = value.permissions;
      const media = record(permissions.media) ? permissions.media : null;
      return {
        isWebinarStage: value.config.view_type === "WEBINAR" && permissions.stage_enabled === true,
        stageAccess: permissions.stage_access,
        audio: media && record(media.audio) ? media.audio.can_produce : null,
        video: media && record(media.video) ? media.video.can_produce : null,
        screenshare: media && record(media.screenshare) ? media.screenshare.can_produce : null,
        canRecord: permissions.can_record,
        canLivestream: permissions.can_livestream,
        canDisableAudio: permissions.disable_participant_audio,
        canDisableVideo: permissions.disable_participant_video,
        canKick: permissions.kick_participant,
        canAcceptProductionRequests: permissions.can_accept_production_requests,
        canChangeParticipantPermissions: permissions.can_change_participant_permissions,
      };
    };
    const h = definition(host);
    const o = definition(observer);
    const c = definition(consented);
    return (
      h.isWebinarStage && h.stageAccess === "ALLOWED" && h.audio === "ALLOWED" &&
      h.video === "ALLOWED" && h.screenshare === "NOT_ALLOWED" &&
      h.canRecord === false && h.canLivestream === false && h.canDisableAudio === true &&
      h.canDisableVideo === true && h.canKick === true && h.canAcceptProductionRequests === true &&
      h.canChangeParticipantPermissions === true &&
      o.isWebinarStage && o.stageAccess === "NOT_ALLOWED" && o.audio === "NOT_ALLOWED" &&
      o.video === "NOT_ALLOWED" && o.screenshare === "NOT_ALLOWED" &&
      o.canRecord === false && o.canLivestream === false &&
      o.canDisableAudio === false && o.canDisableVideo === false && o.canKick === false &&
      o.canAcceptProductionRequests === false && o.canChangeParticipantPermissions === false &&
      c.isWebinarStage && c.stageAccess === "CAN_REQUEST" && c.audio === "CAN_REQUEST" &&
      c.video === "CAN_REQUEST" && c.screenshare === "NOT_ALLOWED" &&
      c.canRecord === false && c.canLivestream === false && c.canDisableAudio === false &&
      c.canDisableVideo === false && c.canKick === false &&
      c.canAcceptProductionRequests === false && c.canChangeParticipantPermissions === false
    );
  }

  async function createMeeting(title: string) {
    const cleanTitle = z.string().min(1).max(256).parse(title);
    const response = await request("/meetings", {
      method: "POST",
      body: JSON.stringify({
        title: cleanTitle,
        record_on_start: false,
        live_stream_on_start: false,
      }),
    });
    const meeting = parseMeeting(response?.data);
    if (meeting.title !== cleanTitle)
      throw new RealtimeKitApiError("RealtimeKit meeting metadata did not match.");
    return meeting;
  }

  async function addParticipant(input: {
    meetingId: string;
    customParticipantId: string;
    presetName: string;
    name: string;
    expiresOn: string;
  }) {
    const meetingId = providerIdSchema.parse(input.meetingId);
    const response = await request(
      `/meetings/${encodeURIComponent(meetingId)}/participants`,
      {
        method: "POST",
        body: JSON.stringify({
          custom_participant_id: z.string().min(1).max(160).parse(input.customParticipantId),
          preset_name: presetNameSchema.parse(input.presetName),
          name: z.string().trim().min(1).max(120).parse(input.name),
          token: { expires_on: z.iso.datetime().parse(input.expiresOn) },
        }),
      },
    );
    const data = response?.data;
    if (!record(data))
      throw new RealtimeKitApiError("RealtimeKit returned an invalid participant response.");
    const participant = parseParticipant(data);
    const token = z.string().min(1).max(4096).safeParse(data.token);
    const expiresOn = z.iso.datetime().parse(input.expiresOn);
    if (
      !token.success ||
      !tokenMatchesScope(token.data, expiresOn, meetingId, participant.id) ||
      participant.customParticipantId !== input.customParticipantId
    )
      throw new RealtimeKitApiError("RealtimeKit participant identity did not match.");
    return { participant, token: token.data };
  }

  async function getParticipant(meetingId: string, participantId: string) {
    const meeting = providerIdSchema.parse(meetingId);
    const participant = providerIdSchema.parse(participantId);
    const response = await request(
      `/meetings/${encodeURIComponent(meeting)}/participants/${encodeURIComponent(participant)}`,
      {},
      true,
    );
    return !response || response.data === null ? null : parseParticipant(response.data);
  }

  async function refreshParticipantToken(input: {
    meetingId: string;
    participantId: string;
    expiresOn: string;
  }) {
    const meetingId = providerIdSchema.parse(input.meetingId);
    const participantId = providerIdSchema.parse(input.participantId);
    const expiresOn = z.iso.datetime().parse(input.expiresOn);
    const response = await request(
      `/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}/token`,
      {
        method: "POST",
        body: JSON.stringify({ expires_on: expiresOn }),
      },
    );
    const data = response?.data;
    if (!record(data)) throw new RealtimeKitApiError("Invalid token response.");
    const token = z.string().min(1).max(4096).safeParse(data.token);
    if (!token.success || !tokenMatchesScope(token.data, expiresOn, meetingId, participantId))
      throw new RealtimeKitApiError("Invalid token response.");
    return token.data;
  }

  async function deleteParticipant(meetingId: string, participantId: string) {
    const meeting = providerIdSchema.parse(meetingId);
    const participant = providerIdSchema.parse(participantId);
    const response = await request(
      `/meetings/${encodeURIComponent(meeting)}/participants/${encodeURIComponent(participant)}`,
      { method: "DELETE" },
      true,
    );
    return response !== null;
  }

  async function setMeetingInactive(meetingId: string) {
    const id = providerIdSchema.parse(meetingId);
    const current = await getMeeting(id);
    if (current.status === "INACTIVE") return true;
    await request(`/meetings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "INACTIVE" }),
    });
    const confirmed = await getMeeting(id);
    return confirmed.id === id && confirmed.status === "INACTIVE";
  }

  return {
    addParticipant,
    createMeeting,
    deleteParticipant,
    getMeeting,
    getParticipant,
    listParticipantsByCustomId,
    listPresetDefinitions,
    listMeetingsByTitle,
    refreshParticipantToken,
    setMeetingInactive,
    verifyPresetDefinitions,
  };
}
