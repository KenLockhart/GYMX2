import "server-only";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { Locale } from "@/i18n/config";
import { isPremiumCategory, MIN_PAID_PRICE_CENTS, platformFeeCents } from "@/lib/armory";
import { isPublicArmorySale } from "@/lib/armory-commerce-core";
import { findPrintfulVariantMapping, validatePrintfulMappingInput } from "@/lib/printful-mapping";
import { bindArmoryCheckoutSession } from "@/lib/armory-checkout-binding";
import { recordArmoryCheckoutPurchase, updateArmoryCheckoutStatus } from "@/lib/armory-purchases";
import { refreshPayoutAccount } from "@/lib/purchases";
import { getStripe, isStripeConfigured, isStripeTestMode, stripePublishableKey } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import { platformHasTier } from "@/lib/platform-membership-server";
import { createClient } from "@/lib/supabase/server";
import type { ArmoryItem, Profile } from "@/lib/types";

type CheckoutItem = Pick<
  ArmoryItem,
  | "id"
  | "coach_id"
  | "kind"
  | "category"
  | "title"
  | "price_cents"
  | "file_path"
  | "file_name"
  | "sizes"
  | "shipping_cents"
  | "visible_to_all"
  | "printful_sku"
  | "printful_sync_variant_id"
  | "printful_variant_mappings"
> & { updated_at: string };

const ITEM_FIELDS =
  "id, coach_id, kind, category, title, price_cents, file_path, file_name, sizes, shipping_cents, visible_to_all, printful_sku, printful_sync_variant_id, printful_variant_mappings, updated_at";
const PUBLIC_FIELDS =
  "id, coach_id, kind, category, title, price_cents, sizes, shipping_cents";

export type ArmoryCheckoutResult =
  | { error: string }
  | { url: string }
  | { clientSecret: string };

