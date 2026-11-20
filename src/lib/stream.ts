import "server-only";
import { encodeUploadMetadata } from "./tus";
import type { VideoStatus } from "./types";

const MAX_DURATION_SECONDS = 2 * 60 * 60;
const UPLOAD_WINDOW_MS = 6 * 60 * 60 * 1000;
const VIDEO_UID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CREATOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function videoUidPath(uid: string) {
  if (typeof uid !== "string" || !VIDEO_UID_PATTERN.test(uid))
    throw new Error("Invalid Cloudflare video identifier.");
  return encodeURIComponent(uid);
}

function getStreamEnv() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_TOKEN;
  const customerCode = process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
  return accountId && token && customerCode
    ? { accountId, token, customerCode }
    : null;
}

export function isStreamConfigured() {
  return getStreamEnv() !== null;
}

function requireStreamEnv() {
  const env = getStreamEnv();
  if (!env)
    throw new Error("Missing Cloudflare Stream settings. See .env.example.");
  return env;
}

function getLiveStreamEnv() {
  const override = {
    accountId: process.env.CLOUDFLARE_LIVE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_LIVE_STREAM_TOKEN,
    customerCode: process.env.CLOUDFLARE_LIVE_CUSTOMER_CODE,
  };
  const hasOverride = Object.values(override).some(
    (value) => value !== undefined,
  );
  if (hasOverride) {
    return Object.values(override).every(
      (value) => typeof value === "string" && value.length > 0,
    )
      ? {
          accountId: override.accountId!,
          token: override.token!,
          customerCode: override.customerCode!,
        }
      : null;
  }
  return getStreamEnv();
}

function requireLiveStreamEnv() {
  const env = getLiveStreamEnv();
  if (!env)
    throw new Error(
      "Missing complete Cloudflare Live Stream settings. See .env.example.",
    );
  return env;
}

function streamRequest(path: string, init: RequestInit = {}) {
  const { accountId, token } = requireStreamEnv();
  return fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream${path}`,
    {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      cache: "no-store",
    },
  );
}

function liveStreamRequest(path: string, init: RequestInit = {}) {
  const { accountId, token } = requireLiveStreamEnv();
  return fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream${path}`,
    {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      cache: "no-store",
    },
  );
}

export function isLiveStreamConfigured() {
  return getLiveStreamEnv() !== null;
}

export function hasDedicatedLiveStreamConfig() {
  return [
    process.env.CLOUDFLARE_LIVE_ACCOUNT_ID,
    process.env.CLOUDFLARE_LIVE_STREAM_TOKEN,
    process.env.CLOUDFLARE_LIVE_CUSTOMER_CODE,
  ].every((value) => typeof value === "string" && value.length > 0);
}

export function getLiveStreamCustomerCode() {
  const env = getLiveStreamEnv();
  if (!env)
    throw new Error(
      "Missing complete Cloudflare Live Stream settings. See .env.example.",
    );
  return env.customerCode;
}

export function getLiveStreamAccountId() {
  const env = getLiveStreamEnv();
  if (!env)
    throw new Error(
      "Missing complete Cloudflare Live Stream settings. See .env.example.",
    );
  return env.accountId;
}

// The browser sends the file straight to this one-time address, so the API token never leaves the server.
export async function createUpload(input: {
  length: string;
  title: string;
  creatorId: string;
  maxDurationSeconds?: number;
}) {
  const response = await streamRequest("?direct_user=true", {
    method: "POST",
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": input.length,
      "Upload-Creator": input.creatorId,
      "Upload-Metadata": encodeUploadMetadata({
        name: input.title,
        requiresignedurls: null,
        maxDurationSeconds: String(
          input.maxDurationSeconds ?? MAX_DURATION_SECONDS,
        ),
        expiry: new Date(Date.now() + UPLOAD_WINDOW_MS).toISOString(),
      }),
    },
  });

  const location = response.headers.get("Location");
  const uid = response.headers.get("stream-media-id");
  if (!response.ok || !location || !uid) {
    throw new Error(`Cloudflare refused the upload (${response.status}).`);
  }
  return { location, uid };
}

