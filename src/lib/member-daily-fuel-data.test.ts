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
    rpc: vi.fn().mockResolvedValue({
      data: [{
        day: "2026-11-18",
        video_id: null,
        video_source: null,
        video_slot_id: null,
        video_revision_id: null,
        video_title: null,
        video_coach_name: null,
        quote_text: null,
        quote_attribution: null,
        quote_revision_id: null,
        affirmation_text: null,
        affirmation_revision_id: null,
        affirmation_acknowledged: false,
      }],
      error: null,
    }),
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
    const user = resultClient({ member_daily_fuel_bookmarks: { data: { video_id: videoId } } });
    user.rpc.mockResolvedValue({ data: [{
      day: "2026-11-18",
      video_id: videoId,
      video_source: "legacy",
      video_slot_id: null,
      video_revision_id: null,
      video_title: "Mobility Flow",
      video_coach_name: "Coach Sage",
      quote_text: "A little progress counts.",
      quote_attribution: "Coach Sage",
      quote_revision_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      affirmation_text: "I can grow today.",
      affirmation_revision_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      affirmation_acknowledged: true,
    }], error: null });
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

    expect(user.rpc).toHaveBeenCalledTimes(2);
    expect(user.rpc).toHaveBeenCalledWith("resolve_member_daily_content");
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
      quote: {
        text: "A little progress counts.",
        attribution: "Coach Sage",
        revisionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      affirmation: {
        text: "I can grow today.",
        revisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
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
    const unassigned = resultClient({});
    mockCreateClient.mockResolvedValue(unassigned);
    const noVideo = await loadMemberDailyFuel(memberId, "2026-11-18");
    expect(noVideo.video).toBeNull();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();

    await expect(loadMemberDailyFuel(memberId, "2026-11-17")).rejects.toThrow(
      "A valid member and Eastern day are required",
    );

    const assigned = resultClient({ member_daily_fuel_bookmarks: { data: null } });
    assigned.rpc.mockResolvedValue({ data: [{
      day: "2026-11-18",
      video_id: videoId,
      video_source: "legacy",
      video_slot_id: null,
      video_revision_id: null,
      video_title: null,
      video_coach_name: null,
      quote_text: null,
      quote_attribution: null,
      quote_revision_id: null,
      affirmation_text: null,
      affirmation_revision_id: null,
      affirmation_acknowledged: false,
    }], error: null });
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
    const user = resultClient({ member_daily_fuel_bookmarks: { data: null } });
    user.rpc.mockResolvedValue({ data: [{
      day: "2026-11-18",
      video_id: videoId,
      video_source: "coach",
      video_slot_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      video_revision_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      video_title: "Program clip",
      video_coach_name: "Coach Sage",
      quote_text: null,
      quote_attribution: null,
      quote_revision_id: null,
      affirmation_text: null,
      affirmation_revision_id: null,
      affirmation_acknowledged: false,
    }], error: null });
    mockCreateClient.mockResolvedValue(user);
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

  it("does not return a signed token if the member grant changes while signing", async () => {
    const user = resultClient({ member_daily_fuel_bookmarks: { data: null } });
    user.rpc
      .mockResolvedValueOnce({ data: [{
        day: "2026-11-18",
        video_id: videoId,
        video_source: "coach",
        video_slot_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        video_revision_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        video_title: "Mobility Flow",
        video_coach_name: "Coach Sage",
        quote_text: null,
        quote_attribution: null,
        quote_revision_id: null,
        affirmation_text: null,
        affirmation_revision_id: null,
        affirmation_acknowledged: false,
      }], error: null })
      .mockResolvedValueOnce({ data: [{
        day: "2026-11-18",
        video_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        video_source: "admin",
        video_slot_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        video_revision_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        video_title: "Changed clip",
        video_coach_name: "Daily Admin",
        quote_text: null,
        quote_attribution: null,
        quote_revision_id: null,
        affirmation_text: null,
        affirmation_revision_id: null,
        affirmation_acknowledged: false,
      }], error: null });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(resultClient({
      videos: {
        data: {
          id: videoId,
          title: "Mobility Flow",
          status: "ready",
          visibility: "members",
          duration_seconds: 300,
          category: "Mobility",
          cloudflare_uid: "stream-private-uid",
          coach: { display_name: "Coach Sage" },
        },
      },
    }));

    const result = await loadMemberDailyFuel(memberId, "2026-11-18");

    expect(result.video).toBeNull();
    expect(result.videoError).toBe(true);
    expect(mockGetPlayerUrl).toHaveBeenCalledWith("stream-private-uid");
    expect(JSON.stringify(result)).not.toContain("stream-private-uid");
  });

  it("does not display or sign resolver data from a different Eastern day", async () => {
    const user = resultClient({ member_daily_fuel_bookmarks: { data: null } });
    user.rpc.mockResolvedValue({ data: [{
      day: "2026-11-19",
      video_id: videoId,
      video_source: "admin",
      video_slot_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      video_revision_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      video_title: "Tomorrow's clip",
      video_coach_name: "Daily Admin",
      quote_text: "Tomorrow's quote",
      quote_attribution: null,
      quote_revision_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      affirmation_text: "Tomorrow's affirmation",
      affirmation_revision_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      affirmation_acknowledged: true,
    }], error: null });
    mockCreateClient.mockResolvedValue(user);

    const result = await loadMemberDailyFuel(memberId, "2026-11-18");

    expect(result).toMatchObject({
      day: "2026-11-18",
      video: null,
      videoError: true,
      quote: null,
      quoteError: true,
      affirmation: null,
      affirmed: false,
      affirmationError: true,
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockGetPlayerUrl).not.toHaveBeenCalled();
  });

  it("revokes signed output when Eastern day rolls over while the provider token is minted", async () => {
    const user = resultClient({ member_daily_fuel_bookmarks: { data: null } });
    const current = {
      day: "2026-11-18",
      video_id: videoId,
      video_source: "coach",
      video_slot_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      video_revision_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      video_title: "Today clip",
      video_coach_name: "Coach Sage",
      quote_text: "Today quote",
      quote_attribution: null,
      quote_revision_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      affirmation_text: "Today affirmation",
      affirmation_revision_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      affirmation_acknowledged: true,
    };
    user.rpc
      .mockResolvedValueOnce({ data: [current], error: null })
      .mockResolvedValueOnce({ data: [{ ...current, day: "2026-11-19" }], error: null });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(resultClient({
      videos: {
        data: {
          id: videoId,
          title: "Today clip",
          status: "ready",
          visibility: "members",
          duration_seconds: 120,
          category: "Technique",
          cloudflare_uid: "private-stream-uid",
          coach: { display_name: "Coach Sage" },
        },
      },
    }));

    const result = await loadMemberDailyFuel(memberId, "2026-11-18");

    expect(result.video).toBeNull();
    expect(result.videoError).toBe(true);
    expect(result.quoteError).toBe(true);
    expect(result.affirmationError).toBe(true);
    expect(mockGetPlayerUrl).toHaveBeenCalledWith("private-stream-uid");
    expect(JSON.stringify(result)).not.toContain("private-stream-uid");
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
