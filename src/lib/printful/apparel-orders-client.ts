import "server-only";
import { printfulCommonDesignIdentity } from "./design-identity";

export type PrintfulAddress = Readonly<{
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state_code: string;
  country_code: "US";
  zip: string;
  phone?: string;
  email: string;
}>;

export type PrintfulOrderLine = Readonly<{
  syncVariantId: string;
  externalId: string;
  quantity: 1;
}>;

export type PrintfulEstimate = Readonly<{
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
}>;

export type PrintfulOrderObservation = Readonly<{
  id: string;
  storeId: string;
  externalId: string | null;
  status: string;
  currency: string | null;
  totalCents: number | null;
  costFactsComplete: boolean;
  syncVariantIds: readonly string[];
  designIdentityFingerprints: readonly string[];
  externalLineIds: readonly string[];
  recipient: PrintfulAddress | null;
  shipments: readonly Readonly<{
    carrier: string;
    service: string;
    trackingNumber: string;
    trackingUrl: string | null;
    shippedAt: string | null;
  }>[];
}>;

export type PrintfulOrdersResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "unavailable" | "invalid_response" | "provider_rejected" | "not_found" };

type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

const API_ORIGIN = "https://api.printful.com";
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_CATALOG_ID = "9223372036854775807";
const EXTERNAL_ID = /^[0-9a-f]{32}$/;

function validCatalogId(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) return false;
  return value.length < MAX_CATALOG_ID.length ||
    (value.length === MAX_CATALOG_ID.length && value <= MAX_CATALOG_ID);
}

function safeProviderInteger(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && validCatalogId(value)) return value;
  return null;
}

function moneyToCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
    const scaled = value * 100;
    const cents = Math.round(scaled);
    if (!Number.isSafeInteger(cents) || cents > 100_000_000) return null;
    const magnitude = Math.abs(scaled);
    const oneUlp = magnitude === 0
      ? Number.MIN_VALUE
      : 2 ** (Math.floor(Math.log2(magnitude)) - 52);
    return Math.abs(scaled - cents) <= oneUlp ? cents : null;
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,8})(?:\.([0-9]{1,2}))?$/.test(value)) return null;
  const text = value;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseAddress(value: unknown): PrintfulAddress | null {
  if (!isRecord(value)) return null;
  const fields = ["name", "address1", "city", "state_code", "country_code", "zip", "email"] as const;
  if (fields.some((field) => typeof value[field] !== "string")) return null;
  const result: PrintfulAddress = {
    name: value.name as string,
    address1: value.address1 as string,
    ...(typeof value.address2 === "string" ? { address2: value.address2 } : {}),
    city: value.city as string,
    state_code: value.state_code as string,
    country_code: "US",
    zip: value.zip as string,
    ...(typeof value.phone === "string" ? { phone: value.phone } : {}),
    email: value.email as string,
  };
  if (value.country_code !== "US") return null;
  return result;
}

function parseEstimate(value: unknown): PrintfulEstimate | null {
  if (!isRecord(value) || value.currency !== "USD") return null;
  const subtotalCents = moneyToCents(value.subtotal);
  const discountCents = moneyToCents(value.discount);
  const shippingCents = moneyToCents(value.shipping);
  const additionalFeeCents = moneyToCents(value.additional_fee);
  const fulfillmentFeeCents = moneyToCents(value.fulfillment_fee);
  const taxCents = moneyToCents(value.tax);
  const vatCents = moneyToCents(value.vat);
  const digitizationCents = moneyToCents(value.digitization);
  const totalCents = moneyToCents(value.total);
  if ([subtotalCents, discountCents, shippingCents, additionalFeeCents, fulfillmentFeeCents,
    taxCents, vatCents, digitizationCents, totalCents].some((amount) => amount === null)) return null;
  if (totalCents === 0) return null;
  return {
    currency: "USD",
    subtotalCents: subtotalCents!,
    discountCents: discountCents!,
    shippingCents: shippingCents!,
    additionalFeeCents: additionalFeeCents!,
    fulfillmentFeeCents: fulfillmentFeeCents!,
    taxCents: taxCents!,
    vatCents: vatCents!,
    digitizationCents: digitizationCents!,
    totalCents: totalCents!,
  };
}

