import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import { formatDuration } from "@/lib/format";
import { getVideoState, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Video, VideoStatus } from "@/lib/types";
import { deleteVideo } from "./actions";

export const metadata: Metadata = { title: "Library" };

type LibraryVideo = Video & { coach: { display_name: string } | null };

const statusLabel: Record<VideoStatus, string> = {
  uploading: "Waiting for upload",
  processing: "Processing",
  ready: "Ready",
  failed: "Upload failed",
};

// Cloudflare finishes processing in its own time, so unfinished videos are re-checked when a coach looks.
async function refreshUnfinishedVideos(videos: Video[]) {
  const unfinished = videos.filter((video) => video.status !== "ready" && video.status !== "failed");
  if (unfinished.length === 0 || !isStreamConfigured()) return false;

  const admin = createAdminClient();
  const { data } = await admin
    .from("videos")
    .select("id, cloudflare_uid")
    .in("id", unfinished.map((video) => video.id));

  const results = await Promise.allSettled(
    (data ?? []).map(async (video) => {
      const state = await getVideoState(video.cloudflare_uid);
      await admin
        .from("videos")
        .update({ status: state.status, duration_seconds: state.durationSeconds })
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
      "id, coach_id, title, description, status, duration_seconds, created_at, coach:profiles!coach_id(display_name)",
    )
    .order("created_at", { ascending: false });
  return { videos: (data ?? []) as unknown as LibraryVideo[], error };
}

export default async function LibraryPage() {
  const { profile } = await requireAccount();
  const isCoach = profile.role === "coach";

  let { videos, error } = await loadVideos();
  if (isCoach && (await refreshUnfinishedVideos(videos))) {
    ({ videos, error } = await loadVideos());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">Library</h1>
          <p className="mt-2 max-w-xl text-muted">
            {isCoach
              ? "Your videos. Members who join you can watch anything that's ready."
              : profile.role === "admin"
                ? "Every video on GYMX2."
                : "Videos from the coaches you've joined, plus anything assigned to you."}
          </p>
        </div>
        {isCoach && (
          <Link href="/library/upload" className="btn-primary">
            Upload a video
          </Link>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the library. Please refresh and try again.
        </p>
      ) : videos.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {isCoach ? (
            "You haven't uploaded any videos yet."
          ) : profile.role === "member" ? (
            <>
              Nothing here yet.{" "}
              <Link href="/coaches" className="text-link">
                Join a coach
              </Link>{" "}
              to see their videos.
            </>
          ) : (
            "No videos have been uploaded yet."
          )}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {videos.map((video) => {
            const duration = formatDuration(video.duration_seconds);
            return (
              <li
                key={video.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  {video.status === "ready" ? (
                    <Link href={`/library/${video.id}`} className="text-link font-semibold">
                      {video.title}
                    </Link>
                  ) : (
                    <p className="font-semibold">{video.title}</p>
                  )}
                  <p className="mt-1 text-sm text-muted">
                    {[
                      !isCoach && video.coach?.display_name,
                      duration,
                      video.status !== "ready" && statusLabel[video.status],
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {(isCoach || profile.role === "admin") && (
                  <ActionForm
                    action={deleteVideo}
                    confirmMessage={`Delete "${video.title}"? This can't be undone.`}
                    className="shrink-0 space-y-2"
                  >
                    <input type="hidden" name="video_id" value={video.id} />
                    <SubmitButton pendingText="Deleting..." className="btn-secondary px-3 py-2 text-sm">
                      Delete
                    </SubmitButton>
                    <FormStatus />
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
