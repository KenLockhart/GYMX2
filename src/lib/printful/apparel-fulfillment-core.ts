import { createHash } from "node:crypto";
import type { PrintfulProductReadResult } from "./catalog-provider";
import type { PrintfulAddress, PrintfulEstimate, PrintfulOrderLine, PrintfulOrderObservation, PrintfulOrdersResult } from "./apparel-orders-client";
import { printfulExternalIdFromOrderId } from "./apparel-core";

export type ApparelFulfillmentStatus =
  | "paid_waiting_net" | "paid_waiting_address_quote" | "queued" | "create_unknown"
  | "draft_created" | "quote_pending" | "confirm_unknown" | "confirmed" | "partial";

export type ApparelFulfillmentJob = Readonly<{
  orderId: string;
  workerId: string;
  leaseGeneration: number;
  status: ApparelFulfillmentStatus;
  variantId: string;
  providerExternalId: string;
  providerOrderId: string | null;
  syncVariantId: string;
  externalProductId: string;
  externalVariantId: string;
  catalogVariantId: string;
  configurationFingerprint: string;
  designIdentityFingerprint: string;
  itemTitle: string;
  variantLabel: string;
  quantity: 1;
  guestEmail: string;
  address: unknown;
  customerPriceCents: number;
  stripeSessionId: string;
  stripeEventId: string | null;
  stripePaymentIntentId: string | null;
  stripePaidCents: number | null;
  stripeNetRevenueCents: number | null;
  stripeLivemode: boolean | null;
  quoteTotalCents: number;
  finalQuoteTotalCents: number | null;
  catalogRevision: string;
  approvalVersion: number;
  finalStripeAddressVerified: boolean;
}>;

export type ApparelFulfillmentContext = Readonly<{
  salesMode: string;
  fulfillmentEnabled: boolean;
  approvalEnabled: boolean;
  classification: string;
  approvalVersion: number;
  storeId: string;
  productId: string;
  productIgnored: boolean | null;
  variantId: string;
  syncVariantId: string;
  externalVariantId: string | null;
  catalogVariantId: string | null;
  synced: boolean;
  variantIgnored: boolean | null;
  availabilityStatus: string | null;
  configurationComplete: boolean;
  configurationFingerprint: string;
}>;

export type StripeFulfillmentFacts = Readonly<{
  verifiedPaid: boolean;
  netRevenueCents: number | null;
  refundOrDispute: boolean;
  finalStripeAddress?: Record<string, string> | null;
}>;

export type FinalApparelQuote = Readonly<{
  complete: true;
  currency: "USD";
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  additionalFeeCents: number;
  fulfillmentFeeCents: number;
  taxCents: number;
  vatCents: number;
  digitizationCents: number;
  totalCents: number;
  source: "printful-order-estimate";
  observedAt: string;
  variantId: string;
  configurationFingerprint: string;
  designIdentityFingerprint: string;
  catalogRevision: string;
  approvalVersion: number;
  addressSha256: string;
  address: Record<string, string | null>;
  createdAt: string;
  expiresAt: string;
}>;

export type FulfillmentActionKind = "status_poll" | "estimate" | "create" | "reconcile" | "confirm";
export type FulfillmentActionState = "started" | "succeeded" | "unknown" | "failed";