function parseOrderCosts(value: unknown): { currency: string; totalCents: number } | null {
  if (!isRecord(value) || typeof value.currency !== "string") return null;
  const subtotal = moneyToCents(value.subtotal);
  const discount = moneyToCents(value.discount);
  const shipping = moneyToCents(value.shipping);
  const digitization = moneyToCents(value.digitization);
  const additionalFee = moneyToCents(value.additional_fee);
  const fulfillmentFee = moneyToCents(value.fulfillment_fee);
  const retailDeliveryFee = moneyToCents(value.retail_delivery_fee);
  const tax = moneyToCents(value.tax);
  const vat = moneyToCents(value.vat);
  const total = moneyToCents(value.total);
  if ([subtotal, discount, shipping, digitization, additionalFee, fulfillmentFee, retailDeliveryFee, tax, vat, total]
    .some((amount) => amount === null) || total === 0) return null;
  return { currency: value.currency, totalCents: total! };
}

function parseOrder(value: unknown): PrintfulOrderObservation | null {
  if (!isRecord(value)) return null;
  const id = safeProviderInteger(value.id);
  const storeId = safeProviderInteger(value.store);
  if (!id || storeId !== "19050731" || typeof value.status !== "string" || value.status.length > 40) return null;
  const externalId = value.external_id === null ? null : value.external_id;
  if (externalId !== null && (typeof externalId !== "string" || !EXTERNAL_ID.test(externalId))) return null;
  if (!Array.isArray(value.items) || value.items.length !== 1) return null;
  const item = value.items[0];
  if (!isRecord(item)) return null;
  const syncVariantId = safeProviderInteger(item.sync_variant_id);
  const catalogVariantId = safeProviderInteger(item.variant_id);
  const externalLineId = item.external_id;
  const designIdentityFingerprint = printfulCommonDesignIdentity({
    syncVariantId,
    catalogVariantId,
    files: item.files,
    options: item.options,
  });
  if (!syncVariantId || !designIdentityFingerprint || typeof externalLineId !== "string" ||
    !EXTERNAL_ID.test(externalLineId) || item.quantity !== 1) return null;
  let currency: string | null = null;
  let totalCents: number | null = null;
  let costFactsComplete = false;
  if (value.costs !== undefined && value.costs !== null) {
    const parsedCosts = parseOrderCosts(value.costs);
    if (parsedCosts) {
      currency = parsedCosts.currency;
      totalCents = parsedCosts.totalCents;
      costFactsComplete = true;
    }
  }
  const recipient = value.recipient === undefined ? null : parseAddress(value.recipient);
  if (value.recipient !== undefined && recipient === null) return null;
  if (value.shipments !== undefined && (!Array.isArray(value.shipments) || value.shipments.length > 20)) return null;
  const shipments = (Array.isArray(value.shipments) ? value.shipments : []).map((rawShipment) => {
    if (!isRecord(rawShipment)) return null;
    const carrier = typeof rawShipment.carrier === "string" && rawShipment.carrier.length <= 80 ? rawShipment.carrier : "";
    const service = typeof rawShipment.service === "string" && rawShipment.service.length <= 80 ? rawShipment.service : "";
    const trackingNumber = typeof rawShipment.tracking_number === "string" && rawShipment.tracking_number.length <= 100
      ? rawShipment.tracking_number : "";
    const trackingUrl = rawShipment.tracking_url === undefined || rawShipment.tracking_url === null
      ? null
      : typeof rawShipment.tracking_url === "string" && rawShipment.tracking_url.length <= 500 &&
        /^https:\/\//i.test(rawShipment.tracking_url) ? rawShipment.tracking_url : "invalid";
    const shippedAt = rawShipment.shipped_at === undefined || rawShipment.shipped_at === null
      ? null
      : typeof rawShipment.shipped_at === "string" && rawShipment.shipped_at.length <= 64 ? rawShipment.shipped_at : "invalid";
    if (!carrier || !service || !trackingNumber || trackingUrl === "invalid" || shippedAt === "invalid") return null;
    return { carrier, service, trackingNumber, trackingUrl, shippedAt };
  });
  if (shipments.some((shipment) => shipment === null)) return null;
  return {
    id,
    storeId,
    externalId,
    status: value.status,
    currency,
    totalCents,
    costFactsComplete,
    syncVariantIds: [syncVariantId],
    designIdentityFingerprints: [designIdentityFingerprint],
    externalLineIds: [externalLineId],
    recipient,
    shipments: shipments as NonNullable<(typeof shipments)[number]>[],
  };
}

