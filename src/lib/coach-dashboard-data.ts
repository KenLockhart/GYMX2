import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isOwnedProfilePhotoPath, PROFILE_PHOTO_BUCKET } from "@/lib/profile-photo-shared";

const COACH_PHOTO_BUCKET = "coach-photos";
const PHOTO_URL_TTL_SECONDS = 60 * 60;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type CoachDashboardSession = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
};

export type CoachDashboardActivity = {
  id: string;
  memberId: string;
  memberName: string;
  createdAt: string;
  kind: "checkin" | "message";
};

export type CoachDashboardData = {
  photoUrl: string | null;
  sessions: { items: CoachDashboardSession[]; error: boolean };
  activity: { items: CoachDashboardActivity[]; error: boolean };
};

function isOwnedCoachPhotoPath(ownerId: string, path: unknown): path is string {
  if (typeof path !== "string" || !new RegExp(`^${UUID}$`, "i").test(ownerId))
    return false;
  const [pathOwner, filename, ...rest] = path.split("/");
  return (
    rest.length === 0 &&
    pathOwner.toLowerCase() === ownerId.toLowerCase() &&
    new RegExp(`^${UUID}\\.(jpg|jpeg|png|webp)$`, "i").test(filename ?? "")
  );
}

async function read<T>(request: () => PromiseLike<{ data: T | null; error?: unknown }>) {
  try {
    const result = await request();
    return { data: result.data, error: Boolean(result.error) };
  } catch {
    return { data: null, error: true };
  }
}

async function signPhoto(bucket: string, path: string) {
  try {
    const { data, error } = await createAdminClient()
      .storage.from(bucket)
      .createSignedUrl(path, PHOTO_URL_TTL_SECONDS);
    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}

async function loadOwnPhoto(
  ownerId: string,
  paths: { account: string | null; draft: string | null; published: string | null },
) {
  const candidates = [
    paths.account && isOwnedProfilePhotoPath(ownerId, paths.account)
      ? { bucket: PROFILE_PHOTO_BUCKET, path: paths.account }
      : null,
    paths.draft && isOwnedCoachPhotoPath(ownerId, paths.draft)
      ? { bucket: COACH_PHOTO_BUCKET, path: paths.draft }
      : null,
    paths.published && isOwnedCoachPhotoPath(ownerId, paths.published)
      ? { bucket: COACH_PHOTO_BUCKET, path: paths.published }
      : null,
  ].filter((candidate): candidate is { bucket: string; path: string } => !!candidate);

  for (const candidate of candidates) {
    const url = await signPhoto(candidate.bucket, candidate.path);
    if (url) return url;
  }
  return null;
}

export async function loadCoachDashboardData(
  coachId: string,
  now = new Date().toISOString(),
): Promise<CoachDashboardData> {
  const supabase = await createClient();
  const [sessionResult, memberResult, accountPhoto, draftPhoto, publishedPhoto] =
    await Promise.all([
      read<CoachDashboardSession[]>(() =>
        supabase
          .from("calendar_sessions")
          .select("id, title, starts_at, ends_at, location")
          .eq("coach_id", coachId)
          .gt("ends_at", now)
          .order("starts_at", { ascending: true })
          .limit(3),
      ),
      read<
        {
          member_id: string;
          member:
            | { id: string; display_name: string }
            | { id: string; display_name: string }[]
            | null;
        }[]
      >(() =>
        supabase
          .from("coach_members")
          .select("member_id, member:profiles!member_id(id, display_name)")
          .eq("coach_id", coachId),
      ),
      read<{ photo_path: string | null }>(() =>
        supabase
          .from("profile_photos")
          .select("photo_path")
          .eq("user_id", coachId)
          .maybeSingle(),
      ),
      read<{ photo_path: string | null }>(() =>
        supabase
          .from("coach_profile_drafts")
          .select("photo_path")
          .eq("coach_id", coachId)
          .maybeSingle(),
      ),
      read<{ photo_path: string | null }>(() =>
        supabase
          .from("coach_profiles_public")
          .select("photo_path")
          .eq("coach_id", coachId)
          .maybeSingle(),
      ),
    ]);

  const photoUrl = await loadOwnPhoto(coachId, {
    account: accountPhoto.data?.photo_path ?? null,
    draft: draftPhoto.data?.photo_path ?? null,
    published: publishedPhoto.data?.photo_path ?? null,
  });

  if (memberResult.error) {
    return {
      photoUrl,
      sessions: {
        items: sessionResult.error ? [] : (sessionResult.data ?? []),
        error: sessionResult.error,
      },
      activity: { items: [], error: true },
    };
  }

  const members = (memberResult.data ?? []).flatMap((row) => {
    const member = Array.isArray(row.member) ? row.member[0] : row.member;
    return member && row.member_id === member.id
      ? [{ id: row.member_id, name: member.display_name }]
      : [];
  });
  const memberIds = [...new Set(members.map((member) => member.id))];
  const names = new Map(members.map((member) => [member.id, member.name]));

  if (!memberIds.length) {
    return {
      photoUrl,
      sessions: {
        items: sessionResult.error ? [] : (sessionResult.data ?? []),
        error: sessionResult.error,
      },
      activity: { items: [], error: false },
    };
  }

  const [checkinsResult, messagesResult] = await Promise.all([
    read<{ id: string; member_id: string; created_at: string }[]>(() =>
      supabase
        .from("checkins")
        .select("id, member_id, created_at")
        .in("member_id", memberIds)
        .order("created_at", { ascending: false })
        .limit(3),
    ),
    read<
      { id: string; member_id: string; sender_id: string; created_at: string }[]
    >(() =>
      supabase
        .from("messages")
        .select("id, member_id, sender_id, created_at")
        .eq("coach_id", coachId)
        .neq("sender_id", coachId)
        .in("member_id", memberIds)
        .order("created_at", { ascending: false })
        .limit(3),
    ),
  ]);

  const items: CoachDashboardActivity[] = [
    ...(checkinsResult.data ?? []).flatMap((row) => {
      const memberName = names.get(row.member_id);
      return memberName
        ? [{
            id: `checkin:${row.id}`,
            memberId: row.member_id,
            memberName,
            createdAt: row.created_at,
            kind: "checkin" as const,
          }]
        : [];
    }),
    ...(messagesResult.data ?? []).flatMap((row) => {
      const memberName = names.get(row.member_id);
      return memberName && row.sender_id !== coachId
        ? [{
            id: `message:${row.id}`,
            memberId: row.member_id,
            memberName,
            createdAt: row.created_at,
            kind: "message" as const,
          }]
        : [];
    }),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);

  return {
    photoUrl,
    sessions: {
      items: sessionResult.error ? [] : (sessionResult.data ?? []),
      error: sessionResult.error,
    },
    activity: {
      items,
      error: checkinsResult.error || messagesResult.error,
    },
  };
}
