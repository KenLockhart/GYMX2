import "server-only";
import type { ActivityRows } from "@/lib/leaderboard";
import { createAdminClient } from "@/lib/supabase/admin";

type Query = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
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
export async function loadActivity(since: string | null): Promise<ActivityRows> {
  const db = createAdminClient();
  // Narrows a query to rows on or after the start of the range, when there is one.
  const after = <Q,>(query: Q, column: string): Q =>
    since ? (query as unknown as { gte: (column: string, value: string) => Q }).gte(column, since) : query;

  const [people, completions, assignedRows, going, sessions, messages, memos, videos, joins, sales] =
    await Promise.all([
      readAll<ActivityRows["people"][number]>(() => db.from("profiles").select("id, display_name, role").order("id")),
      readAll<ActivityRows["completions"][number]>(() =>
        after(db.from("task_assignments").select("member_id").not("completed_at", "is", null), "completed_at").order("id"),
      ),
      readAll<{ task: { coach_id: string } | null }>(() =>
        after(db.from("task_assignments").select("task:tasks(coach_id)"), "created_at").order("id"),
      ),
      readAll<ActivityRows["going"][number]>(() =>
        after(db.from("session_invites").select("member_id").eq("response", "going"), "responded_at").order("session_id"),
      ),
      readAll<ActivityRows["sessions"][number]>(() =>
        after(db.from("calendar_sessions").select("coach_id"), "created_at").order("id"),
      ),
      readAll<ActivityRows["messages"][number]>(() =>
        after(db.from("messages").select("sender_id"), "created_at").order("id"),
      ),
      readAll<ActivityRows["memos"][number]>(() => after(db.from("memos").select("user_id"), "created_at").order("id")),
      readAll<ActivityRows["videos"][number]>(() =>
        after(db.from("videos").select("coach_id").eq("status", "ready"), "created_at").order("id"),
      ),
      readAll<ActivityRows["joins"][number]>(() =>
        after(db.from("coach_members").select("coach_id, member_id"), "created_at").order("coach_id"),
      ),
      readAll<ActivityRows["sales"][number]>(() =>
        after(
          db.from("purchases").select("member_id, seller_id, item_id, item_title, amount_cents, fee_cents, refunded_at, kind"),
          "created_at",
        ).order("id"),
      ),
    ]);

  return {
    people,
    completions,
    assigned: assignedRows.flatMap((row) => (row.task ? [{ coach_id: row.task.coach_id }] : [])),
    going,
    sessions,
    messages,
    memos,
    videos,
    joins,
    sales,
  };
}
