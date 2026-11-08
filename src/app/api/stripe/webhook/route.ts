import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { recordPurchase } from "@/lib/purchases";
import { recordMembershipInvoice, syncSubscription, syncSubscriptionById } from "@/lib/membership-server";
import { recordRefundFromCharge } from "@/lib/refunds";
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

  // Memberships: keep each subscription's status in step, and record every paid invoice.
  try {
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncSubscription(event.data.object);
      return NextResponse.json({ received: true });
    }
    if (event.type === "invoice.paid") {
      const saved = await recordMembershipInvoice(event.data.object);
      return saved ? NextResponse.json({ received: true }) : new NextResponse("Could not record invoice", { status: 500 });
    }
    if (event.type === "checkout.session.completed" && event.data.object.mode === "subscription") {
      const subscription = event.data.object.subscription;
      if (typeof subscription === "string") await syncSubscriptionById(subscription);
      return NextResponse.json({ received: true });
    }
  } catch (error) {
    console.error(error);
    return new NextResponse("Could not update membership", { status: 500 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const saved = await recordPurchase(event.data.object);
    // A failed save asks Stripe to try again later.
    if (!saved && event.data.object.payment_status === "paid") {
      return new NextResponse("Could not record purchase", { status: 500 });
    }
  }

  // A full refund made in the Stripe dashboard is recorded here too.
  if (event.type === "charge.refunded") {
    try {
      await recordRefundFromCharge(event.data.object);
    } catch (error) {
      console.error(error);
      return new NextResponse("Could not record refund", { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
