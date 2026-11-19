import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CoachProfilesGallery,
  type CoachGalleryItem,
} from "@/components/admin-coach-profiles-gallery";
import { rankFeaturedCoaches, readExactPages } from "@/lib/featured-coach";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const now = new Date("2026-11-20T12:00:00.000Z");

function coach(id: string, name = id, publishedAt: string | null = "2026-01-01T00:00:00Z") {
  return { id, name, publishedAt };
}

describe("rankFeaturedCoaches", () => {
  it("gives sales, new members, and activity days equal normalized weight", () => {
    const result = rankFeaturedCoaches(
      [coach("sales", "Sales"), coach("members", "Members"), coach("active", "Active")],
      {
        sales: [
          {
            seller_id: "sales",
            kind: "paid",
            amount_cents: 10_000,
            shipping_cents: 0,
            refunded_at: null,
            created_at: now.toISOString(),
          },
        ],
        members: Array.from({ length: 7 }, (_, index) => ({
          coach_id: "members",
          member_id: `member-${index}`,
          created_at: now.toISOString(),
        })),
        activity: Array.from({ length: 4 }, (_, index) => ({
          coach_id: "active",
          created_at: new Date(now.getTime() - index * 24 * 60 * 60 * 1000).toISOString(),
        })),
      },
      now,
    );

    result.ranking.forEach((row) => {
      expect(row.metrics.score).toBeCloseTo(100 / 3);
    });
    expect(result.winner?.id).toBe("sales");
  });

  it("counts paid membership invoice rows once and excludes refunds, shipping, old sales, and other sellers", () => {
    const result = rankFeaturedCoaches(
      [coach("a")],
      {
        sales: [
          {
            seller_id: "a",
            kind: "paid",
            amount_cents: 10_000,
            shipping_cents: 1_200,
            refunded_at: null,
            created_at: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            seller_id: "a",
            kind: "paid",
            amount_cents: 2_000,
            shipping_cents: 300,
            refunded_at: null,
            created_at: now.toISOString(),
          },
          {
            seller_id: "a",
            kind: "membership",
            amount_cents: 90_000,
            shipping_cents: 0,
            refunded_at: null,
            created_at: now.toISOString(),
          },
          {
            seller_id: "a",
            kind: "paid",
            amount_cents: 50_000,
            shipping_cents: 0,
            refunded_at: "2026-11-19T00:00:00.000Z",
            created_at: now.toISOString(),
          },
          {
            seller_id: "a",
            kind: "paid",
            amount_cents: 70_000,
            shipping_cents: 0,
            refunded_at: null,
            created_at: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000 - 1).toISOString(),
          },
          {
            seller_id: "other",
            kind: "paid",
            amount_cents: 99_000,
            shipping_cents: 0,
            refunded_at: null,
            created_at: now.toISOString(),
          },
        ],
        members: [],
        activity: [],
      },
      now,
    );

    expect(result.winner?.metrics.salesCents).toBe(100_500);
  });

  it("counts distinct new links and Eastern active days within the inclusive time window", () => {
    const result = rankFeaturedCoaches(
      [coach("a")],
      {
        sales: [],
        members: [
          { coach_id: "a", member_id: "one", created_at: now.toISOString() },
          { coach_id: "a", member_id: "one", created_at: now.toISOString() },
          { coach_id: "a", member_id: "two", created_at: now.toISOString() },
          {
            coach_id: "a",
            member_id: "old",
            created_at: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000 - 1).toISOString(),
          },
          {
            coach_id: "a",
            member_id: "future",
            created_at: new Date(now.getTime() + 1).toISOString(),
          },
        ],
        activity: [
          { coach_id: "a", created_at: "2026-11-20T01:30:00.000Z" },
          { coach_id: "a", created_at: "2026-11-20T04:59:59.999Z" },
          { coach_id: "a", created_at: "2026-11-20T05:00:00.000Z" },
          { coach_id: "a", created_at: "2026-10-21T12:00:00.000Z" },
        ],
      },
      now,
    );

    expect(result.winner?.metrics.newMembers).toBe(2);
    expect(result.winner?.metrics.activeDays).toBe(3);
  });

  it("keeps a published coach eligible while a separate draft is pending and excludes unpublished profiles", () => {
    const result = rankFeaturedCoaches(
      [coach("live-pending-edit", "Pending edit", "2026-10-01T00:00:00Z"), coach("unpublished", "Unpublished", null)],
      {
        sales: [
          {
            seller_id: "live-pending-edit",
            kind: "paid",
            amount_cents: 1,
            shipping_cents: 0,
            refunded_at: null,
            created_at: now.toISOString(),
          },
        ],
        members: [],
        activity: [],
      },
      now,
    );

    expect(result.eligibleCount).toBe(1);
    expect(result.winner?.id).toBe("live-pending-edit");
  });

  it("returns no featured winner when all eligible coaches have zero recent metrics", () => {
    const result = rankFeaturedCoaches(
      [coach("a"), coach("b")],
      { sales: [], members: [], activity: [] },
      now,
    );

    expect(result.eligibleCount).toBe(2);
    expect(result.winner).toBeNull();
    expect(result.ranking.every((row) => row.metrics.score === 0)).toBe(true);
  });

  it("uses a stable metric and name tie-break after the balanced score", () => {
    const result = rankFeaturedCoaches(
      [coach("z", "Zed"), coach("a", "Alpha"), coach("b", "Beta")],
      {
        sales: [
          {
            seller_id: "z",
            kind: "paid",
            amount_cents: 1_000,
            shipping_cents: 0,
            refunded_at: null,
            created_at: now.toISOString(),
          },
          {
            seller_id: "a",
            kind: "paid",
            amount_cents: 1_000,
            shipping_cents: 0,
            refunded_at: null,
            created_at: now.toISOString(),
          },
        ],
        members: [],
        activity: [],
      },
      now,
    );

    expect(result.ranking.map((row) => row.id)).toEqual(["a", "z", "b"]);
  });
});

