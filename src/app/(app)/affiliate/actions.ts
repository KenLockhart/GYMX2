"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeCode } from "@/lib/affiliates";
import { requireAccount } from "@/lib/auth";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import type { ActionState } from "@/lib/types";
import { affiliateApplicationSchema } from "@/lib/validation";

export async function applyToAffiliateProgram(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireAccount();
  if (profile.role === "admin") return { error: "Admins run the program, so they can't join it." };

  const parsed = affiliateApplicationSchema.safeParse({
    code: normalizeCode(String(formData.get("code") ?? "")),
    application: formData.get("application") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = createAdminClient();
  const { data: existing } = await db.from("affiliates").select("status").eq("user_id", profile.id).maybeSingle();
  if (existing && existing.status !== "rejected") return { error: "You've already applied." };

  const row = { code: parsed.data.code, application: parsed.data.application, status: "pending", decided_at: null };
  const { error } = existing
    ? await db.from("affiliates").update(row).eq("user_id", profile.id)
    : await db.from("affiliates").insert({ ...row, user_id: profile.id });
  if (error) {
    return {
      error: error.code === "23505" ? "That link name is taken. Try another." : "We couldn't send your application. Please try again.",
    };
  }

  revalidatePath("/affiliate");
  return { message: "Thanks! An admin will review your application." };
}

async function approvedAffiliate(userId: string) {
  const { data } = await createAdminClient()
    .from("affiliates")
    .select("status, stripe_account_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.status === "approved" ? data : null;
}

// Connects a bank account through Stripe so commissions can be paid. A coach who already set up
// payouts for their Armory sales uses that same account.
export async function startAffiliatePayoutSetup(): Promise<ActionState> {
  const { profile, email } = await requireAccount();
  if (!isStripeConfigured()) return { error: "Payouts aren't switched on yet. Please check back soon." };
  const affiliate = await approvedAffiliate(profile.id);
  if (!affiliate) return { error: "Only approved affiliates can set up payouts." };

  const db = createAdminClient();
  const stripe = getStripe();
  let accountId = affiliate.stripe_account_id as string | null;
  let url: string;
  try {
    if (!accountId) {
      const { data: coachAccount } = await db
        .from("payout_accounts")
        .select("stripe_account_id")
        .eq("coach_id", profile.id)
        .maybeSingle();
      accountId = (coachAccount?.stripe_account_id as string | undefined) ?? null;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          country: "US",
          email,
          capabilities: { transfers: { requested: true } },
          business_profile: { product_description: "GYMX2 affiliate commissions" },
          metadata: { affiliate_id: profile.id },
        });
        accountId = account.id;
      }
      const { error } = await db.from("affiliates").update({ stripe_account_id: accountId }).eq("user_id", profile.id);
      if (error) throw error;
    }
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${getSiteUrl()}/affiliate?setup=again`,
      return_url: `${getSiteUrl()}/affiliate?setup=done`,
    });
    url = link.url;
  } catch (error) {
    console.error(error);
    return { error: "We couldn't reach Stripe. Please try again." };
  }
  redirect(url);
}

export async function openAffiliateStripe(): Promise<ActionState> {
  const { profile } = await requireAccount();
  const affiliate = await approvedAffiliate(profile.id);
  if (!affiliate?.stripe_account_id) return { error: "Set up payouts first." };
  let url: string;
  try {
    url = (await getStripe().accounts.createLoginLink(affiliate.stripe_account_id as string)).url;
  } catch (error) {
    console.error(error);
    return { error: "We couldn't open Stripe. Finish setting up payouts first, then try again." };
  }
  redirect(url);
}
