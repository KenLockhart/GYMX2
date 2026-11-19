import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireCoachOrAdmin, mockCreateClient } = vi.hoisted(() => ({
  mockRequireCoachOrAdmin: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireCoachOrAdmin: mockRequireCoachOrAdmin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/reminders", () => ({ todayKey: () => "2026-11-19" }));

import { loadDailyContentPortal } from "./daily-content-server";

const coachId = "11111111-1111-4111-8111-111111111111";
const itemId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type RowSet = Record<string, unknown[]>;
type RangeCall = { table: string; from: number; to: number };

function queryClient(rows: RowSet) {
  const ranges: RangeCall[] = [];
  return {
    ranges,
    from(table: string) {
      let start = 0;
      let end = 999;
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        in: () => query,
        range: (from: number, to: number) => {
          start = from;
          end = to;
          ranges.push({ table, from, to });
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: (rows[table] ?? []).slice(start, end + 1), error: null })
            .then(resolve, reject),
      };
      return query;
    },
  };
}

function item(id: string, number: number) {
  return {
    id,
    kind: "quote",
    title: `Quote ${number}`,
    status: "draft",
    updated_at: `2026-11-${String((number % 28) + 1).padStart(2, "0")}T12:00:00Z`,
  };
}

describe("Daily Content portal loader paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCoachOrAdmin.mockResolvedValue({ profile: { id: coachId, role: "coach" } });
  });

  it("requests one lookahead row and returns explicit page flags for items and videos", async () => {
    const items = Array.from({ length: 201 }, (_, index) => item(`item-${index}`, index));
    const videos = Array.from({ length: 401 }, (_, index) => ({
      id: `video-${index}`,
      title: `Video ${index}`,
      status: index === 400 ? "processing" : "ready",
      visibility: "members",
      created_at: "2026-11-18T12:00:00Z",
      duration_seconds: 60,
    }));
    const client = queryClient({ daily_content_items: items, videos });
    mockCreateClient.mockResolvedValue(client);

    const data = await loadDailyContentPortal({ page: 2 });

    expect(client.ranges).toContainEqual({ table: "daily_content_items", from: 100, to: 200 });
    expect(client.ranges).toContainEqual({ table: "videos", from: 200, to: 400 });
    expect(data).toMatchObject({
      page: 2,
      hasMoreItems: true,
      hasMoreVideos: true,
      truncated: false,
      error: false,
    });
    expect(data.items).toHaveLength(100);
    expect(data.videoOptions).toHaveLength(200);
    expect(data.items[0]?.id).toBe("item-100");
    expect(data.videoOptions[0]?.id).toBe("video-200");
  });

  it("pages inner revisions and reports an explicit warning when the safety ceiling is exceeded", async () => {
    const revisions = Array.from({ length: 5_001 }, (_, index) => ({
      id: `revision-${5_001 - index}`,
      item_id: itemId,
      kind: "quote",
      revision_number: 5_001 - index,
      title_snapshot: `Revision ${5_001 - index}`,
      video_id: null,
      quote_text: "A small step.",
      quote_attribution: null,
      affirmation_text: null,
      created_at: "2026-11-19T12:00:00Z",
    }));
    const client = queryClient({
      daily_content_items: [item(itemId, 1)],
      videos: [],
      daily_content_revisions: revisions,
      daily_content_slots: [],
    });
    mockCreateClient.mockResolvedValue(client);

    const data = await loadDailyContentPortal();

    expect(client.ranges.filter((call) => call.table === "daily_content_revisions")).toHaveLength(11);
    expect(data.truncated).toBe(true);
    expect(data.items[0]?.latestRevision).toMatchObject({
      number: 5_001,
      titleSnapshot: "Revision 5001",
    });
  });
});
