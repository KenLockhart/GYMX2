"use server";

import { redirect } from "next/navigation";
import { startPrintfulApparelCheckout } from "@/lib/printful/apparel-checkout";

export type ApparelCheckoutActionState = { error?: string };

export async function startGuestPrintfulApparelCheckout(
  _previous: ApparelCheckoutActionState,
  formData: FormData,
): Promise<ApparelCheckoutActionState> {
  const result = await startPrintfulApparelCheckout({
    productId: String(formData.get("product_id") ?? ""),
    variantId: String(formData.get("variant_id") ?? ""),
    orderId: String(formData.get("order_id") ?? ""),
    statusToken: String(formData.get("status_token") ?? ""),
    email: String(formData.get("email") ?? ""),
    address: {
      name: formData.get("name"),
      address1: formData.get("address1"),
      address2: formData.get("address2"),
      city: formData.get("city"),
      state: formData.get("state"),
      postalCode: formData.get("zip"),
      country: "US",
    },
  });
  if (!result.ok) {
    const error = result.reason === "invalid_request"
      ? "Enter a valid email and complete US shipping address."
      : result.reason === "variant_unavailable"
        ? "That apparel option is no longer available. Refresh the page and choose another option."
        : result.reason === "quote_unavailable"
          ? "We could not verify current production and shipping costs for this option. Try again later."
          : "Checkout is temporarily unavailable. Please try again later.";
    return { error };
  }
  redirect(result.url);
}
