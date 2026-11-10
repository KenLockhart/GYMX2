import { ShoppingCart, Star, UserRound, Users } from "lucide-react";
import type { Metadata } from "next";
import {
  type LeaderboardKpi,
  type LeaderboardTab,
  LeaderboardView,
} from "@/components/leaderboard-view";
import { averageRating, growth } from "@/lib/admin-console";
import { publicImageUrl } from "@/lib/armory";
import { requireAdmin } from "@/lib/auth";
import {
  buildEngagement,
  buildLeaderboards,
  COACH_POINTS,
  ENGAGEMENT_POINTS,
  LEADERBOARD_RANGES,
  MEMBER_POINTS,
  rangeStart,
  salesTrend,
} from "@/lib/leaderboard";
import { getSupabaseEnv } from "@/lib/supabase/env";
import {
  loadActivity,
  loadEngagement,
  loadLeaderboardExtras,
  loadSalesSince,
} from "./load";

export const metadata: Metadata = { title: "Leaderboard" };

const TABS: LeaderboardTab[] = [
  "overview",
  "members",
  "coaches",
  "sales",
  "engagement",
];
const DAY_MS = 24 * 60 * 60 * 1000;

// The card has room for whole dollars only; the tables below show cents.
function wholeDollars(cents: number) {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const tabParam = typeof params.tab === "string" ? params.tab : "";
  const tab: LeaderboardTab = TABS.includes(tabParam as LeaderboardTab)
    ? (tabParam as LeaderboardTab)
    : "overview";
  const { range, since } = rangeStart(
    typeof params.range === "string" ? params.range : undefined,
  );
  // The cards compare with the window before, so they need twice the range (90 days for all time).
  const trendDays = range.days ?? 90;
  const now = new Date();
  const trendSince = new Date(
    now.getTime() - 2 * trendDays * DAY_MS,
  ).toISOString();

  const [activity, engagementRows, recentSales] = await Promise.all([
    loadActivity(since),
    tab === "engagement" ? loadEngagement(since) : Promise.resolve(null),
    loadSalesSince(trendSince),
  ]);
  const boards = buildLeaderboards(activity);
  const extras = await loadLeaderboardExtras(
    boards.items.flatMap((item) => (item.id ? [item.id] : [])),
  );
  const engagement = engagementRows
    ? buildEngagement(activity.people, engagementRows)
    : [];

  const created = (role: string) =>
    activity.people
      .filter((p) => p.role === role && p.created_at)
      .map((p) => p.created_at!);
  const members = growth(created("member"), trendDays, now);
  const coaches = growth(created("coach"), trendDays, now);
  const sales = salesTrend(recentSales, trendDays, now);
  const rating = averageRating(extras.ratings);
  // All time shows totals; the trend lines then cover the last 90 days.
  const allTime = range.days === null;
  const kpis: LeaderboardKpi[] = [
    {
      label: "Total members",
      value: members.total.toLocaleString("en-US"),
      icon: Users,
      changePct: allTime ? null : members.changePct,
      series: members.series,
    },
    {
      label: "Coaches",
      value: coaches.total.toLocaleString("en-US"),
      icon: UserRound,
      changePct: allTime ? null : coaches.changePct,
      series: coaches.series,
    },
    {
      label: allTime
        ? "Armory sales (all time)"
        : `Armory sales (${range.days}d)`,
      value: wholeDollars(
        allTime
          ? activity.sales
              .filter((s) => !s.refunded_at)
              .reduce((sum, s) => sum + s.amount_cents, 0)
          : sales.cents,
      ),
      icon: ShoppingCart,
      changePct: allTime ? null : sales.changePct,
      series: sales.series,
    },
    {
      label: `Average review rating (${extras.ratings.length})`,
      value: rating === null ? "—" : String(rating),
      icon: Star,
      changePct: null,
      series: null,
      stars: rating,
    },
  ];

  const supabaseUrl = getSupabaseEnv().url;
  const itemImages = new Map(
    [...extras.items].map(([id, item]) => [
      id,
      {
        url: publicImageUrl(supabaseUrl, item.imagePath),
        membership: item.kind === "membership",
      },
    ]),
  );

  return (
    <LeaderboardView
      tab={tab}
      range={range.value}
      rangeOptions={LEADERBOARD_RANGES}
      rangeLabel={range.label}
      kpis={kpis}
      boards={boards}
      engagement={engagement}
      coachPhotos={extras.coachPhotos}
      itemImages={itemImages}
      points={{
        members: `Points: task or program day done ${MEMBER_POINTS.tasks} · session attended or RSVP ${MEMBER_POINTS.sessions} · message ${MEMBER_POINTS.messages} · memo ${MEMBER_POINTS.memos} · habit ${MEMBER_POINTS.habits}`,
        coaches: `Points: video ${COACH_POINTS.videos} · new member ${COACH_POINTS.newMembers} · session ${COACH_POINTS.sessions} · task given ${COACH_POINTS.tasks} · message ${COACH_POINTS.messages}`,
        engagement: `Shared posts, comments and likes. Points: post ${ENGAGEMENT_POINTS.posts} · comment ${ENGAGEMENT_POINTS.comments} · like ${ENGAGEMENT_POINTS.likes}. Private and removed posts don't count.`,
      }}
    />
  );
}
