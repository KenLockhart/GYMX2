"use client";

import { useActionState } from "react";
import { startGuestArmoryCheckout } from "@/app/(app)/armory/payments";
import type { CheckoutState } from "@/lib/types";
import { T, useTr } from "@/i18n/t";

export function GuestBuyPanel({
  itemId,
  sizes,
  price,
}: {
  itemId: string;
  sizes: string[];
  price: string;
}) {
  const tr = useTr();
  const [state, action, pending] = useActionState<CheckoutState, FormData>(
    startGuestArmoryCheckout,
    {},
  );

  return (
    <form action={action} className="max-w-sm space-y-3">
      <input type="hidden" name="item_id" value={itemId} />
      {sizes.length > 0 && (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium"><T>Size</T></span>
          <select name="size" required defaultValue="" className="field-input">
            <option value="" disabled><T>Choose a size</T></option>
            {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      )}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium"><T>Email for your receipt and download link</T></span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          className="field-input"
        />
      </label>
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? tr("Opening checkout...") : tr("Buy for {price}", { price })}
      </button>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <p className="text-xs text-muted">
        <T>Secure card checkout by Stripe. You can check out without creating an account.</T>
      </p>
    </form>
  );
}
