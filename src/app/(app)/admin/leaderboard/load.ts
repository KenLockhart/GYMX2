import "server-only";
import type { ActivityRows, EngagementRows } from "@/lib/leaderboard";
import { PHOTO_BUCKET } from "@/lib/coach-profile-server";
import { createAdminClient } from "@/lib/supabase/admin";

type Query = {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
};

// Supabase returns at most 1,000 rows a request, so read in pages (up to 50,000 rows).
async function readAll<T>(build: () => Query): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

// Reads who did what since a date (or ever). The server key is used because the counts span
// every member's private records, such as memos; only IDs and dates are read, never content.
// The caller must already have checked that this is an admin.
export async function loadActivity(
  since: string | null,
): Promise<ActivityRows> {
  const db = createAdminClient();
  // Narrows a query to rows on or after the start of the range, when there is one.
  const after = <Q>(query: Q, column: string): Q =>
    since
      ? (query as unknown as { gte: (column: string, value: string) => Q }).gte(
          column,
          since,
        )
      : query;

  const [
    people,
    completions,
    assignedRows,
    going,
    sessions,
    messages,
    memos,
    videos,
    joins,
    sales,
    habits,
    programDays,
    attended,
  ] = await Promise.all([
    readAll<ActivityRows["people"][number]>(() =>
      db
        .from("profiles")
        .select("id, display_name, role, created_at")
        .order("id"),
    ),
    readAll<ActivityRows["completions"][number]>(() =>
      after(
        db
          .from("task_assignments")
          .select("member_id")
          .not("completed_at", "is", null),
        "completed_at",
      ).order("id"),
    ),
    readAll<{ task: { coach_id: string } | null }>(() =>
      after(
        db.from("task_assignments").select("task:tasks(coach_id)"),
        "created_at",
      ).order("id"),
    ),
    readAll<ActivityRows["going"][number]>(() =>
      after(
        db.from("session_invites").select("member_id").eq("response", "going"),
        "responded_at",
      ).order("session_id"),
    ),
    readAll<ActivityRows["sessions"][number]>(() =>
      after(
        db.from("calendar_sessions").select("coach_id"),
        "created_at",
      ).order("id"),
    ),
    readAll<ActivityRows["messages"][number]>(() =>
      after(db.from("messages").select("sender_id"), "created_at").order("id"),
    ),
    readAll<ActivityRows["memos"][number]>(() =>
      after(db.from("memos").select("user_id"), "created_at").order("id"),
    ),
    readAll<ActivityRows["videos"][number]>(() =>
      after(
        db.from("videos").select("coach_id").eq("status", "ready"),
        "created_at",
      ).order("id"),
    ),
    readAll<ActivityRows["joins"][number]>(() =>
      after(
        db.from("coach_members").select("coach_id, member_id"),
        "created_at",
      ).order("coach_id"),
    ),
    readAll<ActivityRows["sales"][number]>(() =>
      after(
        db
          .from("purchases")
          .select(
            "member_id, seller_id, item_id, item_title, amount_cents, fee_cents, refunded_at, kind, created_at",
          ),
        "created_at",
      ).order("id"),
    ),
    readAll<ActivityRows["habits"][number]>(() =>
      after(db.from("habit_logs").select("user_id"), "created_at").order(
        "habit_id",
      ),
    ),
    // Finished program days count like finished tasks.
    readAll<ActivityRows["completions"][number]>(() =>
      after(
        db.from("program_day_completions").select("member_id"),
        "completed_at",
      )
        .order("enrollment_id")
        .order("day_id"),
    ),
    // Showing up live counts as a session too.
    readAll<ActivityRows["going"][number]>(() =>
      after(db.from("session_attendance").select("member_id"), "joined_at")
        .order("session_id")
        .order("member_id"),
    ),
  ]);

  return {
    people,
    completions: [...completions, ...programDays],
    assigned: assignedRows.flatMap((row) =>
      row.task ? [{ coach_id: row.task.coach_id }] : [],
    ),
    going: [...going, ...attended],
    sessions,
    messages,
    memos,
    videos,
    joins,
    sales,
    habits,
  };
}

// Shared Community activity since a date: posts not kept to "only me", comments and likes, leaving
// out anything moderators removed. Only who and when are read, never what was written.
export async function loadEngagement(
  since: string | null,
): Promise<EngagementRows> {
  const db = createAdminClient();
  const after = <Q>(query: Q): Q =>
    since
      ? (query as unknown as { gte: (column: string, value: string) => Q }).gte(
          "created_at",
          since,
        )
      : query;
  const [posts, comments, likes] = await Promise.all([
    readAll<EngagementRows["posts"][number]>(() =>
      after(
        db
          .from("posts")
          .select("author_id")
          .neq("audience", "private")
          .is("removed_at", null),
      ).order("id"),
    ),
    readAll<EngagementRows["comments"][number]>(() =>
      after(
        db.from("post_comments").select("author_id").is("removed_at", null),
      ).order("id"),
    ),
    readAll<EngagementRows["likes"][number]>(() =>
      after(db.from("post_likes").select("user_id"))
        .order("post_id")
        .order("user_id"),
    ),
  ]);
  return { posts, comments, likes };
}

// Paid Armory sales since a date, for the sales card's trend.
export async function loadSalesSince(since: string) {
  const db = createAdminClient();
  return readAll<{
    amount_cents: number;
    created_at: string;
    refunded_at: string | null;
  }>(() =>
    db
      .from("purchases")
      .select("amount_cents, created_at, refunded_at")
      .gte("created_at", since)
      .order("id"),
  );
}

// Ratings for the average, coach photos for avatars, and item photos for the best sellers.
export async function loadLeaderboardExtras(itemIds: string[]) {
  const db = createAdminClient();
  const [{ data: ratings }, { data: profiles }, { data: items }] =
    await Promise.all([
      db
        .from("coach_reviews")
        .select("rating")
        .eq("hidden", false)
        .limit(10000),
      db
        .from("coach_profiles_public")
        .select("coach_id, photo_path")
        .not("photo_path", "is", null),
      itemIds.length
        ? db
            .from("armory_items")
            .select("id, image_path, kind")
            .in("id", itemIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              image_path: string | null;
              kind: string;
            }[],
          }),
    ]);
  const paths = (profiles ?? []).map((p) => p.photo_path as string);
  const { data: signed } = paths.length
    ? await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60)
    : { data: [] };
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return {
    ratings: (ratings ?? []).map((r) => r.rating as number),
    coachPhotos: new Map(
      (profiles ?? []).flatMap((p) => {
        const url = byPath.get(p.photo_path as string);
        return url ? [[p.coach_id as string, url] as const] : [];
      }),
    ),
    items: new Map(
      (items ?? []).map((i) => [
        i.id as string,
        {
          imagePath: (i.image_path as string | null) ?? null,
          kind: i.kind as string,
        },
      ]),
    ),
  };
}
