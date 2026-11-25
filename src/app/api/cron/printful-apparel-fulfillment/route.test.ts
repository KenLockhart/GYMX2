import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { runPrintfulApparelFulfillmentTick } from "@/lib/printful/apparel-fulfillment-runtime";

vi.mock("@/lib/printful/apparel-fulfillment-runtime", () => ({ runPrintfulApparelFulfillmentTick: vi.fn() }));

describe("Printful apparel fulfillment cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "synthetic-cron-secret";
  });

  it("rejects unauthenticated requests without claiming work", async () => {
    const request = new Request("https://gymx2.example.test/api/cron/printful-apparel-fulfillment") as never;
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(runPrintfulApparelFulfillmentTick).not.toHaveBeenCalled();
  });

  it("runs one bounded worker tick only with the cron bearer", async () => {
    vi.mocked(runPrintfulApparelFulfillmentTick).mockResolvedValue("idle");
    const request = new Request("https://gymx2.example.test/api/cron/printful-apparel-fulfillment", {
      headers: { authorization: "Bearer synthetic-cron-secret" },
    }) as never;
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "idle" });
    expect(runPrintfulApparelFulfillmentTick).toHaveBeenCalledTimes(1);
  });

  it("returns sanitized failure without exposing provider or database details", async () => {
    vi.mocked(runPrintfulApparelFulfillmentTick).mockRejectedValue(new Error("synthetic secret-like failure"));
    const request = new Request("https://gymx2.example.test/api/cron/printful-apparel-fulfillment", {
      headers: { authorization: "Bearer synthetic-cron-secret" },
    }) as never;
    const response = await GET(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "worker_unavailable" });
  });
});
