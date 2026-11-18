import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  isOwnedProfilePhotoPath,
  PROFILE_PHOTO_BUCKET,
} from "@/lib/profile-photo-shared";

const PHOTO_URL_TTL_SECONDS = 60 * 60;

export type MemberDashboardSession = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  coach: { display_name: string } | null;
};

type SessionRow = Omit<MemberDashboardSession, "coach"> & {
  coach: { display_name: string } | { display_name: string }[] | null;
};

export type MemberDashboardTask = {
  id: string;
  due_on: string | null;
  title: string;
};

export type MemberDashboardData = {
  photoUrl: string | null;
  coachSelection: "selected" | "missing" | "error";
  armoryPurchase: "purchased" | "missing" | "error";
  sessions: { items: MemberDashboardSession[]; error: boolean };
  tasks: { items: MemberDashboardTask[]; error: boolean };
};

type ReadResult<T> = { data: T | null; error: boolean };

function firstRelation<T>(relation: T | T[] | null): T | null {
  return Array.isArray(relation)
    ? ((relation[0] as T | undefined) ?? null)
    : (relation as T | null);
}

async function read<T>(
  request: () => PromiseLike<{ data: T | null; error?: unknown }>,
): Promise<ReadResult<T>> {
  try {
    const result = await request();
    return { data: result.data, error: Boolean(result.error) };
  } catch {
    return { data: null, error: true };
  }
}

async function signOwnPhoto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string,
) {
  const photo = await read<{ photo_path: string | null }>(() =>
    supabase
      .from("profile_photos")
      .select("photo_path")
      .eq("user_id", memberId)
      .maybeSingle(),
  );
  const path = photo.data?.photo_path;
  if (!path || !isOwnedProfilePhotoPath(memberId, path)) return null;

  try {
    const { data, error } = await createAdminClient()
      .storage.from(PROFILE_PHOTO_BUCKET)
      .createSignedUrl(path, PHOTO_URL_TTL_SECONDS);
    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}

export async function loadMemberDashboardData(
  memberId: string,
  now = new Date().toISOString(),
): Promise<MemberDashboardData> {
  const supabase = await createClient();
  const [coachResult, purchaseResult, sessionResult, taskResult, photoUrl] =
    await Promise.all([
      read<{ coach_id: string }[]>(() =>
        supabase
          .from("coach_members")
          .select("coach_id")
          .eq("member_id", memberId)
          .limit(1),
      ),
      read<{ id: string }[]>(() =>
        supabase
          .from("purchases")
          .select("id")
          .eq("member_id", memberId)
          .eq("kind", "item")
          .limit(1),
      ),
      read<SessionRow[]>(() =>
        supabase
          .from("calendar_sessions")
          .select(
            "id, title, starts_at, ends_at, location, coach:profiles!coach_id(display_name)",
          )
          .gt("ends_at", now)
          .order("starts_at", { ascending: true })
          .limit(3),
      ),
      read<
        {
          id: string;
          due_on: string | null;
          task:
            | { title: string }
            | { title: string }[]
            | null;
        }[]
      >(() =>
        supabase
          .from("task_assignments")
          .select("id, due_on, task:tasks(title)")
          .eq("member_id", memberId)
          .is("completed_at", null)
          .order("due_on", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(3),
      ),
      signOwnPhoto(supabase, memberId),
    ]);

  const sessions = (sessionResult.data ?? []).map((session) => ({
    ...session,
    coach: firstRelation(session.coach),
  }));
  const tasks = (taskResult.data ?? []).flatMap((assignment) => {
    const task = Array.isArray(assignment.task)
      ? assignment.task[0]
      : assignment.task;
    return task
      ? [{ id: assignment.id, due_on: assignment.due_on, title: task.title }]
      : [];
  });

  return {
    photoUrl,
    coachSelection: coachResult.error || !Array.isArray(coachResult.data)
      ? "error"
      : coachResult.data.length
        ? "selected"
        : "missing",
    armoryPurchase: purchaseResult.error || !Array.isArray(purchaseResult.data)
      ? "error"
      : purchaseResult.data.length
        ? "purchased"
        : "missing",
    sessions: {
      items: Array.isArray(sessionResult.data) ? sessions : [],
      error: sessionResult.error || !Array.isArray(sessionResult.data),
    },
    tasks: {
      items: Array.isArray(taskResult.data) ? tasks : [],
      error: taskResult.error || !Array.isArray(taskResult.data),
    },
  };
}
