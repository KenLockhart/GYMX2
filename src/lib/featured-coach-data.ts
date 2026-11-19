import "server-only";
import type {
  FeaturedActivityRow,
  FeaturedMemberRow,
  FeaturedSaleRow,
} from "@/lib/featured-coach";
import { readExactPages, type ExactPage } from "@/lib/featured-coach";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 1_000;
const COACH_BATCH_SIZE = 100;

type Page<T> = ExactPage<T>;

function batches<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function loadForCoachBatches<T>(
  coachIds: string[],
  request: (ids: string[], from: number, to: number) => PromiseLike<Page<T>>,
  keyOf: (row: T) => string,
) {
  const result: T[] = [];
  for (const ids of batches(coachIds, COACH_BATCH_SIZE)) {
    result.push(
      ...(await readExactPages((from, to) => request(ids, from, to), keyOf, PAGE_SIZE)),
    );
  }
  return result;
}

async function loadCoachNames(coachIds: string[]) {
  const db = createAdminClient();
  const names = new Map<string, string>();
  for (const ids of batches(coachIds, COACH_BATCH_SIZE)) {
    const rows = await readExactPages(
      (from, to) =>
        db
          .from("profiles")
          .select("id, display_name", { count: "exact" })
          .in("id", ids)
          .order("id", { ascending: true })
          .range(from, to),
      (row) => row.id,
      PAGE_SIZE,
    );
    for (const row of rows) names.set(row.id, row.display_name);
  }
  if (names.size !== new Set(coachIds).size) {
    throw new Error("Featured coach profiles could not be read completely.");
  }
  return names;
}

/**
 * Reads only aggregate inputs for published coaches in a rolling 30-day window.
 * The caller must already have required an admin. Returned rows contain no names,
 * message contents, customer addresses, or payment identifiers; the page reduces
 * these inputs to numeric metrics before passing anything to the client component.
 */
export async function loadFeaturedCoachInputs(
  coachIds: string[],
  now: Date,
) {
  if (!coachIds.length) {
    return { sales: [], members: [], activity: [], coachNames: new Map<string, string>() };
  }

  const db = createAdminClient();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const through = now.toISOString();

  const [sales, members, sessions, assignments, videos, coachNames] = await Promise.all([
    loadForCoachBatches<FeaturedSaleRow & { id: string }>(
      coachIds,
      (ids, from, to) =>
        db
          .from("purchases")
          .select(
            "id, seller_id, kind, amount_cents, shipping_cents, refunded_at, created_at",
            { count: "exact" },
          )
          .in("seller_id", ids)
          .gte("created_at", since)
          .lte("created_at", through)
          .order("id", { ascending: true })
          .range(from, to),
      (row) => row.id,
    ),
    loadForCoachBatches<FeaturedMemberRow>(
      coachIds,
      (ids, from, to) =>
        db
          .from("coach_members")
          .select("coach_id, member_id, created_at", { count: "exact" })
          .in("coach_id", ids)
          .gte("created_at", since)
          .lte("created_at", through)
          .order("coach_id", { ascending: true })
          .order("member_id", { ascending: true })
          .range(from, to),
      (row) => `${row.coach_id}\u0000${row.member_id}`,
    ),
    loadForCoachBatches<{ id: string; coach_id: string; created_at: string }>(
      coachIds,
      (ids, from, to) =>
        db
          .from("calendar_sessions")
          .select("id, coach_id, created_at", { count: "exact" })
          .in("coach_id", ids)
          .gte("created_at", since)
          .lte("created_at", through)
          .order("id", { ascending: true })
          .range(from, to),
      (row) => row.id,
    ),
    loadForCoachBatches<{
      id: string;
      task: { coach_id: string }[] | { coach_id: string } | null;
      created_at: string;
    }>(
      coachIds,
      (ids, from, to) =>
        db
          .from("task_assignments")
          .select("id, created_at, task:tasks!inner(coach_id)", { count: "exact" })
          .in("task.coach_id", ids)
          .gte("created_at", since)
          .lte("created_at", through)
          .order("id", { ascending: true })
          .range(from, to),
      (row) => row.id,
    ),
    loadForCoachBatches<{ id: string; coach_id: string; created_at: string }>(
      coachIds,
      (ids, from, to) =>
        db
          .from("videos")
          .select("id, coach_id, created_at", { count: "exact" })
          .eq("status", "ready")
          .in("coach_id", ids)
          .gte("created_at", since)
          .lte("created_at", through)
          .order("id", { ascending: true })
          .range(from, to),
      (row) => row.id,
    ),
    loadCoachNames(coachIds),
  ]);

  const activity: FeaturedActivityRow[] = [
    ...sessions,
    ...videos,
    ...assignments.flatMap((row) => {
      const tasks = Array.isArray(row.task) ? row.task : row.task ? [row.task] : [];
      return tasks.map((task) => ({ coach_id: task.coach_id, created_at: row.created_at }));
    }),
  ];

  return { sales, members, activity, coachNames };
}
