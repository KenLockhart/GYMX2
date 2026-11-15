import {
  cleanupPrivateLiveInputsAndRecordHeartbeat,
  verifyLiveCleanupHmac,
} from "@/lib/private-live-server";

export const runtime = "nodejs";

const CLEANUP_PATH = "/api/cron/live-cleanup";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const secret = process.env.LIVE_CLEANUP_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { ok: false, error: "cleanup_unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }

  const requestUrl = new URL(request.url);
  const authorized =
    requestUrl.pathname === CLEANUP_PATH &&
    requestUrl.search === "" &&
    verifyLiveCleanupHmac({
      timestamp: request.headers.get("x-gymx2-cleanup-timestamp"),
      signature: request.headers.get("x-gymx2-cleanup-signature"),
      secret,
    });
  if (!authorized) {
    return Response.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const result = await cleanupPrivateLiveInputsAndRecordHeartbeat();
  if (!result.ok || !result.heartbeatRecorded) {
    return Response.json(
      { ok: false, error: "cleanup_failed" },
      { status: 503, headers: NO_STORE },
    );
  }

  return Response.json(
    {
      ok: true,
      claimed: result.claimed,
      completed: result.completed,
    },
    { status: 200, headers: NO_STORE },
  );
}
