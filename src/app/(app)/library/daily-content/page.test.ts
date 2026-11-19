import { beforeEach, describe, expect, it, vi } from "vitest";
import CoachDailyContentPage, { generateMetadata } from "./page";
import { loadDailyContentPortal } from "@/lib/daily-content-server";
import { getT } from "@/i18n/server";
import { DailyContentManager } from "@/components/daily-content/daily-content-manager";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/daily-content-server", () => ({ loadDailyContentPortal: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getT: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));

const mockGetT = vi.mocked(getT);
const mockLoad = vi.mocked(loadDailyContentPortal);
const copy = { library: { dailyContent: { title: "Daily content" } } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetT.mockResolvedValue(copy);
});

describe("coach Daily Content page", () => {
  it("uses the coach loader and the allowlisted upload return route", async () => {
    mockLoad.mockResolvedValue({
      role: "coach", today: "2026-11-19", page: 2, hasMoreItems: false, hasMoreVideos: false, truncated: false,
      items: [], videoOptions: [], slots: [], error: false,
    });
    const element = await CoachDailyContentPage({ searchParams: Promise.resolve({ page: "2" }) });
    expect(element.type).toBe(DailyContentManager);
    expect(element.props.uploadHref).toBe("/library/upload?returnTo=%2Flibrary%2Fdaily-content");
    expect(mockLoad).toHaveBeenCalledWith({ page: 2 });
  });

  it("sends an admin to the global fallback manager", async () => {
    mockLoad.mockResolvedValue({
      role: "admin", today: "2026-11-19", page: 1, hasMoreItems: false, hasMoreVideos: false, truncated: false,
      items: [], videoOptions: [], slots: [], error: false,
    });
    await expect(CoachDailyContentPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/admin/daily-content");
  });

  it("provides localized page metadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "Daily content" });
  });
});
