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
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Insights") };
}

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
  const tr = await getTr();
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
          <h1 className="text-5xl">
            <T>Coach insights</T>
          </h1>
          <p className="text-muted">
            <T>No coaches yet.</T>
          </p>
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
            {isAdmin ? tr("Coach insights") : tr("Insights")}
          </h1>
          <p className="mt-2 max-w-2xl text-muted">
            {isAdmin
              ? tr("How {coachName}'s business is doing.", {
                  coachName: coachName ?? "",
                })
              : tr("How your coaching business is doing.")}{" "}
            {tr("Earnings are after GYMX2's {fee}% fee and refunds.", {
              fee: MEMBERSHIP_FEE_PERCENT,
            })}
          </p>
        </div>
        {isAdmin && (
          <form className="flex items-end gap-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                <T>Coach</T>
              </span>
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
              <T>Show</T>
            </button>
          </form>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl">
          <T>Earnings</T>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label={tr("This month")}
            value={money(money6.thisMonth)}
            note={
              change === null
                ? undefined
                : tr("{change}% vs last month", {
                    change: `${change >= 0 ? "+" : ""}${change}`,
                  })
            }
          />
          <Tile
            label={tr("Monthly memberships")}
            value={money(money6.monthlyRecurring)}
            note={`${tr("{n} paying", { n: money6.payingMembers })}${money6.trialingMembers ? tr(" · {trialingMembers} on trial", { trialingMembers: money6.trialingMembers }) : ""}${
              money6.cancelling
                ? tr(" · {n} cancelling", { n: money6.cancelling })
                : ""
            }`}
          />
          <Tile
            label={tr("Armory, all time")}
            value={money(money6.fromArmory)}
          />
          <Tile
            label={tr("All time")}
            value={money(money6.allTime)}
            note={tr("{amount} from memberships", {
              amount: money(money6.fromMemberships),
            })}
          />
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <EarningsChart months={money6.months} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">
          <T>Members</T>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label={tr("Members")}
            value={String(health.total)}
            note={tr("{n} joined in the last 30 days", {
              n: health.newThisMonth,
            })}
          />
          <Tile
            label={tr("Active this week")}
            value={String(health.activeThisWeek)}
            note={tr("Did a task, replied, posted or showed up")}
          />
          <Tile
            label={tr("Tasks done")}
            value={rate(tasks.rate)}
            note={tr("{done} of {given} given in the last 30 days", {
              done: tasks.done,
              given: tasks.given,
            })}
          />
          <Tile
            label={tr("Session turnout")}
            value={rate(turnout.goingRate)}
            note={tr("Said going · {rate} watched live, last 30 days", {
              rate: rate(turnout.liveRate),
            })}
          />
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold">
            {tr("Falling off ({n})", { n: health.fallingOff.length })}
          </h3>
          {health.fallingOff.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
              {tr("Everyone has been active in the last {days} days.", {
                days: QUIET_DAYS,
              })}
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
                      ? tr("No activity yet")
                      : tr("Quiet for {daysQuiet} days", {
                          daysQuiet: row.daysQuiet,
                        })}
                    {!isAdmin && (
                      <Link
                        href={`/messages/${row.member_id}`}
                        className="text-link"
                      >
                        <T>Check in</T>
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {health.fallingOff.length > 15 && (
            <p className="text-xs text-muted">
              {tr("And {n} more.", { n: health.fallingOff.length - 15 })}
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-2xl">
            <T>Best sellers</T>
          </h2>
          {top.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
              <T>No Armory sales yet.</T>
            </p>
          ) : (
            <table className="w-full overflow-hidden rounded-lg border border-border bg-surface text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="p-3 font-medium">
                    <T>Item</T>
                  </th>
                  <th className="p-3 text-right font-medium">
                    <T>Sold</T>
                  </th>
                  <th className="p-3 text-right font-medium">
                    <T>Earned</T>
                  </th>
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
          <h2 className="text-2xl">
            <T>Programs</T>
          </h2>
          {programs.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
              <T>No programs yet.</T>{" "}
              {!isAdmin && (
                <Link href="/programs" className="text-link">
                  <T>Build one</T>
                </Link>
              )}
            </p>
          ) : (
            <table className="w-full overflow-hidden rounded-lg border border-border bg-surface text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="p-3 font-medium">
                    <T>Program</T>
                  </th>
                  <th className="p-3 text-right font-medium">
                    <T>Started</T>
                  </th>
                  <th className="p-3 text-right font-medium">
                    <T>Finished</T>
                  </th>
                  <th className="p-3 text-right font-medium">
                    <T>Avg. done</T>
                  </th>
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
