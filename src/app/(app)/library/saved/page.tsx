import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { loadSavedMemberDailyFuelVideos } from "@/lib/member-saved-daily-fuel";
import { formatDuration } from "@/lib/format";
import { SavedDailyFuelRemove } from "@/components/saved-daily-fuel-remove";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).library.savedTitle };
}

export default async function SavedDailyFuelPage() {
  const { profile } = await requireAccount();
  if (profile.role !== "member") redirect("/dashboard");

  const t = (await getT()).library;
  const { videos, error } = await loadSavedMemberDailyFuelVideos();

  return (
    <main className="space-y-6">
      <Link href="/library" className="text-link text-sm">
        {t.back}
      </Link>
      <header>
        <h1 className="text-4xl sm:text-5xl">{t.savedTitle}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t.savedIntro}</p>
      </header>

      {error ? (
        <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-danger">
          {t.savedLoadError}
        </p>
      ) : videos.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {t.savedEmpty}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {videos.map((video) => (
            <li key={video.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4">
              <h2 className="text-xl font-semibold leading-tight">{video.title}</h2>
              <p className="mt-2 min-h-5 text-sm text-muted">
                {[video.coachName, t.categories[video.category] ?? video.category, formatDuration(video.durationSeconds)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {video.description && (
                <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm text-muted">
                  {video.description}
                </p>
              )}
              <Link
                href={`/library/saved/${video.id}`}
                className="btn-primary mt-5 min-h-11 w-full justify-center"
              >
                {t.savedWatch(video.title)}
              </Link>
              <SavedDailyFuelRemove
                videoId={video.id}
                copy={{
                  remove: t.savedRemove,
                  removing: t.savedRemoving,
                  confirm: t.savedRemoveConfirm(video.title),
                  removed: t.savedRemoved,
                  error: t.savedRemoveError,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
