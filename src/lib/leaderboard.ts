// Admin leaderboards, worked out from activity counts. Only who-did-what-when is used,
// never the content of messages or memos.

export type Person = {
  id: string;
  display_name: string;
  role: string;
  created_at?: string;
};

export type ActivityRows = {
  people: Person[];
  completions: { member_id: string }[]; // tasks members finished
  assigned: { coach_id: string }[]; // one row per member a coach gave a task to
  going: { member_id: string }[]; // "Going" replies to sessions
  sessions: { coach_id: string }[]; // sessions coaches scheduled
  messages: { sender_id: string }[];
  memos: { user_id: string }[];
  habits: { user_id: string }[]; // daily habit check-ins
  videos: { coach_id: string }[];
  joins: { coach_id: string; member_id: string }[]; // members who joined a coach
  sales: {
    member_id: string | null;
    seller_id: string | null;
    item_id: string | null;
    item_title: string;
    amount_cents: number;
    fee_cents: number;
    refunded_at: string | null;
    kind?: string;
    created_at?: string;
  }[];
};

// How much each action counts toward an activity score. Shown on the page so the ranking is clear.
export const MEMBER_POINTS = {
  tasks: 3,
  sessions: 2,
  messages: 1,
  memos: 1,
  habits: 1,
} as const;
export const COACH_POINTS = {
  videos: 3,
  newMembers: 3,
  sessions: 2,
  tasks: 1,
  messages: 1,
} as const;

