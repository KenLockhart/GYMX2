import "server-only";
import { requireAccount } from "@/lib/auth";
import { idSchema } from "@/lib/validation";
import { getPlayerUrl, getThumbnailUrl, isStreamConfigured } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readCategory } from "@/lib/video-library";
import { todayKey } from "@/lib/reminders";
import { z } from "zod";

export type MemberDailyFuelVideo = {
  id: string;
  title: string;
  coachName: string;
  category: string;
  durationSeconds: number | null;
  playerUrl: string;
  thumbnailUrl: string | null;
  saved: boolean;
};

export type MemberDailyFuelData = {
  day: string;
  video: MemberDailyFuelVideo | null;
  videoError: boolean;
  bookmarkError: boolean;
  quote: { text: string; attribution: string | null; revisionId: string } | null;
  quoteError: boolean;
  affirmation: { text: string; revisionId: string } | null;
  affirmed: boolean;
  affirmationError: boolean;
};

export type DailyFuelMemberOption = { id: string; name: string };

type AssignmentVideo = {
  id: string;
  title: string;
  status: string;
  visibility: string;
  duration_seconds: number | string | null;
  category: string | null;
  cloudflare_uid: string;
  coach: { display_name: string } | { display_name: string }[] | null;
};

function relationOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function loadMemberDailyFuel(
  memberId: string,
  day: string,
  asOf = new Date(),
): Promise<MemberDailyFuelData> {
  const { profile } = await requireAccount();
  if (profile.role !== "member" || profile.id !== memberId)
    throw new Error("Member Daily Fuel access required.");

  const parsedDay = z.iso.date().safeParse(day);
  if (
    !idSchema.safeParse(memberId).success ||
    !parsedDay.success ||
    day !== todayKey(asOf)
  )
    throw new Error("A valid member and Eastern day are required.");

  const supabase = await createClient();
  const resolution = await supabase.rpc("resolve_member_daily_content");
  const row = Array.isArray(resolution.data)
    ? resolution.data[0]
    : resolution.data;
  const resolutionIsCurrent = !resolution.error && !!row && row.day === day;

  const base: MemberDailyFuelData = {
    day,
    video: null,
    videoError: !resolutionIsCurrent,
    bookmarkError: false,
    quote: resolutionIsCurrent && row?.quote_text && row?.quote_revision_id
      ? {
          text: row.quote_text,
          attribution: row.quote_attribution ?? null,
          revisionId: row.quote_revision_id,
        }
      : null,
    quoteError: !resolutionIsCurrent,
    affirmation: resolutionIsCurrent && row?.affirmation_text && row?.affirmation_revision_id
      ? { text: row.affirmation_text, revisionId: row.affirmation_revision_id }
      : null,
    affirmed: resolutionIsCurrent && Boolean(row?.affirmation_acknowledged),
    affirmationError: !resolutionIsCurrent,
  };
  if (!resolutionIsCurrent) return base;
  const videoId = row?.video_id;
  if (!videoId) return base;
  const parsedVideoId = idSchema.safeParse(videoId);
  if (!parsedVideoId.success) return { ...base, videoError: true };

  // The assignment row is the member's authorization to view this one clip. Read only that
  // exact ready video with the server client; do not broaden the Library videos RLS policy.
  const admin = createAdminClient();
  const { data: rawVideo, error: videoError } = await admin
    .from("videos")
    .select(
      "id, title, status, visibility, duration_seconds, category, cloudflare_uid, coach:profiles!coach_id(display_name)",
    )
    .eq("id", parsedVideoId.data)
    .maybeSingle();
  const video = rawVideo as unknown as AssignmentVideo | null;
  if (
    videoError ||
    !video ||
    video.id !== parsedVideoId.data ||
    video.status !== "ready" ||
    (video.visibility !== "members" && video.visibility !== "private") ||
    !video.cloudflare_uid ||
    !isStreamConfigured()
  ) {
    return { ...base, videoError: true };
  }

  const [playerResult, thumbnailResult, bookmarkResult] = await Promise.allSettled([
    getPlayerUrl(video.cloudflare_uid),
    getThumbnailUrl(video.cloudflare_uid),
    supabase
      .from("member_daily_fuel_bookmarks")
      .select("video_id")
      .eq("member_id", profile.id)
      .eq("video_id", video.id)
      .maybeSingle(),
  ]);
  if (playerResult.status !== "fulfilled")
    return { ...base, videoError: true };

  // A content slot or legacy assignment can change while Cloudflare mints a short-lived
  // playback token. Only return the token if the same authenticated resolver still grants it.
  const latestResolution = await supabase.rpc("resolve_member_daily_content");
  const latestRow = Array.isArray(latestResolution.data)
    ? latestResolution.data[0]
    : latestResolution.data;
  if (
    latestResolution.error ||
    !latestRow ||
    latestRow.day !== day ||
    latestRow?.video_id !== parsedVideoId.data ||
    latestRow?.video_source !== row?.video_source ||
    latestRow?.video_slot_id !== row?.video_slot_id ||
    latestRow?.video_revision_id !== row?.video_revision_id ||
    latestRow?.quote_revision_id !== row?.quote_revision_id ||
    latestRow?.affirmation_revision_id !== row?.affirmation_revision_id
  ) {
    return { ...base, videoError: true, quoteError: true, affirmationError: true };
  }

  const coach = relationOne(video.coach);
  const parsedDuration = Number(video.duration_seconds);
  return {
    ...base,
    affirmed: Boolean(latestRow.affirmation_acknowledged),
    bookmarkError:
      bookmarkResult.status !== "fulfilled" ||
      Boolean(bookmarkResult.value.error),
    video: {
      id: video.id,
      title: video.title,
      coachName: coach?.display_name ?? "",
      category: readCategory(video.category),
      durationSeconds:
        Number.isFinite(parsedDuration) && parsedDuration > 0
          ? Math.floor(parsedDuration)
          : null,
      playerUrl: playerResult.value,
      thumbnailUrl:
        thumbnailResult.status === "fulfilled" ? thumbnailResult.value : null,
      saved:
        bookmarkResult.status === "fulfilled" &&
        Boolean(bookmarkResult.value.data?.video_id),
    },
  };
}

