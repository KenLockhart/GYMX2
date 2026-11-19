import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DailyContentItemForm } from "./item-form";
import { messages } from "@/i18n/messages";
import type { DailyContentPortalVideoOption } from "@/lib/daily-content";

vi.mock("server-only", () => ({}));

const copy = messages.en.library.dailyContent;
const videos: DailyContentPortalVideoOption[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Ready lesson",
    status: "ready",
    visibility: "members",
    createdAt: "2026-11-10T10:00:00.000Z",
    durationSeconds: 180,
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    title: "Processing lesson",
    status: "processing",
    visibility: "members",
    createdAt: "2026-11-18T10:00:00.000Z",
    durationSeconds: null,
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    title: "Unsupported lesson",
    status: "ready",
    visibility: "program_only",
    createdAt: "2026-11-18T10:00:00.000Z",
    durationSeconds: null,
  },
];

describe("DailyContentItemForm", () => {
  it("posts only supported ready-video IDs and disables processing or unsupported choices", () => {
    const html = renderToStaticMarkup(
      <DailyContentItemForm
        videoOptions={videos}
        copy={copy}
        uploadHref="/library/upload?returnTo=%2Flibrary%2Fdaily-content"
      />,
    );
    expect(html).toContain('name="kind"');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="video_id"');
    expect(html).toContain('value="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"');
    expect(html).toMatch(/<option[^>]*value="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"[^>]*disabled=""/);
    expect(html).toMatch(/<option[^>]*value="cccccccc-cccc-4ccc-8ccc-cccccccccccc"[^>]*disabled=""/);
    expect(html).not.toContain("Upload a video");
    expect(html).not.toContain("cloudflare");
  });

  it("keeps quote and affirmation forms bounded and prevents changing a saved item kind", () => {
    const quoteHtml = renderToStaticMarkup(
      <DailyContentItemForm
        item={{
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          kind: "quote",
          title: "Quote",
          status: "draft",
          updatedAt: "2026-11-19T10:00:00.000Z",
          latestRevision: {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            number: 1,
            titleSnapshot: "A useful thought",
            videoId: null,
            quoteText: "Practice makes progress.",
            quoteAttribution: null,
            affirmationText: null,
            createdAt: "2026-11-19T10:00:00.000Z",
          },
        }}
        videoOptions={videos}
        copy={copy}
        uploadHref="/library/upload?returnTo=%2Flibrary%2Fdaily-content"
      />,
    );
    expect(quoteHtml).toContain('name="kind" value="quote"');
    expect(quoteHtml).toContain('name="quote_text"');
    expect(quoteHtml).toContain('maxLength="500"');
    expect(quoteHtml).not.toContain('name="video_id"');
    expect(quoteHtml).not.toContain('name="affirmation_text"');
  });

  it("returns editors to the daily portal to select a new video after upload", () => {
    const html = renderToStaticMarkup(
      <DailyContentItemForm
        videoOptions={[]}
        copy={copy}
        uploadHref="/library/upload?returnTo=%2Flibrary%2Fdaily-content"
      />,
    );
    expect(html).toContain("No ready videos to choose");
    expect(html).toContain('href="/library/upload?returnTo=%2Flibrary%2Fdaily-content"');
    expect(html).toContain('disabled=""');
  });

  it("preserves the selected revision video if it is on another video page", () => {
    const html = renderToStaticMarkup(
      <DailyContentItemForm
        item={{
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          kind: "video",
          title: "Movement",
          status: "draft",
          updatedAt: "2026-11-19T10:00:00.000Z",
          latestRevision: {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            number: 1,
            titleSnapshot: "Morning mobility",
            videoId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            quoteText: null,
            quoteAttribution: null,
            affirmationText: null,
            createdAt: "2026-11-19T10:00:00.000Z",
          },
        }}
        videoOptions={[]}
        copy={copy}
        uploadHref="/library/upload?returnTo=%2Flibrary%2Fdaily-content"
      />,
    );
    expect(html).toContain('value="ffffffff-ffff-4fff-8fff-ffffffffffff" selected=""');
    expect(html).toContain("previously selected video");
    expect(html).not.toContain("No ready videos to choose");
  });
});