export type ApparelFulfillmentDependencies = Readonly<{
  getContext(job: ApparelFulfillmentJob): Promise<ApparelFulfillmentContext | null>;
  getStripeFacts(job: ApparelFulfillmentJob): Promise<StripeFulfillmentFacts>;
  recoverFinalAddress(job: ApparelFulfillmentJob, address: Record<string, string>): Promise<boolean>;
  recordCostException(job: ApparelFulfillmentJob, code: "provider_cost_facts_unverified" | "provider_cost_changed" | "provider_cost_above_cap" | "provider_cost_above_net"): Promise<boolean>;
  readProduct(productId: string): Promise<PrintfulProductReadResult>;
  estimate(recipient: PrintfulAddress, line: PrintfulOrderLine): Promise<PrintfulOrdersResult<PrintfulEstimate>>;
  createDraft(recipient: PrintfulAddress, line: PrintfulOrderLine, designIdentity: string): Promise<PrintfulOrdersResult<PrintfulOrderObservation>>;
  findOrder(externalId: string, line: PrintfulOrderLine, designIdentity: string, recipient: PrintfulAddress): Promise<PrintfulOrdersResult<PrintfulOrderObservation>>;
  confirmDraft(providerOrderId: string, externalId: string, line: PrintfulOrderLine, recipient: PrintfulAddress, designIdentity: string): Promise<PrintfulOrdersResult<PrintfulOrderObservation>>;
  recordAction(job: ApparelFulfillmentJob, key: string, kind: FulfillmentActionKind, state: FulfillmentActionState, safeCode: string | null, providerOrderId: string | null, requestSha256: string): Promise<boolean>;
  recordNet(job: ApparelFulfillmentJob, netRevenueCents: number): Promise<boolean>;
  bindFinalQuote(job: ApparelFulfillmentJob, quote: FinalApparelQuote): Promise<boolean>;
  update(job: ApparelFulfillmentJob, input: Readonly<{
    orderStatus: string;
    jobStatus: string;
    providerOrderId: string | null;
    providerStatus: string | null;
    shipments: readonly unknown[];
    safeCode: string | null;
    retryAt: string | null;
  }>): Promise<boolean>;
  defer(job: ApparelFulfillmentJob, safeCode: string, delaySeconds: number, hold: boolean): Promise<boolean>;
  now?: () => Date;
}>;

export type ApparelWorkerOutcome =
  | "updated" | "deferred" | "held" | "no_action" | "stale_lease";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonnegativeMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000_000;
}

