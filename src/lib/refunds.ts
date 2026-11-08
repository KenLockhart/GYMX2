import "server-only";
import { after } from "next/server";
import type Stripe from "stripe";
import { loadRecipient, sendEmail } from "@/lib/email";
import { refundEmail } from "@/lib/email-templates";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";

type PurchaseForRefund = {
  id: string;
  member_id: string | null;
  seller_id: string | null;
  item_title: string;
  amount_cents: number;
  stripe_session_id: string;
  fulfillment_status: string;
  refunded_at: string | null;
};

const COLUMNS = "id, member_id, seller_id, item_title, amount_cents, stripe_session_id, fulfillment_status, refunded_at";

// Refunds an order in full through Stripe, then records it. For a coach's sale, the coach's share
// is taken back and GYMX2 returns its fee, so the buyer gets everything back.
// The caller must already have checked that this person may refund the order.
export async function refundPurchase(purchaseId: string, refundedBy: string) {
  const admin = createAdminClient();
  const { data: purchase } = await admin.from("purchases").select(COLUMNS).eq("id", purchaseId).maybeSingle<PurchaseForRefund>();
  if (!purchase) return { error: "We couldn't find that order." };
  if (purchase.refunded_at) return { error: "This order was already refunded." };
  const stripe = getStripe();
  try {
    const session = await stripe.checkout.sessions.retrieve(purchase.stripe_session_id, {
      expand: ["payment_intent"],
    });
    const intent = session.payment_intent as Stripe.PaymentIntent | null;
    if (!intent) return { error: "Stripe has no payment for this order." };
    const toCoach = Boolean(intent.transfer_data?.destination);
    await stripe.refunds.create(
      {
        payment_intent: intent.id,
        ...(toCoach ? { reverse_transfer: true, refund_application_fee: true } : {}),
        metadata: { purchase_id: purchase.id, refunded_by: refundedBy },
      },
      // The same order can't be refunded twice, even if the button is pressed twice.
      { idempotencyKey: `gymx2-refund-${purchase.id}` },
    );
  } catch (error) {
    // Already refunded in Stripe (say, from its dashboard): just record it here.
    if ((error as { code?: string }).code !== "charge_already_refunded") {
      console.error(error);
      return { error: "Stripe couldn't refund this order. Please try again, or refund it from the Stripe dashboard." };
    }
  }

  await recordRefund(purchase, refundedBy);
  return { ok: true as const };
}

// Marks an order refunded (from the button, or when Stripe reports a refund made in its dashboard)
// and emails the buyer and seller. Safe to call twice: only the first call changes anything.
export async function recordRefund(purchase: PurchaseForRefund, refundedBy: string | null) {
  const cancelled = purchase.fulfillment_status === "to_ship";
  const { data } = await createAdminClient()
    .from("purchases")
    .update({ refunded_at: new Date().toISOString(), ...(cancelled ? { fulfillment_status: "cancelled" } : {}) })
    .eq("id", purchase.id)
    .is("refunded_at", null)
    .select("id");
  if (!data?.length) return;

  after(async () => {
    try {
      const buyer = purchase.member_id ? await loadRecipient(purchase.member_id) : null;
      const common = {
        siteUrl: getSiteUrl(),
        itemTitle: purchase.item_title,
        amountCents: purchase.amount_cents,
        buyerName: buyer?.name ?? "A member",
        orderCancelled: cancelled,
      };
      if (buyer) await sendEmail(buyer.email, refundEmail({ ...common, audience: "buyer" }));
      if (purchase.seller_id && purchase.seller_id !== refundedBy) {
        const seller = await loadRecipient(purchase.seller_id);
        if (seller) await sendEmail(seller.email, refundEmail({ ...common, audience: "seller" }));
      }
    } catch (error) {
      console.error("Refund emails failed", error);
    }
  });
}

// A full refund made in the Stripe dashboard: find the order it belongs to and record it.
export async function recordRefundFromCharge(charge: Stripe.Charge) {
  if (!charge.refunded || typeof charge.payment_intent !== "string") return;
  const sessions = await getStripe().checkout.sessions.list({ payment_intent: charge.payment_intent, limit: 1 });
  const sessionId = sessions.data[0]?.id;
  if (!sessionId) return;
  const { data: purchase } = await createAdminClient()
    .from("purchases")
    .select(COLUMNS)
    .eq("stripe_session_id", sessionId)
    .maybeSingle<PurchaseForRefund>();
  if (purchase && !purchase.refunded_at) await recordRefund(purchase, null);
}
