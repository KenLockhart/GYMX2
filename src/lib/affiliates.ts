// Affiliate program rules, shared by the server and the pages.

export type CommissionBase = "platform_share" | "sale_price";

export type ProgramSettings = {
  sale_percent: number;
  sale_base: CommissionBase;
  signup_bonus_cents: number;
  hold_days: number;
  attribution_months: number;
  cookie_days: number;
  min_payout_cents: number;
};

export const DEFAULT_SETTINGS: ProgramSettings = {
  sale_percent: 10,
  sale_base: "platform_share",
  signup_bonus_cents: 500,
  hold_days: 30,
  attribution_months: 12,
  cookie_days: 30,
  min_payout_cents: 2500,
};

export const REFERRAL_COOKIE = "gymx2_ref";

export const BASE_LABELS: Record<CommissionBase, string> = {
  platform_share: "GYMX2's share of the sale",
  sale_price: "the full item price",
};

// Codes are what goes in the link: gymx2.com/r/<code>.
export function normalizeCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

export function isValidCode(code: string) {
  return /^[a-z0-9][a-z0-9-]{2,23}$/.test(code);
}

// Without a page, the link goes to sign-up.
export function referralLink(siteUrl: string, code: string, path?: string) {
  const to = path ? `?to=${encodeURIComponent(path)}` : "";
  return `${siteUrl}/r/${code}${to}`;
}

// The rates that apply to one affiliate: their own where an admin set one, otherwise the program's.
export function effectiveRates(
  settings: ProgramSettings,
  affiliate: {
    sale_percent: number | string | null;
    signup_bonus_cents: number | null;
  },
) {
  return {
    salePercent:
      affiliate.sale_percent === null
        ? settings.sale_percent
        : Number(affiliate.sale_percent),
    signupBonusCents:
      affiliate.signup_bonus_cents ?? settings.signup_bonus_cents,
    custom:
      affiliate.sale_percent !== null || affiliate.signup_bonus_cents !== null,
  };
}

// The commission on one purchase. Shipping never counts. GYMX2's share is its fee on a coach's
// item, or the whole item price on GYMX2's own item.
export function saleCommission(
  sale: {
    amount_cents: number;
    shipping_cents: number;
    fee_cents: number;
    platformItem: boolean;
  },
  settings: Pick<ProgramSettings, "sale_base">,
  salePercent: number,
) {
  const itemPrice = Math.max(0, sale.amount_cents - sale.shipping_cents);
  const base =
    settings.sale_base === "sale_price"
      ? itemPrice
      : sale.platformItem
        ? itemPrice
        : Math.min(sale.fee_cents, itemPrice);
  return {
    baseCents: base,
    amountCents: Math.round((base * salePercent) / 100),
  };
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export type CommissionRow = {
  amount_cents: number;
  status: "pending" | "paid" | "void";
  available_at: string;
};

// Splits commissions into waiting (still in the hold period), available (ready to pay) and paid.
export function earningsSummary(rows: CommissionRow[], now = new Date()) {
  const summary = {
    waitingCents: 0,
    availableCents: 0,
    paidCents: 0,
    voidCents: 0,
  };
  for (const row of rows) {
    if (row.status === "paid") summary.paidCents += row.amount_cents;
    else if (row.status === "void") summary.voidCents += row.amount_cents;
    else if (new Date(row.available_at) <= now)
      summary.availableCents += row.amount_cents;
    else summary.waitingCents += row.amount_cents;
  }
  return summary;
}

export const AFFILIATE_STATUS_LABELS: Record<string, string> = {
  pending: "Waiting for review",
  approved: "Approved",
  paused: "Paused",
  rejected: "Not approved",
};
