import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAccount,
  mockCreateClient,
  mockCreateAdminClient,
  mockGetPlayerUrl,
  mockGetThumbnailUrl,
  mockIsStreamConfigured,
} = vi.hoisted(() => ({
  mockRequireAccount: vi.fn(),
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockGetPlayerUrl: vi.fn(),
  mockGetThumbnailUrl: vi.fn(),
  mockIsStreamConfigured: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAccount: mockRequireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/stream", () => ({
  getPlayerUrl: mockGetPlayerUrl,
  getThumbnailUrl: mockGetThumbnailUrl,
  isStreamConfigured: mockIsStreamConfigured,
}));
vi.mock("@/lib/reminders", () => ({ todayKey: () => "2026-11-18" }));

import {
  loadDailyFuelAssignmentOptions,
  loadMemberDailyFuel,
} from "./member-daily-fuel-data";

const memberId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const videoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Result = { data: unknown; error?: unknown };

function resultClient(results: Record<string, Result>) {
  const operations: Record<string, unknown[][]> = {};
  return {
    operations,
    from(table: string) {
      type Builder = {
        select: (...args: unknown[]) => Builder;
        eq: (...args: unknown[]) => Builder;
        maybeSingle: () => Promise<Result>;
        then: Promise<Result>["then"];
      };
      operations[table] ??= [];
      const rowResult = Promise.resolve(results[table] ?? { data: [] });
      const builder: Builder = {
        select: (...args) => {
          operations[table]!.push(["select", ...args]);
          return builder;
        },
        eq: (...args) => {
          operations[table]!.push(["eq", ...args]);
          return builder;
        },
        maybeSingle: () => Promise.resolve(results[table] ?? { data: null }),
        then: rowResult.then.bind(rowResult),
      };
      return builder;
    },
  };
}

function memberAccount(id = memberId, role = "member") {
  return {
    profile: {
      id,
      role,
      display_name: "Taylor Member",
    },
  };
}

describe("loadMemberDailyFuel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAccount.mockResolvedValue(memberAccount());
    mockIsStreamConfigured.mockReturnValue(true);
    mockGetPlayerUrl.mockResolvedValue("signed-player-url");
    mockGetThumbnailUrl.mockResolvedValue("signed-thumbnail-url");
  });

  it("signs only the ready video assigned to this member for the current Eastern day", async () => {
    const user = resultClient({
      member_daily_fuel_assignments: { data: { video_id: videoId } },
      member_daily_affirmations: { data: { affirmed_at: "2026-11-18T12:00:00Z" } },
      member_daily_fuel_bookmarks: { data: { video_id: videoId } },
    });
    const admin = resultClient({
      videos: {
        data: {
          id: videoId,
          title: "Mobility Flow",
          status: "ready",
          visibility: "members",
          duration_seconds: 480,
          category: "Mobility",
          cloudflare_uid: "stream-internal-uid",
          coach: { display_name: "Coach Sage" },
        },
      },
    });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(admin);

    const result = await loadMemberDailyFuel(memberId, "2026-11-18");

    expect(user.operations.member_daily_fuel_assignments).toContainEqual([
      "eq",
      "member_id",
      memberId,
    ]);
    expect(user.operations.member_daily_fuel_assignments).toContainEqual([
      "eq",
      "day",
      "2026-11-18",
    ]);
    expect(mockGetPlayerUrl).toHaveBeenCalledWith("stream-internal-uid");
    expect(result).toMatchObject({
      day: "2026-11-18",
      video: {
        id: videoId,
        title: "Mobility Flow",
        coachName: "Coach Sage",
        category: "Mobility",
        durationSeconds: 480,
        playerUrl: "signed-player-url",
        thumbnailUrl: "signed-thumbnail-url",
        saved: true,
      },
      affirmed: true,
    });
    expect(JSON.stringify(result)).not.toContain("stream-internal-uid");
  });

  it("does not use the service client or sign media for a different account or role", async () => {
    mockRequireAccount.mockResolvedValue(memberAccount(otherId));
    await expect(loadMemberDailyFuel(memberId, "2026-11-18")).rejects.toThrow(
      "Member Daily Fuel access required",
    );
    mockRequireAccount.mockResolvedValue(memberAccount(memberId, "coach"));
    await expect(loadMemberDailyFuel(memberId, "2026-11-18")).rejects.toThrow(
      "Member Daily Fuel access required",
    );
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockGetPlayerUrl).not.toHaveBeenCalled();
  });

  it("does not sign when no clip is assigned, the assignment day is stale, or the assigned video is not ready", async () => {
    const unassigned = resultClient({
      member_daily_fuel_assignments: { data: null },
      member_daily_affirmations: { data: null },
    });
    mockCreateClient.mockResolvedValue(unassigned);
    const noVideo = await loadMemberDailyFuel(memberId, "2026-11-18");
    expect(noVideo.video).toBeNull();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();

    await expect(loadMemberDailyFuel(memberId, "2026-11-17")).rejects.toThrow(
      "A valid member and Eastern day are required",
    );

    const assigned = resultClient({
      member_daily_fuel_assignments: { data: { video_id: videoId } },
      member_daily_affirmations: { data: null },
      member_daily_fuel_bookmarks: { data: null },
    });
    const notReady = resultClient({
      videos: {
        data: {
          id: videoId,
          title: "Still processing",
          status: "processing",
          visibility: "members",
          duration_seconds: null,
          category: "Other",
          cloudflare_uid: "unready-uid",
          coach: null,
        },
      },
    });
    mockCreateClient.mockResolvedValue(assigned);
    mockCreateAdminClient.mockReturnValue(notReady);
    const hidden = await loadMemberDailyFuel(memberId, "2026-11-18");
    expect(hidden.video).toBeNull();
    expect(hidden.videoError).toBe(true);
    expect(mockGetPlayerUrl).not.toHaveBeenCalled();
  });

  it("does not sign a featured video that is not member-visible", async () => {
    mockCreateClient.mockResolvedValue(
      resultClient({
        member_daily_fuel_assignments: { data: { video_id: videoId } },
        member_daily_affirmations: { data: null },
        member_daily_fuel_bookmarks: { data: null },
      }),
    );
    mockCreateAdminClient.mockReturnValue(
      resultClient({
        videos: {
          data: {
            id: videoId,
            title: "Program clip",
            status: "ready",
            visibility: "program_only",
            duration_seconds: 120,
            category: "Technique",
            cloudflare_uid: "program-only-uid",
            coach: { display_name: "Coach Sage" },
          },
        },
      }),
    );

    const result = await loadMemberDailyFuel(memberId, "2026-11-18");

    expect(result.video).toBeNull();
    expect(result.videoError).toBe(true);
    expect(mockGetPlayerUrl).not.toHaveBeenCalled();
  });

  it("does not offer a program-only video in the Daily Fuel assignment form", async () => {
    const supabase = resultClient({
      videos: {
        data: {
          id: videoId,
          coach_id: memberId,
          status: "ready",
          visibility: "program_only",
        },
      },
    });
    mockRequireAccount.mockResolvedValue(memberAccount(memberId, "coach"));
    mockCreateClient.mockResolvedValue(supabase);

    await expect(loadDailyFuelAssignmentOptions(videoId)).resolves.toEqual({
      videoReady: false,
      members: [],
      error: false,
    });
  });
});
