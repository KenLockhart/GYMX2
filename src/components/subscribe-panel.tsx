"use client";

import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { startTransition, useActionState, useState } from "react";
import { subscribeToPlan } from "@/app/(app)/plans/actions";
import { getStripeJs } from "@/components/buy-panel";
import type { CheckoutState } from "@/lib/types";

// The Subscribe button for one plan, and Stripe's checkout shown on the page once it's pressed.
export function SubscribePanel({
  planId,
  buttonLabel,
  publishableKey,
}: {
  planId: string;
  buttonLabel: string;
  publishableKey: string;
}) {
  const [state, formAction, pending] = useActionState<CheckoutState, FormData>(
    subscribeToPlan,
    {},
  );
  const [closedSecret, setClosedSecret] = useState<string | null>(null);
  const clientSecret =
    state.clientSecret && state.clientSecret !== closedSecret
      ? state.clientSecret
      : null;

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
        <button
          type="button"
          onClick={() => setClosedSecret(clientSecret)}
          className="text-link text-sm"
        >
          Cancel checkout
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <input type="hidden" name="plan_id" value={planId} />
      <button type="submit" disabled={pending} className="btn-primary w-full">
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
