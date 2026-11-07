import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { createUpload, deleteVideo, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUploadMetadata } from "@/lib/tus";
import { videoSchema } from "@/lib/validation";

const MAX_FILE_BYTES = 30 * 1024 * 1024 * 1024;

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// Starts a resumable upload: the upload library calls this first, then sends the file to Cloudflare.
export async function POST(request: NextRequest) {
  const account = await getCurrentAccount();
  if (!account) return failure("Log in to upload a video.", 401);
  if (account.profile.role !== "coach") return failure("Only coaches can upload videos.", 403);
  if (!isStreamConfigured()) return failure("Video uploads aren't connected yet.", 503);

  const length = request.headers.get("Upload-Length") ?? "";
  if (!/^\d+$/.test(length) || Number(length) === 0 || Number(length) > MAX_FILE_BYTES) {
    return failure("Videos must be under 30 GB.", 400);
  }

  const parsed = videoSchema.safeParse(parseUploadMetadata(request.headers.get("Upload-Metadata")));
  if (!parsed.success) return failure(parsed.error.issues[0].message, 400);

  try {
    const { location, uid } = await createUpload({
      length,
      title: parsed.data.title,
      creatorId: account.profile.id,
    });

    const { error } = await createAdminClient().from("videos").insert({
      coach_id: account.profile.id,
      cloudflare_uid: uid,
      title: parsed.data.title,
      description: parsed.data.description,
    });
    if (error) {
      // Nothing points at this upload now, so don't leave it behind in Cloudflare.
      await deleteVideo(uid).catch(console.error);
      throw new Error(`The video couldn't be saved (${error.code}).`);
    }

    return new NextResponse(null, {
      status: 201,
      headers: { Location: location, "Tus-Resumable": "1.0.0" },
    });
  } catch (error) {
    console.error(error);
    return failure("We couldn't start that upload. Please try again.", 502);
  }
}
