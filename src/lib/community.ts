// GYMX2 Community: post kinds, audiences and the shape the screens use. Safe for the browser.

export const POST_KINDS = [
  { value: "general", label: "Update", coachOnly: false },
  { value: "workout", label: "Workout", coachOnly: false },
  { value: "nutrition", label: "Nutrition", coachOnly: false },
  { value: "motivation", label: "Motivation", coachOnly: false },
  { value: "achievement", label: "Achievement", coachOnly: false },
  { value: "progress", label: "Progress", coachOnly: false },
  { value: "challenge", label: "Challenge", coachOnly: true },
  { value: "announcement", label: "Announcement", coachOnly: true },
] as const;
export type PostKind = (typeof POST_KINDS)[number]["value"];
export const POST_KIND_VALUES = POST_KINDS.map((kind) => kind.value) as [
  PostKind,
  ...PostKind[],
];

export const AUDIENCES = [
  { value: "everyone", label: "Everyone on GYMX2" },
  { value: "coach_community", label: "A coach community" },
  { value: "only_me", label: "Only me" },
] as const;
export type Audience = (typeof AUDIENCES)[number]["value"];

export const POST_BODY_MAX = 5000;
export const MAX_POST_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 10 * 60;
export const PHOTO_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
export const FEED_PAGE_SIZE = 20;

export function kindLabel(kind: string) {
  return POST_KINDS.find((item) => item.value === kind)?.label ?? "Update";
}

// Kinds a person may choose. Only coaches and admins post challenges and announcements.
export function kindsFor(role: string) {
  return POST_KINDS.filter(
    (kind) => !kind.coachOnly || role === "coach" || role === "admin",
  );
}

export type PostAuthor = { id: string; name: string; role: string };

export type PostDTO = {
  id: string;
  kind: PostKind;
  body: string;
  audience: Audience;
  coach: { id: string; name: string } | null;
  pillar: string | null;
  author: PostAuthor;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  editedAt: string | null;
  photos: { url: string; width: number | null; height: number | null }[];
  video: {
    url: string | null;
    status: "ready" | "processing" | "failed";
  } | null;
  mine: boolean;
  likedByMe: boolean;
};

export type CommentDTO = {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  author: PostAuthor;
  createdAt: string;
  editedAt: string | null;
  mine: boolean;
};

export const COMMENT_MAX = 2000;

// "3m", "5h", "2d", then a date.
export function timeAgo(iso: string, now = new Date()) {
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - new Date(iso).getTime()) / 1000),
  );
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export function audienceLabel(post: Pick<PostDTO, "audience" | "coach">) {
  if (post.audience === "only_me") return "Only you";
  if (post.audience === "coach_community")
    return `${post.coach?.name ?? "Coach"}'s community`;
  return "Everyone";
}