export async function createArmoryCheckout(input: {
  itemId: string;
  size: string;
  email: string;
  profile?: Pick<Profile, "id" | "role"> | null;
  embedded?: boolean;
  locale?: Locale;
}): Promise<ArmoryCheckoutResult> {
  if (!isStripeConfigured()) {
    return { error: "Payments aren't switched on yet. Please check back soon." };
  }
  const memberId = input.profile?.id ?? null;
  const email = input.email.trim().toLowerCase();
  if (!email) return { error: "Enter an email address for your receipt." };

  const supabase = await createClient();
  let item: CheckoutItem | null = null;
  let authorizedMemberRead = false;
  if (memberId) {
    const { data } = await supabase
      .from("armory_items")
      .select(ITEM_FIELDS)
      .eq("id", input.itemId)
      .maybeSingle<CheckoutItem>();
    item = data;
    authorizedMemberRead = Boolean(data);
  }

  let publicListing = false;
  if (!item) {
    const { data } = await supabase
      .from("public_armory_catalog")
      .select(PUBLIC_FIELDS)
      .eq("id", input.itemId)
      .maybeSingle<Pick<CheckoutItem, "id" | "coach_id" | "kind" | "category" | "title" | "price_cents" | "sizes" | "shipping_cents">>();
    if (data) {
      publicListing = true;
      const { data: privateSnapshot } = await createAdminClient()
        .from("armory_items")
        .select(ITEM_FIELDS)
        .eq("id", input.itemId)
        .maybeSingle<CheckoutItem>();
      item = privateSnapshot;
    }
  }

  if (!item || (item.kind !== "paid" && item.kind !== "product") || !item.price_cents || item.price_cents < MIN_PAID_PRICE_CENTS) {
    return { error: "This item can't be bought right now." };
  }
  if (!item.visible_to_all && !authorizedMemberRead) {
    return { error: "This item can't be bought right now." };
  }
  if (memberId && item.coach_id === memberId) {
    return { error: "This is your own item." };
  }
  if (publicListing && !isPublicArmorySale(item)) {
    return { error: "This item can't be bought right now." };
  }
  if (!memberId && !isPublicArmorySale(item)) {
    return { error: "This item can't be bought right now." };
  }
  if (memberId && !authorizedMemberRead && !isPublicArmorySale(item)) {
    return { error: "This item can't be bought right now." };
  }
  if (isPremiumCategory(item.category)) {
    if (!memberId || !(await platformHasTier(memberId, "premium"))) {
      return { error: "Premium membership required to buy this item." };
    }
  }

  const isProduct = item.kind === "product";
  let size: string | null = null;
  if (isProduct) {
    if (item.sizes.length > 0) {
      size = item.sizes.find((option) => option === input.size) ?? null;
      if (!size) return { error: "Choose a size." };
    } else if (input.size !== "") {
      return { error: "This item doesn't have size options." };
    }

    const mapping = validatePrintfulMappingInput({
      kind: item.kind,
      category: item.category,
      sizes: item.sizes.join(", "),
      printful_sku: item.printful_sku ?? "",
      printful_sync_variant_id: item.printful_sync_variant_id === null
        ? ""
        : String(item.printful_sync_variant_id),
      printful_variant_mappings: JSON.stringify(item.printful_variant_mappings ?? []),
    });
    if (!mapping.success) {
      return { error: "This item's product variant mapping needs attention." };
    }
    if (size && mapping.value.printful_variant_mappings.length > 0) {
      const selected = findPrintfulVariantMapping(mapping.value.printful_variant_mappings, size);
      if (!selected?.sku) return { error: "This item's selected size isn't mapped yet." };
    }
  } else if (input.size !== "") {
    return { error: "This item doesn't have size options." };
  }

  if (memberId && !isProduct) {
    const { data: owned } = await supabase
      .from("purchases")
      .select("id")
      .eq("item_id", item.id)
      .eq("member_id", memberId)
      .is("refunded_at", null)
      .limit(1);
    if (owned?.length) return { error: "You already own this. Use the Download button." };
  }

  const admin = createAdminClient();
  const { data: seller } = await admin
    .from("profiles")
    .select("role")
    .eq("id", item.coach_id)
    .maybeSingle();
  if (!seller) return { error: "This seller can't take orders right now." };

  const isPlatformItem = seller.role === "admin";
  let destination: string | null = null;
  if (!isPlatformItem) {
    const { data: account } = await admin
      .from("payout_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("coach_id", item.coach_id)
      .maybeSingle();
    let ready = Boolean(account?.charges_enabled);
    if (account && !ready) {
      ready = (await refreshPayoutAccount(item.coach_id, account.stripe_account_id as string)).charges_enabled;
    }
    if (!account || !ready) return { error: "This coach hasn't finished setting up payments yet." };
    destination = account.stripe_account_id as string;
  }

  const shippingCents = isProduct ? item.shipping_cents : 0;
  const coachFeeCents = platformFeeCents(item.price_cents);
  const retainedCents = isPlatformItem ? item.price_cents + shippingCents : coachFeeCents;
  const intentId = randomUUID();
  const { data: intentCreated, error: intentError } = await admin.rpc("create_armory_checkout_intent", {
    target_intent_id: intentId,
    target_item_id: item.id,
    target_member_id: memberId,
    target_guest_email: memberId ? null : email,
    target_locale: input.locale ?? "en",
    target_size: size,
    target_fee_cents: retainedCents,
    target_item_updated_at: item.updated_at,
    target_item_price_cents: item.price_cents,
    target_item_shipping_cents: shippingCents,
    target_item_title: item.title,
    target_item_kind: item.kind,
    target_item_category: item.category,
    target_file_path: item.file_path,
    target_file_name: item.file_name,
  });
  if (intentError || intentCreated !== true) {
    return { error: "This item changed while checkout was opening. Refresh and try again." };
  }

  const site = getSiteUrl();
  const embedded = Boolean(memberId && input.embedded && stripePublishableKey());
  const itemReturnUrl = `${site}/armory/${item.id}?purchase=done&session_id={CHECKOUT_SESSION_ID}`;
  const params = {
    mode: "payment" as const,
    payment_method_types: ["card"] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
    ...(embedded
      ? { ui_mode: "embedded" as const, return_url: itemReturnUrl }
      : {
          success_url: `${site}/armory/checkout-complete`,
          cancel_url: `${site}/armory/${item.id}`,
        }),
    customer_email: email,
    client_reference_id: intentId,
    line_items: [
      {
        quantity: 1 as const,
        price_data: {
          currency: "usd",
          unit_amount: item.price_cents,
          product_data: { name: size ? `${item.title} (size ${size})` : item.title },
        },
      },
    ],
    ...(isProduct
      ? {
          shipping_address_collection: { allowed_countries: ["US"] as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] },
          shipping_options: [
            {
              shipping_rate_data: {
                type: "fixed_amount" as const,
                display_name: shippingCents > 0 ? "Standard shipping" : "Free shipping",
                fixed_amount: { amount: shippingCents, currency: "usd" as const },
              },
            },
          ],
        }
      : {}),
    ...(destination
      ? {
          payment_intent_data: {
            application_fee_amount: coachFeeCents,
            transfer_data: { destination },
            metadata: { armory_checkout_intent_id: intentId, kind: "armory_purchase" },
          },
        }
      : {
          payment_intent_data: {
            metadata: { armory_checkout_intent_id: intentId, kind: "armory_purchase" },
          },
        }),
    metadata: { armory_checkout_intent_id: intentId, kind: "armory_purchase" },
  } satisfies Stripe.Checkout.SessionCreateParams;

  let session: Stripe.Checkout.Session;
  try {
    session = await getStripe().checkout.sessions.create(params, {
      idempotencyKey: `gymx2-armory-${intentId}`,
    });
  } catch {
    // Keep the intent. A provider timeout can happen after Stripe created the session; a later
    // signed webhook must still be able to bind and settle that exact intent.
    return { error: "We couldn't start checkout. Please try again." };
  }

  if (!(await bindArmoryCheckoutSession(intentId, session.id))) {
    // The database may have committed even if its response was lost. The helper verifies an
    // exact read-back; on uncertainty, do not expire a session that another request may own.
    return { error: "We couldn't finish setting up checkout. Please try again." };
  }

  const current = await getStripe()
    .checkout.sessions.retrieve(session.id, { expand: ["payment_intent"] })
    .catch(() => null);
  if (current && (
    current.metadata?.kind !== "armory_purchase" ||
    current.metadata.armory_checkout_intent_id !== intentId ||
    current.mode !== "payment"
  )) {
    return { error: "We couldn't confirm this checkout. Please try again." };
  }
  if (current?.payment_status === "paid") {
    await recordArmoryCheckoutPurchase(current);
    return { url: `${site}/armory/checkout-complete` };
  }
  if (current?.status === "expired") {
    await updateArmoryCheckoutStatus(current.id, "expired");
    return { error: "This checkout expired. Please try again." };
  }
  if (current && current.status !== "open") {
    return { error: "We couldn't confirm this checkout. Please try again." };
  }

  if (embedded) {
    const clientSecret = current?.client_secret ?? session.client_secret;
    if (clientSecret) return { clientSecret };
  }
  const checkoutUrl = current?.url ?? session.url;
  if (!checkoutUrl) return { error: "We couldn't start checkout. Please try again." };
  return { url: checkoutUrl };
}

export function guestLivePreviewCheckoutBlocked() {
  return process.env.VERCEL_ENV === "preview" && !isStripeTestMode();
}
