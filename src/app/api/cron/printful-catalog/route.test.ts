import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("@/lib/printful/catalog-runtime", () => ({
  syncPrintfulCatalogToPrivateStage: mocks.sync,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "synthetic-cron-secret");
  mocks.sync.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("Printful catalog cron route", () => {
  it("rejects missing authorization before starting a sync", async () => {
    const response = await GET(new NextRequest("http://localhost/api/cron/printful-catalog"));

    expect(response.status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("keeps the scheduled route harmless while catalog sync is disabled", async () => {
    mocks.sync.mockResolvedValue({ status: "disabled" });

    const response = await GET(new NextRequest("http://localhost/api/cron/printful-catalog", {
      headers: { authorization: "Bearer synthetic-cron-secret" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "disabled" });
    expect(mocks.sync).toHaveBeenCalledOnce();
  });

  it("reports persistence failures without exposing provider details", async () => {
    mocks.sync.mockResolvedValue({ status: "persistence_failed" });

    const response = await GET(new NextRequest("http://localhost/api/cron/printful-catalog", {
      headers: { authorization: "Bearer synthetic-cron-secret" },
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "persistence_failed" });
  });
});
