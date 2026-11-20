import { runFormCoachScheduledJobs } from "@/lib/form-coach/jobs-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMPTY_COUNTS = Object.freeze({
  expiredAssessments: 0,
  programSendsClaimed: 0,
  programSendsProcessed: 0,
  summariesClaimed: 0,
  summariesCompleted: 0,
  summariesRetryScheduled: 0,
  summariesUnavailable: 0,
  failures: 0,
});

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  if (process.env.FORM_COACH_JOBS_ENABLED !== "true") {
    return Response.json(EMPTY_COUNTS, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  try {
    return Response.json(await runFormCoachScheduledJobs(), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ ...EMPTY_COUNTS, failures: 1 }, {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }
}
