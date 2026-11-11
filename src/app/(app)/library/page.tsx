import type { Metadata } from "next";
import Link from "next/link";
import { VideoLibrary } from "@/components/video-library";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { getVideoState, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Video } from "@/lib/types";
import { type LibraryCard, readCategory } from "@/lib/video-library";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).library.title };
}

type LibraryVideo = Video & {
  category: string;
  visibility: string;
  coach: { display_name: string } | null;
};

// Cloudflare finishes processing in its own time, so unfinished videos are re-checked when a coach looks.
async function refreshUnfinishedVideos(videos: Video[]) {
  const unfinished = videos.filter(
    (video) => video.status !== "ready" && video.status !== "failed",
  );
  if (unfinished.length === 0 || !isStreamConfigured()) return false;

  const admin = createAdminClient();
  const { data } = await admin
    .from("videos")
    .select("id, cloudflare_uid")
    .in(
      "id",
      unfinished.map((video) => video.id),
    );

  const results = await Promise.allSettled(
    (data ?? []).map(async (video) => {
      const state = await getVideoState(video.cloudflare_uid);
      await admin
        .from("videos")
        .update({
          status: state.status,
          duration_seconds: state.durationSeconds,
        })
        .eq("id", video.id);
    }),
  );
  return results.some((result) => result.status === "fulfilled");
}

async function loadVideos() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("videos")
    .select(
      "id, coach_id, title, description, status, duration_seconds, created_at, category, visibility, coach:profiles!coach_id(display_name)",
    )
    .order("created_at", { ascending: false });
  return { videos: (data ?? []) as unknown as LibraryVideo[], error };
}

export default async function LibraryPage() {
  const { profile } = await requireAccount();
  const isCoach = profile.role === "coach";
  const t = (await getT()).library;

  let { videos, error } = await loadVideos();
  if (isCoach && (await refreshUnfinishedVideos(videos))) {
    ({ videos, error } = await loadVideos());
  }
  const cards: LibraryCard[] = videos.map((video) => ({
    id: video.id,
    title: video.title,
    description: video.description,
    category: readCategory(video.category),
    visibility: video.visibility === "private" ? "private" : "members",
    status: video.status,
    durationSeconds: video.duration_seconds,
    createdAt: video.created_at,
    coachId: video.coach_id,
    coachName: video.coach?.display_name ?? "",
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">{t.title}</h1>
          <p className="mt-2 max-w-xl text-muted">
            {isCoach
              ? t.introCoach
              : profile.role === "admin"
                ? t.introAdmin
                : t.introMember}
          </p>
        </div>
        {isCoach && (
          <Link href="/library/upload" className="btn-primary">
            {t.upload}
          </Link>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-danger">
          {t.loadError}
        </p>
      ) : cards.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {isCoach ? (
            t.noneCoach
          ) : profile.role === "member" ? (
            <>
              {t.noneMemberBefore}{" "}
              <Link href="/coaches" className="text-link">
                {t.joinCoach}
              </Link>{" "}
              {t.noneMemberAfter}
            </>
          ) : (
            t.noneOther
          )}
        </p>
      ) : (
        <VideoLibrary
          videos={cards}
          viewer={{ id: profile.id, role: profile.role }}
        />
      )}
    </div>
  );
}