describe("readExactPages", () => {
  it("collects every row when the server caps responses below the requested range", async () => {
    const source = Array.from({ length: 5 }, (_, index) => ({ id: `row-${index}` }));
    const ranges: [number, number][] = [];

    const result = await readExactPages(
      async (from, to) => {
        ranges.push([from, to]);
        return {
          data: source.slice(from, Math.min(to + 1, from + 2)),
          error: null,
          count: source.length,
        };
      },
      (row) => row.id,
    );

    expect(result).toEqual(source);
    expect(ranges).toEqual([
      [0, 999],
      [2, 4],
      [4, 4],
    ]);
  });

  it("fails closed when a later exact page overlaps rows already collected", async () => {
    let calls = 0;
    await expect(
      readExactPages(
        async () => {
          calls += 1;
          return {
            data: calls === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "b" }, { id: "c" }],
            error: null,
            count: 4,
          };
        },
        (row) => row.id,
        2,
      ),
    ).rejects.toThrow("overlapping rows");
  });

  it("fails closed when the exact count changes between pages", async () => {
    let calls = 0;
    await expect(
      readExactPages(
        async () => {
          calls += 1;
          return {
            data: [{ id: calls === 1 ? "a" : "b" }],
            error: null,
            count: calls === 1 ? 2 : 3,
          };
        },
        (row) => row.id,
        1,
      ),
    ).rejects.toThrow("changed while being read");
  });
});

describe("CoachProfilesGallery degraded metrics state", () => {
  const card = (id: string, status: string, publishedAt: string | null): CoachGalleryItem => ({
    id,
    name: id,
    status,
    publishedAt,
    submittedAt: status === "submitted" ? "2026-11-19T00:00:00Z" : null,
    updatedAt: "2026-11-19T00:00:00Z",
    photoUrl: null,
    headline: "Strength coaching",
    specialties: [],
    location: "",
    formats: [],
    completion: 50,
  });

  it("keeps the review and live rails visible without inventing a featured winner", () => {
    const html = renderToStaticMarkup(
      createElement(CoachProfilesGallery, {
        coaches: [
          card("Pending coach", "submitted", null),
          card("Live coach", "approved", "2026-11-01T00:00:00Z"),
        ],
        eligibleLiveCount: 1,
        featuredMetricsError: true,
      }),
    );

    expect(html).toContain("Performance data unavailable");
    expect(html).toContain("Ready for review");
    expect(html).toContain("Live roster");
    expect(html).toContain("Pending coach");
    expect(html).toContain("Live coach");
    expect(html).not.toContain("Featured coach</span>");
  });
});
