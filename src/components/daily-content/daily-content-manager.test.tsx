import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { DailyContentManager } from "./daily-content-manager";
import { I18nProvider } from "@/i18n/client";
import { messages } from "@/i18n/messages";
import type { DailyContentPortalData } from "@/lib/daily-content";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const data: DailyContentPortalData = {
  role: "coach",
  today: "2026-11-19",
  page: 1,
  hasMoreItems: false,
  hasMoreVideos: false,
  truncated: false,
  error: false,
  items: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "video",
      title: "Movement of the day",
      status: "draft",
      updatedAt: "2026-11-18T10:00:00.000Z",
      latestRevision: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        number: 2,
        titleSnapshot: "Morning mobility",
        videoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        quoteText: null,
        quoteAttribution: null,
        affirmationText: null,
        createdAt: "2026-11-18T10:00:00.000Z",
      },
    },
  ],
  videoOptions: [
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      title: "Morning mobility",
      status: "ready",
      visibility: "members",
      createdAt: "2026-11-10T10:00:00.000Z",
      durationSeconds: 240,
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      title: "Upload in progress",
      status: "processing",
      visibility: "members",
      createdAt: "2026-11-19T10:00:00.000Z",
      durationSeconds: null,
    },
  ],
  slots: [
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      itemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revisionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: "video",
      title: "Morning mobility",
      day: "2026-11-20",
      status: "scheduled",
    },
    {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      itemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revisionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: "video",
      title: "Morning mobility",
      day: "2026-11-19",
      status: "scheduled",
    },
  ],
};

function renderManager(value = data) {
  return renderToStaticMarkup(
    <I18nProvider locale="en">
      <DailyContentManager
        data={value}
        copy={messages.en.library.dailyContent}
        uploadHref="/library/upload?returnTo=%2Flibrary%2Fdaily-content"
      />
    </I18nProvider>,
  );
}

describe("DailyContentManager", () => {
  it("renders staff-owned content, priority guidance, and the bounded schedule date", () => {
    const html = renderManager();
    expect(html).toContain("Daily content");
    expect(html).toContain("Movement of the day");
    expect(html).toContain('name="item_id"');
    expect(html).toContain('name="revision_id"');
    expect(html).toMatch(/<input[^>]*type="date"[^>]*name="day"/);
    expect(html).toContain('min="2026-11-19"');
    expect(html).toContain('max="2027-11-19"');
    expect(html).toContain("A video assigned directly to a member");
    expect(html).toContain("Live today");
    expect(html).not.toContain("cloudflare");
    expect(html).not.toContain("audience");
  });

  it("does not show a false empty state when the portal load failed", () => {
    const html = renderManager({ ...data, items: [], slots: [], error: true });
    expect(html).toContain("We couldn’t load daily content");
    expect(html).toContain("Refresh this page");
    expect(html).not.toContain("Start your daily lineup");
  });

  it("shows the empty-state action only after a successful empty load", () => {
    const html = renderManager({ ...data, items: [], slots: [] });
    expect(html).toContain("Start your daily lineup");
    expect(html).toContain("Create content");
  });

  it("paginates item and video lists and warns when inner query limits are reached", () => {
    const html = renderManager({ ...data, page: 3, hasMoreItems: true, truncated: true });
    expect(html).toContain('href="/library/daily-content?page=2"');
    expect(html).toContain('href="/library/daily-content?page=4"');
    expect(html).toContain("Some older items may be outside the manager’s list limit");
    expect(html).toContain("Page 3");
  });

  it("keeps all locale copy passed from a server page serializable", () => {
    expect(typeof messages.en.library.dailyContent.pageLabel).toBe("string");
    expect(typeof messages.es.library.dailyContent.pageLabel).toBe("string");
    expect(Object.values(messages.en.library.dailyContent).some((value) => typeof value === "function")).toBe(false);
    expect(Object.values(messages.es.library.dailyContent).some((value) => typeof value === "function")).toBe(false);
  });
});
