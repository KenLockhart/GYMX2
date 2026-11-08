import type { Metadata } from "next";
import Link from "next/link";
import { summarizeOverview, weekAgoIso, type OverviewSale } from "@/lib/admin-overview";
import { formatMoney } from "@/lib/armory";
import { requireAdmin } from "@/lib/auth";
import { groupForReview } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import type { AdminUser } from "@/lib/types";
import { RoleForm } from "./role-form";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireAdmin();

  // Admins can read every user, sale and message, so the overview needs no special access.
  const supabase = await createClient();
  const weekAgo = weekAgoIso();
  const [{ data, error }, { data: salesData }, { data: messageData }] =
    await Promise.all([
      supabase.rpc("admin_list_users"),
      supabase
        .from("purchases")
        .select(
          "amount_cents, fee_cents, created_at, refunded_at, fulfillment_status",
        )
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase
        .from("messages")
        .select("coach_id, member_id, sender_id, body, created_at")
        .gte("created_at", weekAgo)
        .limit(2000),
    ]);
  // Coach requests first, then newest sign-ups.
  const users = ((data ?? []) as AdminUser[]).toSorted(
    (a, b) =>
      Number(b.coach_requested) - Number(a.coach_requested) ||
      b.created_at.localeCompare(a.created_at),
  );
  const requests = users.filter((user) => user.coach_requested).length;
  const overview = summarizeOverview({
    users,
    sales: (salesData ?? []) as OverviewSale[],
    flaggedConversations: groupForReview(
      (messageData ?? []) as Parameters<typeof groupForReview>[0],
      { flaggedOnly: true },
    ).length,
  });

  const tiles = [
    {
      label: "People",
      value: String(overview.people),
      detail: `${overview.newPeople} new this week · ${overview.coaches} coaches · ${overview.members} members`,
      href: "#people",
    },
    {
      label: "Coach requests",
      value: String(overview.coachRequests),
      detail: overview.coachRequests ? "Waiting for you below" : "None waiting",
      href: "#people",
      alert: overview.coachRequests > 0,
    },
    {
      label: "Sales this week",
      value: formatMoney(overview.weekSalesCents),
      detail: `${overview.weekSalesCount} ${overview.weekSalesCount === 1 ? "sale" : "sales"} · GYMX2 kept ${formatMoney(overview.weekKeptCents)}`,
      href: "/armory/sales",
    },
    {
      label: "Orders to ship",
      value: String(overview.toShip),
      detail:
        overview.oldestToShipDays === null
          ? "All shipped"
          : `Oldest waiting ${overview.oldestToShipDays} ${overview.oldestToShipDays === 1 ? "day" : "days"}`,
      href: "/armory/sales",
      alert: (overview.oldestToShipDays ?? 0) >= 5,
    },
    {
      label: "Flagged conversations",
      value: String(overview.flaggedConversations),
      detail: "In the last 7 days",
      href: "/admin/messages?show=flagged",
      alert: overview.flaggedConversations > 0,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-5xl">Admin</h1>
          <p className="mt-2 text-muted">
            {users.length} {users.length === 1 ? "person" : "people"},{" "}
            {requests} coach {requests === 1 ? "request" : "requests"} waiting
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/leaderboard" className="btn-secondary">
            Leaderboard
          </Link>
          <Link href="/admin/messages" className="btn-secondary">
            Review conversations
          </Link>
          <Link href="/armory/sales" className="btn-secondary">
            Armory sales
          </Link>
        </div>
      </div>

      <section
        aria-label="Overview"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className={`rounded-lg border bg-surface p-4 transition hover:bg-surface-raised ${
              tile.alert ? "border-accent" : "border-border"
            }`}
          >
            <p className="text-sm text-muted">{tile.label}</p>
            <p className="mt-1 text-3xl font-semibold">{tile.value}</p>
            <p
              className={`mt-1 text-xs ${tile.alert ? "text-accent" : "text-muted"}`}
            >
              {tile.detail}
            </p>
          </Link>
        ))}
      </section>

      <h2 id="people" className="scroll-mt-6 text-2xl">
        People
      </h2>
      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the user list. Please refresh and try again.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {user.display_name}
                  {user.coach_requested && (
                    <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">
                      Coach request
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-muted">
                  {user.email} · {user.role} · joined{" "}
                  {new Date(user.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </p>
              </div>
              <RoleForm user={user} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
