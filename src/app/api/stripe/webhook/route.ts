import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { recordPurchase } from "@/lib/purchases";
import { recordMembershipInvoice, syncSubscription, syncSubscriptionById } from "@/lib/membership-server";
import { recordRefundFromCharge } from "@/lib/refunds";
import { getStripe } from "@/lib/stripe";
import {
  releasePlatformCheckout,
  syncPlatformSubscriptionById,
} from "@/lib/platform-membership-server";
import { updateArmoryCheckoutStatus } from "@/lib/armory-purchases";
import { dispatchFormCoachStripeEvent } from "@/lib/form-coach/stripe-webhook-server";

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

  // Form Coach uses a separate Stripe namespace and must be reconciled before
  // generic membership, Armory, or Connect handlers inspect the same event.
  try {
    if (await dispatchFormCoachStripeEvent(event)) {
      return NextResponse.json({ received: true });
    }
  } catch {
    // Keep provider payloads and SDK errors out of logs and ask Stripe to retry.
    return new NextResponse("Could not reconcile billing", { status: 500 });
  }

  // Memberships: keep each subscription's status in step, and record every paid invoice.
  try {
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      if (subscription.metadata?.kind === "armory_purchase") {
        return NextResponse.json({ received: true });
      } else if (subscription.metadata?.kind === "platform_membership") {
        // Retrieve Stripe's current subscription state instead of trusting a delayed snapshot.
        // The database revision CAS prevents an earlier in-flight read from overwriting it;
        // event.created is retained only as audit data because delivery order is not guaranteed.
        await syncPlatformSubscriptionById(subscription.id, {
          id: event.id,
          created: event.created,
        });
      } else {
        await syncSubscription(subscription);
      }
      return NextResponse.json({ received: true });
    }
    if (event.type === "invoice.paid") {
      const subscriptionMetadata =
        event.data.object.parent?.subscription_details?.metadata;
      if (
        subscriptionMetadata?.kind === "platform_membership" ||
        subscriptionMetadata?.kind === "armory_purchase"
      ) {
        // Platform invoices are not coach purchases and never include Connect commissions.
        return NextResponse.json({ received: true });
      }
      const saved = await recordMembershipInvoice(event.data.object);
      return saved ? NextResponse.json({ received: true }) : new NextResponse("Could not record invoice", { status: 500 });
    }
    if (event.type === "checkout.session.completed" && event.data.object.mode === "subscription") {
      const session = event.data.object;
      const subscription = session.subscription;
      if (
        session.metadata?.kind === "platform_membership" ||
        session.metadata?.kind === "armory_purchase"
      ) {
        if (session.metadata?.kind === "armory_purchase") {
          return NextResponse.json({ received: true });
        }
        if (
          session.metadata.member_id &&
          session.metadata.checkout_request_id &&
          typeof subscription === "string"
        ) {
          await syncPlatformSubscriptionById(
            subscription,
            { id: event.id, created: event.created },
            {
              memberId: session.metadata.member_id,
              checkoutRequestId: session.metadata.checkout_request_id,
            },
          );
        }
        // A malformed platform session must never fall through into coach billing sync.
      } else if (typeof subscription === "string") {
        await syncSubscriptionById(subscription);
      }
      return NextResponse.json({ received: true });
    }
    if (
      event.type === "checkout.session.expired" &&
      event.data.object.metadata?.kind === "platform_membership"
    ) {
      await releasePlatformCheckout(event.data.object.id);
      return NextResponse.json({ received: true });
    }
    if (
      (event.type === "checkout.session.expired" ||
        event.type === "checkout.session.async_payment_failed") &&
      event.data.object.metadata?.kind === "armory_purchase"
    ) {
      const updated = await updateArmoryCheckoutStatus(
        event.data.object.id,
        event.type === "checkout.session.expired" ? "expired" : "failed",
      );
      if (!updated) return new NextResponse("Could not update checkout intent", { status: 500 });
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
