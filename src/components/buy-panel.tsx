"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { startTransition, useActionState, useState } from "react";
import { buyArmoryItem } from "@/app/(app)/armory/payments";
import type { CheckoutState } from "@/lib/types";

// Stripe.js is loaded once per page, the first time someone opens checkout.
let stripePromise: Promise<Stripe | null> | null = null;
export function getStripeJs(publishableKey: string) {
  stripePromise ??= loadStripe(publishableKey);
  return stripePromise;
}

// The Buy button, and Stripe's payment form shown right here on gymx2.com once it's pressed.
export function BuyPanel({
  itemId,
  sizes,
  buttonLabel,
  publishableKey,
}: {
  itemId: string;
  sizes: string[];
  buttonLabel: string;
  publishableKey: string;
}) {
  const [state, formAction, pending] = useActionState<CheckoutState, FormData>(buyArmoryItem, {});
  // Each checkout gets its own key, so closing and buying again starts fresh.
  const [closedSecret, setClosedSecret] = useState<string | null>(null);
  const clientSecret = state.clientSecret && state.clientSecret !== closedSecret ? state.clientSecret : null;

  if (clientSecret && publishableKey) {
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg bg-white">
          <EmbeddedCheckoutProvider
            key={clientSecret}
            stripe={getStripeJs(publishableKey)}
            options={{ clientSecret }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
        <button type="button" onClick={() => setClosedSecret(clientSecret)} className="text-link text-sm">
          Cancel checkout
        </button>
      </div>
    );
  }

  return (
    <form
      className="max-w-xs space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <input type="hidden" name="item_id" value={itemId} />
      {sizes.length > 0 && (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Size</span>
          <select name="size" required defaultValue="" className="field-input">
            <option value="" disabled>
              Choose a size
            </option>
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Opening checkout..." : buttonLabel}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
