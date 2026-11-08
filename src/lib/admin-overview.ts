// The numbers on the admin overview, worked out from rows the admin can already read.

const DAY_MS = 24 * 60 * 60 * 1000;

export type OverviewUser = { role: string; coach_requested: boolean; created_at: string };
export type OverviewSale = {
  amount_cents: number;
  fee_cents: number;
  created_at: string;
  refunded_at: string | null;
  fulfillment_status: string;
};

export function summarizeOverview(
  input: { users: OverviewUser[]; sales: OverviewSale[]; flaggedConversations: number },
  now = new Date(),
) {
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const recent = (iso: string) => new Date(iso).getTime() >= weekAgo;

  const weekSales = input.sales.filter((sale) => !sale.refunded_at && recent(sale.created_at));
  const toShip = input.sales.filter((sale) => sale.fulfillment_status === "to_ship" && !sale.refunded_at);
  const oldestToShip = toShip.reduce<string | null>(
    (oldest, sale) => (!oldest || sale.created_at < oldest ? sale.created_at : oldest),
    null,
  );

  return {
    people: input.users.length,
    newPeople: input.users.filter((user) => recent(user.created_at)).length,
    coaches: input.users.filter((user) => user.role === "coach").length,
    members: input.users.filter((user) => user.role === "member").length,
    coachRequests: input.users.filter((user) => user.coach_requested && user.role === "member").length,
    weekSalesCount: weekSales.length,
    weekSalesCents: weekSales.reduce((sum, sale) => sum + sale.amount_cents, 0),
    weekKeptCents: weekSales.reduce((sum, sale) => sum + sale.fee_cents, 0),
    toShip: toShip.length,
    // Whole days the longest-waiting order has waited, so slow sellers stand out.
    oldestToShipDays: oldestToShip ? Math.floor((now.getTime() - new Date(oldestToShip).getTime()) / DAY_MS) : null,
    flaggedConversations: input.flaggedConversations,
  };
}

// The start of the 7-day window the overview covers.
export function weekAgoIso(now = new Date()) {
  return new Date(now.getTime() - 7 * DAY_MS).toISOString();
}
