import {
  Award,
  BadgeCheck,
  Flag,
  Handshake,
  Mail,
  MessageCircle,
  Package,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  ChartNoAxesColumn,
  UserPlus,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import type { Metadata } from "next";
import { AdminOverview } from "@/components/admin-overview";
import {
  type Activity,
  averageRating,
  growth,
  mergeActivity,
  RANGES,
  readRange,
} from "@/lib/admin-console";
import { loadAdminCounts } from "@/lib/admin-console-server";
import {
  summarizeOverview,
  weekAgoIso,
  type OverviewSale,
} from "@/lib/admin-overview";
import { formatMoney } from "@/lib/armory";
import { requireAdmin } from "@/lib/auth";
import { groupForReview } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import type { AdminUser } from "@/lib/types";

export const metadata: Metadata = { title: "Admin" };

type Named = { display_name: string } | null;

// Recent activity scrolls inside its panel, so it can hold more than fits on screen.
const ACTIVITY_LIMIT = 25;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireAdmin();
  const range = readRange((await searchParams).range);
  const rangeLabel = RANGES.find((r) => r.days === range)!.label.toLowerCase();
  const supabase = await createClient();
  const [
    { data: userData },
    { data: affiliateData },
    { data: reviewData },
    { data: saleData },
    { data: messageData },
    { data: approvedData },
    counts,
  ] = await Promise.all([
    supabase.rpc("admin_list_users"),
    supabase
      .from("affiliates")
      .select(
        "status, decided_at, created_at, user:profiles!user_id(display_name)",
      ),
    supabase
      .from("coach_reviews")
      .select(
        "rating, created_at, member:profiles!member_id(display_name), coach:profiles!coach_id(display_name)",
      )
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("purchases")
      .select(
        "item_title, amount_cents, fee_cents, created_at, refunded_at, fulfillment_status",
      )
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("messages")
      .select("coach_id, member_id, sender_id, body, created_at")
      .gte("created_at", weekAgoIso())
      .limit(2000),
    supabase
      .from("coach_profile_drafts")
      .select("reviewed_at, coach:profiles!coach_id(display_name)")
      .eq("status", "approved")
      .order("reviewed_at", { ascending: false })
      .limit(ACTIVITY_LIMIT),
    loadAdminCounts(),
  ]);

  const users = (userData ?? []) as AdminUser[];
  const affiliates = (affiliateData ?? []) as unknown as {
    status: string;
    decided_at: string | null;
    created_at: string;
    user: Named;
  }[];
  const reviews = (reviewData ?? []) as unknown as {
    rating: number;
    created_at: string;
    member: Named;
    coach: Named;
  }[];
  const sales = (saleData ?? []) as (OverviewSale & { item_title: string })[];
  const approved = (approvedData ?? []) as unknown as {
    reviewed_at: string | null;
    coach: Named;
  }[];
  const overview = summarizeOverview({
    users,
    sales,
    flaggedConversations: groupForReview(
      (messageData ?? []) as Parameters<typeof groupForReview>[0],
      { flaggedOnly: true },
    ).length,
  });

  const members = growth(
    users.filter((u) => u.role === "member").map((u) => u.created_at),
    range,
  );
  const coaches = growth(
    users.filter((u) => u.role === "coach").map((u) => u.created_at),
    range,
  );
  const liveAffiliates = growth(
    affiliates
      .filter((a) => a.status === "approved")
      .map((a) => a.decided_at ?? a.created_at),
    range,
  );
  const rating = averageRating(reviews.map((r) => r.rating));

  const kpis = [
    {
      label: "Members",
      icon: Users,
      ...members,
      href: "/admin/users?show=member",
    },
    {
      label: "Coaches",
      icon: UserRound,
      ...coaches,
      href: "/admin/users?show=coach",
    },
    {
      label: "Affiliates",
      icon: Handshake,
      ...liveAffiliates,
      href: "/admin/affiliates",
    },
  ];

  const quickActions = [
    {
      label: "Add a coach",
      icon: UserPlus,
      href: "/admin/users?show=requests",
      primary: true,
    },
    { label: "Affiliates", icon: Handshake, href: "/admin/affiliates" },
    { label: "Edit emails", icon: Mail, href: "/admin/emails" },
    {
      label: "Match weights",
      icon: SlidersHorizontal,
      href: "/admin/matching",
    },
    { label: "Moderate reviews", icon: Star, href: "/admin/reports" },
    { label: "Coach insights", icon: ChartNoAxesColumn, href: "/insights" },
    { label: "Armory sales", icon: ShoppingCart, href: "/armory/sales" },
  ];

  const tasks = [
    {
      label: "Coach requests",
      detail: "Members asking to coach",
      count: counts.coachRequests,
      icon: UserRound,
      href: "/admin/users?show=requests",
    },
    {
      label: "Coach profiles to review",
      detail: "Submitted for approval",
      count: counts.profilesToReview,
      icon: BadgeCheck,
      href: "/admin/coach-profiles",
    },
    {
      label: "Credential checks",
      detail: "Waiting for verification",
      count: counts.credentialsPending,
      icon: Award,
      href: "/admin/credentials",
    },
    {
      label: "Review and coach reports",
      detail: "Open reports from members",
      count: counts.reports,
      icon: Flag,
      href: "/admin/reports",
    },
    {
      label: "Community reports",
      detail: "Reported posts and comments",
      count: counts.communityReports,
      icon: UsersRound,
      href: "/moderation",
    },
    {
      label: "Conversations to review",
      detail: "Flagged in the last 7 days",
      count: overview.flaggedConversations,
      icon: MessageCircle,
      href: "/admin/messages?show=flagged",
    },
    {
      label: "Orders to ship",
      detail:
        overview.oldestToShipDays === null
          ? "Everything has shipped"
          : `Oldest waiting ${overview.oldestToShipDays} ${overview.oldestToShipDays === 1 ? "day" : "days"}`,
      count: overview.toShip,
      icon: Package,
      href: "/armory/sales",
    },
    {
      label: "Affiliate applications",
      detail: "Waiting for a decision",
      count: counts.affiliateApplications,
      icon: Handshake,
      href: "/admin/affiliates",
    },
  ];
  const waiting = tasks.reduce((sum, t) => sum + t.count, 0);
  // Anything waiting comes first; the order otherwise stays put so admins learn where things are.
  const sortedTasks = [
    ...tasks.filter((t) => t.count > 0),
    ...tasks.filter((t) => t.count === 0),
  ];

  const activity = mergeActivity(
    [
      users
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, ACTIVITY_LIMIT)
        .map((u): Activity => ({
          kind: "signup",
          title: `New ${u.role === "coach" ? "coach" : "member"} signed up`,
          detail: u.display_name,
          at: u.created_at,
          href: "/admin/users",
        })),
      approved.map((a): Activity => ({
        kind: "profile",
        title: "Coach profile approved",
        detail: a.coach?.display_name ?? "A coach",
        at: a.reviewed_at ?? "",
        href: "/admin/coach-profiles",
      })),
      reviews.slice(0, ACTIVITY_LIMIT).map((r): Activity => ({
        kind: "review",
        title: `New ${r.rating}-star review`,
        detail: `${r.member?.display_name ?? "A member"} for ${r.coach?.display_name ?? "a coach"}`,
        at: r.created_at,
        href: "/admin/reviews",
      })),
      sales.slice(0, ACTIVITY_LIMIT).map((s): Activity => ({
        kind: "sale",
        title: s.refunded_at ? "Armory sale refunded" : "Armory sale",
        detail: `${s.item_title} · ${formatMoney(s.amount_cents)}`,
        at: s.created_at,
        href: "/armory/sales",
      })),
      affiliates
        .filter((a) => a.status === "approved" && a.decided_at)
        .map((a): Activity => ({
          kind: "affiliate",
          title: "New affiliate approved",
          detail: a.user?.display_name ?? "An affiliate",
          at: a.decided_at!,
          href: "/admin/affiliates",
        })),
    ],
    ACTIVITY_LIMIT,
  );

  return (
    <AdminOverview
      range={range}
      rangeLabel={rangeLabel}
      kpis={kpis}
      rating={rating}
      reviewCount={reviews.length}
      quickActions={quickActions}
      sortedTasks={sortedTasks}
      waiting={waiting}
      activity={activity}
    />
  );
}
