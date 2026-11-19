import "server-only";

import { requireAccount } from "@/lib/auth";
import { todayKey } from "@/lib/reminders";
import { getPlayerUrl, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readCategory } from "@/lib/video-library";
import { idSchema } from "@/lib/validation";

const MAX_SAVED_VIDEOS = 500;
const ASSIGNMENT_QUERY_BATCH_SIZE = 100;

type VideoRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  visibility: string;
  duration_seconds: number | string | null;
  category: string | null;
  cloudflare_uid: string;
  coach: { display_name: string } | { display_name: string }[] | null;
};

export type SavedDailyFuelCard = {
  id: string;
  title: string;
  description: string | null;
  coachName: string;
  category: string;
  durationSeconds: number | null;
  savedAt: string;
};

export type SavedDailyFuelPlayback = SavedDailyFuelCard & {
  playerUrl: string | null;
};

function relationOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toCard(video: VideoRow, savedAt: string): SavedDailyFuelCard {
  const coach = relationOne(video.coach);
  const duration = Number(video.duration_seconds);
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    coachName: coach?.display_name ?? "",
    category: readCategory(video.category),
    durationSeconds:
      Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : null,
    savedAt,
  };
}

async function getMemberAccount() {
  const { profile } = await requireAccount();
  if (profile.role !== "member") return null;
  return profile;
}

/**
 * Reads only videos that have both the caller's own bookmark and a legitimate
 * Daily Fuel assignment on or before the current Eastern day. The user client
 * proves those grants through RLS before the service client reads video details.
 */
export async function loadSavedMemberDailyFuelVideos(): Promise<{
  videos: SavedDailyFuelCard[];
  error: boolean;
}> {
  const profile = await getMemberAccount();
  if (!profile) return { videos: [], error: true };

  const currentDay = todayKey();
  const supabase = await createClient();
  const { data: bookmarks, error: bookmarkError } = await supabase
    .from("member_daily_fuel_bookmarks")
    .select("video_id, created_at")
    .eq("member_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(MAX_SAVED_VIDEOS);
  if (bookmarkError) return { videos: [], error: true };

  const savedAtByVideo = new Map<string, string>();
  for (const row of bookmarks ?? []) {
    const id = idSchema.safeParse(row.video_id);
    if (id.success && !savedAtByVideo.has(id.data))
      savedAtByVideo.set(id.data, row.created_at);
  }
  const bookmarkIds = [...savedAtByVideo.keys()];
  if (bookmarkIds.length === 0) return { videos: [], error: false };

  const assignmentResults = await Promise.all(
    Array.from(
      { length: Math.ceil(bookmarkIds.length / ASSIGNMENT_QUERY_BATCH_SIZE) },
      (_, index) =>
        supabase
          .from("member_daily_fuel_assignments")
          .select("video_id, day")
          .eq("member_id", profile.id)
          .in(
            "video_id",
            bookmarkIds.slice(
              index * ASSIGNMENT_QUERY_BATCH_SIZE,
              (index + 1) * ASSIGNMENT_QUERY_BATCH_SIZE,
            ),
          )
          .lte("day", currentDay)
          .order("day", { ascending: false })
          .limit(1000),
    ),
  );
  if (assignmentResults.some((result) => result.error))
    return { videos: [], error: true };
  const assignments = assignmentResults.flatMap((result) => result.data ?? []);

  const authorizedIds = new Set<string>();
  for (const row of assignments ?? []) {
    const id = idSchema.safeParse(row.video_id);
    if (id.success && typeof row.day === "string" && row.day <= currentDay)
      authorizedIds.add(id.data);
  }
  const videoIds = bookmarkIds.filter((id) => authorizedIds.has(id));
  if (videoIds.length === 0) return { videos: [], error: false };

  const admin = createAdminClient();
  const { data: rawVideos, error: videoError } = await admin
    .from("videos")
    .select(
      "id, title, description, status, visibility, duration_seconds, category, cloudflare_uid, coach:profiles!coach_id(display_name)",
    )
    .in("id", videoIds)
    .eq("status", "ready")
    .in("visibility", ["members", "private"])
    .order("created_at", { ascending: false });
  if (videoError) return { videos: [], error: true };

  const eligible = new Set(videoIds);
  return {
    videos: ((rawVideos ?? []) as unknown as VideoRow[])
      .filter(
        (video) =>
          eligible.has(video.id) &&
          video.status === "ready" &&
          (video.visibility === "members" || video.visibility === "private") &&
          Boolean(video.cloudflare_uid),
      )
      .map((video) => toCard(video, savedAtByVideo.get(video.id) ?? ""))
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt)),
    error: false,
  };
}

/**
 * Revalidates bookmark + nonfuture assignment using the authenticated user
 * client before using the server-only Stream credential for this single clip.
 */
export async function loadSavedMemberDailyFuelPlayback(
  videoId: string,
): Promise<{ video: SavedDailyFuelPlayback | null; error: boolean }> {
  const profile = await getMemberAccount();
  const parsedVideoId = idSchema.safeParse(videoId);
  if (!profile || !parsedVideoId.success) return { video: null, error: false };

  const currentDay = todayKey();
  const supabase = await createClient();
  const [bookmark, assignment] = await Promise.all([
    supabase
      .from("member_daily_fuel_bookmarks")
      .select("video_id, created_at")
      .eq("member_id", profile.id)
      .eq("video_id", parsedVideoId.data)
      .maybeSingle(),
    supabase
      .from("member_daily_fuel_assignments")
      .select("video_id, day")
      .eq("member_id", profile.id)
      .eq("video_id", parsedVideoId.data)
      .lte("day", currentDay)
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (bookmark.error || assignment.error)
    return { video: null, error: true };
  if (
    bookmark.data?.video_id !== parsedVideoId.data ||
    assignment.data?.video_id !== parsedVideoId.data ||
    typeof assignment.data.day !== "string" ||
    assignment.data.day > currentDay
  )
    return { video: null, error: false };

  const { data: rawVideo, error: videoError } = await createAdminClient()
    .from("videos")
    .select(
      "id, title, description, status, visibility, duration_seconds, category, cloudflare_uid, coach:profiles!coach_id(display_name)",
    )
    .eq("id", parsedVideoId.data)
    .maybeSingle();
  const video = rawVideo as unknown as VideoRow | null;
  if (
    videoError ||
    !video ||
    video.id !== parsedVideoId.data ||
    video.status !== "ready" ||
    (video.visibility !== "members" && video.visibility !== "private") ||
    !video.cloudflare_uid
  )
    return { video: null, error: Boolean(videoError) };

  const card = toCard(video, bookmark.data.created_at);
  if (!isStreamConfigured()) return { video: { ...card, playerUrl: null }, error: true };
  try {
    const playerUrl = await getPlayerUrl(video.cloudflare_uid);
    return { video: { ...card, playerUrl }, error: false };
  } catch {
    return { video: { ...card, playerUrl: null }, error: true };
  }
}