export async function getVideoState(uid: string): Promise<{
  status: VideoStatus;
  durationSeconds: number | null;
}> {
  const response = await streamRequest(`/${videoUidPath(uid)}`);
  if (response.status === 404)
    return { status: "failed", durationSeconds: null };
  if (!response.ok)
    throw new Error(
      `Cloudflare couldn't check the video (${response.status}).`,
    );

  const { result } = await response.json();
  const state: string | undefined = result.status?.state;
  const status: VideoStatus = result.readyToStream
    ? "ready"
    : state === "error"
      ? "failed"
      : state === "pendingupload" || state === "downloading"
        ? "uploading"
        : "processing";
  return {
    status,
    durationSeconds: result.duration > 0 ? result.duration : null,
  };
}

// Links expire after an hour, so a shared link stops working. Fine for up to 1,000 plays a day;
// Cloudflare recommends switching to a signing key above that.
export async function getPlayerUrl(uid: string) {
  const response = await streamRequest(`/${videoUidPath(uid)}/token`, {
    method: "POST",
  });
  if (!response.ok)
    throw new Error(
      `Cloudflare couldn't start the video (${response.status}).`,
    );

  const { result } = await response.json();
  const { customerCode } = requireStreamEnv();
  return `https://customer-${customerCode}.cloudflarestream.com/${result.token}/iframe`;
}

// A still from the video, through the same short-lived token as playback.
export async function getThumbnailUrl(uid: string) {
  const response = await streamRequest(`/${videoUidPath(uid)}/token`, {
    method: "POST",
  });
  if (!response.ok)
    throw new Error(
      `Cloudflare couldn't make a thumbnail link (${response.status}).`,
    );
  const { result } = await response.json();
  const { customerCode } = requireStreamEnv();
  return `https://customer-${customerCode}.cloudflarestream.com/${result.token}/thumbnails/thumbnail.jpg?time=2s&height=360&fit=crop`;
}

type VideoCreatorLookup =
  | { exists: false; creatorId: null }
  | { exists: true; creatorId: string | null };

async function lookupVideoCreator(uid: string): Promise<VideoCreatorLookup> {
  const response = await streamRequest(`/${videoUidPath(uid)}`);
  if (response.status === 404) return { exists: false, creatorId: null };
  if (!response.ok)
    throw new Error(
      `Cloudflare couldn't verify the video owner (${response.status}).`,
    );

  const body = (await response.json()) as {
    result?: { creator?: unknown } | null;
  };
  const creatorId = body.result?.creator;
  return {
    exists: true,
    creatorId:
      typeof creatorId === "string" && creatorId.length > 0
        ? creatorId
        : null,
  };
}

// Who started an upload (set from the signed-in person when the upload began).
export async function getVideoCreator(uid: string) {
  const result = await lookupVideoCreator(uid);
  return result.exists ? result.creatorId : null;
}

export async function deleteVideo(uid: string, expectedCreatorId: string) {
  const path = videoUidPath(uid);
  if (
    typeof expectedCreatorId !== "string" ||
    !CREATOR_ID_PATTERN.test(expectedCreatorId)
  )
    throw new Error("The expected video owner is invalid.");

  // The database row that references a UID is not proof that the provider UID belongs to the
  // same person. Verify the authoritative Cloudflare creator before every VOD delete.
  const ownership = await lookupVideoCreator(uid);
  if (!ownership.exists) return;
  if (ownership.creatorId !== expectedCreatorId)
    throw new Error("Cloudflare video ownership could not be confirmed.");

  const response = await streamRequest(`/${path}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Cloudflare couldn't delete the video (${response.status}).`,
    );
  }
}

// Live inputs for coach broadcasts. The browser publishes over WebRTC (WHIP) and viewers play
// over WebRTC (WHEP). Cloudflare doesn't record WebRTC broadcasts.
export async function createLiveInput(
  name: string,
  options: { privatePlayback?: boolean } = {},
) {
  const response = await liveStreamRequest("/live_inputs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      meta: { name },
      recording: {
        mode: "off",
        ...(options.privatePlayback ? { requireSignedURLs: true } : {}),
      },
    }),
  });
  if (!response.ok)
    throw new Error(
      `Cloudflare couldn't create the live room (${response.status}).`,
    );
  const { result } = await response.json();
  const playbackUrl: string | undefined = result?.webRTCPlayback?.url;
  if (!result?.uid || !playbackUrl)
    throw new Error("Cloudflare didn't return a WebRTC playback address.");
  return { uid: result.uid as string, playbackUrl };
}

