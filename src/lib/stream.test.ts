import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
  vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", "test-token");
  vi.stubEnv("CLOUDFLARE_STREAM_CUSTOMER_CODE", "test-customer");
  vi.stubEnv("CLOUDFLARE_LIVE_ACCOUNT_ID", "live-account");
  vi.stubEnv("CLOUDFLARE_LIVE_STREAM_TOKEN", "live-token");
  vi.stubEnv("CLOUDFLARE_LIVE_CUSTOMER_CODE", "live-customer");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        result: {
          uid: "synthetic-input",
          webRTCPlayback: { url: "https://stream.test/playback" },
        },
      }),
      { status: 200 },
    ),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("createLiveInput playback privacy", () => {
  it("keeps existing group broadcasts unrecorded and otherwise unchanged", async () => {
    const { createLiveInput } = await import("./stream");

    await createLiveInput("Group session");

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({
      meta: { name: "Group session" },
      recording: { mode: "off" },
    });
    expect(fetchMock.mock.calls[0][0]).toContain("/accounts/live-account/");
  });

  it("leaves VOD lookups on the existing Cloudflare account and customer code", async () => {
    const { getPlayerUrl } = await import("./stream");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { token: "short-lived-token" } })),
    );

    await expect(getPlayerUrl("synthetic-video")).resolves.toBe(
      "https://customer-test-customer.cloudflarestream.com/short-lived-token/iframe",
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/test-account/stream/synthetic-video/token",
    );
  });

  it("requires signed URLs only when private one-on-one playback is requested", async () => {
    const { createLiveInput } = await import("./stream");

    await createLiveInput("Private session", { privatePlayback: true });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.recording).toEqual({
      mode: "off",
      requireSignedURLs: true,
    });
  });
});

describe("live stream configuration", () => {
  it("falls back to the existing video config only when no live override is set", async () => {
    delete process.env.CLOUDFLARE_LIVE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_LIVE_STREAM_TOKEN;
    delete process.env.CLOUDFLARE_LIVE_CUSTOMER_CODE;
    const { getLiveStreamAccountId, getLiveStreamCustomerCode, isLiveStreamConfigured } =
      await import("./stream");

    expect(isLiveStreamConfigured()).toBe(true);
    expect(getLiveStreamAccountId()).toBe("test-account");
    expect(getLiveStreamCustomerCode()).toBe("test-customer");
  });

  it("requires a complete dedicated override instead of mixing partial settings", async () => {
    const { createLiveInput, hasDedicatedLiveStreamConfig, isLiveStreamConfigured } =
      await import("./stream");
    vi.stubEnv("CLOUDFLARE_LIVE_STREAM_TOKEN", "");

    expect(hasDedicatedLiveStreamConfig()).toBe(false);
    expect(isLiveStreamConfigured()).toBe(false);
    await expect(createLiveInput("Should not call Cloudflare")).rejects.toThrow(
      "Missing complete Cloudflare Live Stream settings",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes the dedicated customer code for WebRTC playback URL construction", async () => {
    const {
      getLiveStreamAccountId,
      getLiveStreamCustomerCode,
      hasDedicatedLiveStreamConfig,
    } =
      await import("./stream");

    expect(hasDedicatedLiveStreamConfig()).toBe(true);
    expect(getLiveStreamAccountId()).toBe("live-account");
    expect(getLiveStreamCustomerCode()).toBe("live-customer");
  });
});

describe("findLiveInputsByMetaName", () => {
  it("returns only UIDs whose metadata name exactly matches the provider tag", async () => {
    const { findLiveInputsByMetaName } = await import("./stream");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            liveInputs: [
              { uid: "exact-uid", meta: { name: "private:tag" } },
              { uid: "prefix-uid", meta: { name: "private:tag-extra" } },
              { uid: "other-uid", meta: { name: "unrelated" } },
            ],
            range: 1_000,
            total: 3,
          },
        }),
      ),
    );

    await expect(findLiveInputsByMetaName("private:tag")).resolves.toEqual([
      "exact-uid",
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/live-account/stream/live_inputs?include_counts=true",
    );
  });

  it("fails closed when the confirmed total exceeds the returned list", async () => {
    const { findLiveInputsByMetaName } = await import("./stream");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            liveInputs: [{ uid: "one-uid", meta: { name: "unrelated" } }],
            range: 1,
            total: 2,
          },
        }),
      ),
    );

    await expect(findLiveInputsByMetaName("private:tag")).rejects.toThrow(
      "Cloudflare's live room list was incomplete",
    );
  });

  it("fails closed when include_counts did not return a total", async () => {
    const { findLiveInputsByMetaName } = await import("./stream");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            liveInputs: [],
          },
        }),
      ),
    );

    await expect(findLiveInputsByMetaName("private:tag")).rejects.toThrow(
      "Cloudflare didn't confirm the live room count",
    );
  });

  it("fails when Cloudflare cannot verify the live input list", async () => {
    const { findLiveInputsByMetaName } = await import("./stream");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));

    await expect(findLiveInputsByMetaName("private:tag")).rejects.toThrow(
      "Cloudflare couldn't list live rooms (503)",
    );
  });
});

describe("getLiveInputMetaName", () => {
  it("returns metadata name only for an existing input", async () => {
    const { getLiveInputMetaName } = await import("./stream");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            uid: "input-id",
            meta: { name: "exact-provider-tag" },
            webRTC: { url: "https://secret.example/ingest" },
            webRTCPlayback: { url: "https://secret.example/playback" },
          },
        }),
      ),
    );

    await expect(getLiveInputMetaName("input-id")).resolves.toBe(
      "exact-provider-tag",
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/live-account/stream/live_inputs/input-id",
    );
  });

  it("treats only a 404 as already absent and throws on provider errors", async () => {
    const { getLiveInputMetaName } = await import("./stream");
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));

    await expect(getLiveInputMetaName("deleted-input")).resolves.toBeNull();
    await expect(getLiveInputMetaName("unknown-input")).rejects.toThrow(
      "Cloudflare couldn't check the live room (503)",
    );
  });
});
