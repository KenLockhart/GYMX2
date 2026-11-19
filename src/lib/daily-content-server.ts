import "server-only";

import { requireCoachOrAdmin } from "@/lib/auth";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import type {
  DailyContentKind,
  DailyContentPortalData,
  DailyContentPortalItem,
  DailyContentPortalRevision,
  DailyContentPortalSlot,
  DailyContentPortalVideoOption,
} from "@/lib/daily-content";

type ItemRow = {
  id: string;
  kind: string;
  title: string;
  status: string;
  updated_at: string;
};

type RevisionRow = {
  id: string;
  item_id: string;
  kind: string;
  revision_number: number;
  title_snapshot: string;
  video_id: string | null;
  quote_text: string | null;
  quote_attribution: string | null;
  affirmation_text: string | null;
  created_at: string;
};

type SlotRow = {
  id: string;
  item_id: string;
  revision_id: string;
  content_kind: string;
  day: string;
  status: string;
};

type VideoRow = {
  id: string;
  title: string;
  status: string;
  visibility: string;
  created_at: string;
  duration_seconds: number | string | null;
};

const ITEM_PAGE_SIZE = 100;
const VIDEO_PAGE_SIZE = 200;
const RELATED_PAGE_SIZE = 500;
const RELATED_PAGE_LIMIT = 10;

async function loadAllRelatedRows<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  let error = false;
  let truncated = false;
  for (let page = 0; page < RELATED_PAGE_LIMIT; page += 1) {
    const from = page * RELATED_PAGE_SIZE;
    const result = await loadPage(from, from + RELATED_PAGE_SIZE - 1);
    if (result.error) error = true;
    const pageRows = (result.data ?? []) as T[];
    rows.push(...pageRows);
    if (pageRows.length < RELATED_PAGE_SIZE) break;
    if (page === RELATED_PAGE_LIMIT - 1) {
      const probe = await loadPage(
        RELATED_PAGE_LIMIT * RELATED_PAGE_SIZE,
        RELATED_PAGE_LIMIT * RELATED_PAGE_SIZE,
      );
      if (probe.error) error = true;
      truncated = (probe.data ?? []).length > 0;
    }
  }
  return { rows, error, truncated };
}

function isKind(value: string): value is DailyContentKind {
  return value === "video" || value === "quote" || value === "affirmation";
}

function isItemStatus(value: string): value is DailyContentPortalItem["status"] {
  return value === "draft" || value === "active" || value === "archived";
}

function isSlotStatus(value: string): value is DailyContentPortalSlot["status"] {
  return value === "scheduled" || value === "published" || value === "cancelled";
}

function safeDuration(value: number | string | null) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

export async function loadDailyContentPortal(input: { page?: number } = {}): Promise<DailyContentPortalData> {
  const { profile } = await requireCoachOrAdmin();
  const role = profile.role;
  if (role !== "coach" && role !== "admin")
    throw new Error("Daily Content staff access required.");

  const supabase = await createClient();
  const page = Number.isSafeInteger(input.page) && (input.page ?? 1) > 0
    ? Math.min(input.page ?? 1, 10_000)
    : 1;
  const itemStart = (page - 1) * ITEM_PAGE_SIZE;
  const videoStart = (page - 1) * VIDEO_PAGE_SIZE;
  const [itemResult, videoResult] = await Promise.all([
    supabase
      .from("daily_content_items")
      .select("id, kind, title, status, updated_at")
      .eq("owner_id", profile.id)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(itemStart, itemStart + ITEM_PAGE_SIZE),
    supabase
      .from("videos")
      .select("id, title, status, visibility, created_at, duration_seconds")
      .eq("coach_id", profile.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(videoStart, videoStart + VIDEO_PAGE_SIZE),
  ]);

  const returnedItems = (itemResult.data ?? []) as unknown as ItemRow[];
  const returnedVideos = (videoResult.data ?? []) as unknown as VideoRow[];
  const hasMoreItems = returnedItems.length > ITEM_PAGE_SIZE;
  const hasMoreVideos = returnedVideos.length > VIDEO_PAGE_SIZE;
  const itemRows = returnedItems.slice(0, ITEM_PAGE_SIZE);
  const videoRows = returnedVideos.slice(0, VIDEO_PAGE_SIZE);
  const itemIds = itemRows.map((row) => row.id);
  const [revisionResult, slotResult] = itemIds.length
    ? await Promise.all([
        loadAllRelatedRows<RevisionRow>((from, to) => supabase
          .from("daily_content_revisions")
          .select("id, item_id, kind, revision_number, title_snapshot, video_id, quote_text, quote_attribution, affirmation_text, created_at")
          .in("item_id", itemIds)
          .order("revision_number", { ascending: false })
          .order("item_id", { ascending: true })
          .range(from, to)),
        loadAllRelatedRows<SlotRow>((from, to) => supabase
          .from("daily_content_slots")
          .select("id, item_id, revision_id, content_kind, day, status")
          .in("item_id", itemIds)
          .order("day", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)),
      ])
    : [
        { rows: [], error: false, truncated: false },
        { rows: [], error: false, truncated: false },
      ];

  const revisionRows = revisionResult.rows;
  const revisionsByItem = new Map<string, DailyContentPortalRevision>();
  const revisionById = new Map<string, RevisionRow>();
  for (const row of revisionRows) {
    revisionById.set(row.id, row);
    if (revisionsByItem.has(row.item_id) || !isKind(row.kind)) continue;
    revisionsByItem.set(row.item_id, {
      id: row.id,
      number: row.revision_number,
      titleSnapshot: row.title_snapshot,
      videoId: row.video_id,
      quoteText: row.quote_text,
      quoteAttribution: row.quote_attribution,
      affirmationText: row.affirmation_text,
      createdAt: row.created_at,
    });
  }

  const items: DailyContentPortalItem[] = itemRows.flatMap((row) => {
    if (!isKind(row.kind) || !isItemStatus(row.status)) return [];
    return [{
      id: row.id,
      kind: row.kind,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      latestRevision: revisionsByItem.get(row.id) ?? null,
    }];
  });

  const slotRows = slotResult.rows;
  const titleByItem = new Map(items.map((item) => [item.id, item.title]));
  const slots: DailyContentPortalSlot[] = slotRows.flatMap((row) => {
    const revision = revisionById.get(row.revision_id);
    if (!isKind(row.content_kind) || !isSlotStatus(row.status) || !revision) return [];
    return [{
      id: row.id,
      itemId: row.item_id,
      revisionId: row.revision_id,
      kind: row.content_kind,
      title: revision.title_snapshot || titleByItem.get(row.item_id) || "",
      day: row.day,
      status: row.status,
    }];
  });

  const videoOptions: DailyContentPortalVideoOption[] =
    videoRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      visibility: row.visibility,
      createdAt: row.created_at,
      durationSeconds: safeDuration(row.duration_seconds),
    }));

  return {
    role,
    today: todayKey(),
    page,
    hasMoreItems,
    hasMoreVideos,
    truncated: revisionResult.truncated || slotResult.truncated,
    items,
    videoOptions,
    slots,
    error: Boolean(itemResult.error || videoResult.error || revisionResult.error || slotResult.error),
  };
}
