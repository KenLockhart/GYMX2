import "server-only";
import {
  DEFAULT_SETTINGS,
  addDays,
  addMonths,
  effectiveRates,
  isValidCode,
  saleCommission,
  type ProgramSettings,
} from "@/lib/affiliates";
import { formatMoney } from "@/lib/armory";
import { createAdminClient } from "@/lib/supabase/admin";

// Everything here uses the server key and is called from trusted server code only.

export async function loadProgramSettings(): Promise<ProgramSettings> {
  const { data } = await createAdminClient()
    .from("affiliate_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    sale_percent: Number(data.sale_percent),
    sale_base: data.sale_base,
    signup_bonus_cents: data.signup_bonus_cents,
    hold_days: data.hold_days,
    attribution_months: data.attribution_months,
    cookie_days: data.cookie_days,
    min_payout_cents: data.min_payout_cents,
  };
}

// The approved affiliate behind a link code, if any.
export async function findApprovedAffiliate(code: string) {
  if (!isValidCode(code)) return null;
  const { data } = await createAdminClient()
    .from("affiliates")
    .select("user_id, code")
    .eq("code", code)
    .eq("status", "approved")
    .maybeSingle();
  return data as { user_id: string; code: string } | null;
}

export async function recordClick(affiliateId: string) {
  await createAdminClient()
    .from("affiliate_clicks")
    .insert({ affiliate_id: affiliateId });
}

// Links a brand-new account to the affiliate whose link they came through.
export async function attributeSignup(newUserId: string, code: string) {
  const affiliate = await findApprovedAffiliate(code);
  if (!affiliate || affiliate.user_id === newUserId) return;
  const settings = await loadProgramSettings();
  const { error } = await createAdminClient()
    .from("referrals")
    .insert({
      referred_user_id: newUserId,
      affiliate_id: affiliate.user_id,
      expires_at: addMonths(
        new Date(),
        settings.attribution_months,
      ).toISOString(),
    });
  if (error && error.code !== "23505")
    console.error("Referral not saved", error);
}

async function insertOnce(row: Record<string, unknown>) {
  const { error } = await createAdminClient().from("commissions").insert(row);
  // 23505: this purchase or sign-up was already credited.
  if (error && error.code !== "23505") throw error;
}

// Credits the referring affiliate for a new purchase: a share of the sale, plus the one-off
// sign-up bonus on the referred person's first purchase.
export async function recordAffiliateCommissions(purchaseId: string) {
  try {
    const db = createAdminClient();
    const { data: purchase } = await db
      .from("purchases")
      .select(
        "id, member_id, seller_id, item_title, amount_cents, shipping_cents, fee_cents, created_at, refunded_at",
      )
      .eq("id", purchaseId)
      .maybeSingle();
    if (!purchase?.member_id || purchase.refunded_at) return;

    const { data: referral } = await db
      .from("referrals")
      .select(
        "affiliate_id, expires_at, affiliate:affiliates(status, sale_percent, signup_bonus_cents)",
      )
      .eq("referred_user_id", purchase.member_id)
      .maybeSingle();
    const affiliate = (
      referral as unknown as {
        affiliate: {
          status: string;
          sale_percent: string | null;
          signup_bonus_cents: number | null;
        } | null;
      } | null
    )?.affiliate;
    if (!referral || !affiliate || affiliate.status !== "approved") return;
    if (new Date(purchase.created_at) > new Date(referral.expires_at)) return;
    // Affiliates don't earn on their own sales.
    if (purchase.seller_id === referral.affiliate_id) return;

    const settings = await loadProgramSettings();
    const rates = effectiveRates(settings, affiliate);
    const { data: seller } = purchase.seller_id
      ? await db
          .from("profiles")
          .select("role")
          .eq("id", purchase.seller_id)
          .maybeSingle()
      : { data: null };
    const sale = saleCommission(
      {
        amount_cents: purchase.amount_cents,
        shipping_cents: purchase.shipping_cents,
        fee_cents: purchase.fee_cents,
        platformItem: !purchase.seller_id || seller?.role === "admin",
      },
      settings,
      rates.salePercent,
    );
    const availableAt = addDays(new Date(), settings.hold_days).toISOString();

    if (sale.amountCents > 0) {
      await insertOnce({
        affiliate_id: referral.affiliate_id,
        kind: "sale",
        purchase_id: purchase.id,
        referred_user_id: purchase.member_id,
        description: `Sale: ${purchase.item_title}`.slice(0, 200),
        base_cents: sale.baseCents,
        rate: `${rates.salePercent}%`,
        amount_cents: sale.amountCents,
        available_at: availableAt,
      });
    }
    if (rates.signupBonusCents > 0) {
      await insertOnce({
        affiliate_id: referral.affiliate_id,
        kind: "signup",
        purchase_id: purchase.id,
        referred_user_id: purchase.member_id,
        description: "Sign-up bonus (first purchase)",
        base_cents: 0,
        rate: `${formatMoney(rates.signupBonusCents)} flat`,
        amount_cents: rates.signupBonusCents,
        available_at: availableAt,
      });
    }
  } catch (error) {
    console.error("Affiliate commission failed", error);
  }
}

// A refund cancels commissions on that purchase that haven't been paid yet.
export async function voidCommissionsForPurchase(purchaseId: string) {
  const { error } = await createAdminClient()
    .from("commissions")
    .update({ status: "void" })
    .eq("purchase_id", purchaseId)
    .eq("status", "pending");
  if (error) console.error("Voiding commissions failed", error);
}
