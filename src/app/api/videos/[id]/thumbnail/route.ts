import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { getThumbnailUrl, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

// Sends the browser to a short-lived thumbnail for a video the viewer may watch. Row security
// decides access first; the Cloudflare id is only read after it says yes.
export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const notFound = new NextResponse(null, { status: 404 });
  const account = await getCurrentAccount();
  if (!account) return new NextResponse(null, { status: 401 });
  const id = idSchema.safeParse((await params).id);
  if (!id.success || !isStreamConfigured()) return notFound;

  const supabase = await createClient();
  const { data: video } = await supabase
    .from("videos")
    .select("id, status")
    .eq("id", id.data)
    .maybeSingle();
  if (!video || video.status !== "ready") return notFound;

  try {
    const { data } = await createAdminClient()
      .from("videos")
      .select("cloudflare_uid")
      .eq("id", id.data)
      .single();
    if (!data) return notFound;
    const url = await getThumbnailUrl(data.cloudflare_uid as string);
    // Playback tokens last an hour, so the browser may reuse this for a little less than that.
    return NextResponse.redirect(url, {
      status: 302,
      headers: { "Cache-Control": "private, max-age=3000" },
    });
  } catch (error) {
    console.error(error);
    return notFound;
  }
}
