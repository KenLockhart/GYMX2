// Minimal WHIP (publish) and WHEP (play) clients for Cloudflare Stream, using the browser's own
// WebRTC. Browser only.

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

export class NotLiveYet extends Error {}

function waitForIce(pc: RTCPeerConnection, timeoutMs = 2500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, timeoutMs);
  });
}

// Sends our offer, applies the answer and returns the address that ends the connection.
async function negotiate(pc: RTCPeerConnection, url: string) {
  await pc.setLocalDescription(await pc.createOffer());
  await waitForIce(pc);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp,
  });
  if (response.status === 404 || response.status === 409)
    throw new NotLiveYet();
  if (!response.ok)
    throw new Error(`The video service answered ${response.status}.`);
  await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
  const location = response.headers.get("Location");
  return location ? new URL(location, url).toString() : null;
}

export type Connection = { pc: RTCPeerConnection; stop: () => void };

function connection(
  pc: RTCPeerConnection,
  resource: string | null,
  cleanup?: () => void,
): Connection {
  return {
    pc,
    stop: () => {
      if (resource) void fetch(resource, { method: "DELETE" }).catch(() => {});
      pc.close();
      cleanup?.();
    },
  };
}

export async function publish(
  ingestUrl: string,
  stream: MediaStream,
): Promise<Connection> {
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    bundlePolicy: "max-bundle",
  });
  for (const track of stream.getTracks())
    pc.addTransceiver(track, { direction: "sendonly" });
  try {
    return connection(pc, await negotiate(pc, ingestUrl));
  } catch (error) {
    pc.close();
    throw error;
  }
}

export async function play(
  playbackUrl: string,
  onStream: (stream: MediaStream) => void,
): Promise<Connection> {
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    bundlePolicy: "max-bundle",
  });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  const stream = new MediaStream();
  pc.addEventListener("track", (event) => {
    stream.addTrack(event.track);
    onStream(stream);
  });
  try {
    return connection(pc, await negotiate(pc, playbackUrl));
  } catch (error) {
    pc.close();
    throw error;
  }
}
