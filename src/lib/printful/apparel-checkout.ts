import "server-only";
import { createHash } from "node:crypto";
import { createPrintfulOrdersClient, type PrintfulAddress } from "./apparel-orders-client";
import { createOrRecoverPrintfulApparelStripeSession } from "./apparel-stripe-session";
import { resolveApparelCheckoutReadiness, normalizeApparelShippingAddress } from "./apparel-core";
import { createPrintfulStoreCatalogReader, getPrintfulCatalogSyncConfig } from "./catalog-provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured, isStripeTestMode } from "@/lib/stripe";
import { getSiteUrl } from "@/lib/supabase/env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type ApparelCheckoutInput = Readonly<{
  productId: string;
  variantId: string;
  orderId: string;
  statusToken: string;
  email: string;
  address: unknown;
}>;

export type ApparelCheckoutStartResult =
  | { ok: true; url: string }
  | { ok: false; reason: "checkout_unavailable" | "invalid_request" | "variant_unavailable" | "quote_unavailable" | "checkout_failed" };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseCatalogRevision(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && String(parsed) === value ? value : null;
}

function validEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function stripeAddress(address: Record<string, unknown>, email: string): PrintfulAddress | null {
  const name = typeof address.name === "string" ? address.name : "";
  const address1 = typeof address.address1 === "string" ? address.address1 : "";
  const city = typeof address.city === "string" ? address.city : "";
  const state = typeof address.state === "string" ? address.state.toUpperCase() : "";
  const zip = typeof address.postalCode === "string" ? address.postalCode.toUpperCase() : "";
  const address2 = typeof address.address2 === "string" ? address.address2 : "";
  if (!name || !address1 || !city || !/^[A-Z]{2}$/.test(state) || !/^[A-Z0-9 -]{3,20}$/.test(zip)) return null;
  return {
    name,
    address1,
    ...(address2 ? { address2 } : {}),
    city,
    state_code: state,
    country_code: "US",
    zip,
    email,
  };
}

function quoteAddress(address: PrintfulAddress): Record<string, string | null> {
  return {
    name: address.name,
    address1: address.address1,
    address2: address.address2 ?? "",
    city: address.city,
    stateCode: address.state_code,
    countryCode: address.country_code,
    zip: address.zip,
    phone: address.phone ?? null,
    email: address.email,
  };
}

function checkoutFlags() {
  const catalog = getPrintfulCatalogSyncConfig();
  const orderToken = process.env.PRINTFUL_ORDER_ACCESS_TOKEN?.trim();
  const expectedStripeAccount = process.env.PRINTFUL_APPAREL_STRIPE_ACCOUNT_ID?.trim();
  return {
    enabled: process.env.PRINTFUL_APPAREL_CHECKOUT_ENABLED === "true" &&
      process.env.PRINTFUL_APPAREL_FULFILLMENT_ENABLED === "true" &&
      catalog.enabled && !!orderToken && !/[\r\n]/.test(orderToken) &&
      !!expectedStripeAccount && isStripeConfigured() && !isStripeTestMode(),
    catalog,
    orderToken,
    expectedStripeAccount,
  };
}

/**
 * Creates a private quote/order record and a card-only Stripe Checkout Session.
 * It does not publish products, create a Printful order, or confirm/charge Printful.
 */
