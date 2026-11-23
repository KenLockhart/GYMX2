"use client";

import { useActionState } from "react";
import { useState } from "react";
import { startGuestPrintfulApparelCheckout } from "./actions";
import { deriveApparelSelection, type ApparelOptionVariant } from "@/lib/printful/apparel-options";

export type PublicApparelVariant = ApparelOptionVariant;

export function ApparelOrderForm(props: Readonly<{
  productId: string;
  priceCents: number;
  variants: readonly PublicApparelVariant[];
  orderId: string;
  statusToken: string;
}>) {
  const [state, action, pending] = useActionState(startGuestPrintfulApparelCheckout, {});
  const [requestedColor, setRequestedColor] = useState("");
  const [requestedSize, setRequestedSize] = useState("");
  const [requestedVariantId, setRequestedVariantId] = useState("");
  const selection = deriveApparelSelection(props.variants, {
    color: requestedColor,
    size: requestedSize,
    variantId: requestedVariantId,
  });
  const exactNameCounts = new Map<string, number>();
  for (const variant of selection.variants) {
    const name = variant.name.trim();
    if (name) exactNameCounts.set(name, (exactNameCounts.get(name) ?? 0) + 1);
  }

  return (
    <form action={action} className="mt-5 grid gap-4 rounded-xl border border-border bg-surface p-4">
      <input type="hidden" name="product_id" value={props.productId} />
      <input type="hidden" name="order_id" value={props.orderId} />
      <input type="hidden" name="status_token" value={props.statusToken} />
      <input type="hidden" name="variant_id" value={selection.variant?.id ?? ""} />
      <p className="text-lg font-semibold">${(props.priceCents / 100).toFixed(2)} <span className="text-sm font-normal text-muted">· free U.S. shipping</span></p>

      {selection.mode === "facets" && selection.variant ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">Color
            <select value={selection.color} onChange={(event) => setRequestedColor(event.currentTarget.value)} required className="field-input">
              {selection.colors.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Size
            <select value={selection.size} onChange={(event) => setRequestedSize(event.currentTarget.value)} required className="field-input">
              {selection.sizes.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      ) : selection.mode === "exact" && selection.variant ? (
        <label className="grid gap-1 text-sm font-medium">Apparel option
          <select
            value={selection.variant.id}
            onChange={(event) => setRequestedVariantId(event.currentTarget.value)}
            required
            className="field-input"
          >
            {selection.variants.map((variant, index) => (
              <option key={variant.id} value={variant.id}>
                {variant.name.trim() || (selection.variants.length > 1 ? `Option ${index + 1}` : "Apparel option")}
                {selection.variants.length > 1 && (exactNameCounts.get(variant.name.trim()) ?? 0) > 1
                  ? ` (Option ${index + 1})`
                  : ""}
              </option>
            ))}
          </select>
        </label>
      ) : <p className="text-sm text-muted">No apparel options are currently available. Refresh this page later to check again.</p>}

      <label className="grid gap-1 text-sm font-medium">Email
          <input required type="email" name="email" autoComplete="email" maxLength={320} className="field-input" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Full name
        <input required name="name" autoComplete="name" maxLength={200} className="field-input" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Street address
        <input required name="address1" autoComplete="address-line1" maxLength={200} className="field-input" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Apartment, suite, etc. (optional)
        <input name="address2" autoComplete="address-line2" maxLength={200} className="field-input" />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">City
          <input required name="city" autoComplete="address-level2" maxLength={100} className="field-input" />
        </label>
        <label className="grid gap-1 text-sm font-medium">State
          <input required name="state" autoComplete="address-level1" minLength={2} maxLength={2} className="field-input uppercase" />
        </label>
        <label className="grid gap-1 text-sm font-medium">ZIP code
          <input required name="zip" autoComplete="postal-code" maxLength={20} className="field-input uppercase" />
        </label>
      </div>
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      <button type="submit" disabled={pending || !selection.variant} className="btn-primary w-full">
        {pending ? "Preparing checkout…" : `Continue to checkout`}
      </button>
      <p className="text-xs text-muted">Made to order. Allow 3–4 weeks for delivery.</p>
    </form>
  );
}