export async function loadDailyFuelAssignmentOptions(videoId: string): Promise<{
  videoReady: boolean;
  members: DailyFuelMemberOption[];
  error: boolean;
}> {
  const { profile } = await requireAccount();
  if (profile.role !== "coach" && profile.role !== "admin")
    return { videoReady: false, members: [], error: true };

  const parsedVideoId = idSchema.safeParse(videoId);
  if (!parsedVideoId.success) return { videoReady: false, members: [], error: true };
  const supabase = await createClient();
  const { data: video, error: videoError } = await supabase
    .from("videos")
    .select("id, coach_id, status, visibility")
    .eq("id", parsedVideoId.data)
    .maybeSingle();
  if (
    videoError ||
    !video ||
    (profile.role === "coach" && video.coach_id !== profile.id)
  ) {
    return { videoReady: false, members: [], error: true };
  }
  if (
    video.status !== "ready" ||
    (video.visibility !== "members" && video.visibility !== "private")
  )
    return { videoReady: false, members: [], error: false };

  if (profile.role === "admin") {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("role", "member")
      .order("display_name", { ascending: true })
      .limit(500);
    return {
      videoReady: true,
      members: (data ?? []).map((row) => ({ id: row.id, name: row.display_name })),
      error: Boolean(error),
    };
  }

  const { data, error } = await supabase
    .from("coach_members")
    .select("member_id, member:profiles!member_id(display_name)")
    .eq("coach_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(500);
  return {
    videoReady: true,
    members: (data ?? []).flatMap((row) => {
      const member = relationOne(row.member);
      return member ? [{ id: row.member_id, name: member.display_name }] : [];
    }),
    error: Boolean(error),
  };
}
