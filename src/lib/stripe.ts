import "server-only";
import Stripe from "stripe";

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let client: Stripe | null = null;

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY. See .env.example.");
  client ??= new Stripe(key);
  return client;
}

// True for test keys (secret or restricted), so pages can say no real money moves.
export function isStripeTestMode() {
  return /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "");
}

// The publishable key lets the browser show Stripe's checkout inside GYMX2's pages.
// Without it, buyers are sent to Stripe's own checkout page instead.
export function stripePublishableKey() {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
}
