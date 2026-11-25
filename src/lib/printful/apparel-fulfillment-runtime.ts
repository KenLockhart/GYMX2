import "server-only";
import { randomUUID } from "node:crypto";
import { createPrintfulStoreCatalogReader, getPrintfulCatalogSyncConfig } from "./catalog-provider";
import { createPrintfulOrdersClient } from "./apparel-orders-client";
import { processPrintfulApparelJob, type ApparelFulfillmentContext, type ApparelFulfillmentJob, type FinalApparelQuote } from "./apparel-fulfillment-core";
import { parseStripeShippingAddress, retrievePrintfulStripeSettlementFacts } from "./apparel-stripe-events";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured, isStripeTestMode } from "@/lib/stripe";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown, maximum = 512): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function safeInteger(value: unknown, minimum = 0): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum ? Number(value) : null;
}

export function parsePrintfulApparelClaimRow(value: unknown, workerId: string): ApparelFulfillmentJob | null {
  if (!isRecord(value)) return null;
  const orderId = nonempty(value.order_id, 36);
  const leaseGeneration = safeInteger(value.lease_generation, 1);
  const status = value.status;
  const allowed = new Set([
    "paid_waiting_net", "paid_waiting_address_quote", "queued", "create_unknown",
    "draft_created", "quote_pending", "confirm_unknown", "confirmed", "partial",
  ]);
  const quantity = safeInteger(value.quantity, 1);
  const approvalVersion = safeInteger(value.approval_version, 1);
  const catalogRevision = value.catalog_revision;
  if (!orderId || !leaseGeneration || typeof status !== "string" || !allowed.has(status) || quantity !== 1 ||
    !approvalVersion || !(typeof catalogRevision === "string" || Number.isSafeInteger(catalogRevision))) return null;
  const requiredStrings = [
    "provider_external_id", "sync_variant_id", "external_product_id", "provider_external_variant_id",
    "catalog_variant_id", "configuration_fingerprint", "design_identity_fingerprint", "item_title",
    "variant_label", "guest_email", "stripe_session_id",
  ] as const;
  const strings = Object.fromEntries(requiredStrings.map((key) => [key, nonempty(value[key], key.includes("title") || key.includes("label") ? 240 : 512)]));
  if (Object.values(strings).some((entry) => entry === null)) return null;
  const variantId = nonempty(value.variant_id, 36);
  const address = value.address;
  const customerPriceCents = safeInteger(value.customer_price_cents, 1);
  const quoteTotalCents = safeInteger(value.quote_total_cents, 1);
  const stripePaidCents = value.stripe_paid_cents === null ? null : safeInteger(value.stripe_paid_cents, 1);
  const stripeNetRevenueCents = value.stripe_net_revenue_cents === null ? null : safeInteger(value.stripe_net_revenue_cents);
  const finalQuoteTotalCents = value.final_quote_total_cents === null ? null : safeInteger(value.final_quote_total_cents, 1);
  if (!variantId || !isRecord(address) || !customerPriceCents || !quoteTotalCents ||
    typeof value.final_stripe_address_verified !== "boolean" ||
    (value.stripe_event_id !== null && nonempty(value.stripe_event_id, 255) === null) ||
    (value.stripe_paid_cents !== null && stripePaidCents === null) ||
    (value.stripe_net_revenue_cents !== null && stripeNetRevenueCents === null) ||
    (value.final_quote_total_cents !== null && finalQuoteTotalCents === null)) return null;
  return {
    orderId,
    workerId,
    leaseGeneration,
    status: status as ApparelFulfillmentJob["status"],
    variantId,
    providerExternalId: strings.provider_external_id!,
    providerOrderId: value.provider_order_id === null ? null : nonempty(value.provider_order_id, 32),
    syncVariantId: strings.sync_variant_id!,
    externalProductId: strings.external_product_id!,
    externalVariantId: strings.provider_external_variant_id!,
    catalogVariantId: strings.catalog_variant_id!,
    configurationFingerprint: strings.configuration_fingerprint!,
    designIdentityFingerprint: strings.design_identity_fingerprint!,
    itemTitle: strings.item_title!,
    variantLabel: strings.variant_label!,
    quantity: 1,
    guestEmail: strings.guest_email!,
    address,
    customerPriceCents,
    stripeSessionId: strings.stripe_session_id!,
    stripeEventId: value.stripe_event_id === null ? null : nonempty(value.stripe_event_id, 255),
    stripePaymentIntentId: value.stripe_payment_intent_id === null ? null : nonempty(value.stripe_payment_intent_id, 255),
    stripePaidCents,
    stripeNetRevenueCents,
    stripeLivemode: typeof value.stripe_livemode === "boolean" ? value.stripe_livemode : null,
    quoteTotalCents,
    finalQuoteTotalCents,
    catalogRevision: String(catalogRevision),
    approvalVersion,
    finalStripeAddressVerified: value.final_stripe_address_verified === true,
  };
}

