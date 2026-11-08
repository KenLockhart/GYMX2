import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EarningsChart } from "@/components/earnings-chart";
import { requireCoachOrAdmin } from "@/lib/auth";
import {
  bestSellers,
  earnings,
  memberHealth,
  programStats,
  QUIET_DAYS,
  sessionTurnout,
  taskCompletion,
} from "@/lib/coach-insights";
import { loadCoachInsights } from "@/lib/coach-insights-data";
import { MEMBERSHIP_FEE_PERCENT } from "@/lib/memberships";
import { createAdminClient } from "@/lib/supabase/admin";
import { idSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Insights" };

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

const rate = (value: number | null) => (value === null ? "–" : `${value}%`);

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ coach?: string }>;
}) {
  const { profile } = await requireCoachOrAdmin();
  const isAdmin = profile.role === "admin";
  const { coach } = await searchParams;

  // Admins pick any coach; coaches only ever see their own business.
  let coachId = profile.id;
  let coaches: { id: string; display_name: string }[] = [];
  if (isAdmin) {
    const { data } = await createAdminClient()
      .from("profiles")
      .select("id, display_name")
      .eq("role", "coach")
      .order("display_name");
    coaches = (data ?? []) as { id: string; display_name: string }[];
    const chosen = idSchema.safeParse(coach).success ? coach! : coaches[0]?.id;
    if (!chosen) {
      return (
        <div className="space-y-4">
          <h1 className="text-5xl">Coach insights</h1>
          <p className="text-muted">No coaches yet.</p>
        </div>
      );
    }
    if (!coaches.some((row) => row.id === chosen)) redirect("/insights");
    coachId = chosen;
  }

  const data = await loadCoachInsights(coachId);
  const now = new Date();
  const money6 = earnings(
    data.sales,
    data.subscriptions,
    now,
    MEMBERSHIP_FEE_PERCENT,
  );
  const health = memberHealth(data.members, data.activity, now);
  const tasks = taskCompletion(data.assignments, now);
  const turnout = sessionTurnout(data.invites, data.attendance, now);
  const top = bestSellers(data.sales);
  const programs = programStats(data.programs);
  const coachName = coaches.find((row) => row.id === coachId)?.display_name;
  const change =
    money6.lastMonth > 0
      ? Math.round(
          ((money6.thisMonth - money6.lastMonth) / money6.lastMonth) * 100,
        )
      : null;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">
            {isAdmin ? "Coach insights" : "Insights"}
          </h1>
          <p className="mt-2 max-w-2xl text-muted">
            {isAdmin
              ? `How ${coachName}'s business is doing.`
              : "How your coaching business is doing."}{" "}
            Earnings are after GYMX2&apos;s {MEMBERSHIP_FEE_PERCENT}% fee and
            refunds.
          </p>
        </div>
        {isAdmin && (
          <form className="flex items-end gap-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Coach</span>
              <select
                name="coach"
                defaultValue={coachId}
                className="field-input"
              >
                {coaches.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.display_name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-secondary">
              Show
            </button>
          </form>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl">Earnings</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="This month"
            value={money(money6.thisMonth)}
            note={
              change === null
                ? undefined
                : `${change >= 0 ? "+" : ""}${change}% vs last month`
            }
          />
          <Tile
            label="Monthly memberships"
            value={money(money6.monthlyRecurring)}
            note={`${money6.payingMembers} paying${money6.trialingMembers ? ` · ${money6.trialingMembers} on trial` : ""}${
              money6.cancelling ? ` · ${money6.cancelling} cancelling` : ""
            }`}
          />
          <Tile label="Armory, all time" value={money(money6.fromArmory)} />
          <Tile
            label="All time"
            value={money(money6.allTime)}
            note={`${money(money6.fromMemberships)} from memberships`}
          />
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <EarningsChart months={money6.months} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">Members</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Members"
            value={String(health.total)}
            note={`${health.newThisMonth} joined in the last 30 days`}
          />
          <Tile
            label="Active this week"
            value={String(health.activeThisWeek)}
            note="Did a task, replied, posted or showed up"
          />
          <Tile
            label="Tasks done"
            value={rate(tasks.rate)}
            note={`${tasks.done} of ${tasks.given} given in the last 30 days`}
          />
          <Tile
            label="Session turnout"
            value={rate(turnout.goingRate)}
            note={`Said going · ${rate(turnout.liveRate)} watched live, last 30 days`}
          />
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold">
            Falling off ({health.fallingOff.length})
          </h3>
          {health.fallingOff.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
              Everyone has been active in the last {QUIET_DAYS} days.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
              {health.fallingOff.slice(0, 15).map((row) => (
                <li
                  key={row.member_id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <span className="font-medium">{row.name}</span>
                  <span className="flex items-center gap-3 text-muted">
                    {row.daysQuiet === null
                      ? "No activity yet"
                      : `Quiet for ${row.daysQuiet} days`}
                    {!isAdmin && (
                      <Link
                        href={`/messages/${row.member_id}`}
                        className="text-link"
                      >
                        Check in
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {health.fallingOff.length > 15 && (
            <p className="text-xs text-muted">
              And {health.fallingOff.length - 15} more.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-2xl">Best sellers</h2>
          {top.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
              No Armory sales yet.
            </p>
          ) : (
            <table className="w-full overflow-hidden rounded-lg border border-border bg-surface text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="p-3 font-medium">Item</th>
                  <th className="p-3 text-right font-medium">Sold</th>
                  <th className="p-3 text-right font-medium">Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {top.map((item) => (
                  <tr key={item.title}>
                    <td className="p-3">{item.title}</td>
                    <td className="p-3 text-right tabular-nums">{item.sold}</td>
                    <td className="p-3 text-right tabular-nums">
                      {money(item.cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl">Programs</h2>
          {programs.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
              No programs yet.{" "}
              {!isAdmin && (
                <Link href="/programs" className="text-link">
                  Build one
                </Link>
              )}
            </p>
          ) : (
            <table className="w-full overflow-hidden rounded-lg border border-border bg-surface text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="p-3 font-medium">Program</th>
                  <th className="p-3 text-right font-medium">Started</th>
                  <th className="p-3 text-right font-medium">Finished</th>
                  <th className="p-3 text-right font-medium">Avg. done</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {programs.map((program) => (
                  <tr key={program.id}>
                    <td className="p-3">
                      {isAdmin ? (
                        program.title
                      ) : (
                        <Link
                          href={`/programs/${program.id}`}
                          className="text-link"
                        >
                          {program.title}
                        </Link>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {program.started}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {program.finished}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {rate(program.average)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
