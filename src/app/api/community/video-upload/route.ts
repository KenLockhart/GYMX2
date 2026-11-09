import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from "@/lib/community";
import { createUpload, isStreamConfigured } from "@/lib/stream";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// Starts a resumable upload of a community post video. The post itself is saved only after the
// upload finishes, and only by the person who started it.
export async function POST(request: NextRequest) {
  const account = await getCurrentAccount();
  if (!account) return failure("Log in to upload a video.", 401);
  if (!isStreamConfigured())
    return failure("Video uploads aren't connected yet.", 503);

  const length = request.headers.get("Upload-Length") ?? "";
  if (
    !/^\d+$/.test(length) ||
    Number(length) === 0 ||
    Number(length) > MAX_VIDEO_BYTES
  ) {
    return failure("Videos can be up to 1 GB.", 400);
  }

  try {
    const { location } = await createUpload({
      length,
      title: `Community post by ${account.profile.id}`,
      creatorId: account.profile.id,
      maxDurationSeconds: MAX_VIDEO_SECONDS,
    });
    return new NextResponse(null, {
      status: 201,
      headers: { Location: location, "Tus-Resumable": "1.0.0" },
    });
  } catch (error) {
    console.error(error);
    return failure("We couldn't start that upload. Please try again.", 502);
  }
}
