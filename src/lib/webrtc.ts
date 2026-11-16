// Minimal WHIP (publish) and WHEP (play) clients for Cloudflare Stream, using the browser's own
// WebRTC. Browser only.

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

export class NotLiveYet extends Error {}

function abortError(signal?: AbortSignal) {
  return signal?.reason ?? new DOMException("The live connection was cancelled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal);
}

function deleteResource(resource: string | null) {
  if (resource) void fetch(resource, { method: "DELETE" }).catch(() => {});
}

function waitForIce(
  pc: RTCPeerConnection,
  timeoutMs = 2500,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const check = () => pc.iceGatheringState === "complete" && done();
    const done = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => done(abortError(signal));

    const timer = setTimeout(() => done(), timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
    signal?.addEventListener("abort", onAbort, { once: true });
    check();
  });
}

async function negotiate(
  pc: RTCPeerConnection,
  url: string,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  await pc.setLocalDescription(await pc.createOffer());
  await waitForIce(pc, 2500, signal);
  throwIfAborted(signal);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp,
    signal,
  });
  if (response.status === 404 || response.status === 409)
    throw new NotLiveYet();
  if (!response.ok)
    throw new Error(`The video service answered ${response.status}.`);

  const location = response.headers.get("Location");
  const resource = location ? new URL(location, url).toString() : null;
  try {
    const sdp = await response.text();
    throwIfAborted(signal);
    await pc.setRemoteDescription({ type: "answer", sdp });
    throwIfAborted(signal);
    return resource;
  } catch (error) {
    deleteResource(resource);
    throw error;
  }
}

export type Connection = { pc: RTCPeerConnection; stop: () => void };

function connection(
  pc: RTCPeerConnection,
  resource: string | null,
  cleanup?: () => void,
): Connection {
  let stopped = false;
  return {
    pc,
    stop: () => {
      if (stopped) return;
      stopped = true;
      deleteResource(resource);
      pc.close();
      cleanup?.();
    },
  };
}

export async function publish(
  ingestUrl: string,
  stream: MediaStream,
  options: { signal?: AbortSignal } = {},
): Promise<Connection> {
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    bundlePolicy: "max-bundle",
  });
  for (const track of stream.getTracks())
    pc.addTransceiver(track, { direction: "sendonly" });
  let resource: string | null = null;
  try {
    resource = await negotiate(pc, ingestUrl, options.signal);
    throwIfAborted(options.signal);
    return connection(pc, resource);
  } catch (error) {
    deleteResource(resource);
    pc.close();
    throw error;
  }
}

export async function play(
  playbackUrl: string,
  onStream: (stream: MediaStream) => void,
  options: { signal?: AbortSignal } = {},
): Promise<Connection> {
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    bundlePolicy: "max-bundle",
  });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  const stream = new MediaStream();
  let disposed = false;
  pc.addEventListener("track", (event) => {
    if (disposed || options.signal?.aborted) return;
    if (stream.getTracks().some((track) => track.id === event.track.id)) return;
    stream.addTrack(event.track);
    onStream(stream);
  });
  let resource: string | null = null;
  try {
    resource = await negotiate(pc, playbackUrl, options.signal);
    throwIfAborted(options.signal);
    return connection(pc, resource, () => {
      disposed = true;
      for (const track of stream.getTracks()) track.stop();
    });
  } catch (error) {
    disposed = true;
    deleteResource(resource);
    for (const track of stream.getTracks()) track.stop();
    pc.close();
    throw error;
  }
}
