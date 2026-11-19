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

import { assignMemberDailyFuelVideo } from "./daily-fuel-actions";

const coachId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const videoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function form() {
  const values = new FormData();
  values.set("video_id", videoId);
  values.set("member_id", memberId);
  return values;
}

describe("assignMemberDailyFuelVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAccount.mockResolvedValue({ profile: { id: coachId, role: "coach" } });
  });

  it("delegates ownership, ready-state, current-link and Eastern-day checks to the database RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "assignment-id", error: null });
    mockCreateClient.mockResolvedValue({ rpc });

    await expect(assignMemberDailyFuelVideo({ status: "idle" }, form())).resolves.toEqual({
      status: "assigned",
    });
    expect(rpc).toHaveBeenCalledWith("assign_member_daily_fuel_video", {
      target_member_id: memberId,
      target_video_id: videoId,
      target_expected_day: "2026-11-18",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/library/${videoId}`);
  });

  it("does not create a client for an unrelated role or malformed ids", async () => {
    mockRequireAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    await expect(assignMemberDailyFuelVideo({ status: "idle" }, form())).resolves.toEqual({
      status: "error",
      reason: "not_allowed",
    });
    expect(mockCreateClient).not.toHaveBeenCalled();

    mockRequireAccount.mockResolvedValue({ profile: { id: coachId, role: "coach" } });
    const malformed = form();
    malformed.set("member_id", "not-a-uuid");
    await expect(assignMemberDailyFuelVideo({ status: "idle" }, malformed)).resolves.toEqual({
      status: "error",
      reason: "failed",
    });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("surfaces database authorization and readiness failures without claiming assignment", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501" },
    });
    mockCreateClient.mockResolvedValue({ rpc });
    await expect(assignMemberDailyFuelVideo({ status: "idle" }, form())).resolves.toEqual({
      status: "error",
      reason: "not_allowed",
    });

    rpc.mockResolvedValue({ data: null, error: { code: "22023" } });
    await expect(assignMemberDailyFuelVideo({ status: "idle" }, form())).resolves.toEqual({
      status: "error",
      reason: "not_ready",
    });

    rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    await expect(assignMemberDailyFuelVideo({ status: "idle" }, form())).resolves.toEqual({
      status: "error",
      reason: "day_changed",
    });
  });
});
