import "server-only";
import { encodeUploadMetadata } from "./tus";
import type { VideoStatus } from "./types";

const MAX_DURATION_SECONDS = 2 * 60 * 60;
const UPLOAD_WINDOW_MS = 6 * 60 * 60 * 1000;

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
  const response = await streamRequest(`/${uid}`);
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
  const response = await streamRequest(`/${uid}/token`, { method: "POST" });
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
  const response = await streamRequest(`/${uid}/token`, { method: "POST" });
  if (!response.ok)
    throw new Error(
      `Cloudflare couldn't make a thumbnail link (${response.status}).`,
    );
  const { result } = await response.json();
  const { customerCode } = requireStreamEnv();
  return `https://customer-${customerCode}.cloudflarestream.com/${result.token}/thumbnails/thumbnail.jpg?time=2s&height=360&fit=crop`;
}

export async function deleteVideo(uid: string) {
  const response = await streamRequest(`/${uid}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Cloudflare couldn't delete the video (${response.status}).`,
    );
  }
}

// Live inputs for coach broadcasts. The browser publishes over WebRTC (WHIP) and viewers play
// over WebRTC (WHEP). Cloudflare doesn't record WebRTC broadcasts.
export async function createLiveInput(name: string) {
  const response = await streamRequest("/live_inputs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meta: { name }, recording: { mode: "off" } }),
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
  const response = await streamRequest(`/live_inputs/${uid}`);
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

export async function deleteLiveInput(uid: string) {
  const response = await streamRequest(`/live_inputs/${uid}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Cloudflare couldn't close the live room (${response.status}).`,
    );
  }
}

// Who started an upload (set from the signed-in person when the upload began).
export async function getVideoCreator(uid: string) {
  const response = await streamRequest(`/${uid}`);
  if (!response.ok) return null;
  const { result } = await response.json();
  return (result?.creator as string | undefined) ?? null;
}
