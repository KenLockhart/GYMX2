"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { refreshAffiliatePayouts } from "@/lib/affiliate-payouts";
import { loadProgramSettings } from "@/lib/affiliate-server";
import { BASE_LABELS, effectiveRates, referralLink } from "@/lib/affiliates";
import { formatMoney } from "@/lib/armory";
import { requireAdmin } from "@/lib/auth";
import { loadRecipient, sendEmail } from "@/lib/email";
import { affiliateDecisionEmail, affiliatePayoutEmail } from "@/lib/email-templates";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import type { ActionState } from "@/lib/types";
import { affiliateRatesSchema, idSchema, programSettingsSchema } from "@/lib/validation";

function done(message: string): ActionState {
  revalidatePath("/admin/affiliates");
  return { message };
}

export async function saveProgramSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = programSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { signup_bonus, min_payout, ...rest } = parsed.data;
  const { error } = await createAdminClient()
    .from("affiliate_settings")
    .update({
      ...rest,
      signup_bonus_cents: signup_bonus,
      min_payout_cents: min_payout,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) return { error: "We couldn't save the program settings. Please try again." };
  return done("Program settings saved. New commissions use them; earlier ones don't change.");
}

// Approve (with optional custom rates) or reject an application, and email the applicant.
export async function decideApplication(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const approve = formData.get("decision") === "approve";
  const parsed = affiliateRatesSchema.safeParse({
    user_id: formData.get("user_id"),
    sale_percent: formData.get("sale_percent") ?? "",
    signup_bonus: formData.get("signup_bonus") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data, error } = await createAdminClient()
    .from("affiliates")
    .update({
      status: approve ? "approved" : "rejected",
      decided_at: new Date().toISOString(),
      ...(approve ? { sale_percent: parsed.data.sale_percent, signup_bonus_cents: parsed.data.signup_bonus } : {}),
    })
    .eq("user_id", parsed.data.user_id)
    .eq("status", "pending")
    .select("code, sale_percent, signup_bonus_cents")
    .maybeSingle();
  if (error || !data) return { error: "We couldn't update that application. Refresh and try again." };

  after(async () => {
    try {
      const [person, settings] = await Promise.all([loadRecipient(parsed.data.user_id), loadProgramSettings()]);
      if (!person) return;
      const rates = effectiveRates(settings, data);
      await sendEmail(
        person.email,
        affiliateDecisionEmail({
          siteUrl: getSiteUrl(),
          name: person.name,
          approved: approve,
          link: referralLink(getSiteUrl(), data.code as string),
          terms: [
            `You earn ${rates.salePercent}% of ${BASE_LABELS[settings.sale_base]} on purchases by people you refer, for ${settings.attribution_months} months.`,
            `Plus ${formatMoney(rates.signupBonusCents)} when someone you refer makes their first purchase.`,
            `Commissions can be paid ${settings.hold_days} days after each sale.`,
          ],
        }),
      );
    } catch (emailError) {
      console.error(emailError);
    }
  });
  return done(approve ? "Approved. We emailed them their link." : "Application declined. We let them know.");
}

export async function saveAffiliateRates(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = affiliateRatesSchema.safeParse({
    user_id: formData.get("user_id"),
    sale_percent: formData.get("sale_percent") ?? "",
    signup_bonus: formData.get("signup_bonus") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { error } = await createAdminClient()
    .from("affiliates")
    .update({ sale_percent: parsed.data.sale_percent, signup_bonus_cents: parsed.data.signup_bonus })
    .eq("user_id", parsed.data.user_id);
  if (error) return { error: "We couldn't save those rates. Please try again." };
  return done("Rates saved. They apply to new commissions.");
}

export async function setAffiliatePaused(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const userId = idSchema.safeParse(formData.get("user_id"));
  if (!userId.success) return { error: "Choose an affiliate." };
  const pause = formData.get("pause") === "true";
  const { error } = await createAdminClient()
    .from("affiliates")
    .update({ status: pause ? "paused" : "approved" })
    .eq("user_id", userId.data)
    .in("status", ["approved", "paused"]);
  if (error) return { error: "We couldn't change that affiliate. Please try again." };
  return done(pause ? "Paused. Their link stops earning until you resume it." : "Resumed.");
}

// Pays an affiliate everything that's ready, through a Stripe transfer to their account.
export async function payAffiliate(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireAdmin();
  const userId = idSchema.safeParse(formData.get("user_id"));
  if (!userId.success) return { error: "Choose an affiliate." };
  if (!isStripeConfigured()) return { error: "Stripe isn't set up." };

  const db = createAdminClient();
  const [{ data: affiliate }, settings, { data: ready }] = await Promise.all([
    db.from("affiliates").select("stripe_account_id").eq("user_id", userId.data).maybeSingle(),
    loadProgramSettings(),
    db
      .from("commissions")
      .select("id, amount_cents")
      .eq("affiliate_id", userId.data)
      .eq("status", "pending")
      .lte("available_at", new Date().toISOString())
      .order("id"),
  ]);
  const rows = (ready ?? []) as { id: string; amount_cents: number }[];
  const total = rows.reduce((sum, row) => sum + row.amount_cents, 0);
  if (!affiliate?.stripe_account_id) return { error: "They haven't set up payouts yet." };
  if (total < settings.min_payout_cents) {
    return { error: `Only ${formatMoney(total)} is ready, below the ${formatMoney(settings.min_payout_cents)} minimum.` };
  }
  const enabled = await refreshAffiliatePayouts(userId.data, affiliate.stripe_account_id as string).catch(() => false);
  if (!enabled) return { error: "Their Stripe account can't receive payouts yet. Ask them to finish setup." };

  // The same set of commissions always makes the same transfer, so a double click can't pay twice.
  const key = createHash("sha256").update(rows.map((row) => row.id).join(",")).digest("hex").slice(0, 40);
  let transferId: string;
  try {
    const transfer = await getStripe().transfers.create(
      {
        amount: total,
        currency: "usd",
        destination: affiliate.stripe_account_id as string,
        description: `GYMX2 affiliate commissions (${rows.length})`,
        metadata: { affiliate_id: userId.data },
      },
      { idempotencyKey: `gymx2-affiliate-${key}` },
    );
    transferId = transfer.id;
  } catch (error) {
    console.error(error);
    const code = (error as { code?: string }).code;
    return {
      error:
        code === "balance_insufficient"
          ? "GYMX2's Stripe balance doesn't have enough available to send this yet. Try again once recent sales settle."
          : "Stripe couldn't send this payout. Please try again.",
    };
  }

  const { data: payout, error: payoutError } = await db
    .from("affiliate_payouts")
    .insert({ affiliate_id: userId.data, amount_cents: total, stripe_transfer_id: transferId, paid_by: profile.id })
    .select("id")
    .single();
  if (payoutError || !payout) {
    console.error("Payout sent but not recorded", transferId, payoutError);
    return { error: `Stripe sent the money (${transferId}), but we couldn't record it. Tell support before paying again.` };
  }
  await db
    .from("commissions")
    .update({ status: "paid", payout_id: payout.id })
    .in(
      "id",
      rows.map((row) => row.id),
    );

  after(async () => {
    const person = await loadRecipient(userId.data);
    if (person) {
      await sendEmail(
        person.email,
        affiliatePayoutEmail({ siteUrl: getSiteUrl(), name: person.name, amountCents: total, count: rows.length }),
      );
    }
  });
  return done(`Paid ${formatMoney(total)}.`);
}
