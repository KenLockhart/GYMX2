import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cleanup = vi.hoisted(() => vi.fn());

vi.mock("@/lib/private-live-server", () => ({
  cleanupPrivateLiveInputsAndRecordHeartbeat: cleanup,
  verifyLiveCleanupHmac: vi.fn(async () => false),
}));

import { GET } from "./route";
import { verifyLiveCleanupHmac } from "@/lib/private-live-server";

const secret = "synthetic-cleanup-secret";

function signedHeaders(nowMs = Date.now()) {
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.GET./api/cron/live-cleanup`)
    .digest("hex");
  return {
    "x-gymx2-cleanup-timestamp": timestamp,
    "x-gymx2-cleanup-signature": signature,
  };
}

beforeEach(() => {
  vi.stubEnv("LIVE_CLEANUP_SECRET", secret);
  cleanup.mockReset();
  cleanup.mockResolvedValue({
    ok: true,
    claimed: 0,
    completed: 0,
    heartbeatRecorded: true,
  });
  vi.mocked(verifyLiveCleanupHmac).mockImplementation(({ signature }) =>
    Boolean(signature && /^[0-9a-f]{64}$/.test(signature)),
  );
});

afterEach(() => vi.unstubAllEnvs());

describe("live cleanup cron route", () => {
  it("rejects missing or invalid HMAC credentials before cleanup or database work", async () => {
    vi.stubEnv("LIVE_CLEANUP_SECRET", "");
    const missingSecret = await GET(
      new Request("https://gymx2.com/api/cron/live-cleanup"),
    );
    expect(missingSecret.status).toBe(503);

    vi.stubEnv("LIVE_CLEANUP_SECRET", secret);
    const invalid = await GET(
      new Request("https://gymx2.com/api/cron/live-cleanup", {
        headers: {
          "x-gymx2-cleanup-timestamp": String(Math.floor(Date.now() / 1000)),
          "x-gymx2-cleanup-signature": "00",
        },
      }),
    );
    expect(invalid.status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("rejects query-string variants and returns only counts after authorized cleanup", async () => {
    const queryVariant = await GET(
      new Request("https://gymx2.com/api/cron/live-cleanup?anything=1", {
        headers: signedHeaders(),
      }),
    );
    expect(queryVariant.status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();

    const valid = await GET(
      new Request("https://gymx2.com/api/cron/live-cleanup", {
        headers: signedHeaders(),
      }),
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ ok: true, claimed: 0, completed: 0 });
    expect(valid.headers.get("cache-control")).toBe("no-store");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not mark a failed or un-heartbeated batch successful", async () => {
    cleanup.mockResolvedValueOnce({
      ok: true,
      claimed: 1,
      completed: 1,
      heartbeatRecorded: false,
    });
    const response = await GET(
      new Request("https://gymx2.com/api/cron/live-cleanup", {
        headers: signedHeaders(),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "cleanup_failed" });
  });
});
