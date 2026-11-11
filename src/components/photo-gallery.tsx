import { LOCALE_TAG, type Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import type { ProgressPhoto } from "@/lib/photos";

function shortDate(day: string, locale: Locale) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(LOCALE_TAG[locale], {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// First and latest photo of the same pose side by side, then everything else by date.
export function PhotoGallery({
  photos,
  renderDelete,
  locale = "en",
}: {
  photos: ProgressPhoto[];
  renderDelete?: (photo: ProgressPhoto) => React.ReactNode;
  locale?: Locale;
}) {
  if (photos.length === 0) return null;
  const t = messages[locale].track;
  const pose = (value: string) => t.poses[value] ?? value;
  const date = (day: string) => shortDate(day, locale);
  const byPose = new Map<string, ProgressPhoto[]>();
  for (const photo of photos)
    byPose.set(photo.pose, [...(byPose.get(photo.pose) ?? []), photo]);
  const comparePose = [...byPose].find(([, list]) => list.length >= 2);

  return (
    <div className="space-y-4">
      {comparePose && (
        <div className="grid max-w-xl grid-cols-2 gap-3">
          {[comparePose[1][comparePose[1].length - 1], comparePose[1][0]].map(
            (photo, index) => (
              <figure key={photo.id} className="space-y-1">
                {photo.url && (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived private links
                  <img
                    src={photo.url}
                    alt={t.photoAlt(pose(photo.pose), date(photo.day))}
                    className="aspect-[3/4] w-full rounded-lg object-cover"
                  />
                )}
                <figcaption className="text-xs text-muted">
                  {index === 0 ? t.first : t.latest} · {pose(photo.pose)} ·{" "}
                  {date(photo.day)}
                </figcaption>
              </figure>
            ),
          )}
        </div>
      )}
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {photos.map((photo) => (
          <li key={photo.id} className="space-y-1">
            {photo.url && (
              <a href={photo.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived private links */}
                <img
                  src={photo.url}
                  alt={t.photoAlt(pose(photo.pose), date(photo.day))}
                  className="aspect-[3/4] w-full rounded-md object-cover"
                />
              </a>
            )}
            <p className="text-xs text-muted">
              {pose(photo.pose)} · {date(photo.day)}
            </p>
            {renderDelete?.(photo)}
          </li>
        ))}
      </ul>
    </div>
  );
}
