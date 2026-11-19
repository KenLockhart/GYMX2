import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminDailyContentPage from "./page";
import { requireAdmin } from "@/lib/auth";
import { loadDailyContentPortal } from "@/lib/daily-content-server";
import { DailyContentManager } from "@/components/daily-content/daily-content-manager";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/daily-content-server", () => ({ loadDailyContentPortal: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getT: vi.fn().mockResolvedValue({ library: { dailyContent: { title: "Daily content" } } }) }));

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockLoad = vi.mocked(loadDailyContentPortal);

beforeEach(() => vi.clearAllMocks());

describe("admin Daily Content page", () => {
  it("requires an admin and routes its own fallback data to the shared manager", async () => {
    mockRequireAdmin.mockResolvedValue({ profile: { id: "admin-id", role: "admin" } } as never);
    mockLoad.mockResolvedValue({
      role: "admin", today: "2026-11-19", page: 1, hasMoreItems: false, hasMoreVideos: false, truncated: false,
      items: [], videoOptions: [], slots: [], error: false,
    });
    const element = await AdminDailyContentPage({ searchParams: Promise.resolve({}) });
    expect(mockRequireAdmin).toHaveBeenCalledOnce();
    expect(mockLoad).toHaveBeenCalledOnce();
    expect(element.type).toBe(DailyContentManager);
    expect(element.props.uploadHref).toBe("/library/upload?returnTo=%2Fadmin%2Fdaily-content");
  });

  it("stops before loading staff content when admin authorization fails", async () => {
    mockRequireAdmin.mockRejectedValue(new Error("redirect"));
    await expect(AdminDailyContentPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect");
    expect(mockLoad).not.toHaveBeenCalled();
  });
});