function matchesOrder(order: PrintfulOrderObservation, externalId: string, line: PrintfulOrderLine, expectedDesignIdentity: string): boolean {
  return order.externalId === externalId &&
    order.syncVariantIds.length === 1 && order.syncVariantIds[0] === line.syncVariantId &&
    order.externalLineIds.length === 1 && order.externalLineIds[0] === line.externalId &&
    order.designIdentityFingerprints.length === 1 && order.designIdentityFingerprints[0] === expectedDesignIdentity;
}

function normalizeAddressPart(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("en-US");
}

function matchesAddress(actual: PrintfulAddress | null, expected: PrintfulAddress): boolean {
  if (!actual) return false;
  return normalizeAddressPart(actual.name) === normalizeAddressPart(expected.name) &&
    normalizeAddressPart(actual.address1) === normalizeAddressPart(expected.address1) &&
    normalizeAddressPart(actual.address2) === normalizeAddressPart(expected.address2) &&
    normalizeAddressPart(actual.city) === normalizeAddressPart(expected.city) &&
    normalizeAddressPart(actual.state_code) === normalizeAddressPart(expected.state_code) &&
    actual.country_code === expected.country_code &&
    normalizeAddressPart(actual.zip) === normalizeAddressPart(expected.zip);
}

export function createPrintfulOrdersClient(input: Readonly<{
  token: string;
  storeId: string;
  fetcher: FetchLike;
}>) {
  const token = input.token.trim();
  if (!token || input.storeId !== "19050731") throw new Error("Printful apparel orders are not configured");

  async function request(path: string, method: "GET" | "POST", body?: unknown): Promise<PrintfulOrdersResult<unknown>> {
    let response: Response;
    try {
      response = await input.fetcher(new URL(path, API_ORIGIN), {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
        headers: {
          Authorization: `Bearer ${token}`,
          "X-PF-Store-Id": input.storeId,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (response.status === 404) return { ok: false, reason: "not_found" };
    if (response.status < 200 || response.status >= 300) return { ok: false, reason: "provider_rejected" };
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null && (!/^(0|[1-9][0-9]*)$/.test(contentLengthHeader) ||
      Number(contentLengthHeader) > MAX_RESPONSE_BYTES)) return { ok: false, reason: "invalid_response" };
    if (!response.body) return { ok: false, reason: "invalid_response" };
    const bodyReader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const { done, value } = await bodyReader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > MAX_RESPONSE_BYTES) {
          await bodyReader.cancel();
          return { ok: false, reason: "invalid_response" };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, reason: "invalid_response" };
    } finally {
      bodyReader.releaseLock();
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let text: string;
    let payload: unknown;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      payload = JSON.parse(text);
    } catch {
      return { ok: false, reason: "invalid_response" };
    }
    if (!isRecord(payload) || payload.code !== 200 || !Object.hasOwn(payload, "result")) {
      return { ok: false, reason: "invalid_response" };
    }
    return { ok: true, value: payload.result };
  }

  function toProviderId(value: string): number | null {
    if (!validCatalogId(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }

  function orderInput(recipient: PrintfulAddress, line: PrintfulOrderLine, includeExternalIds = true) {
    const syncVariantId = toProviderId(line.syncVariantId);
    if (!syncVariantId || line.quantity !== 1 || !EXTERNAL_ID.test(line.externalId)) return null;
    if (recipient.country_code !== "US" || !recipient.email || !recipient.name || !recipient.address1 ||
      !recipient.city || !recipient.state_code || !recipient.zip) return null;
    return {
      ...(includeExternalIds ? { external_id: line.externalId } : {}),
      shipping: "STANDARD",
      recipient,
      items: [{ sync_variant_id: syncVariantId, quantity: 1, ...(includeExternalIds ? { external_id: line.externalId } : {}) }],
    };
  }

  return {
    async estimateCosts(recipient: PrintfulAddress, line: PrintfulOrderLine): Promise<PrintfulOrdersResult<PrintfulEstimate>> {
      const body = orderInput(recipient, line, false);
      if (!body) return { ok: false, reason: "invalid_response" };
      const response = await request("/orders/estimate-costs", "POST", body);
      if (!response.ok) return response;
      if (!isRecord(response.value) || !Object.hasOwn(response.value, "costs")) return { ok: false, reason: "invalid_response" };
      const estimate = parseEstimate(response.value.costs);
      return estimate ? { ok: true, value: estimate } : { ok: false, reason: "invalid_response" };
    },

    async createDraft(recipient: PrintfulAddress, line: PrintfulOrderLine, expectedDesignIdentity: string): Promise<PrintfulOrdersResult<PrintfulOrderObservation>> {
      if (!/^[0-9a-f]{64}$/.test(expectedDesignIdentity)) return { ok: false, reason: "invalid_response" };
      const body = orderInput(recipient, line);
      if (!body) return { ok: false, reason: "invalid_response" };
      const response = await request("/orders?confirm=0&update_existing=0", "POST", body);
      if (!response.ok) return response;
      const order = parseOrder(response.value);
      return order && matchesOrder(order, line.externalId, line, expectedDesignIdentity) && matchesAddress(order.recipient, recipient)
        ? { ok: true, value: order }
        : { ok: false, reason: "invalid_response" };
    },

    async findByExternalId(
      externalId: string,
      line: PrintfulOrderLine,
      expectedDesignIdentity: string,
      expectedRecipient?: PrintfulAddress,
    ): Promise<PrintfulOrdersResult<PrintfulOrderObservation>> {
      if (!EXTERNAL_ID.test(externalId) || line.externalId !== externalId || !/^[0-9a-f]{64}$/.test(expectedDesignIdentity)) return { ok: false, reason: "invalid_response" };
      const response = await request(`/orders/@${externalId}`, "GET");
      if (!response.ok) return response;
      const order = parseOrder(response.value);
      if (!order || !matchesOrder(order, externalId, line, expectedDesignIdentity) ||
        expectedRecipient && !matchesAddress(order.recipient, expectedRecipient)) return { ok: false, reason: "invalid_response" };
      return { ok: true, value: order };
    },

    async confirmDraft(providerOrderId: string, externalId: string, line: PrintfulOrderLine, recipient: PrintfulAddress, expectedDesignIdentity: string): Promise<PrintfulOrdersResult<PrintfulOrderObservation>> {
      const id = toProviderId(providerOrderId);
      if (!id || !EXTERNAL_ID.test(externalId) || line.externalId !== externalId || !/^[0-9a-f]{64}$/.test(expectedDesignIdentity)) return { ok: false, reason: "invalid_response" };
      const response = await request(`/orders/${id}/confirm`, "POST");
      if (!response.ok) return response;
      const order = parseOrder(response.value);
      return order && matchesOrder(order, externalId, line, expectedDesignIdentity) && matchesAddress(order.recipient, recipient)
        ? { ok: true, value: order }
        : { ok: false, reason: "invalid_response" };
    },
  };
}
