// Categories and visibility for the video library, shared by the server and the browser.

export const VIDEO_CATEGORIES = [
  "Upper Body",
  "Lower Body",
  "Core",
  "Full Body",
  "Cardio",
  "Mobility",
  "Warm-up",
  "Recovery",
  "Technique",
  "Nutrition",
  "Other",
] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

export const VIDEO_VISIBILITY = {
  members: "Members",
  private: "Private",
} as const;
export type VideoVisibility = keyof typeof VIDEO_VISIBILITY;

export type LibraryCard = {
  id: string;
  title: string;
  description: string;
  category: VideoCategory;
  visibility: VideoVisibility;
  status: "uploading" | "processing" | "ready" | "failed";
  durationSeconds: number | null;
  createdAt: string;
  coachId: string;
  coachName: string;
};

export function readCategory(value: unknown): VideoCategory {
  return (VIDEO_CATEGORIES as readonly unknown[]).includes(value)
    ? (value as VideoCategory)
    : "Other";
}

// Search across title, description, category and coach name.
export function searchVideos(videos: LibraryCard[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return videos;
  return videos.filter((video) => {
    const text = [
      video.title,
      video.description,
      video.category,
      video.coachName,
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

// Rows for the library, in the category order above. Newest first inside each row. A "New" row
// leads when there are enough videos for it to help.
export function libraryRows(videos: LibraryCard[]) {
  const newest = [...videos].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const rows: { key: string; title: string; videos: LibraryCard[] }[] = [];
  if (newest.length > 6)
    rows.push({
      key: "new",
      title: "Recently added",
      videos: newest.slice(0, 10),
    });
  for (const category of VIDEO_CATEGORIES) {
    const inRow = newest.filter((video) => video.category === category);
    if (inRow.length)
      rows.push({
        key: category,
        title:
          category === "Other"
            ? rows.length
              ? "More videos"
              : "Videos"
            : category,
        videos: inRow,
      });
  }
  return rows;
}
