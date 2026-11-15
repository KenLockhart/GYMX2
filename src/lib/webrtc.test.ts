import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  iceGatheringState: RTCIceGatheringState = "complete";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  transceivers: (string | MediaStreamTrack)[] = [];
  closed = 0;
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer-sdp" }));
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description;
  });
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description;
  });
  addTransceiver = vi.fn((track: string | MediaStreamTrack) => {
    this.transceivers.push(track);
  });
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }
  close() {
    this.closed += 1;
    this.connectionState = "closed";
  }
}

class FakeMediaStream {
  tracks: MediaStreamTrack[] = [];
  getTracks() {
    return this.tracks;
  }
  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
  }
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  FakePeerConnection.instances = [];
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("", { status: 200 }));
  vi.stubGlobal(
    "RTCPeerConnection",
    FakePeerConnection as unknown as typeof RTCPeerConnection,
  );
  vi.stubGlobal("MediaStream", FakeMediaStream);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("WHIP/WHEP connection lifecycle", () => {
  it("publishes the coach's tracks and deletes the negotiated resource only once", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("answer", {
        status: 201,
        headers: { Location: "/session/publish/1" },
      }),
    );
    const video = { id: "video-track", stop: vi.fn() } as unknown as MediaStreamTrack;
    const audio = { id: "audio-track", stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [video, audio] } as unknown as MediaStream;
    const { publish } = await import("./webrtc");

    const connected = await publish("https://stream.test/ingest", stream);
    const peer = FakePeerConnection.instances[0];
    expect(peer.transceivers).toEqual([video, audio]);
    expect(peer.remoteDescription).toEqual({ type: "answer", sdp: "answer" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://stream.test/ingest");

    connected.stop();
    connected.stop();
    await Promise.resolve();
    expect(peer.closed).toBe(1);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://stream.test/ingest", "POST"],
      ["https://stream.test/session/publish/1", "DELETE"],
    ]);
    expect(video.stop).not.toHaveBeenCalled();
    expect(audio.stop).not.toHaveBeenCalled();
  });

  it("plays only once per remote track and stops receiver tracks on cleanup", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("answer", {
        status: 201,
        headers: { Location: "/session/play/1" },
      }),
    );
    const { play } = await import("./webrtc");
    const onStream = vi.fn();
    const connected = await play("https://stream.test/playback", onStream);
    const peer = FakePeerConnection.instances[0];
    const track = { id: "remote-video", stop: vi.fn() } as unknown as MediaStreamTrack;
    const event = { track } as unknown as RTCTrackEvent;
    peer.dispatch("track", event as unknown as Event);
    peer.dispatch("track", event as unknown as Event);
    expect(onStream).toHaveBeenCalledOnce();

    connected.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(peer.closed).toBe(1);
  });

  it.each([404, 409])("treats WHEP status %i as a not-yet-live retry", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("", { status }));
    const { NotLiveYet, play } = await import("./webrtc");
    await expect(play("https://stream.test/playback", () => {})).rejects.toBeInstanceOf(
      NotLiveYet,
    );
    expect(FakePeerConnection.instances[0].closed).toBe(1);
  });

  it("aborts an in-flight negotiation and closes its peer instead of leaking it", async () => {
    fetchMock.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
        once: true,
      });
    }));
    const { publish } = await import("./webrtc");
    const controller = new AbortController();
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const pending = publish("https://stream.test/ingest", stream, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(FakePeerConnection.instances[0].closed).toBe(1);
  });

  it("closes the peer when the provider rejects negotiation", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const { publish } = await import("./webrtc");
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    await expect(publish("https://stream.test/ingest", stream)).rejects.toThrow(
      "The video service answered 503.",
    );
    expect(FakePeerConnection.instances[0].closed).toBe(1);
  });
});
