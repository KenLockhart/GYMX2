import type { ProgressPhoto } from "@/lib/photos";

function shortDate(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const POSE_LABELS: Record<string, string> = { front: "Front", side: "Side", back: "Back", other: "Other" };

// First and latest photo of the same pose side by side, then everything else by date.
export function PhotoGallery({
  photos,
  renderDelete,
}: {
  photos: ProgressPhoto[];
  renderDelete?: (photo: ProgressPhoto) => React.ReactNode;
}) {
  if (photos.length === 0) return null;
  const byPose = new Map<string, ProgressPhoto[]>();
  for (const photo of photos) byPose.set(photo.pose, [...(byPose.get(photo.pose) ?? []), photo]);
  const comparePose = [...byPose].find(([, list]) => list.length >= 2);

  return (
    <div className="space-y-4">
      {comparePose && (
        <div className="grid max-w-xl grid-cols-2 gap-3">
          {[comparePose[1][comparePose[1].length - 1], comparePose[1][0]].map((photo, index) => (
            <figure key={photo.id} className="space-y-1">
              {photo.url && (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived private links
                <img src={photo.url} alt={`${POSE_LABELS[photo.pose]} photo, ${shortDate(photo.day)}`} className="aspect-[3/4] w-full rounded-lg object-cover" />
              )}
              <figcaption className="text-xs text-muted">
                {index === 0 ? "First" : "Latest"} · {POSE_LABELS[photo.pose]} · {shortDate(photo.day)}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {photos.map((photo) => (
          <li key={photo.id} className="space-y-1">
            {photo.url && (
              <a href={photo.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived private links */}
                <img src={photo.url} alt={`${POSE_LABELS[photo.pose]} photo, ${shortDate(photo.day)}`} className="aspect-[3/4] w-full rounded-md object-cover" />
              </a>
            )}
            <p className="text-xs text-muted">
              {POSE_LABELS[photo.pose]} · {shortDate(photo.day)}
            </p>
            {renderDelete?.(photo)}
          </li>
        ))}
      </ul>
    </div>
  );
}
