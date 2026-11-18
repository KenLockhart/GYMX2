"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthenticatedAccount } from "@/lib/auth";
import {
  createPlatformBillingPortalSession,
  createPlatformCheckoutSession,
  PlatformMembershipError,
  resumePlatformMembership,
} from "@/lib/platform-membership-server";
import { isPlatformTier } from "@/lib/platform-memberships";
import type { ActionState } from "@/lib/types";

function messageForPlatformError(error: unknown) {
  if (!(error instanceof PlatformMembershipError)) {
    return "We couldn't update your platform membership. Please try again.";
  }
  switch (error.code) {
    case "not_configured":
    case "price_unavailable":
    case "invalid_price":
      return "Platform membership payments aren't available right now. Please try again later.";
    case "active_membership":
      return "You already have a platform membership. Change or manage it below instead of starting another checkout.";
    case "already_entitled":
      return "This account already has test access. No Stripe checkout was started.";
    case "checkout_pending":
      return "A checkout is already open. Finish or close it before choosing another plan.";
    case "subscription_unavailable":
    case "invalid_subscription":
      return "We couldn't verify your platform membership. Please refresh and try again.";
    case "account_deleting":
      return "Checkout isn't available while your account is being closed.";
    case "portal_unavailable":
      return "Stripe couldn't open billing management. Please try again later.";
    case "checkout_failed":
      return "We couldn't start checkout. Please try again later.";
  }
  return "We couldn't update your platform membership. Please try again.";
}

export async function startPlatformCheckout(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile, email } = await requireAuthenticatedAccount();
  const tier = formData.get("tier");
  if (!isPlatformTier(tier)) return { error: "Choose a platform plan." };
  if (tier === "regular" && profile.role !== "member") {
    return { error: "Regular membership is available to members. Choose Premium to unlock the Premium Armory." };
  }

  let checkoutUrl: string;
  try {
    checkoutUrl = await createPlatformCheckoutSession(
      { id: profile.id, email },
      tier,
    );
  } catch (error) {
    return { error: messageForPlatformError(error) };
  }
  redirect(checkoutUrl);
}

export async function openPlatformBillingPortal(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAuthenticatedAccount();
  const intent = formData.get("intent");
  let request: { type: "manage" } | { type: "cancel" } | { type: "change"; tier: "regular" | "premium" };
  if (intent === "manage") request = { type: "manage" };
  else if (intent === "cancel") request = { type: "cancel" };
  else if (intent === "change" && isPlatformTier(formData.get("tier"))) {
    request = { type: "change", tier: formData.get("tier") as "regular" | "premium" };
  } else {
    return { error: "Choose a billing action." };
  }

  let portalUrl: string;
  try {
    portalUrl = await createPlatformBillingPortalSession(profile.id, request, {
      allowRegularPlan: profile.role === "member",
    });
  } catch (error) {
    return { error: messageForPlatformError(error) };
  }
  redirect(portalUrl);
}

export async function resumePlatformPlan(
  _: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  void _;
  void _formData;
  const { profile } = await requireAuthenticatedAccount();
  try {
    await resumePlatformMembership(profile.id);
  } catch (error) {
    return { error: messageForPlatformError(error) };
  }
  revalidatePath("/membership");
  revalidatePath("/", "layout");
  return { message: "Your platform membership will renew again." };
}
