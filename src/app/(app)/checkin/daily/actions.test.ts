import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAccount,
  mockGetT,
  mockCreateClient,
  mockRevalidatePath,
  mockTodayKey,
} = vi.hoisted(() => ({
  mockRequireAccount: vi.fn(),
  mockGetT: vi.fn(),
  mockCreateClient: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockTodayKey: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/i18n/server", () => ({ getT: mockGetT }));
vi.mock("@/lib/auth", () => ({ requireAccount: mockRequireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/reminders", () => ({ todayKey: mockTodayKey }));

import { en } from "@/i18n/en";
import { saveDailyCheckin } from "./actions";

function formData(values: Record<string, string>) {
  const form = new FormData();
  if (!Object.hasOwn(values, "expected_day"))
    form.set("expected_day", "2026-11-17");
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("saveDailyCheckin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetT.mockResolvedValue(en);
    mockTodayKey.mockReturnValue("2026-11-17");
    mockRequireAccount.mockResolvedValue({
      profile: { id: "11111111-1111-4111-8111-111111111111", role: "member" },
    });
  });

  it("rejects non-members before writing", async () => {
    mockRequireAccount.mockResolvedValue({
      profile: { id: "11111111-1111-4111-8111-111111111111", role: "coach" },
    });

    const result = await saveDailyCheckin({}, formData({}));

    expect(result).toEqual({ error: en.checkin.daily.memberOnly });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid scores before calling the RPC", async () => {
    const result = await saveDailyCheckin(
      {},
      formData({ energy: "6", sleep: "3", stress: "2", motivation: "4" }),
    );

    expect(result).toEqual({ error: en.checkin.daily.invalidAnswers });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("saves four validated scores through the identity/date deriving RPC and revalidates the page", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mockCreateClient.mockResolvedValue({ rpc });

    const result = await saveDailyCheckin(
      {},
      formData({ energy: "4", sleep: "3", stress: "2", motivation: "5" }),
    );

    expect(rpc).toHaveBeenCalledWith("save_member_daily_checkin", {
      target_expected_day: "2026-11-17",
      target_energy: 4,
      target_sleep: 3,
      target_stress: 2,
      target_motivation: 5,
    });
    expect(result).toEqual({ message: en.checkin.daily.saved });
    expect(mockRevalidatePath).toHaveBeenNthCalledWith(1, "/checkin/daily");
    expect(mockRevalidatePath).toHaveBeenNthCalledWith(2, "/dashboard");
  });

  it("returns the localized save error when the database rejects the request", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: new Error("database error") });
    mockCreateClient.mockResolvedValue({ rpc });

    const result = await saveDailyCheckin(
      {},
      formData({ energy: "4", sleep: "3", stress: "2", motivation: "5" }),
    );

    expect(result).toEqual({ error: en.checkin.daily.saveError });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a stale rendered day before calling the RPC", async () => {
    const result = await saveDailyCheckin(
      {},
      formData({ expected_day: "2026-11-16", energy: "4", sleep: "3", stress: "2", motivation: "5" }),
    );

    expect(result).toEqual({ error: en.checkin.daily.stale });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