function parseContext(value: unknown): ApparelFulfillmentContext | null {
  if (!isRecord(value) || !isRecord(value.sales) || !isRecord(value.approval) || !isRecord(value.catalog)) return null;
  const sales = value.sales;
  const approval = value.approval;
  const catalog = value.catalog;
  const strings = [
    sales.mode, approval.classification, catalog.storeId, catalog.externalProductId, catalog.variantId,
    catalog.syncVariantId, catalog.configurationFingerprint,
  ];
  if (strings.some((entry) => typeof entry !== "string")) return null;
  return {
    salesMode: sales.mode as string,
    fulfillmentEnabled: sales.fulfillmentEnabled === true,
    approvalEnabled: approval.enabled === true,
    classification: approval.classification as string,
    approvalVersion: safeInteger(approval.version, 1) ?? 0,
    storeId: catalog.storeId as string,
    productId: catalog.externalProductId as string,
    productIgnored: typeof catalog.ignored === "boolean" ? catalog.ignored : null,
    variantId: catalog.variantId as string,
    syncVariantId: catalog.syncVariantId as string,
    externalVariantId: typeof catalog.externalVariantId === "string" ? catalog.externalVariantId : null,
    catalogVariantId: typeof catalog.catalogVariantId === "string" ? catalog.catalogVariantId : null,
    synced: catalog.synced === true,
    variantIgnored: typeof catalog.ignoredVariant === "boolean" ? catalog.ignoredVariant : null,
    availabilityStatus: typeof catalog.availabilityStatus === "string" ? catalog.availabilityStatus : null,
    configurationComplete: catalog.configurationComplete === true,
    configurationFingerprint: catalog.configurationFingerprint as string,
  };
}

function getOrderConfig() {
  const catalog = getPrintfulCatalogSyncConfig();
  const token = process.env.PRINTFUL_ORDER_ACCESS_TOKEN?.trim();
  const stripeAccountId = process.env.PRINTFUL_APPAREL_STRIPE_ACCOUNT_ID?.trim();
  return {
    enabled: process.env.PRINTFUL_APPAREL_FULFILLMENT_ENABLED === "true" && catalog.enabled &&
      !!token && !/[\r\n]/.test(token) && !!stripeAccountId && isStripeConfigured() && !isStripeTestMode(),
    catalog,
    token: token && !/[\r\n]/.test(token) ? token : null,
    stripeAccountId: stripeAccountId || null,
  };
}

