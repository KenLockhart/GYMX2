const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const NEW_YORK_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type FeaturedCoachCandidate = {
  id: string;
  name: string;
  publishedAt: string | null;
};

export type FeaturedSaleRow = {
  seller_id: string | null;
  kind: string;
  amount_cents: number;
  shipping_cents: number;
  refunded_at: string | null;
  created_at: string;
};

export type FeaturedMemberRow = {
  coach_id: string;
  member_id: string;
  created_at: string;
};

export type FeaturedActivityRow = {
  coach_id: string;
  created_at: string;
};

export type FeaturedCoachMetrics = {
  salesCents: number;
  newMembers: number;
  activeDays: number;
  score: number;
};

export type FeaturedCoachRank = FeaturedCoachCandidate & {
  metrics: FeaturedCoachMetrics;
};

export type FeaturedCoachRanking = {
  eligibleCount: number;
  winner: FeaturedCoachRank | null;
  ranking: FeaturedCoachRank[];
};

type MetricsRows = {
  sales: FeaturedSaleRow[];
  members: FeaturedMemberRow[];
  activity: FeaturedActivityRow[];
};

export type FeaturedCoachMetricRows = MetricsRows;

export type ExactPage<T> = {
  data: T[] | null;
  error: unknown;
  count: number | null;
};

/**
 * Collects an exact-count query even when the server silently caps each response
 * below the requested page size. Stable unique keys detect overlapping pages.
 */
export async function readExactPages<T>(
  request: (from: number, to: number) => PromiseLike<ExactPage<T>>,
  keyOf: (row: T) => string,
  pageSize = 1_000,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Featured coach page size must be a positive integer.");
  }
  const first = await request(0, pageSize - 1);
  if (first.error || first.count === null) {
    throw new Error("Featured coach metrics could not be read completely.");
  }

  const expectedCount = first.count;
  const rows = [...(first.data ?? [])];
  if (rows.length > expectedCount || rows.length > pageSize) {
    throw new Error("Featured coach metrics changed while being read.");
  }
  if (expectedCount > 0 && !rows.length) {
    throw new Error("Featured coach metrics were truncated while being read.");
  }

  const keys = new Set(rows.map(keyOf));
  if (keys.size !== rows.length) {
    throw new Error("Featured coach metrics contained overlapping rows.");
  }

  while (rows.length < expectedCount) {
    const from = rows.length;
    const to = Math.min(from + pageSize - 1, expectedCount - 1);
    const page = await request(from, to);
    if (page.error || page.count !== expectedCount) {
      throw new Error("Featured coach metrics changed while being read.");
    }
    const next = page.data ?? [];
    if (!next.length) {
      throw new Error("Featured coach metrics were truncated while being read.");
    }
    if (next.length > to - from + 1 || rows.length + next.length > expectedCount) {
      throw new Error("Featured coach metrics changed while being read.");
    }
    for (const row of next) {
      const key = keyOf(row);
      if (keys.has(key)) {
        throw new Error("Featured coach metrics contained overlapping rows.");
      }
      keys.add(key);
    }
    rows.push(...next);
  }

  if (rows.length !== expectedCount) {
    throw new Error("Featured coach metrics were truncated while being read.");
  }
  return rows;
}

function parseInWindow(value: string, start: number, end: number) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= start && time <= end ? time : null;
}

function easternDay(timestamp: number) {
  const parts = NEW_YORK_DATE.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function numericCents(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Ranks only coaches with a published profile using three equally weighted signals
 * from the rolling 720-hour window. Sales are paid, unrefunded purchase-ledger value
 * excluding pass-through shipping; membership invoice ledger rows count once and
 * subscription tables/events are never added. Member growth is distinct new coach-
 * member links; activity is Eastern calendar days with a ready video, created session,
 * or task assignment. Messages are deliberately not an activity signal.
 */
export function rankFeaturedCoaches(
  coaches: FeaturedCoachCandidate[],
  rows: MetricsRows,
  now = new Date(),
): FeaturedCoachRanking {
  const end = now.getTime();
  const start = end - WINDOW_MS;
  const eligible = coaches.filter((coach) => Boolean(coach.publishedAt));
  if (!eligible.length) return { eligibleCount: 0, winner: null, ranking: [] };

  const byId = new Map(
    eligible.map((coach) => [
      coach.id,
      {
        coach,
        salesCents: 0,
        members: new Set<string>(),
        activeDays: new Set<string>(),
      },
    ]),
  );

  for (const sale of rows.sales) {
    if (sale.refunded_at || !sale.seller_id) continue;
    if (parseInWindow(sale.created_at, start, end) === null) continue;
    const ranked = byId.get(sale.seller_id);
    if (!ranked) continue;
    ranked.salesCents += Math.max(
      0,
      numericCents(sale.amount_cents) - numericCents(sale.shipping_cents),
    );
  }

  for (const member of rows.members) {
    if (!byId.has(member.coach_id) || !member.member_id) continue;
    if (parseInWindow(member.created_at, start, end) === null) continue;
    byId.get(member.coach_id)?.members.add(member.member_id);
  }

  for (const action of rows.activity) {
    const ranked = byId.get(action.coach_id);
    if (!ranked) continue;
    const timestamp = parseInWindow(action.created_at, start, end);
    if (timestamp === null) continue;
    const day = easternDay(timestamp);
    if (day) ranked.activeDays.add(day);
  }

  const totals = [...byId.values()].map(({ coach, salesCents, members, activeDays }) => ({
    ...coach,
    metrics: {
      salesCents,
      newMembers: members.size,
      activeDays: activeDays.size,
      score: 0,
    },
  }));

  const components = ["salesCents", "newMembers", "activeDays"] as const;
  const normalized = totals.map(() => [0, 0, 0]);
  components.forEach((component, componentIndex) => {
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const row of totals) {
      const value = row.metrics[component];
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    for (let index = 0; index < totals.length; index += 1) {
      const value = totals[index].metrics[component];
      normalized[index][componentIndex] =
        maximum === minimum
          ? maximum > 0
            ? 1
            : 0
          : (value - minimum) / (maximum - minimum);
    }
  });

  const ranking = totals
    .map((row, index) => ({
      ...row,
      metrics: {
        ...row.metrics,
        score:
          ((normalized[index][0] + normalized[index][1] + normalized[index][2]) / 3) *
          100,
      },
    }))
    .sort(
      (a, b) =>
        b.metrics.score - a.metrics.score ||
        b.metrics.salesCents - a.metrics.salesCents ||
        b.metrics.newMembers - a.metrics.newMembers ||
        b.metrics.activeDays - a.metrics.activeDays ||
        a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
        a.id.localeCompare(b.id),
    );

  const hasActivity = ranking.some(
    ({ metrics }) =>
      metrics.salesCents > 0 || metrics.newMembers > 0 || metrics.activeDays > 0,
  );
  return {
    eligibleCount: eligible.length,
    winner: hasActivity ? ranking[0] : null,
    ranking,
  };
}
