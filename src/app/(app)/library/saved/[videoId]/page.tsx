import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberDailyFuelPlayer } from "@/components/member-daily-fuel-player";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { formatDuration } from "@/lib/format";
import { loadSavedMemberDailyFuelPlayback } from "@/lib/member-saved-daily-fuel";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).library.savedTitle };
}

export default async function SavedDailyFuelVideoPage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  const { profile } = await requireAccount();
  if (profile.role !== "member") notFound();

  const { videoId } = await params;
  const messages = await getT();
  const t = messages.library;
  const playerCopy = messages.dashboard.dailyFuel;
  const result = await loadSavedMemberDailyFuelPlayback(videoId);
  if (!result.video && !result.error) notFound();

  const video = result.video;
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6">
      <Link href="/library/saved" className="text-link text-sm">
        {t.savedBack}
      </Link>

      {result.error && !video ? (
        <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-danger">
          {t.savedLoadError}
        </p>
      ) : video ? (
        <>
          <header>
            <h1 className="text-3xl sm:text-4xl">{video.title}</h1>
            <p className="mt-2 text-sm text-muted">
              {[video.coachName, t.categories[video.category] ?? video.category, formatDuration(video.durationSeconds)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </header>
          {video.playerUrl ? (
            <MemberDailyFuelPlayer
              title={video.title}
              playerUrl={video.playerUrl}
              thumbnailUrl={null}
              totalDuration={video.durationSeconds}
              todayLabel={t.savedVideoBadge}
              playLabel={playerCopy.playVideo}
              pauseLabel={playerCopy.pauseVideo}
              loadingLabel={playerCopy.loadingPlayer}
              unavailableLabel={playerCopy.playerUnavailable}
              retryLabel={playerCopy.retryPlayer}
            />
          ) : (
            <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-muted">
              {t.savedPlaybackUnavailable}
            </p>
          )}
          {video.description && (
            <p className="max-w-2xl whitespace-pre-line text-muted">
              {video.description}
            </p>
          )}
        </>
      ) : null}
    </main>
  );
}
