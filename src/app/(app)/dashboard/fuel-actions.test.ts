import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireAccount, mockCreateClient, mockRevalidatePath } = vi.hoisted(() => ({
  mockRequireAccount: vi.fn(),
  mockCreateClient: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/auth", () => ({ requireAccount: mockRequireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/reminders", () => ({ todayKey: () => "2026-11-18" }));

import { setMemberDailyAffirmation, setMemberDailyFuelBookmark } from "./fuel-actions";

const memberId = "11111111-1111-4111-8111-111111111111";
const videoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const replacementVideoId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const affirmationRevisionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("Daily Fuel member actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
  });

  it("persists the affirmation through the authenticated RPC using the current Eastern day", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mockCreateClient.mockResolvedValue({ rpc });

    await expect(setMemberDailyAffirmation("2026-11-18", affirmationRevisionId, true)).resolves.toEqual({
      ok: true,
      value: true,
    });
    expect(rpc).toHaveBeenCalledWith("set_member_daily_content_acknowledgment", {
      target_expected_day: "2026-11-18",
      target_revision_id: affirmationRevisionId,
      target_acknowledged: true,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("refuses a stale date before touching Supabase", async () => {
    await expect(setMemberDailyAffirmation("2026-11-17", affirmationRevisionId, true)).resolves.toEqual({
      ok: false,
      error: "day_changed",
    });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("keeps bookmark writes member-only and delegates assignment checks to the RLS-safe RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mockCreateClient.mockResolvedValue({ rpc });

    await expect(setMemberDailyFuelBookmark(videoId, true)).resolves.toEqual({
      ok: true,
      value: true,
    });
    expect(rpc).toHaveBeenCalledWith("set_member_daily_fuel_bookmark", {
      target_video_id: videoId,
      target_saved: true,
    });

    mockRequireAccount.mockResolvedValue({ profile: { id: memberId, role: "coach" } });
    await expect(setMemberDailyFuelBookmark(videoId, true)).resolves.toEqual({
      ok: false,
      error: "not_allowed",
    });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("removes the currently submitted replacement clip by its own ID", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    mockCreateClient.mockResolvedValue({ rpc });

    await expect(setMemberDailyFuelBookmark(replacementVideoId, false)).resolves.toEqual({
      ok: true,
      value: false,
    });
    expect(rpc).toHaveBeenCalledWith("set_member_daily_fuel_bookmark", {
      target_video_id: replacementVideoId,
      target_saved: false,
    });
    expect(rpc).not.toHaveBeenCalledWith("set_member_daily_fuel_bookmark", {
      target_video_id: videoId,
      target_saved: false,
    });
  });
});
