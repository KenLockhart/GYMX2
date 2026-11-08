import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { recordPurchase } from "@/lib/purchases";
import { getStripe } from "@/lib/stripe";

// Stripe calls this after a payment. The signature check proves the message really came from Stripe.
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) return new NextResponse("Not configured", { status: 400 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return new NextResponse("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const saved = await recordPurchase(event.data.object);
    // A failed save asks Stripe to try again later.
    if (!saved && event.data.object.payment_status === "paid") {
      return new NextResponse("Could not record purchase", { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
