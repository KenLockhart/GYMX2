import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccount } from "@/lib/auth";
import { getPlayerUrl, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Video } from "@/lib/types";

export const metadata: Metadata = { title: "Video" };

type WatchVideo = Pick<Video, "id" | "title" | "description" | "status"> & {
  coach: { display_name: string } | null;
};

async function loadPlayerUrl(videoId: string) {
  if (!isStreamConfigured()) return null;
  try {
    const { data } = await createAdminClient()
      .from("videos")
      .select("cloudflare_uid")
      .eq("id", videoId)
      .single();
    return data ? await getPlayerUrl(data.cloudflare_uid) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export default async function VideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccount();
  const { id } = await params;

  // Row security answers "may this person watch?". The player link is only made after it says yes.
  const supabase = await createClient();
  const { data } = await supabase
    .from("videos")
    .select(
      "id, title, description, status, coach:profiles!coach_id(display_name)",
    )
    .eq("id", id)
    .maybeSingle();
  const video = data as unknown as WatchVideo | null;
  if (!video) notFound();

  const playerUrl =
    video.status === "ready" ? await loadPlayerUrl(video.id) : null;

  return (
    <div className="space-y-6">
      <Link href="/library" className="text-link text-sm">
        Back to the library
      </Link>

      {playerUrl ? (
        <div className="relative aspect-video overflow-hidden rounded-lg bg-surface">
          <iframe
            src={playerUrl}
            title={video.title}
            className="absolute inset-0 size-full border-0"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface p-4 text-muted"
        >
          {video.status === "ready"
            ? "This video can't play right now. Please refresh and try again."
            : "This video is still being prepared."}
        </p>
      )}

      <div>
        <h1 className="text-4xl">{video.title}</h1>
        {video.coach && (
          <p className="mt-1 text-sm text-muted">{video.coach.display_name}</p>
        )}
        {video.description && (
          <p className="mt-4 max-w-2xl whitespace-pre-line">
            {video.description}
          </p>
        )}
      </div>
    </div>
  );
}
