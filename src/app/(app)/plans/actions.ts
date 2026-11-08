"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccount, requireCoach } from "@/lib/auth";
import {
  startMembershipCheckout,
  syncPlanWithStripe,
  syncSubscription,
  type Plan,
} from "@/lib/membership-server";
import { TRIAL_DAYS, isJoinMode } from "@/lib/memberships";
import {
  getStripe,
  isStripeConfigured,
  stripePublishableKey,
} from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ActionState, CheckoutState } from "@/lib/types";
import { idSchema, planSchema } from "@/lib/validation";

export async function saveJoinMode(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireCoach();
  const mode = formData.get("join_mode");
  if (!isJoinMode(mode)) return { error: "Choose how members join you." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ join_mode: mode })
    .eq("id", profile.id);
  if (error) return { error: "We couldn't save that. Please try again." };
  revalidatePath("/", "layout");
  return { message: "Saved." };
}

export async function savePlan(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireCoach();
  const parsed = planSchema.safeParse({
    id: formData.get("id") ?? "",
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    price: formData.get("price") ?? "",
    trial: formData.get("trial") === "on",
    active: formData.get("active") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!isStripeConfigured())
    return { error: "Payments aren't switched on yet." };

  const { id, price, trial, ...fields } = parsed.data;
  const row = {
    ...fields,
    price_cents: price,
    trial_days: trial ? TRIAL_DAYS : 0,
    updated_at: new Date().toISOString(),
  };
  const db = createAdminClient();
  const { data: plan, error } = id
    ? await db
        .from("coach_plans")
        .update(row)
        .eq("id", id)
        .eq("coach_id", profile.id)
        .select("*")
        .maybeSingle<Plan>()
    : await db
        .from("coach_plans")
        .insert({ ...row, coach_id: profile.id })
        .select("*")
        .maybeSingle<Plan>();
  if (error || !plan)
    return { error: "We couldn't save that plan. Please try again." };

  try {
    await syncPlanWithStripe(plan, profile.display_name);
  } catch (stripeError) {
    console.error(stripeError);
    return {
      error:
        "The plan was saved, but Stripe didn't accept it. Save it again in a moment.",
    };
  }
  revalidatePath("/plans");
  revalidatePath(`/coaches/${profile.id}`);
  return {
    message: id
      ? "Plan updated. Current subscribers keep their price."
      : "Plan added.",
  };
}

// Starts a membership. Returns the secret that shows Stripe's checkout on the coach's page.
export async function subscribeToPlan(
  _: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const { profile, email } = await requireAccount();
  if (profile.role !== "member")
    return { error: "Only members can subscribe to coaches." };
  const planId = idSchema.safeParse(formData.get("plan_id"));
  if (!planId.success) return { error: "Choose a plan." };
  if (!isStripeConfigured() || !stripePublishableKey())
    return { error: "Payments aren't switched on yet." };
  try {
    return await startMembershipCheckout(
      { id: profile.id, email },
      planId.data,
    );
  } catch (error) {
    console.error(error);
    return { error: "We couldn't start checkout. Please try again." };
  }
}

// The member's own membership, checked before changing it.
async function ownMembership(memberId: string, formData: FormData) {
  const id = idSchema.safeParse(formData.get("subscription_id"));
  if (!id.success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id, stripe_customer_id, member_id")
    .eq("id", id.data)
    .maybeSingle();
  return data && data.member_id === memberId ? data : null;
}

async function setCancelAtPeriodEnd(
  formData: FormData,
  cancel: boolean,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  const membership = await ownMembership(profile.id, formData);
  if (!membership) return { error: "We couldn't find that membership." };
  try {
    const updated = await getStripe().subscriptions.update(
      membership.stripe_subscription_id as string,
      {
        cancel_at_period_end: cancel,
      },
    );
    await syncSubscription(updated);
  } catch (error) {
    console.error(error);
    return { error: "We couldn't update your membership. Please try again." };
  }
  revalidatePath("/armory/purchases");
  return {
    message: cancel
      ? "Cancelled. You keep access until the end of the period you've paid for, and won't be charged again."
      : "Your membership will keep renewing.",
  };
}

export async function cancelMembership(_: ActionState, formData: FormData) {
  return setCancelAtPeriodEnd(formData, true);
}

export async function resumeMembership(_: ActionState, formData: FormData) {
  return setCancelAtPeriodEnd(formData, false);
}

// Stripe's own page for changing the card or seeing receipts.
export async function openBillingPortal(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  const membership = await ownMembership(profile.id, formData);
  if (!membership?.stripe_customer_id)
    return { error: "We couldn't find that membership." };
  let url: string;
  try {
    url = (
      await getStripe().billingPortal.sessions.create({
        customer: membership.stripe_customer_id as string,
        return_url: `${getSiteUrl()}/armory/purchases`,
      })
    ).url;
  } catch (error) {
    console.error(error);
    return {
      error:
        "Card updates aren't available right now. Email support@gymx2.com and we'll help.",
    };
  }
  redirect(url);
}