/** Processes at most one leased job; configuration and Stripe mode fail closed. */
export async function runPrintfulApparelFulfillmentTick() {
  const config = getOrderConfig();
  if (!config.enabled || !config.catalog.enabled || !config.token || !config.stripeAccountId) return "disabled" as const;
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve().catch(() => null);
  if (!account || account.id !== config.stripeAccountId) return "disabled" as const;
  const admin = createAdminClient();
  const workerId = randomUUID();
  const { data, error } = await admin.rpc("claim_printful_apparel_fulfillment_jobs", {
    target_worker_id: workerId,
    target_lease_seconds: 240,
  });
  if (error) throw new Error("apparel_job_claim_failed");
  if (!Array.isArray(data) || data.length === 0) return "idle" as const;
  const job = parsePrintfulApparelClaimRow(data[0], workerId);
  if (!job) throw new Error("apparel_job_shape_invalid");
  const orders = createPrintfulOrdersClient({ token: config.token, storeId: "19050731", fetcher: fetch });
  const catalog = createPrintfulStoreCatalogReader({ enabled: true, token: config.catalog.token, fetcher: fetch });
  const dependencies = {
    async getContext(currentJob: ApparelFulfillmentJob) {
      const result = await admin.rpc("get_printful_apparel_fulfillment_context", {
        target_order_id: currentJob.orderId,
        target_worker_id: currentJob.workerId,
        target_lease_generation: currentJob.leaseGeneration,
      });
      return result.error ? null : parseContext(result.data);
    },
    async getStripeFacts(currentJob: ApparelFulfillmentJob) {
      try {
        const session = await stripe.checkout.sessions.retrieve(currentJob.stripeSessionId, { expand: ["payment_intent"] });
        const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        if (session.id !== currentJob.stripeSessionId || session.mode !== "payment" || session.status !== "complete" ||
          session.payment_status !== "paid" || session.metadata?.kind !== "printful_apparel_purchase" ||
          session.metadata.printful_apparel_order_id !== currentJob.orderId || session.livemode !== true ||
          intentId !== currentJob.stripePaymentIntentId || session.amount_total !== currentJob.customerPriceCents ||
          session.currency !== "usd") return { verifiedPaid: false, netRevenueCents: null, refundOrDispute: false };
        const settlement = await retrievePrintfulStripeSettlementFacts({
          stripe,
          paymentIntentId: intentId,
          amountCents: currentJob.customerPriceCents,
          amountTaxCents: session.total_details?.amount_tax ?? null,
          currency: session.currency,
          livemode: session.livemode,
        });
        return { ...settlement, finalStripeAddress: parseStripeShippingAddress(session as unknown as Record<string, unknown>, currentJob.guestEmail) };
      } catch {
        return { verifiedPaid: false, netRevenueCents: null, refundOrDispute: false, finalStripeAddress: null };
      }
    },
    readProduct: (productId: string) => catalog.readProduct(productId),
    estimate: (recipient: Parameters<typeof orders.estimateCosts>[0], line: Parameters<typeof orders.estimateCosts>[1]) => orders.estimateCosts(recipient, line),
    createDraft: (recipient: Parameters<typeof orders.createDraft>[0], line: Parameters<typeof orders.createDraft>[1], identity: string) => orders.createDraft(recipient, line, identity),
    findOrder: (externalId: string, line: Parameters<typeof orders.findByExternalId>[1], identity: string, recipient: Parameters<typeof orders.findByExternalId>[3]) => orders.findByExternalId(externalId, line, identity, recipient),
    confirmDraft: (id: string, externalId: string, line: Parameters<typeof orders.confirmDraft>[2], recipient: Parameters<typeof orders.confirmDraft>[3], identity: string) => orders.confirmDraft(id, externalId, line, recipient, identity),
    async recordAction(currentJob: ApparelFulfillmentJob, key: string, kind: string, state: string, safeCode: string | null, providerOrderId: string | null, requestSha256: string) {
      const result = await admin.rpc("record_printful_apparel_action", {
        target_order_id: currentJob.orderId, target_worker_id: workerId, target_lease_generation: currentJob.leaseGeneration,
        target_action_key: key, target_action_kind: kind, target_action_state: state,
        target_safe_code: safeCode, target_provider_order_id: providerOrderId, target_request_sha256: requestSha256,
      });
      return result.data === true && !result.error;
    },
    async recordNet(currentJob: ApparelFulfillmentJob, netRevenueCents: number) {
      const result = await admin.rpc("record_printful_apparel_stripe_net", {
        target_order_id: currentJob.orderId, target_payment_intent_id: currentJob.stripePaymentIntentId,
        target_paid_cents: currentJob.stripePaidCents, target_net_revenue_cents: netRevenueCents,
        target_currency: "usd", target_livemode: true,
      });
      return typeof result.data === "string" && !result.error && !["payment_mismatch", "net_conflict", "invalid_net_facts"].includes(result.data);
    },
    async recoverFinalAddress(currentJob: ApparelFulfillmentJob, address: Record<string, string>) {
      if (!currentJob.stripeEventId || !currentJob.stripePaymentIntentId || !currentJob.stripePaidCents) return false;
      const result = await admin.rpc("record_printful_apparel_paid", {
        target_order_id: currentJob.orderId, target_session_id: currentJob.stripeSessionId,
        target_payment_intent_id: currentJob.stripePaymentIntentId, target_event_id: currentJob.stripeEventId,
        target_paid_cents: currentJob.stripePaidCents, target_net_revenue_cents: currentJob.stripeNetRevenueCents,
        target_currency: "usd", target_guest_email: currentJob.guestEmail,
        target_stripe_address: address, target_livemode: currentJob.stripeLivemode === true,
      });
      return typeof result.data === "string" && !result.error &&
        !["not_found", "payment_conflict", "payment_mismatch", "invalid_state"].includes(result.data);
    },
    async recordCostException(currentJob: ApparelFulfillmentJob, code: string) {
      const result = await admin.rpc("record_printful_apparel_post_confirm_cost_exception", {
        target_order_id: currentJob.orderId, target_worker_id: workerId,
        target_lease_generation: currentJob.leaseGeneration, target_safe_code: code,
      });
      return result.data === true && !result.error;
    },
    async bindFinalQuote(currentJob: ApparelFulfillmentJob, quote: FinalApparelQuote) {
      const { addressSha256 } = quote;
      const result = await admin.rpc("bind_printful_apparel_final_quote", {
        target_order_id: currentJob.orderId, target_quote: quote, target_address_sha256: addressSha256,
      });
      return result.data === true && !result.error;
    },
    async update(currentJob: ApparelFulfillmentJob, input: Readonly<{
      orderStatus: string; jobStatus: string; providerOrderId: string | null; providerStatus: string | null;
      shipments: readonly unknown[]; safeCode: string | null; retryAt: string | null;
    }>) {
      const result = await admin.rpc("update_printful_apparel_fulfillment_state", {
        target_order_id: currentJob.orderId, target_worker_id: workerId, target_lease_generation: currentJob.leaseGeneration,
        target_order_status: input.orderStatus, target_job_status: input.jobStatus,
        target_provider_order_id: input.providerOrderId, target_provider_status: input.providerStatus,
        target_provider_shipments: input.shipments, target_safe_error_code: input.safeCode,
        target_next_attempt_at: input.retryAt,
      });
      return result.data === true && !result.error;
    },
    async defer(currentJob: ApparelFulfillmentJob, safeCode: string, delaySeconds: number, hold: boolean) {
      const result = await admin.rpc("defer_printful_apparel_fulfillment_job", {
        target_order_id: currentJob.orderId, target_worker_id: workerId, target_lease_generation: currentJob.leaseGeneration,
        target_safe_error_code: safeCode, target_delay_seconds: delaySeconds, target_hold: hold,
      });
      return result.data === true && !result.error;
    },
  };
  return processPrintfulApparelJob(job, dependencies);
}
