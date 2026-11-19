import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyFuelActionResult } from "@/app/(app)/dashboard/fuel-actions";

const { mockSetBookmark, mockRouter } = vi.hoisted(() => ({
  mockSetBookmark: vi.fn(),
  mockRouter: { refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("@/app/(app)/dashboard/fuel-actions", () => ({
  setMemberDailyFuelBookmark: mockSetBookmark,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mockRouter }));

import {
  removeSavedDailyFuelBookmark,
  SavedDailyFuelRemove,
} from "./saved-daily-fuel-remove";

const copy = {
  remove: "Remove from saved",
  removing: "Removing…",
  confirm: "Remove “Strength Basics” from saved videos?",
  removed: "Video removed from saved.",
  error: "We couldn’t remove this video. Please try again.",
};

describe("saved Daily Fuel removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a member-initiated remove control with the localized confirmation text", () => {
    const markup = renderToStaticMarkup(
      createElement(SavedDailyFuelRemove, {
        videoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        copy,
      }),
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain("Remove from saved");
    expect(markup).toContain("aria-busy=\"false\"");
  });

  it("confirms and removes only the requested bookmark", async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true, value: false });
    const confirm = vi.fn(() => true);

    await expect(
      removeSavedDailyFuelBookmark(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        confirm,
        remove,
      ),
    ).resolves.toBe("removed");

    expect(confirm).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      false,
    );
  });

  it("does not mutate when the member cancels confirmation", async () => {
    const remove = vi.fn();

    await expect(
      removeSavedDailyFuelBookmark(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        () => false,
        remove,
      ),
    ).resolves.toBe("cancelled");

    expect(remove).not.toHaveBeenCalled();
  });

  it.each<[string, () => Promise<DailyFuelActionResult>]>([
    ["the action reports an error", async () => ({ ok: false, error: "failed" })],
    ["the action rejects", async () => { throw new Error("offline"); }],
  ])("reports failure when %s", async (_case, action) => {
    const remove = vi.fn(action);

    await expect(
      removeSavedDailyFuelBookmark(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        () => true,
        remove,
      ),
    ).resolves.toBe("failed");
    expect(remove).toHaveBeenCalledOnce();
  });
});
