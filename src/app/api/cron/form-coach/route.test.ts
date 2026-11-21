import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRun = vi.hoisted(() => vi.fn());

vi.mock("@/lib/form-coach/jobs-server", () => ({
  runFormCoachScheduledJobs: mockRun,
}));

import { GET, maxDuration, runtime } from "./route";

const counts = {
  expiredAssessments: 1,
  programSendsClaimed: 1,
  programSendsProcessed: 1,
  summariesClaimed: 1,
  summariesCompleted: 1,
  summariesRetryScheduled: 0,
  summariesUnavailable: 0,
  failures: 0,
};

function request(authorization?: string): Request {
  return new Request("https://example.test/api/cron/form-coach", {
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "synthetic-cron-secret");
  vi.stubEnv("FORM_COACH_JOBS_ENABLED", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Form Coach scheduled route", () => {
  it("is a bounded Node route", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBeLessThanOrEqual(60);
    expect(maxDuration).toBeGreaterThan(0);
  });

  it("requires the cron bearer secret and does not run jobs when it is missing", async () => {
    const response = await GET(request("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(mockRun).not.toHaveBeenCalled();

    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer synthetic-cron-secret"))).status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("defaults disabled without invoking the worker", async () => {
    const response = await GET(request("Bearer synthetic-cron-secret"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      expiredAssessments: 0,
      programSendsClaimed: 0,
      programSendsProcessed: 0,
      summariesClaimed: 0,
      summariesCompleted: 0,
      summariesRetryScheduled: 0,
      summariesUnavailable: 0,
      failures: 0,
    });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns only aggregate counts after the enabled worker completes", async () => {
    vi.stubEnv("FORM_COACH_JOBS_ENABLED", "true");
    mockRun.mockResolvedValue(counts);

    const response = await GET(request("Bearer synthetic-cron-secret"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(counts);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("does not expose thrown job details", async () => {
    vi.stubEnv("FORM_COACH_JOBS_ENABLED", "true");
    mockRun.mockRejectedValue(new Error("synthetic member id and provider detail"));

    const response = await GET(request("Bearer synthetic-cron-secret"));
    expect(response.status).toBe(500);
    const responseBody = await response.json();
    expect(JSON.stringify(responseBody)).not.toContain("synthetic member id");
    expect(responseBody).toMatchObject({ failures: 1 });
    expect(Object.keys(responseBody).sort()).toEqual([
      "expiredAssessments",
      "failures",
      "programSendsClaimed",
      "programSendsProcessed",
      "summariesClaimed",
      "summariesCompleted",
      "summariesRetryScheduled",
      "summariesUnavailable",
    ]);
  });
});
