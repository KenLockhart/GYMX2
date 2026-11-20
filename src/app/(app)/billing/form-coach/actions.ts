"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuthenticatedAccount } from "@/lib/auth";
import { getPlatformEntitlement } from "@/lib/platform-membership-server";
import { createFormCoachBillingPortalForPayer } from "@/lib/form-coach/billing-portal-server";
import { isFormCoachCheckoutEnabled, startFormCoachCheckoutForAccount } from "@/lib/form-coach/checkout-server";

const CheckoutInput = z.object({
  priceKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  quantity: z.number().int().min(1).max(100),
  requestId: z.string().uuid(),
}).strict();

function pageStatus(status: string): never {
  redirect(`/billing/form-coach?status=${encodeURIComponent(status)}`);
}

export async function startFormCoachCheckout(formData: FormData): Promise<never> {
  const { profile, email } = await requireAuthenticatedAccount();
  if (!isFormCoachCheckoutEnabled()) pageStatus("coming_soon");

  const quantityValue = formData.get("quantity");
  const parsed = CheckoutInput.safeParse({
    priceKey: formData.get("price_key"),
    quantity: typeof quantityValue === "string" && /^\d+$/.test(quantityValue) ? Number(quantityValue) : quantityValue,
    requestId: formData.get("request_id"),
  });
  if (!parsed.success) pageStatus("invalid");

  if (profile.role === "member") {
    const entitlement = await getPlatformEntitlement(profile.id);
    if (!entitlement.ok || !entitlement.entitlement) pageStatus("membership_required");
  }

  let result;
  try {
    result = await startFormCoachCheckoutForAccount({
      profile: { id: profile.id, role: profile.role, display_name: profile.display_name },
      email,
      ...parsed.data,
    });
  } catch {
    pageStatus("unavailable");
  }
  if (result.kind === "redirect") redirect(result.url);
  pageStatus(result.status);
}

export async function openFormCoachBillingPortal(): Promise<never> {
  const { profile } = await requireAuthenticatedAccount();
  let result;
  try {
    result = await createFormCoachBillingPortalForPayer(profile.id);
  } catch {
    pageStatus("portal_unavailable");
  }
  if (result.kind === "redirect") redirect(result.url);
  pageStatus(result.kind === "not_owned" ? "portal_unavailable" : "portal_unavailable");
}