// The secret address the coach's browser streams to. Only ever sent to the session's coach.
export async function getLiveIngestUrl(uid: string) {
  const response = await liveStreamRequest(`/live_inputs/${encodeURIComponent(uid)}`);
  if (!response.ok)
    throw new Error(
      `Cloudflare couldn't open the live room (${response.status}).`,
    );
  const { result } = await response.json();
  const url: string | undefined = result?.webRTC?.url;
  if (!url)
    throw new Error("Cloudflare didn't return a WebRTC broadcast address.");
  return url;
}

// Private cleanup can retry after a delete request succeeded but its database acknowledgement
// failed. Read only the harmless metadata name to confirm an existing UID still belongs to the
// exact cleanup job before trying another delete; never return provider URLs or credentials.
export async function getLiveInputMetaName(uid: string): Promise<string | null> {
  if (!uid || uid.length > 64)
    throw new Error("A valid live input identifier is required.");
  const response = await liveStreamRequest(
    `/live_inputs/${encodeURIComponent(uid)}`,
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `Cloudflare couldn't check the live room (${response.status}).`,
    );
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object")
    throw new Error("Cloudflare returned invalid live room metadata.");
  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object")
    throw new Error("Cloudflare returned invalid live room metadata.");
  const meta = (result as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object")
    throw new Error("Cloudflare returned invalid live room metadata.");
  const name = (meta as { name?: unknown }).name;
  if (typeof name !== "string")
    throw new Error("Cloudflare returned invalid live room metadata.");
  return name;
}

export async function deleteLiveInput(uid: string) {
  const response = await liveStreamRequest(`/live_inputs/${encodeURIComponent(uid)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Cloudflare couldn't close the live room (${response.status}).`,
    );
  }
}

// Reconcile an expired provider-provision lease that failed before its UID could be
// persisted. Cloudflare's Live Inputs list endpoint does not document cursor/page
// parameters, so do one bounded API list request with include_counts and fail closed
// unless Cloudflare confirms the returned row count is complete. The caller must keep
// cleanup pending otherwise; absence was not established safely.
export async function findLiveInputsByMetaName(metaName: string): Promise<string[]> {
  if (!metaName || metaName.length > 120)
    throw new Error("A valid live input metadata name is required.");

  const response = await liveStreamRequest("/live_inputs?include_counts=true");
  if (!response.ok)
    throw new Error(
      `Cloudflare couldn't list live rooms (${response.status}).`,
    );

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object")
    throw new Error("Cloudflare returned an invalid live room list.");
  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object")
    throw new Error("Cloudflare returned an invalid live room list.");
  const list = result as {
    liveInputs?: unknown;
    total?: unknown;
  };
  if ((payload as { success?: unknown }).success === false)
    throw new Error("Cloudflare couldn't list live rooms.");
  if (!Array.isArray(list.liveInputs))
    throw new Error("Cloudflare returned an invalid live room list.");

  const returnedCount = list.liveInputs.length;
  const total = typeof list.total === "number" ? list.total : null;
  if (total === null || !Number.isSafeInteger(total) || total < 0)
    throw new Error("Cloudflare didn't confirm the live room count.");
  if (total !== returnedCount) {
    throw new Error("Cloudflare's live room list was incomplete.");
  }

  const matches: string[] = [];
  for (const item of list.liveInputs) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as {
      meta?: unknown;
      uid?: unknown;
    };
    if (
      !candidate.meta ||
      typeof candidate.meta !== "object" ||
      (candidate.meta as { name?: unknown }).name !== metaName
    )
      continue;
    if (typeof candidate.uid !== "string" || !candidate.uid)
      throw new Error("Cloudflare returned a live room without an identifier.");
    matches.push(candidate.uid);
  }
  return matches;
}
