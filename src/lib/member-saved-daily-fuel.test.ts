import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAccount,
  mockCreateClient,
  mockCreateAdminClient,
  mockGetPlayerUrl,
  mockIsStreamConfigured,
} = vi.hoisted(() => ({
  mockRequireAccount: vi.fn(),
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockGetPlayerUrl: vi.fn(),
  mockIsStreamConfigured: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAccount: mockRequireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/stream", () => ({
  getPlayerUrl: mockGetPlayerUrl,
  isStreamConfigured: mockIsStreamConfigured,
}));
vi.mock("@/lib/reminders", () => ({ todayKey: () => "2026-11-18" }));

import {
  loadSavedMemberDailyFuelPlayback,
  loadSavedMemberDailyFuelVideos,
} from "./member-saved-daily-fuel";

const memberId = "11111111-1111-4111-8111-111111111111";
const videoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const futureVideoId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Result = { data: unknown; error?: unknown };

function resultClient(results: Record<string, Result | Result[]>) {
  const operations: Record<string, unknown[][]> = {};
  const reads: Record<string, number> = {};
  return {
    operations,
    from(table: string) {
      operations[table] ??= [];
      const configured = results[table] ?? { data: [] };
      const readIndex = reads[table] ?? 0;
      reads[table] = readIndex + 1;
      const result = Array.isArray(configured)
        ? (configured[Math.min(readIndex, configured.length - 1)] ?? { data: [] })
        : configured;
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "lte", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          operations[table]!.push([method, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = () => {
        operations[table]!.push(["maybeSingle"]);
        return Promise.resolve(result);
      };
      builder.then = (
        resolve: (value: Result) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  };
}

function memberAccount(role = "member") {
  return { profile: { id: memberId, role, display_name: "Taylor Member" } };
}

function video(overrides: Record<string, unknown> = {}) {
  return {
    id: videoId,
    title: "Strength Basics",
    description: null,
    status: "ready",
    visibility: "members",
    duration_seconds: 300,
    category: "Strength",
    cloudflare_uid: "opaque-stream-uid",
    coach: { display_name: "Coach Sage" },
    ...overrides,
  };
}

describe("saved Daily Fuel access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAccount.mockResolvedValue(memberAccount());
    mockIsStreamConfigured.mockReturnValue(true);
    mockGetPlayerUrl.mockResolvedValue("short-lived-player-token-url");
  });

  it("lists only saved videos with an own assignment dated no later than today", async () => {
    const user = resultClient({
      member_daily_fuel_bookmarks: {
        data: [
          { video_id: videoId, created_at: "2026-11-10T10:00:00Z" },
          { video_id: futureVideoId, created_at: "2026-11-11T10:00:00Z" },
        ],
      },
      member_daily_fuel_assignments: {
        data: [
          { video_id: futureVideoId, day: "2026-11-19" },
          { video_id: videoId, day: "2026-11-12" },
        ],
      },
    });
    const admin = resultClient({ videos: { data: [video()] } });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(admin);

    const result = await loadSavedMemberDailyFuelVideos();

    expect(user.operations.member_daily_fuel_bookmarks).toContainEqual([
      "eq",
      "member_id",
      memberId,
    ]);
    expect(user.operations.member_daily_fuel_assignments).toContainEqual([
      "eq",
      "member_id",
      memberId,
    ]);
    expect(user.operations.member_daily_fuel_assignments).toContainEqual([
      "lte",
      "day",
      "2026-11-18",
    ]);
    expect(admin.operations.videos).toContainEqual(["in", "id", [videoId]]);
    expect(result.videos.map((item) => item.id)).toEqual([videoId]);
    expect(result.videos[0]).toMatchObject({
      title: "Strength Basics",
      coachName: "Coach Sage",
      savedAt: "2026-11-10T10:00:00Z",
    });
    expect(JSON.stringify(result)).not.toContain("opaque-stream-uid");
    expect(mockGetPlayerUrl).not.toHaveBeenCalled();
  });

  it("does not use admin video access when there are no bookmarks or eligible assignments", async () => {
    mockCreateClient.mockResolvedValueOnce(
      resultClient({ member_daily_fuel_bookmarks: { data: [] } }),
    );
    await expect(loadSavedMemberDailyFuelVideos()).resolves.toEqual({
      videos: [],
      error: false,
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();

    mockCreateClient.mockResolvedValueOnce(
      resultClient({
        member_daily_fuel_bookmarks: {
          data: [{ video_id: videoId, created_at: "2026-11-10T10:00:00Z" }],
        },
        member_daily_fuel_assignments: { data: [] },
      }),
    );
    await expect(loadSavedMemberDailyFuelVideos()).resolves.toEqual({
      videos: [],
      error: false,
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("requires the caller's bookmark and a nonfuture assignment before signing one ready member-visible video", async () => {
    const user = resultClient({
      member_daily_fuel_bookmarks: {
        data: { video_id: videoId, created_at: "2026-11-10T10:00:00Z" },
      },
      member_daily_fuel_assignments: {
        data: { video_id: videoId, day: "2026-11-12" },
      },
    });
    const admin = resultClient({
      videos: { data: video({ visibility: "private" }) },
    });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(admin);

    const result = await loadSavedMemberDailyFuelPlayback(videoId);

    expect(user.operations.member_daily_fuel_bookmarks).toContainEqual([
      "eq",
      "member_id",
      memberId,
    ]);
    expect(user.operations.member_daily_fuel_assignments).toContainEqual([
      "lte",
      "day",
      "2026-11-18",
    ]);
    expect(mockGetPlayerUrl).toHaveBeenCalledWith("opaque-stream-uid");
    expect(result.video).toMatchObject({
      id: videoId,
      playerUrl: "short-lived-player-token-url",
      coachName: "Coach Sage",
    });
    expect(
      user.operations.member_daily_fuel_bookmarks.filter(([method]) => method === "maybeSingle"),
    ).toHaveLength(2);
    expect(user.operations.member_daily_fuel_assignments.filter(([method]) => method === "lte"))
      .toHaveLength(2);
  });

  it("withholds a signed URL when the saved Daily Content grant is revoked during signing", async () => {
    const user = resultClient({
      member_daily_fuel_bookmarks: [
        { data: { video_id: videoId, created_at: "2026-11-10T10:00:00Z" } },
        { data: { video_id: videoId, created_at: "2026-11-10T10:00:00Z" } },
      ],
      member_daily_fuel_assignments: [{ data: null }, { data: null }],
      member_daily_content_video_grants: [
        { data: { video_id: videoId, day: "2026-11-18" } },
        { data: null },
      ],
    });
    const admin = resultClient({ videos: { data: video() } });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(admin);

    await expect(loadSavedMemberDailyFuelPlayback(videoId)).resolves.toEqual({
      video: null,
      error: false,
    });
    expect(mockGetPlayerUrl).toHaveBeenCalledOnce();
  });

  it("withholds a signed URL when the own bookmark is removed during signing", async () => {
    const user = resultClient({
      member_daily_fuel_bookmarks: [
        { data: { video_id: videoId, created_at: "2026-11-10T10:00:00Z" } },
        { data: null },
      ],
      member_daily_fuel_assignments: [
        { data: { video_id: videoId, day: "2026-11-12" } },
        { data: { video_id: videoId, day: "2026-11-12" } },
      ],
    });
    const admin = resultClient({ videos: { data: video() } });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(admin);

    await expect(loadSavedMemberDailyFuelPlayback(videoId)).resolves.toEqual({
      video: null,
      error: false,
    });
    expect(mockGetPlayerUrl).toHaveBeenCalledOnce();
  });

  it("rechecks video readiness and visibility after signing", async () => {
    const user = resultClient({
      member_daily_fuel_bookmarks: {
        data: { video_id: videoId, created_at: "2026-11-10T10:00:00Z" },
      },
      member_daily_fuel_assignments: {
        data: { video_id: videoId, day: "2026-11-12" },
      },
    });
    const admin = resultClient({
      videos: [{ data: video() }, { data: video({ status: "processing" }) }],
    });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(admin);

    await expect(loadSavedMemberDailyFuelPlayback(videoId)).resolves.toEqual({
      video: null,
      error: false,
    });
    expect(mockGetPlayerUrl).toHaveBeenCalledOnce();
  });

  it("keeps legacy nonfuture assignments sufficient through post-sign revalidation", async () => {
    const user = resultClient({
      member_daily_fuel_bookmarks: {
        data: { video_id: videoId, created_at: "2026-11-10T10:00:00Z" },
      },
      member_daily_fuel_assignments: {
        data: { video_id: videoId, day: "2026-11-12" },
      },
    });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(resultClient({ videos: { data: video() } }));

    await expect(loadSavedMemberDailyFuelPlayback(videoId)).resolves.toMatchObject({
      video: { id: videoId, playerUrl: "short-lived-player-token-url" },
      error: false,
    });
  });

  it.each([
    ["missing bookmark", null, { video_id: videoId, day: "2026-11-12" }],
    ["missing assignment", { video_id: videoId }, null],
    ["future-only assignment", { video_id: videoId }, { video_id: videoId, day: "2026-11-19" }],
  ])("refuses playback for %s without reading or signing video details", async (_case, bookmark, assignment) => {
    mockCreateClient.mockResolvedValue(
      resultClient({
        member_daily_fuel_bookmarks: { data: bookmark },
        member_daily_fuel_assignments: { data: assignment },
      }),
    );

    await expect(loadSavedMemberDailyFuelPlayback(videoId)).resolves.toEqual({
      video: null,
      error: false,
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockGetPlayerUrl).not.toHaveBeenCalled();
  });

  it("denies unready and program-only videos after the own bookmark/assignment checks", async () => {
    const user = resultClient({
      member_daily_fuel_bookmarks: { data: { video_id: videoId } },
      member_daily_fuel_assignments: {
        data: { video_id: videoId, day: "2026-11-12" },
      },
    });
    mockCreateClient.mockResolvedValue(user);
    for (const candidate of [
      video({ status: "processing" }),
      video({ visibility: "program_only" }),
    ]) {
      mockCreateAdminClient.mockReturnValue(
        resultClient({ videos: { data: candidate } }),
      );
      await expect(loadSavedMemberDailyFuelPlayback(videoId)).resolves.toEqual({
        video: null,
        error: false,
      });
    }
    expect(mockGetPlayerUrl).not.toHaveBeenCalled();
  });

  it("denies nonmembers without reading bookmark or video details", async () => {
    mockRequireAccount.mockResolvedValue(memberAccount("coach"));

    await expect(loadSavedMemberDailyFuelVideos()).resolves.toEqual({
      videos: [],
      error: true,
    });
    await expect(loadSavedMemberDailyFuelPlayback(videoId)).resolves.toEqual({
      video: null,
      error: false,
    });
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockGetPlayerUrl).not.toHaveBeenCalled();
  });
});