export async function startPrintfulApparelCheckout(input: ApparelCheckoutInput): Promise<ApparelCheckoutStartResult> {
  if (!UUID.test(input.productId) || !UUID.test(input.variantId) || !UUID.test(input.orderId) ||
    !TOKEN.test(input.statusToken)) return { ok: false, reason: "invalid_request" };
  const email = validEmail(input.email);
  const normalizedAddress = normalizeApparelShippingAddress(input.address);
  if (!email || !normalizedAddress) return { ok: false, reason: "invalid_request" };
  const addressObject = JSON.parse(normalizedAddress) as Record<string, unknown>;
  const recipient = stripeAddress(addressObject, email);
  if (!recipient) return { ok: false, reason: "invalid_request" };

  const flags = checkoutFlags();
  if (!flags.enabled || !flags.orderToken || !flags.expectedStripeAccount || flags.catalog.enabled !== true) {
    return { ok: false, reason: "checkout_unavailable" };
  }
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
    const account = await stripe.accounts.retrieve();
    if (account.id !== flags.expectedStripeAccount) return { ok: false, reason: "checkout_unavailable" };
  } catch {
    return { ok: false, reason: "checkout_unavailable" };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, reason: "checkout_unavailable" };
  }
  const [contextResult, publicResult] = await Promise.all([
    admin.rpc("get_printful_apparel_checkout_context", { target_product_id: input.productId, target_variant_id: input.variantId }),
    admin.rpc("list_printful_apparel_catalog"),
  ]);
  if (contextResult.error || publicResult.error || !record(contextResult.data) || !Array.isArray(publicResult.data)) {
    return { ok: false, reason: "checkout_unavailable" };
  }
  const state = contextResult.data.state;
  const revision = parseCatalogRevision(contextResult.data.revision);
  const product = contextResult.data.product;
  const approved = contextResult.data.approval;
  const variant = contextResult.data.variant;
  const draft = contextResult.data.draft;
  if (!record(state) || state.mode !== "printful_apparel_only" || state.salesEnabled !== true ||
    state.fulfillmentEnabled !== true || !state.refundPolicy || revision === null || !record(product) ||
    !record(approved) || !record(variant) || !record(draft) || product.storeId !== "19050731" ||
    product.ignored !== false || approved.classification !== "apparel" || approved.enabled !== true ||
    String(approved.productId) !== input.productId || !UUID.test(String(approved.itemId)) ||
    variant.approvedForSale !== true ||
    draft.requiredMembershipTier !== "everyone" ||
    draft.publishedAt === null || draft.curationApprovedAt === null || draft.visibleToAll !== true ||
    typeof draft.imagePath !== "string" || !Number.isSafeInteger(draft.priceCents) || draft.shippingCents !== 0 ||
    revision !== parseCatalogRevision(product.lastSeenRevision) ||
    revision !== parseCatalogRevision(variant.lastSeenRevision)) {
    return { ok: false, reason: "variant_unavailable" };
  }
  const publicProduct = publicResult.data.find((entry: unknown) => record(entry) && entry.product_id === input.productId);
  if (!record(publicProduct) || !Array.isArray(publicProduct.variants) ||
    !publicProduct.variants.some((entry: unknown) => record(entry) && entry.id === input.variantId && entry.available === true)) {
    return { ok: false, reason: "variant_unavailable" };
  }

  const checkoutGate = {
    salesEnabled: true,
    fulfillmentEnabled: true,
    autoOnlyMode: true,
    orderCredentialReady: true,
  };
  const currentListing = {
    productId: String(product.id),
    storeId: String(product.storeId),
    catalogRevision: revision,
    approvalVersion: Number(approved.approvalVersion),
    classification: String(approved.classification),
    enabled: approved.enabled === true,
    priceCents: Number(draft.priceCents),
  };
  const currentVariant = {
    id: String(variant.id),
    productId: String(variant.productId),
    storeId: String(variant.storeId),
    catalogRevision: revision,
    syncVariantId: String(variant.syncVariantId),
    color: typeof variant.color === "string" ? variant.color : null,
    size: typeof variant.size === "string" ? variant.size : null,
    synced: variant.synced === true,
    ignored: typeof variant.ignored === "boolean" ? variant.ignored : null,
    availabilityStatus: typeof variant.availabilityStatus === "string" ? variant.availabilityStatus : null,
    available: variant.available === true,
    configurationComplete: variant.configurationComplete === true,
    configurationFingerprint: String(variant.configurationFingerprint),
    productionCostMinCents: typeof variant.productionCostMinCents === "number" ? variant.productionCostMinCents : null,
    productionCostMaxCents: typeof variant.productionCostMaxCents === "number" ? variant.productionCostMaxCents : null,
    productionCostCurrency: typeof variant.productionCostCurrency === "string" ? variant.productionCostCurrency : null,
    productionCostSource: typeof variant.productionCostSource === "string" ? variant.productionCostSource : null,
    productionCostObservedAt: typeof variant.productionCostObservedAt === "string" ? variant.productionCostObservedAt : null,
    productionCostConfigurationFingerprint: typeof variant.productionCostConfigurationFingerprint === "string" ? variant.productionCostConfigurationFingerprint : null,
    catalogVariantId: typeof variant.catalogVariantId === "string" ? variant.catalogVariantId : null,
  };
  if (!currentVariant.catalogRevision || !currentVariant.configurationFingerprint || currentVariant.syncVariantId === "null" ||
    !currentVariant.productionCostConfigurationFingerprint || currentVariant.productionCostMinCents === null ||
    currentVariant.productionCostMaxCents === null || currentVariant.productionCostMinCents !== currentVariant.productionCostMaxCents) {
    return { ok: false, reason: "variant_unavailable" };
  }

  // Fresh read of the exact current native product/variant configuration. The read is not provider-atomic;
  // the catalog reader's final listing pass rejects observed drift before any order/checkout write.
  const reader = createPrintfulStoreCatalogReader({ enabled: true, token: flags.catalog.token, fetcher: fetch });
  const freshRead = await reader.readProduct(String(product.externalProductId));
  if (freshRead.status !== "complete") return { ok: false, reason: "variant_unavailable" };
  const freshProduct = freshRead.product.syncProductId === product.externalProductId ? freshRead.product : null;
  const freshVariant = freshProduct?.variants.find((entry) => entry.syncVariantId === currentVariant.syncVariantId);
  if (!freshProduct || freshProduct.ignored !== false || !freshVariant || !freshVariant.synced || freshVariant.ignored !== false ||
    freshVariant.availabilityStatus !== "active" || !freshVariant.configurationComplete ||
    freshVariant.catalogVariantId !== currentVariant.catalogVariantId ||
    freshVariant.configurationFingerprint !== currentVariant.configurationFingerprint ||
    !freshVariant.designIdentityFingerprint) return { ok: false, reason: "variant_unavailable" };

  const afterReadResult = await admin.rpc("get_printful_apparel_checkout_context", {
    target_product_id: input.productId,
    target_variant_id: input.variantId,
  });
  const afterReadContext = afterReadResult.data;
  if (afterReadResult.error || !record(afterReadContext) ||
    parseCatalogRevision(afterReadContext.revision) !== revision ||
    !record(afterReadContext.variant) || afterReadContext.variant.configurationFingerprint !== currentVariant.configurationFingerprint ||
    afterReadContext.variant.approvedForSale !== true ||
    !record(afterReadContext.approval) || afterReadContext.approval.approvalVersion !== approved.approvalVersion ||
    !record(afterReadContext.draft) || afterReadContext.draft.requiredMembershipTier !== "everyone" ||
    !record(afterReadContext.state) || afterReadContext.state.salesEnabled !== true || afterReadContext.state.fulfillmentEnabled !== true) {
    return { ok: false, reason: "variant_unavailable" };
  }

  const orderClient = createPrintfulOrdersClient({ token: flags.orderToken, storeId: "19050731", fetcher: fetch });
  const estimateStarted = Date.now();
  const estimate = await orderClient.estimateCosts(recipient, {
    syncVariantId: currentVariant.syncVariantId,
    externalId: input.orderId.replaceAll("-", "").toLowerCase(),
    quantity: 1,
  });
  const quoteObservedAtMs = Date.now();
  const quoteObservedAt = new Date(quoteObservedAtMs).toISOString();
  if (!estimate.ok || Date.now() - estimateStarted > 10 * 60 * 1000) return { ok: false, reason: "quote_unavailable" };
  if (estimate.value.totalCents > currentListing.priceCents) return { ok: false, reason: "quote_unavailable" };

  const quoteExpiresAt = new Date(quoteObservedAtMs + 45 * 60 * 1000).toISOString();
  const normalizedQuoteAddress = JSON.parse(normalizeApparelShippingAddress({
    name: recipient.name,
    address1: recipient.address1,
    address2: recipient.address2 ?? "",
    city: recipient.city,
    state: recipient.state_code,
    postalCode: recipient.zip,
    country: "US",
  })!) as Record<string, unknown>;
  const quoteAddressFull = quoteAddress(recipient);
  const addressSha256 = createHash("sha256").update(JSON.stringify(quoteAddressFull)).digest("hex");
  const quote = {
    complete: true,
    currency: estimate.value.currency,
    subtotalCents: estimate.value.subtotalCents,
    discountCents: estimate.value.discountCents,
    shippingCents: estimate.value.shippingCents,
    additionalFeeCents: estimate.value.additionalFeeCents,
    fulfillmentFeeCents: estimate.value.fulfillmentFeeCents,
    taxCents: estimate.value.taxCents,
    vatCents: estimate.value.vatCents,
    digitizationCents: estimate.value.digitizationCents,
    totalCents: estimate.value.totalCents,
    source: "printful-order-estimate",
    observedAt: quoteObservedAt,
    variantId: currentVariant.id,
    configurationFingerprint: currentVariant.configurationFingerprint,
    designIdentityFingerprint: freshVariant.designIdentityFingerprint,
    catalogRevision: currentListing.catalogRevision,
    approvalVersion: currentListing.approvalVersion,
    addressSha256,
    address: quoteAddressFull,
    createdAt: quoteObservedAt,
    expiresAt: quoteExpiresAt,
  };
  const readiness = resolveApparelCheckoutReadiness({
    gate: checkoutGate,
    listing: currentListing,
    variants: [currentVariant],
    selectedVariantId: currentVariant.id,
    address: normalizedQuoteAddress,
    quote: {
      status: "ready",
      source: "printful-order-estimate",
      observedAt: quoteObservedAt,
      currency: estimate.value.currency,
      totalCents: estimate.value.totalCents,
      costFactsComplete: true,
      variantId: currentVariant.id,
      catalogRevision: currentListing.catalogRevision,
      approvalVersion: currentListing.approvalVersion,
      configurationFingerprint: currentVariant.configurationFingerprint,
      address: normalizedQuoteAddress,
      expiresAt: quoteExpiresAt,
    },
  });
  if (!readiness.ok) return { ok: false, reason: "variant_unavailable" };

  const statusHash = createHash("sha256").update(input.statusToken).digest("hex");
  const { data: orderId, error: insertError } = await admin.rpc("create_printful_apparel_checkout_intent", {
    target_order_id: input.orderId,
    target_product_id: currentListing.productId,
    target_variant_id: currentVariant.id,
    target_catalog_revision: Number(currentListing.catalogRevision),
    target_approval_version: currentListing.approvalVersion,
    target_email: email,
    target_address: quoteAddressFull,
    target_address_sha256: addressSha256,
    target_status_token_sha256: statusHash,
    target_status_token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    target_quote: quote,
  });
  if (insertError || orderId !== input.orderId) return { ok: false, reason: "checkout_failed" };
  const sessionStateResult = await admin.rpc("get_printful_apparel_checkout_session_state", {
    target_order_id: input.orderId,
  });
  if (sessionStateResult.error || !record(sessionStateResult.data)) return { ok: false, reason: "checkout_failed" };
  const sessionState = sessionStateResult.data;
  if (typeof sessionState.status !== "string" ||
    (sessionState.sessionId !== null && typeof sessionState.sessionId !== "string") ||
    typeof sessionState.expiresAt !== "string" || typeof sessionState.email !== "string" ||
    !Number.isSafeInteger(sessionState.priceCents) || typeof sessionState.productTitle !== "string" ||
    typeof sessionState.variantLabel !== "string") return { ok: false, reason: "checkout_failed" };
  const session = await createOrRecoverPrintfulApparelStripeSession({
    stripe,
    snapshot: {
      status: sessionState.status,
      sessionId: sessionState.sessionId,
      expiresAt: sessionState.expiresAt,
      email: sessionState.email,
      priceCents: sessionState.priceCents as number,
      productTitle: sessionState.productTitle,
      variantLabel: sessionState.variantLabel,
    },
    orderId: input.orderId,
    statusToken: input.statusToken,
    siteUrl: getSiteUrl(),
    bind: async (sessionId) => {
      const result = await admin.rpc("bind_printful_apparel_checkout_session", {
        target_order_id: input.orderId,
        target_session_id: sessionId,
      });
      return !result.error && result.data === true;
    },
  });
  return session.ok ? { ok: true, url: session.url } : { ok: false, reason: "checkout_failed" };
}
