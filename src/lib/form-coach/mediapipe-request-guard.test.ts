import { describe, expect, it, vi } from "vitest";
import { FORM_COACH_ASSET_PATHS } from "./detector-loader";
import { installMediaPipeRequestGuard } from "./mediapipe-request-guard";

class FakeXmlHttpRequest {
  method = "";
  url = "";
  body: unknown;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body?: unknown) {
    this.body = body;
  }
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
}

describe("MediaPipe Worker request guard", () => {
  it("permits only exact same-origin asset GETs and forces credential-free no-redirect requests", async () => {
    const fetch = vi.fn(async () => new Response("asset", { status: 200 }));
    const scope = {
      location: { origin: "https://gym.test" },
      fetch,
      XMLHttpRequest: FakeXmlHttpRequest,
    } as unknown as Parameters<typeof installMediaPipeRequestGuard>[0];
    const guard = installMediaPipeRequestGuard(scope);

    const response = await scope.fetch(FORM_COACH_ASSET_PATHS.liteModel);
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://gym.test${FORM_COACH_ASSET_PATHS.liteModel}`);
    expect(init).toMatchObject({
      method: "GET",
      mode: "same-origin",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(guard.getSummary()).toEqual({
      allowedAssetGets: 1,
      allowed: [{ method: "GET", host: "gym.test", path: FORM_COACH_ASSET_PATHS.liteModel, count: 1 }],
      blocked: [],
    });
  });

  it("blocks external POST, XHR, beacon, WebSocket and importScripts without logging bodies or query strings", async () => {
    const fetch = vi.fn(async () => new Response("unexpected", { status: 200 }));
    const navigator = { sendBeacon: vi.fn(() => true) };
    const scope = {
      location: { origin: "https://gym.test" },
      fetch,
      XMLHttpRequest: FakeXmlHttpRequest,
      WebSocket: FakeWebSocket,
      navigator,
      importScripts: vi.fn(),
    } as unknown as Parameters<typeof installMediaPipeRequestGuard>[0];
    const guard = installMediaPipeRequestGuard(scope);

    await expect(scope.fetch("https://odml.pa.googleapis.com/v1/log?apiKey=private", { method: "POST", body: "private-body" })).rejects.toThrow();
    const Xhr = scope.XMLHttpRequest as unknown as typeof XMLHttpRequest;
    const xhr = new Xhr();
    expect(() => xhr.open("POST", "https://odml.pa.googleapis.com/v1/log")).toThrow();
    expect(scope.navigator?.sendBeacon?.("https://odml.pa.googleapis.com/v1/log?token=private", "private-body")).toBe(false);
    const Socket = scope.WebSocket as unknown as typeof WebSocket;
    expect(() => new Socket("wss://odml.pa.googleapis.com/log")).toThrow();
    expect(() => scope.importScripts?.("https://odml.pa.googleapis.com/worker.js")).toThrow();
    expect(fetch).not.toHaveBeenCalled();

    const audit = guard.getSummary();
    expect(audit.allowedAssetGets).toBe(0);
    expect(audit.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "POST", host: "odml.pa.googleapis.com", path: "/v1/log", count: 3 }),
      expect.objectContaining({ method: "WEBSOCKET", host: "odml.pa.googleapis.com", path: "/log", count: 1 }),
      expect.objectContaining({ method: "IMPORTSCRIPT", host: "odml.pa.googleapis.com", path: "/worker.js", count: 1 }),
    ]));
    expect(JSON.stringify(audit)).not.toContain("private");
    expect(JSON.stringify(audit)).not.toContain("private-body");
  });

  it("denies query variants even when the asset path itself is allowlisted", async () => {
    const fetch = vi.fn(async () => new Response("unexpected", { status: 200 }));
    const scope = { location: { origin: "https://gym.test" }, fetch } as unknown as Parameters<typeof installMediaPipeRequestGuard>[0];
    const guard = installMediaPipeRequestGuard(scope);
    await expect(scope.fetch(`${FORM_COACH_ASSET_PATHS.liteModel}?download=1`)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(guard.getSummary().blocked[0]).toMatchObject({ method: "GET", host: "gym.test", path: FORM_COACH_ASSET_PATHS.liteModel });
  });
});
