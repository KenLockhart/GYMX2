import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney } from "@/lib/armory";
import { requireAdmin } from "@/lib/auth";
import { COACH_POINTS, LEADERBOARD_RANGES, MEMBER_POINTS, buildLeaderboards, rangeStart } from "@/lib/leaderboard";
import { loadActivity } from "./load";

export const metadata: Metadata = { title: "Leaderboard" };

function Board({
  title,
  note,
  columns,
  rows,
  empty,
}: {
  title: string;
  note?: string;
  columns: string[];
  rows: { key: string; name: React.ReactNode; cells: React.ReactNode[] }[];
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-2xl">{title}</h2>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="w-10 p-3 font-medium">#</th>
                <th className="p-3 font-medium">Name</th>
                {columns.map((column, index) => (
                  <th
                    key={column}
                    className={`p-3 text-right font-medium ${index === columns.length - 1 ? "text-foreground" : ""}`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, rank) => (
                <tr key={row.key} className={rank === 0 ? "bg-surface-raised" : undefined}>
                  <td className={`p-3 font-semibold ${rank < 3 ? "text-accent" : "text-muted"}`}>{rank + 1}</td>
                  <td className="p-3 font-medium">{row.name}</td>
                  {row.cells.map((cell, index) => (
                    <td
                      key={index}
                      className={`p-3 text-right tabular-nums ${index === row.cells.length - 1 ? "font-semibold" : "text-muted"}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdmin();
  const requested = (await searchParams).range;
  const { range, since } = rangeStart(typeof requested === "string" ? requested : undefined);
  const boards = buildLeaderboards(await loadActivity(since));
  const empty = range.days === null ? "Nothing yet." : `Nothing in the ${range.label.toLowerCase()}.`;

  return (
    <div className="space-y-8">
      <Link href="/admin" className="text-link text-sm">
        Back to admin
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">Leaderboard</h1>
          <p className="mt-2 max-w-2xl text-muted">
            Who&apos;s most active and who&apos;s selling. Scores count what people do, never what they write.
          </p>
        </div>
        <nav aria-label="Time range" className="flex gap-2">
          {LEADERBOARD_RANGES.map((option) => (
            <Link
              key={option.value}
              href={`/admin/leaderboard?range=${option.value}`}
              aria-current={option.value === range.value ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                option.value === range.value
                  ? "bg-accent text-accent-foreground"
                  : "border border-border hover:bg-surface-raised"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <Board
          title="Most active members"
          note={`Points: task done ${MEMBER_POINTS.tasks} · session RSVP ${MEMBER_POINTS.sessions} · message ${MEMBER_POINTS.messages} · memo ${MEMBER_POINTS.memos}`}
          columns={["Tasks done", "Sessions", "Messages", "Memos", "Score"]}
          rows={boards.members.map((row) => ({
            key: row.id,
            name: row.name,
            cells: [row.tasks, row.sessions, row.messages, row.memos, row.score],
          }))}
          empty={empty}
        />
        <Board
          title="Most active coaches"
          note={`Points: video ${COACH_POINTS.videos} · new member ${COACH_POINTS.newMembers} · session ${COACH_POINTS.sessions} · task given ${COACH_POINTS.tasks} · message ${COACH_POINTS.messages}`}
          columns={["Videos", "New members", "Sessions", "Tasks given", "Messages", "Score"]}
          rows={boards.coaches.map((row) => ({
            key: row.id,
            name: row.name,
            cells: [row.videos, row.newMembers, row.sessions, row.tasks, row.messages, row.score],
          }))}
          empty={empty}
        />
        <Board
          title="Top buyers"
          note="Refunded orders are left out."
          columns={["Orders", "Spent"]}
          rows={boards.buyers.map((row) => ({
            key: row.id,
            name: row.name,
            cells: [row.orders, formatMoney(row.cents)],
          }))}
          empty={empty}
        />
        <Board
          title="Top sellers"
          note="GYMX2's own items are grouped as GYMX2. Coach earnings are before Stripe's card fees."
          columns={["Sales", "Coach earned", "Total sold"]}
          rows={boards.sellers.map((row) => ({
            key: row.id,
            name: row.name,
            cells: [row.sales, row.id === "gymx2" ? "—" : formatMoney(row.earned), formatMoney(row.cents)],
          }))}
          empty={empty}
        />
        <Board
          title="Best-selling items"
          columns={["Revenue", "Sold"]}
          rows={boards.items.map((row) => ({
            key: row.id ?? row.title,
            name: row.id ? (
              <Link href={`/armory/${row.id}`} className="hover:text-accent">
                {row.title}
              </Link>
            ) : (
              <span>
                {row.title} <span className="text-xs text-muted">(removed)</span>
              </span>
            ),
            cells: [formatMoney(row.cents), row.sold],
          }))}
          empty={empty}
        />
      </div>
    </div>
  );
}