function tally<T>(rows: T[], key: (row: T) => string | null) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = key(row);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function buildLeaderboards(rows: ActivityRows, limit = 10) {
  const byRole = (role: string) =>
    rows.people.filter((person) => person.role === role);
  const name = new Map(
    rows.people.map((person) => [person.id, person.display_name]),
  );

  const completed = tally(rows.completions, (row) => row.member_id);
  const going = tally(rows.going, (row) => row.member_id);
  const sent = tally(rows.messages, (row) => row.sender_id);
  const memos = tally(rows.memos, (row) => row.user_id);
  const habits = tally(rows.habits, (row) => row.user_id);
  const videos = tally(rows.videos, (row) => row.coach_id);
  const scheduled = tally(rows.sessions, (row) => row.coach_id);
  const assigned = tally(rows.assigned, (row) => row.coach_id);
  const joined = tally(rows.joins, (row) => row.coach_id);

  const members = byRole("member")
    .map((person) => {
      const stats = {
        tasks: completed.get(person.id) ?? 0,
        sessions: going.get(person.id) ?? 0,
        messages: sent.get(person.id) ?? 0,
        memos: memos.get(person.id) ?? 0,
        habits: habits.get(person.id) ?? 0,
      };
      const score =
        stats.tasks * MEMBER_POINTS.tasks +
        stats.sessions * MEMBER_POINTS.sessions +
        stats.messages * MEMBER_POINTS.messages +
        stats.memos * MEMBER_POINTS.memos +
        stats.habits * MEMBER_POINTS.habits;
      return { id: person.id, name: person.display_name, ...stats, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);

  const coaches = byRole("coach")
    .map((person) => {
      const stats = {
        videos: videos.get(person.id) ?? 0,
        newMembers: joined.get(person.id) ?? 0,
        sessions: scheduled.get(person.id) ?? 0,
        tasks: assigned.get(person.id) ?? 0,
        messages: sent.get(person.id) ?? 0,
      };
      const score =
        stats.videos * COACH_POINTS.videos +
        stats.newMembers * COACH_POINTS.newMembers +
        stats.sessions * COACH_POINTS.sessions +
        stats.tasks * COACH_POINTS.tasks +
        stats.messages * COACH_POINTS.messages;
      return { id: person.id, name: person.display_name, ...stats, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);

  // Money boards leave refunded orders out.
  const paid = rows.sales.filter((sale) => !sale.refunded_at);

  const buyerTotals = new Map<string, { orders: number; cents: number }>();
  for (const sale of paid) {
    if (!sale.member_id) continue; // the buyer deleted their account
    const row = buyerTotals.get(sale.member_id) ?? { orders: 0, cents: 0 };
    row.orders += 1;
    row.cents += sale.amount_cents;
    buyerTotals.set(sale.member_id, row);
  }
  const buyers = [...buyerTotals]
    .map(([id, totals]) => ({
      id,
      name: name.get(id) ?? "Former member",
      ...totals,
    }))
    .sort((a, b) => b.cents - a.cents || b.orders - a.orders)
    .slice(0, limit);

  // GYMX2's own items (sold by an admin) are grouped as GYMX2.
  const admins = new Set(byRole("admin").map((person) => person.id));
  const sellerTotals = new Map<
    string,
    { sales: number; cents: number; earned: number }
  >();
  for (const sale of paid) {
    const key =
      !sale.seller_id || admins.has(sale.seller_id) ? "gymx2" : sale.seller_id;
    const row = sellerTotals.get(key) ?? { sales: 0, cents: 0, earned: 0 };
    row.sales += 1;
    row.cents += sale.amount_cents;
    row.earned += key === "gymx2" ? 0 : sale.amount_cents - sale.fee_cents;
    sellerTotals.set(key, row);
  }
  const sellers = [...sellerTotals]
    .map(([id, totals]) => ({
      id,
      name: id === "gymx2" ? "GYMX2" : (name.get(id) ?? "Former coach"),
      ...totals,
    }))
    .sort((a, b) => b.cents - a.cents || b.sales - a.sales)
    .slice(0, limit);

  const itemTotals = new Map<
    string,
    {
      id: string | null;
      title: string;
      sold: number;
      cents: number;
      membership: boolean;
    }
  >();
  for (const sale of paid) {
    const membership = sale.kind === "membership";
    const key =
      sale.item_id ??
      `${membership ? "membership" : "removed"}:${sale.item_title}`;
    const row = itemTotals.get(key) ?? {
      id: sale.item_id,
      title: sale.item_title,
      sold: 0,
      cents: 0,
      membership,
    };
    row.sold += 1;
    row.cents += sale.amount_cents;
    itemTotals.set(key, row);
  }
  const items = [...itemTotals.values()]
    .sort((a, b) => b.sold - a.sold || b.cents - a.cents)
    .slice(0, limit);

  return { members, coaches, buyers, sellers, items };
}

export const LEADERBOARD_RANGES = [
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "all", label: "All time", days: null },
] as const;

export function rangeStart(value: string | undefined, now = new Date()) {
  const range =
    LEADERBOARD_RANGES.find((option) => option.value === value) ??
    LEADERBOARD_RANGES[1];
  return {
    range,
    since:
      range.days === null
        ? null
        : new Date(
            now.getTime() - range.days * 24 * 60 * 60 * 1000,
          ).toISOString(),
  };
}

// Community engagement: shared posts, comments and likes. Posts kept to "only me" and removed
// posts or comments don't count.
export const ENGAGEMENT_POINTS = { posts: 3, comments: 2, likes: 1 } as const;

export type EngagementRows = {
  posts: { author_id: string }[];
  comments: { author_id: string }[];
  likes: { user_id: string }[];
};

export function buildEngagement(
  people: Person[],
  rows: EngagementRows,
  limit = 10,
) {
  const posts = tally(rows.posts, (r) => r.author_id);
  const comments = tally(rows.comments, (r) => r.author_id);
  const likes = tally(rows.likes, (r) => r.user_id);
  return people
    .filter((person) => person.role !== "admin")
    .map((person) => {
      const stats = {
        posts: posts.get(person.id) ?? 0,
        comments: comments.get(person.id) ?? 0,
        likes: likes.get(person.id) ?? 0,
      };
      const score =
        stats.posts * ENGAGEMENT_POINTS.posts +
        stats.comments * ENGAGEMENT_POINTS.comments +
        stats.likes * ENGAGEMENT_POINTS.likes;
      return {
        id: person.id,
        name: person.display_name,
        role: person.role,
        ...stats,
        score,
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// Armory sales over a window and the one before it, with a running total per day.
export function salesTrend(
  sales: {
    amount_cents: number;
    created_at?: string;
    refunded_at: string | null;
  }[],
  days: number,
  now = new Date(),
) {
  const DAY = 24 * 60 * 60 * 1000;
  const end = now.getTime();
  const start = end - days * DAY;
  const paid = sales
    .filter((s) => !s.refunded_at && s.created_at)
    .map((s) => ({
      t: new Date(s.created_at!).getTime(),
      cents: s.amount_cents,
    }));
  const sum = (from: number, to: number) =>
    paid
      .filter((s) => s.t > from && s.t <= to)
      .reduce((total, s) => total + s.cents, 0);
  const cents = sum(start, end);
  const prevCents = sum(start - days * DAY, start);
  const changePct =
    prevCents > 0
      ? Math.round(((cents - prevCents) / prevCents) * 1000) / 10
      : null;
  const series = Array.from({ length: days + 1 }, (_, i) =>
    sum(start, start + i * DAY),
  );
  return { cents, prevCents, changePct, series };
}
