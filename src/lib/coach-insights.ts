// A coach's business at a glance, computed from plain rows so it can be tested.

export const QUIET_DAYS = 7; // a member with no activity this long is "falling off"
const DAY_MS = 24 * 60 * 60 * 1000;

export type SaleRow = {
  item_id: string | null;
  item_title: string;
  amount_cents: number;
  fee_cents: number;
  kind: string;
  refunded_at: string | null;
  created_at: string;
};
export type SubscriptionRow = {
  member_id: string;
  price_cents: number;
  status: string;
  cancel_at_period_end: boolean;
};
export type MemberRow = { member_id: string; name: string; joined_at: string };
export type ActivityRow = { member_id: string; at: string };
export type AssignmentRow = { completed_at: string | null; created_at: string };
export type InviteRow = {
  session_id: string;
  member_id: string;
  response: string;
  ends_at: string;
};
export type AttendanceRow = { session_id: string; member_id: string };
export type ProgramRow = {
  id: string;
  title: string;
  days: number;
  enrollments: { done: number }[];
};

const net = (sale: SaleRow) => sale.amount_cents - sale.fee_cents;
const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

// "2026-11" in Eastern time, so a sale late on the 31st lands in the right month.
export function monthKey(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}

export function lastMonths(now: Date, count: number) {
  const [year, month] = monthKey(now.toISOString()).split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

export function earnings(
  sales: SaleRow[],
  subscriptions: SubscriptionRow[],
  now: Date,
  feePercent = 10,
) {
  const paid = sales.filter((sale) => !sale.refunded_at);
  const months = lastMonths(now, 6);
  const byMonth = new Map(months.map((key) => [key, 0]));
  for (const sale of paid) {
    const key = monthKey(sale.created_at);
    if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0) + net(sale));
  }
  const thisMonth = months[months.length - 1];
  const previous = months[months.length - 2];
  const active = subscriptions.filter(
    (sub) => sub.status === "active" && !sub.cancel_at_period_end,
  );
  const trialing = subscriptions.filter((sub) => sub.status === "trialing");
  const recurringGross = active.reduce((sum, sub) => sum + sub.price_cents, 0);

  return {
    thisMonth: byMonth.get(thisMonth) ?? 0,
    lastMonth: byMonth.get(previous) ?? 0,
    allTime: paid.reduce((sum, sale) => sum + net(sale), 0),
    fromMemberships: paid
      .filter((sale) => sale.kind === "membership")
      .reduce((sum, sale) => sum + net(sale), 0),
    fromArmory: paid
      .filter((sale) => sale.kind !== "membership")
      .reduce((sum, sale) => sum + net(sale), 0),
    // What active paying members will bring in each month after GYMX2's fee.
    monthlyRecurring: Math.round(recurringGross * (1 - feePercent / 100)),
    payingMembers: active.length,
    trialingMembers: trialing.length,
    cancelling: subscriptions.filter(
      (sub) => sub.status === "active" && sub.cancel_at_period_end,
    ).length,
    months: months.map((key) => ({
      key,
      label: monthLabel(key),
      cents: byMonth.get(key) ?? 0,
    })),
  };
}

export function bestSellers(sales: SaleRow[], limit = 5) {
  const items = new Map<
    string,
    { title: string; sold: number; cents: number }
  >();
  for (const sale of sales) {
    if (sale.refunded_at || sale.kind === "membership") continue;
    const key = sale.item_id ?? sale.item_title;
    const entry = items.get(key) ?? {
      title: sale.item_title,
      sold: 0,
      cents: 0,
    };
    entry.sold += 1;
    entry.cents += net(sale);
    items.set(key, entry);
  }
  return [...items.values()]
    .sort((a, b) => b.cents - a.cents || b.sold - a.sold)
    .slice(0, limit);
}

export function memberHealth(
  members: MemberRow[],
  activity: ActivityRow[],
  now: Date,
) {
  const last = new Map<string, string>();
  for (const row of activity) {
    const seen = last.get(row.member_id);
    if (!seen || row.at > seen) last.set(row.member_id, row.at);
  }
  const weekAgo = new Date(now.getTime() - QUIET_DAYS * DAY_MS).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const rows = members.map((member) => {
    const lastActive = last.get(member.member_id) ?? null;
    return {
      ...member,
      lastActive,
      daysQuiet: lastActive
        ? Math.floor((now.getTime() - new Date(lastActive).getTime()) / DAY_MS)
        : null,
    };
  });
  return {
    total: members.length,
    newThisMonth: members.filter((member) => member.joined_at >= monthAgo)
      .length,
    activeThisWeek: rows.filter(
      (row) => row.lastActive && row.lastActive >= weekAgo,
    ).length,
    // Quietest first; members who joined in the last week get a grace period.
    fallingOff: rows
      .filter(
        (row) =>
          (!row.lastActive || row.lastActive < weekAgo) &&
          row.joined_at < weekAgo,
      )
      .sort((a, b) => (a.lastActive ?? "").localeCompare(b.lastActive ?? "")),
  };
}

export function taskCompletion(assignments: AssignmentRow[], now: Date) {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const recent = assignments.filter((row) => row.created_at >= since);
  const done = recent.filter((row) => row.completed_at).length;
  return { given: recent.length, done, rate: percent(done, recent.length) };
}

export function sessionTurnout(
  invites: InviteRow[],
  attendance: AttendanceRow[],
  now: Date,
) {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const nowIso = now.toISOString();
  const past = invites.filter(
    (row) => row.ends_at >= since && row.ends_at <= nowIso,
  );
  const came = new Set(
    attendance.map((row) => `${row.session_id}:${row.member_id}`),
  );
  const going = past.filter((row) => row.response === "going").length;
  const live = past.filter((row) =>
    came.has(`${row.session_id}:${row.member_id}`),
  ).length;
  return {
    sessions: new Set(past.map((row) => row.session_id)).size,
    invited: past.length,
    goingRate: percent(going, past.length),
    watchedLive: live,
    liveRate: percent(live, past.length),
  };
}

export function programStats(programs: ProgramRow[]) {
  return programs
    .map((program) => {
      const finished = program.enrollments.filter(
        (row) => program.days > 0 && row.done >= program.days,
      ).length;
      const average =
        program.enrollments.length && program.days
          ? Math.round(
              (program.enrollments.reduce(
                (sum, row) => sum + Math.min(row.done, program.days),
                0,
              ) /
                (program.enrollments.length * program.days)) *
                100,
            )
          : null;
      return {
        id: program.id,
        title: program.title,
        started: program.enrollments.length,
        finished,
        average,
      };
    })
    .sort((a, b) => b.started - a.started);
}