function parseRecipient(value: unknown, email: string): PrintfulAddress | null {
  if (!isRecord(value)) return null;
  const name = value.name;
  const address1 = value.address1;
  const city = value.city;
  const state = value.stateCode;
  const country = value.countryCode;
  const zip = value.zip;
  if (typeof name !== "string" || typeof address1 !== "string" || typeof city !== "string" ||
    typeof state !== "string" || typeof country !== "string" || typeof zip !== "string" ||
    country.toUpperCase() !== "US" || !/^[A-Z]{2}$/.test(state.toUpperCase()) ||
    !/^[A-Z0-9 -]{3,20}$/.test(zip.toUpperCase()) || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return {
    name, address1, ...(typeof value.address2 === "string" && value.address2 ? { address2: value.address2 } : {}),
    city, state_code: state.toUpperCase(), country_code: "US", zip: zip.toUpperCase(),
    ...(typeof value.phone === "string" && value.phone ? { phone: value.phone } : {}), email,
  };
}

function addressForQuote(address: PrintfulAddress): Record<string, string | null> {
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

function buildFinalQuote(
  job: ApparelFulfillmentJob,
  estimate: PrintfulEstimate,
  recipient: PrintfulAddress,
  observedAt: Date,
  configurationFingerprint: string,
  designIdentityFingerprint: string,
): FinalApparelQuote {
  const address = addressForQuote(recipient);
  const addressSha256 = createHash("sha256").update(JSON.stringify(address)).digest("hex");
  return {
    complete: true,
    currency: "USD",
    subtotalCents: estimate.subtotalCents,
    discountCents: estimate.discountCents,
    shippingCents: estimate.shippingCents,
    additionalFeeCents: estimate.additionalFeeCents,
    fulfillmentFeeCents: estimate.fulfillmentFeeCents,
    taxCents: estimate.taxCents,
    vatCents: estimate.vatCents,
    digitizationCents: estimate.digitizationCents,
    totalCents: estimate.totalCents,
    source: "printful-order-estimate",
    observedAt: observedAt.toISOString(),
    variantId: job.variantId,
    configurationFingerprint,
    designIdentityFingerprint,
    catalogRevision: job.catalogRevision,
    approvalVersion: job.approvalVersion,
    addressSha256,
    address,
    createdAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + 10 * 60_000).toISOString(),
  };
}

function mapProviderStatus(status: string): { orderStatus: string; jobStatus: string } | null {
  if (status === "partial") return { orderStatus: "partial", jobStatus: "partial" };
  if (status === "fulfilled") return { orderStatus: "fulfilled", jobStatus: "fulfilled" };
  if (["pending", "inreview", "inprocess"].includes(status)) return { orderStatus: "confirmed", jobStatus: "confirmed" };
  return null;
}

function postConfirmCostException(
  job: ApparelFulfillmentJob,
  observed: PrintfulOrderObservation,
): "provider_cost_facts_unverified" | "provider_cost_changed" | "provider_cost_above_cap" | "provider_cost_above_net" | null {
  if (!observed.costFactsComplete || observed.currency !== "USD" || observed.totalCents === null ||
    job.stripeNetRevenueCents === null) {
    return "provider_cost_facts_unverified";
  }
  if (observed.totalCents > job.quoteTotalCents ||
    job.finalQuoteTotalCents !== null && observed.totalCents > job.finalQuoteTotalCents) {
    return "provider_cost_above_cap";
  }
  if (job.stripeNetRevenueCents !== null && observed.totalCents > job.stripeNetRevenueCents) {
    return "provider_cost_above_net";
  }
  if (job.finalQuoteTotalCents !== null && observed.totalCents !== job.finalQuoteTotalCents) {
    return "provider_cost_changed";
  }
  return null;
}

async function persistAcceptedCostException(
  job: ApparelFulfillmentJob,
  observation: PrintfulOrderObservation,
  dependencies: ApparelFulfillmentDependencies,
  authority?: Readonly<{ finalQuoteTotalCents?: number; stripeNetRevenueCents?: number | null }>,
): Promise<boolean> {
  const authorityJob = authority ? { ...job, ...authority } : job;
  const exception = postConfirmCostException(authorityJob, observation);
  return exception === null || dependencies.recordCostException(job, exception);
}

export async function processPrintfulApparelJob(
  job: ApparelFulfillmentJob,
  dependencies: ApparelFulfillmentDependencies,
): Promise<ApparelWorkerOutcome> {
  const now = dependencies.now ?? (() => new Date());
  const recipient = parseRecipient(job.address, job.guestEmail);
  const externalId = printfulExternalIdFromOrderId(job.orderId);
  if (!recipient || !externalId || job.providerExternalId !== externalId || job.quantity !== 1 ||
    !nonnegativeMoney(job.quoteTotalCents) || !nonnegativeMoney(job.customerPriceCents) ||
    job.stripePaidCents !== job.customerPriceCents || !job.stripeLivemode) {
    return await dependencies.defer(job, "order_snapshot_invalid", 120, true) ? "held" : "stale_lease";
  }
  const line: PrintfulOrderLine = { syncVariantId: job.syncVariantId, externalId, quantity: 1 };

  // Once a provider order may exist, reconcile or track that immutable order first.
  // Current approval/stock changes can block a new confirm, but cannot hide accepted work.
  if (job.status === "confirmed" || job.status === "partial" || job.status === "create_unknown" || job.status === "confirm_unknown") {
    const actionKey = `${job.status === "confirmed" || job.status === "partial" ? "status" : "reconcile"}-${job.leaseGeneration}`;
    const actionKind: FulfillmentActionKind = job.status === "confirmed" || job.status === "partial" ? "status_poll" : "reconcile";
    const requestHash = createHash("sha256").update(JSON.stringify({ externalId, step: actionKind })).digest("hex");
    if (!(await dependencies.recordAction(job, actionKey, actionKind, "started", null, job.providerOrderId, requestHash))) return "stale_lease";
    const observed = await dependencies.findOrder(externalId, line, job.designIdentityFingerprint, recipient);
    if (!observed.ok) {
      await dependencies.recordAction(job, actionKey, actionKind, observed.reason === "not_found" ? "unknown" : "failed",
        observed.reason === "not_found" ? "order_visibility_pending" : "provider_read_unavailable", job.providerOrderId, requestHash);
      return await dependencies.defer(job, "provider_order_reconciliation_pending", 180, false) ? "deferred" : "stale_lease";
    }
    await dependencies.recordAction(job, actionKey, actionKind, "succeeded", null, observed.value.id, requestHash);
    const mapped = mapProviderStatus(observed.value.status);
    if (mapped) {
      if (!(await persistAcceptedCostException(job, observed.value, dependencies))) return "stale_lease";
      const next = job.status === "partial" && mapped.orderStatus === "confirmed"
        ? { orderStatus: "partial", jobStatus: "partial" }
        : mapped;
      const saved = await dependencies.update(job, {
        ...next,
        providerOrderId: observed.value.id,
        providerStatus: observed.value.status,
        shipments: observed.value.shipments,
        safeCode: null,
        retryAt: new Date(now().getTime() + (next.orderStatus === "partial" ? 300_000 : 12 * 60 * 60_000)).toISOString(),
      });
      return saved ? "updated" : "stale_lease";
    }
    if (observed.value.status === "draft" && job.status === "create_unknown") {
      const saved = await dependencies.update(job, {
        orderStatus: "draft_created", jobStatus: "draft_created", providerOrderId: observed.value.id,
        providerStatus: "draft", shipments: observed.value.shipments, safeCode: null,
        retryAt: new Date(now().getTime() + 30_000).toISOString(),
      });
      return saved ? "updated" : "stale_lease";
    }
    if (observed.value.status === "onhold") {
      if (job.status === "confirm_unknown") {
        return await dependencies.defer(job, "confirm_outcome_unresolved", 180, false) ? "deferred" : "stale_lease";
      }
      const acceptedStatus = job.status === "confirmed" || job.status === "partial" ? job.status : "quote_pending";
      if ((job.status === "confirmed" || job.status === "partial")) {
        const costException = postConfirmCostException(job, observed.value);
        if (costException && !(await dependencies.recordCostException(job, costException))) return "stale_lease";
      }
      const saved = await dependencies.update(job, {
        orderStatus: acceptedStatus, jobStatus: acceptedStatus, providerOrderId: observed.value.id,
        providerStatus: "onhold", shipments: observed.value.shipments,
        safeCode: "provider_order_on_hold", retryAt: new Date(now().getTime() + (acceptedStatus === "partial" ? 300_000 : 12 * 60 * 60_000)).toISOString(),
      });
      return saved ? "deferred" : "stale_lease";
    }
    if (job.status === "confirm_unknown") {
      // The confirm request may already have charged vendor billing. Never retry it.
      const saved = await dependencies.update(job, {
        orderStatus: "resolution_hold", jobStatus: "resolution_hold", providerOrderId: observed.value.id,
        providerStatus: observed.value.status, shipments: observed.value.shipments,
        safeCode: "confirm_outcome_requires_review", retryAt: null,
      });
      return saved ? "held" : "stale_lease";
    }
    return await dependencies.defer(job, "provider_order_status_unresolved", 180, true) ? "held" : "stale_lease";
  }

  // Financial settlement is required before any new supplier action. Existing accepted orders
  // above continue status reconciliation even while fee/net facts or current approval change.
  const stripeFacts = await dependencies.getStripeFacts(job);
  if (stripeFacts.refundOrDispute) {
    return await dependencies.defer(job, "stripe_refund_or_dispute", 120, true) ? "held" : "stale_lease";
  }
  if (!stripeFacts.verifiedPaid) {
    return await dependencies.defer(job, "stripe_payment_not_verified", 120, true) ? "held" : "stale_lease";
  }
  if (stripeFacts.netRevenueCents === null) {
    return await dependencies.defer(job, "stripe_net_pending", 120, false) ? "deferred" : "stale_lease";
  }
  if (!nonnegativeMoney(stripeFacts.netRevenueCents) || stripeFacts.netRevenueCents < 1) {
    return await dependencies.defer(job, "stripe_net_unavailable", 120, true) ? "held" : "stale_lease";
  }
  if (job.stripePaymentIntentId && job.stripePaidCents && job.stripeNetRevenueCents !== stripeFacts.netRevenueCents) {
    if (!(await dependencies.recordNet(job, stripeFacts.netRevenueCents))) return "stale_lease";
  }

  if (job.status === "paid_waiting_net") {
    if (!(await dependencies.recordNet(job, stripeFacts.netRevenueCents))) return "stale_lease";
    return await dependencies.defer(job, "stripe_net_recorded", 15, false) ? "deferred" : "stale_lease";
  }

  if (job.status === "paid_waiting_address_quote" && !job.finalStripeAddressVerified) {
    if (stripeFacts.finalStripeAddress && job.stripeEventId && job.stripePaymentIntentId &&
      job.stripePaidCents === job.customerPriceCents) {
      const recovered = await dependencies.recoverFinalAddress(job, stripeFacts.finalStripeAddress);
      return recovered
        ? await dependencies.defer(job, "shipping_address_recovered", 15, false) ? "deferred" : "stale_lease"
        : "stale_lease";
    }
    return await dependencies.defer(job, "shipping_address_missing", 120, false) ? "deferred" : "stale_lease";
  }

  const context = await dependencies.getContext(job);
  if (!context || context.salesMode !== "printful_apparel_only" || !context.fulfillmentEnabled ||
    !context.approvalEnabled || context.classification !== "apparel" || context.approvalVersion !== job.approvalVersion ||
    context.storeId !== "19050731" || context.productId !== job.externalProductId || context.productIgnored !== false ||
    context.variantId === "" || context.syncVariantId !== job.syncVariantId || context.externalVariantId !== job.externalVariantId ||
    context.catalogVariantId !== job.catalogVariantId || !context.synced || context.variantIgnored !== false ||
    !context.configurationComplete || context.configurationFingerprint !== job.configurationFingerprint) {
    return await dependencies.defer(job, "approval_or_catalog_changed", 120, true) ? "held" : "stale_lease";
  }
  if (job.status === "paid_waiting_address_quote" || job.status === "queued" || job.status === "draft_created" ||
    job.status === "quote_pending") {
    const readKey = `catalog-${job.leaseGeneration}`;
    const readHash = createHash("sha256").update(JSON.stringify({ productId: job.externalProductId, step: "fresh-product-read" })).digest("hex");
    if (!(await dependencies.recordAction(job, readKey, "status_poll", "started", null, null, readHash))) return "stale_lease";
    const productRead = await dependencies.readProduct(job.externalProductId);
    if (productRead.status !== "complete" || productRead.storeId !== "19050731" || productRead.storeName !== "GYMX2" ||
      productRead.storeType !== "native" || productRead.product.syncProductId !== job.externalProductId) {
      await dependencies.recordAction(job, readKey, "status_poll", "failed", "provider_catalog_unavailable", null, readHash);
      return await dependencies.defer(job, "provider_catalog_unavailable", 120, false) ? "deferred" : "stale_lease";
    }
    await dependencies.recordAction(job, readKey, "status_poll", "succeeded", null, null, readHash);
    const variants = productRead.product.variants.filter((variant) => variant.syncVariantId === job.syncVariantId);
    const current = variants.length === 1 ? variants[0] : null;
    if (!current || !current.synced || current.ignored !== false || current.availabilityStatus !== "active") {
      return await dependencies.defer(job, "variant_temporarily_unavailable", 300, false) ? "deferred" : "stale_lease";
    }
    if (!current.configurationComplete || current.catalogVariantId !== job.catalogVariantId ||
      current.configurationFingerprint !== job.configurationFingerprint ||
      current.designIdentityFingerprint !== job.designIdentityFingerprint) {
      return await dependencies.defer(job, "approved_design_changed", 120, true) ? "held" : "stale_lease";
    }
    if (["paid_waiting_address_quote", "queued"].includes(job.status)) {
      const estimateKey = `estimate-${job.leaseGeneration}`;
      const estimateHash = createHash("sha256").update(JSON.stringify({ externalId, addressSha256: createHash("sha256").update(JSON.stringify(addressForQuote(recipient))).digest("hex") })).digest("hex");
      if (!(await dependencies.recordAction(job, estimateKey, "estimate", "started", null, null, estimateHash))) return "stale_lease";
      const estimated = await dependencies.estimate(recipient, line);
      if (!estimated.ok) {
        await dependencies.recordAction(job, estimateKey, "estimate", "failed", "estimate_unavailable", null, estimateHash);
        return await dependencies.defer(job, "estimate_unavailable", 120, false) ? "deferred" : "stale_lease";
      }
      await dependencies.recordAction(job, estimateKey, "estimate", "succeeded", null, null, estimateHash);
      if (estimated.value.totalCents > job.quoteTotalCents || estimated.value.totalCents > stripeFacts.netRevenueCents) {
        return await dependencies.defer(job, "vendor_cap_exceeded", 120, true) ? "held" : "stale_lease";
      }
      const quoteNow = now();
      const quote = buildFinalQuote(job, estimated.value, recipient, quoteNow, current.configurationFingerprint, current.designIdentityFingerprint!);
      if (!(await dependencies.bindFinalQuote(job, quote))) {
        return await dependencies.defer(job, "final_quote_binding_failed", 120, true) ? "held" : "stale_lease";
      }
      if (job.status === "paid_waiting_address_quote") {
        return await dependencies.defer(job, "final_address_quote_saved", 15, false) ? "deferred" : "stale_lease";
      }
    }

    if (job.status === "queued") {
      const createKey = `create-${job.leaseGeneration}`;
      const createRequestHash = createHash("sha256").update(JSON.stringify({ externalId, syncVariantId: job.syncVariantId,
        designIdentity: job.designIdentityFingerprint, addressSha256: createHash("sha256").update(JSON.stringify(addressForQuote(recipient))).digest("hex") })).digest("hex");
      if (!(await dependencies.recordAction(job, createKey, "create", "started", null, null, createRequestHash))) return "stale_lease";
      const created = await dependencies.createDraft(recipient, line, job.designIdentityFingerprint);
      if (!created.ok) {
        await dependencies.recordAction(job, createKey, "create", "unknown", "create_outcome_unknown", null, createRequestHash);
        const saved = await dependencies.update(job, {
          orderStatus: "create_unknown", jobStatus: "create_unknown", providerOrderId: null,
          providerStatus: null, shipments: [], safeCode: "create_outcome_unknown",
          retryAt: new Date(now().getTime() + 120_000).toISOString(),
        });
        return saved ? "deferred" : "stale_lease";
      }
      await dependencies.recordAction(job, createKey, "create", "succeeded", null, created.value.id, createRequestHash);
      const saved = await dependencies.update(job, {
        orderStatus: "draft_created", jobStatus: "draft_created", providerOrderId: created.value.id,
        providerStatus: created.value.status, shipments: created.value.shipments, safeCode: null,
        retryAt: new Date(now().getTime() + 15_000).toISOString(),
      });
      return saved ? "updated" : "stale_lease";
    }

    if (["draft_created", "quote_pending"].includes(job.status)) {
      const reconcileKey = `order-read-${job.leaseGeneration}`;
      const reconcileHash = createHash("sha256").update(JSON.stringify({ externalId, step: "read-before-confirm" })).digest("hex");
      if (!(await dependencies.recordAction(job, reconcileKey, "reconcile", "started", null, job.providerOrderId, reconcileHash))) return "stale_lease";
      const observed = await dependencies.findOrder(externalId, line, job.designIdentityFingerprint, recipient);
      if (!observed.ok) {
        await dependencies.recordAction(job, reconcileKey, "reconcile", "unknown", "order_visibility_pending", job.providerOrderId, reconcileHash);
        return await dependencies.defer(job, "order_visibility_pending", 120, false) ? "deferred" : "stale_lease";
      }
      await dependencies.recordAction(job, reconcileKey, "reconcile", "succeeded", null, observed.value.id, reconcileHash);
      const mapped = mapProviderStatus(observed.value.status);
      if (mapped) {
        if (!(await persistAcceptedCostException(job, observed.value, dependencies))) return "stale_lease";
        const saved = await dependencies.update(job, {
          ...mapped, providerOrderId: observed.value.id, providerStatus: observed.value.status,
          shipments: observed.value.shipments, safeCode: null, retryAt: mapped.orderStatus === "partial" ? new Date(now().getTime() + 300_000).toISOString() : null,
        });
        return saved ? "updated" : "stale_lease";
      }
      if (observed.value.status === "onhold") {
        const saved = await dependencies.update(job, {
          orderStatus: "quote_pending", jobStatus: "quote_pending", providerOrderId: observed.value.id,
          providerStatus: "onhold", shipments: observed.value.shipments,
          safeCode: "provider_order_on_hold", retryAt: new Date(now().getTime() + 300_000).toISOString(),
        });
        return saved ? "deferred" : "stale_lease";
      }
      if (observed.value.status !== "draft") {
        return await dependencies.defer(job, "provider_order_status_unresolved", 180, true) ? "held" : "stale_lease";
      }
      if (!observed.value.costFactsComplete || observed.value.totalCents === null ||
        observed.value.currency !== "USD" || observed.value.totalCents > job.quoteTotalCents ||
        observed.value.totalCents > stripeFacts.netRevenueCents) {
        const nextOrder = observed.value.costFactsComplete ? "draft_created" : "quote_pending";
        const nextJob = nextOrder;
        const updated = await dependencies.update(job, {
          orderStatus: nextOrder, jobStatus: nextJob, providerOrderId: observed.value.id,
          providerStatus: observed.value.status, shipments: observed.value.shipments,
          safeCode: "provider_cost_facts_pending", retryAt: new Date(now().getTime() + 120_000).toISOString(),
        });
        return updated ? "deferred" : "stale_lease";
      }
      const latestEstimateKey = `confirm-estimate-${job.leaseGeneration}`;
      const latestHash = createHash("sha256").update(JSON.stringify({ externalId, step: "pre-confirm-estimate" })).digest("hex");
      if (!(await dependencies.recordAction(job, latestEstimateKey, "estimate", "started", null, observed.value.id, latestHash))) return "stale_lease";
      const estimate = await dependencies.estimate(recipient, line);
      if (!estimate.ok) {
        await dependencies.recordAction(job, latestEstimateKey, "estimate", "failed", "estimate_unavailable", observed.value.id, latestHash);
        return await dependencies.defer(job, "pre_confirm_estimate_unavailable", 120, false) ? "deferred" : "stale_lease";
      }
      await dependencies.recordAction(job, latestEstimateKey, "estimate", "succeeded", null, observed.value.id, latestHash);
      if (estimate.value.totalCents > job.quoteTotalCents || estimate.value.totalCents > stripeFacts.netRevenueCents) {
        return await dependencies.defer(job, "vendor_cap_exceeded", 120, true) ? "held" : "stale_lease";
      }
      const quoteNow = now();
      const finalQuote = buildFinalQuote(job, estimate.value, recipient, quoteNow, current.configurationFingerprint, current.designIdentityFingerprint!);
      if (!(await dependencies.bindFinalQuote(job, finalQuote))) {
        return await dependencies.defer(job, "pre_confirm_quote_binding_failed", 120, true) ? "held" : "stale_lease";
      }
      const latestContext = await dependencies.getContext(job);
      if (!latestContext || latestContext.salesMode !== "printful_apparel_only" || !latestContext.fulfillmentEnabled ||
        !latestContext.approvalEnabled || latestContext.classification !== "apparel" ||
        latestContext.approvalVersion !== job.approvalVersion || latestContext.configurationFingerprint !== job.configurationFingerprint ||
        latestContext.variantIgnored !== false || latestContext.availabilityStatus !== "active") {
        return await dependencies.defer(job, "approval_or_catalog_changed", 120, true) ? "held" : "stale_lease";
      }
      const finalStripeFacts = await dependencies.getStripeFacts(job);
      if (finalStripeFacts.refundOrDispute) return await dependencies.defer(job, "stripe_refund_or_dispute", 120, true) ? "held" : "stale_lease";
      if (!finalStripeFacts.verifiedPaid || finalStripeFacts.netRevenueCents === null) {
        return await dependencies.defer(job, "stripe_settlement_not_final", 120, false) ? "deferred" : "stale_lease";
      }
      if (finalStripeFacts.netRevenueCents < observed.value.totalCents || finalStripeFacts.netRevenueCents < estimate.value.totalCents ||
        observed.value.totalCents > job.quoteTotalCents || estimate.value.totalCents > job.quoteTotalCents) {
        return await dependencies.defer(job, "final_cost_exceeds_authorized_budget", 120, true) ? "held" : "stale_lease";
      }
      const confirmKey = `confirm-${job.leaseGeneration}`;
      const confirmHash = createHash("sha256").update(JSON.stringify({ externalId, providerOrderId: observed.value.id, designIdentity: job.designIdentityFingerprint })).digest("hex");
      if (!(await dependencies.recordAction(job, confirmKey, "confirm", "started", null, observed.value.id, confirmHash))) return "stale_lease";
      const confirmed = await dependencies.confirmDraft(observed.value.id, externalId, line, recipient, job.designIdentityFingerprint);
      if (!confirmed.ok) {
        await dependencies.recordAction(job, confirmKey, "confirm", "unknown", "confirm_outcome_unknown", observed.value.id, confirmHash);
        const saved = await dependencies.update(job, {
          orderStatus: "confirm_unknown", jobStatus: "confirm_unknown", providerOrderId: observed.value.id,
          providerStatus: observed.value.status, shipments: observed.value.shipments,
          safeCode: "confirm_outcome_unknown", retryAt: new Date(now().getTime() + 120_000).toISOString(),
        });
        return saved ? "deferred" : "stale_lease";
      }
      await dependencies.recordAction(job, confirmKey, "confirm", "succeeded", null, confirmed.value.id, confirmHash);
      const finalState = mapProviderStatus(confirmed.value.status);
      if (!finalState) return await dependencies.defer(job, "confirmed_status_unresolved", 120, true) ? "held" : "stale_lease";
      if (!(await persistAcceptedCostException(job, confirmed.value, dependencies, {
        finalQuoteTotalCents: estimate.value.totalCents,
        stripeNetRevenueCents: finalStripeFacts.netRevenueCents,
      }))) return "stale_lease";
      const saved = await dependencies.update(job, {
        ...finalState, providerOrderId: confirmed.value.id, providerStatus: confirmed.value.status,
        shipments: confirmed.value.shipments, safeCode: null,
        retryAt: new Date(now().getTime() + (finalState.orderStatus === "partial" ? 300_000 : 12 * 60 * 60_000)).toISOString(),
      });
      return saved ? "updated" : "stale_lease";
    }
  }
  return "no_action";
}
