import type Stripe from "stripe";
import {
  type ProgramBillingSeller,
  type ProgramBillingOrder,
  type ProgramCheckoutProvider,
  type ProgramCheckoutSession,
  type ProgramInvoice,
  type ProgramInvoiceLine,
  type ProgramInvoiceProvider,
  type ProgramPaymentIntent,
  type ProgramPaymentMethod,
  type ProgramStripeCustomer,
  type ProgramProviderScope,
} from "./program-billing";

function objectId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

function metadataMap(value: Stripe.Metadata | null | undefined) {
  if (!value) return null;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

function assertLivemode(object: { livemode: boolean }, scope: ProgramProviderScope) {
  if (object.livemode !== scope.livemode) throw new Error("Stripe Program object belongs to a different mode");
}

function mapInvoice(invoice: Stripe.Invoice, scope: ProgramProviderScope): ProgramInvoice {
  assertLivemode(invoice, scope);
  return {
    id: invoice.id,
    customerId: objectId(invoice.customer) ?? "",
    currency: invoice.currency ?? "",
    status: invoice.status,
    autoAdvance: invoice.auto_advance ?? null,
    collectionMethod: invoice.collection_method,
    billingReason: invoice.billing_reason ?? "",
    subscriptionId: objectId(invoice.parent?.subscription_details?.subscription),
    parentType: invoice.parent?.type ?? null,
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    amountRemaining: invoice.amount_remaining,
    amountOverpaid: invoice.amount_overpaid,
    amountShipping: invoice.amount_shipping,
    subtotal: invoice.subtotal,
    total: invoice.total,
    subtotalExcludingTax: invoice.subtotal_excluding_tax,
    totalExcludingTax: invoice.total_excluding_tax,
    startingBalance: invoice.starting_balance,
    endingBalance: invoice.ending_balance,
    discounts: invoice.discounts,
    totalDiscountAmounts: invoice.total_discount_amounts,
    defaultTaxRates: invoice.default_tax_rates,
    totalTaxes: invoice.total_taxes,
    automaticTaxEnabled: invoice.automatic_tax.enabled,
    metadata: metadataMap(invoice.metadata),
    defaultPaymentMethodId: objectId(invoice.default_payment_method),
    lines: {
      data: invoice.lines.data.map((line) => mapLine(line, objectId(invoice.customer) ?? "", scope)),
      hasMore: invoice.lines.has_more,
      totalCount: invoice.lines.data.length,
    },
    livemode: invoice.livemode,
    providerScope: scope,
  };
}

function mapLine(line: Stripe.InvoiceLineItem, customerId: string, scope: ProgramProviderScope): ProgramInvoiceLine {
  assertLivemode(line, scope);
  const itemDetails = line.parent?.invoice_item_details;
  const subscriptionDetails = line.parent?.subscription_item_details;
  const lineMetadata = metadataMap(line.metadata);
  return {
    id: line.id,
    invoiceId: line.invoice,
    amount: line.amount,
    currency: line.currency,
    quantity: line.quantity,
    invoiceItemId: itemDetails?.invoice_item ?? subscriptionDetails?.invoice_item ?? null,
    customerId,
    description: line.description,
    discountable: line.discountable,
    discounts: line.discounts,
    taxRates: line.taxes,
    taxAmounts: line.taxes,
    proration: itemDetails?.proration ?? subscriptionDetails?.proration ?? false,
    subscriptionId: objectId(line.subscription) ?? itemDetails?.subscription ?? subscriptionDetails?.subscription ?? null,
    metadata: lineMetadata,
    livemode: line.livemode,
    providerScope: scope,
  };
}

function mapPaymentIntent(intent: Stripe.PaymentIntent, scope: ProgramProviderScope): ProgramPaymentIntent {
  assertLivemode(intent, scope);
  return {
    id: intent.id,
    customerId: objectId(intent.customer),
    amount: intent.amount,
    amountReceived: intent.amount_received,
    currency: intent.currency,
    status: intent.status,
    applicationFeeAmount: intent.application_fee_amount,
    transferDestinationId: objectId(intent.transfer_data?.destination),
    paymentMethodId: objectId(intent.payment_method),
    latestChargeId: objectId(intent.latest_charge),
    metadata: metadataMap(intent.metadata),
    livemode: intent.livemode,
    providerScope: scope,
  };
}

function mapCustomer(customer: Stripe.Customer, scope: ProgramProviderScope): ProgramStripeCustomer {
  assertLivemode(customer, scope);
  return {
    id: customer.id,
    deleted: false,
    balance: customer.balance,
    invoiceCreditBalance: customer.invoice_credit_balance ?? {},
    discountId: objectId(customer.discount),
    taxExempt: customer.tax_exempt ?? null,
    metadata: metadataMap(customer.metadata),
    livemode: customer.livemode,
    providerScope: scope,
  };
}

export function mapProgramStripeCheckoutSession(session: Stripe.Checkout.Session, scope: ProgramProviderScope): ProgramCheckoutSession {
  assertLivemode(session, scope);
  return {
    id: session.id,
    url: session.url,
    customerId: objectId(session.customer),
    clientReferenceId: session.client_reference_id,
    mode: session.mode,
    status: session.status,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total,
    currency: session.currency,
    paymentIntentId: objectId(session.payment_intent),
    metadata: metadataMap(session.metadata),
    livemode: session.livemode,
    providerScope: scope,
  };
}

function createProgramProviderScopeResolver(stripe: Stripe) {
  let scopePromise: Promise<ProgramProviderScope> | null = null;
  return () => {
    scopePromise ??= Promise.all([stripe.accounts.retrieve(), stripe.balance.retrieve()]).then(([account, balance]) => {
      const scope = { platformAccountId: account.id, livemode: balance.livemode };
      if (!/^acct_[A-Za-z0-9]+$/.test(scope.platformAccountId) || typeof scope.livemode !== "boolean") {
        throw new Error("Stripe Program platform scope is incomplete or inconsistent");
      }
      return scope;
    });
    return scopePromise;
  };
}

async function retrieveFreshProgramProviderScope(stripe: Stripe): Promise<ProgramProviderScope> {
  const [account, balance] = await Promise.all([stripe.accounts.retrieve(), stripe.balance.retrieve()]);
  const scope = { platformAccountId: account.id, livemode: balance.livemode };
  if (!/^acct_[A-Za-z0-9]+$/.test(scope.platformAccountId) || typeof scope.livemode !== "boolean") {
    throw new Error("Stripe Program platform scope is incomplete or inconsistent");
  }
  return scope;
}

function providerScopesEqual(actual: ProgramProviderScope, expected: ProgramProviderScope) {
  return actual.platformAccountId === expected.platformAccountId && actual.livemode === expected.livemode;
}

function isExactStripeResourceMissing(error: unknown): error is { type: "StripeInvalidRequestError"; statusCode: 404; code: "resource_missing" } {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { type?: unknown; statusCode?: unknown; code?: unknown };
  return candidate.type === "StripeInvalidRequestError" && candidate.statusCode === 404 && candidate.code === "resource_missing";
}

export function buildProgramInvoiceCreateParams(input: {
  customerId: string;
  savedPaymentMethodId: string;
  amountCents: number;
  orderId: string;
  installmentNumber: number;
  attemptNumber: number;
  seller: ProgramBillingSeller;
  providerScope: ProgramProviderScope;
}): Stripe.InvoiceCreateParams {
  const params: Stripe.InvoiceCreateParams = {
    customer: input.customerId,
    currency: "usd",
    collection_method: "charge_automatically",
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    default_payment_method: input.savedPaymentMethodId,
    default_tax_rates: [],
    discounts: [],
    automatic_tax: { enabled: false },
    payment_settings: { payment_method_types: ["card"] },
    metadata: {
      program_order_id: input.orderId,
      program_installment_number: String(input.installmentNumber),
      program_attempt_number: String(input.attemptNumber),
      program_billing_kind: "standalone_installment",
      program_platform_account_id: input.providerScope.platformAccountId,
      program_livemode: String(input.providerScope.livemode),
    },
  };
  if (!input.seller.platformOwned) {
    params.application_fee_amount = Math.round((input.amountCents * input.seller.applicationFeeBasisPoints) / 10_000);
    params.transfer_data = { destination: input.seller.connectedAccountId };
  }
  return params;
}

/** Stripe 19.3 adapter. It performs only explicit API calls and is safe to unit test with a mock. */
export function createProgramInvoiceProvider(stripe: Stripe): ProgramInvoiceProvider {
  const getProviderScope = createProgramProviderScopeResolver(stripe);
  async function requireScope(expected?: ProgramProviderScope) {
    const actual = await getProviderScope();
    if (expected && (expected.platformAccountId !== actual.platformAccountId || expected.livemode !== actual.livemode)) {
      throw new Error("Stripe Program platform scope changed");
    }
    return actual;
  }
  return {
    getProviderScope,
    async retrieveCustomer(customerId) {
      const scope = await requireScope();
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) {
        return {
          id: customer.id,
          deleted: true,
          balance: 0,
          invoiceCreditBalance: {},
          discountId: null,
          taxExempt: null,
          metadata: null,
          livemode: scope.livemode,
          providerScope: scope,
        };
      }
      return mapCustomer(customer, scope);
    },
    async hasPendingInvoiceItems(customerId) {
      const scope = await requireScope();
      let startingAfter: string | undefined;
      for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
        const page = await stripe.invoiceItems.list({
          customer: customerId,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        if (!Array.isArray(page.data) || typeof page.has_more !== "boolean") {
          throw new Error("Pending invoice-item inventory page is incomplete");
        }
        if (page.data.some((item) => {
          assertLivemode(item, scope);
          return item.invoice === null;
        })) return true;
        if (!page.has_more) return false;
        const lastId = page.data.at(-1)?.id;
        if (!lastId || lastId === startingAfter) throw new Error("Pending invoice item pagination did not advance");
        startingAfter = lastId;
      }
      throw new Error("Pending invoice item inventory exceeded the pagination safety bound");
    },
    async listSubscriptions(input) {
      const scope = await requireScope();
      const page = await stripe.subscriptions.list({
        customer: input.customerId,
        status: "all",
        limit: 100,
        ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
      });
      for (const subscription of page.data) assertLivemode(subscription, scope);
      return { data: page.data.map((subscription) => ({ id: subscription.id })), hasMore: page.has_more };
    },
    async listSubscriptionSchedules(input) {
      const scope = await requireScope();
      const page = await stripe.subscriptionSchedules.list({
        customer: input.customerId,
        limit: 100,
        ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
      });
      for (const schedule of page.data) assertLivemode(schedule, scope);
      return { data: page.data.map((schedule) => ({ id: schedule.id })), hasMore: page.has_more };
    },
    async listPaymentIntents(input) {
      const scope = await requireScope();
      const page = await stripe.paymentIntents.list({
        customer: input.customerId,
        limit: 100,
        ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
      });
      return { data: page.data.map((intent) => mapPaymentIntent(intent, scope)), hasMore: page.has_more };
    },
    async listCheckoutSessions(input) {
      const scope = await requireScope();
      const page = await stripe.checkout.sessions.list({
        customer: input.customerId,
        limit: 100,
        ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
      });
      return { data: page.data.map((session) => mapProgramStripeCheckoutSession(session, scope)), hasMore: page.has_more };
    },
    async retrieveCheckoutSession(sessionId) {
      const scope = await requireScope();
      return mapProgramStripeCheckoutSession(await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] }), scope);
    },
    async createInvoice(input) {
      const scope = await requireScope(input.providerScope);
      const created = await stripe.invoices.create(buildProgramInvoiceCreateParams({
        customerId: input.customerId,
        savedPaymentMethodId: input.savedPaymentMethodId,
        amountCents: input.amountCents,
        orderId: input.orderId,
        installmentNumber: input.installmentNumber,
        attemptNumber: input.attemptNumber,
        seller: input.seller,
        providerScope: scope,
      }), { idempotencyKey: input.idempotencyKey });
      return mapInvoice(created, scope);
    },
    async listInvoices(input) {
      const scope = await requireScope();
      const page = await stripe.invoices.list({
        customer: input.customerId,
        limit: 100,
        ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
      });
      return { data: page.data.map((invoice) => mapInvoice(invoice, scope)), hasMore: page.has_more };
    },
    async retrieveInvoice(invoiceId) {
      const scope = await requireScope();
      return mapInvoice(await stripe.invoices.retrieve(invoiceId), scope);
    },
    async deleteDraftInvoice(input) {
      const scope = await retrieveFreshProgramProviderScope(stripe);
      if (!providerScopesEqual(scope, input.providerScope)) throw new Error("Stripe Program platform scope changed");
      const deleted = await stripe.invoices.del(input.invoiceId, { idempotencyKey: input.idempotencyKey });
      if (deleted.id !== input.invoiceId || deleted.object !== "invoice" || deleted.deleted !== true) {
        throw new Error("Stripe did not confirm deletion of the exact Program draft Invoice");
      }
      return { id: deleted.id, object: "invoice", deleted: true, providerScope: scope };
    },
    async retrieveInvoiceDeleteReadback(input) {
      const scope = await retrieveFreshProgramProviderScope(stripe);
      if (!providerScopesEqual(scope, input.providerScope)) throw new Error("Stripe Program platform scope changed");
      try {
        const invoice = await stripe.invoices.retrieve(input.invoiceId);
        return { status: "present", invoice: mapInvoice(invoice, scope), providerScope: scope } as const;
      } catch (error) {
        if (isExactStripeResourceMissing(error)) {
          return {
            status: "missing",
            invoiceId: input.invoiceId,
            httpStatus: 404,
            errorCode: "resource_missing",
            providerScope: scope,
          } as const;
        }
        throw error;
      }
    },
    async createInvoiceLine(input) {
      const scope = await requireScope(input.providerScope);
      const item = await stripe.invoiceItems.create({
        customer: input.customerId,
        invoice: input.invoiceId,
        amount: input.amountCents,
        currency: input.currency,
        description: `Program installment ${input.installmentNumber}`,
        discountable: false,
        discounts: [],
        tax_rates: [],
        metadata: {
          program_order_id: input.orderId,
          program_installment_number: String(input.installmentNumber),
          program_attempt_number: String(input.attemptNumber),
          program_billing_kind: "standalone_installment_line",
          program_platform_account_id: scope.platformAccountId,
          program_livemode: String(scope.livemode),
        },
      }, { idempotencyKey: input.idempotencyKey });
      return { id: item.id };
    },
    async listInvoiceLines(input) {
      const scope = await requireScope();
      const page = await stripe.invoices.listLineItems(input.invoiceId, {
        limit: 100,
        ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
      });
      const invoice = await stripe.invoices.retrieve(input.invoiceId);
      assertLivemode(invoice, scope);
      const customerId = objectId(invoice.customer) ?? "";
      return {
        data: page.data.map((line) => mapLine(line, customerId, scope)),
        hasMore: page.has_more,
      };
    },
    async finalizeInvoice(input) {
      const scope = await requireScope();
      const invoice = await stripe.invoices.finalizeInvoice(input.invoiceId, { auto_advance: false }, {
        idempotencyKey: input.idempotencyKey,
      });
      return mapInvoice(invoice, scope);
    },
    async listInvoicePayments(input) {
      const scope = await requireScope();
      const page = await stripe.invoicePayments.list({
        invoice: input.invoiceId,
        limit: 100,
        ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
      });
      return {
        data: page.data.map((payment) => {
          assertLivemode(payment, scope);
          return {
          id: payment.id,
          invoiceId: objectId(payment.invoice) ?? "",
          isDefault: payment.is_default,
          status: payment.status,
          amountRequested: payment.amount_requested,
          amountPaid: payment.amount_paid,
          currency: payment.currency,
          type: payment.payment.type,
          paymentIntentId: objectId(payment.payment.payment_intent),
          livemode: payment.livemode,
          providerScope: scope,
        };}),
        hasMore: page.has_more,
      };
    },
    async retrievePaymentIntent(paymentIntentId) {
      const scope = await requireScope();
      return mapPaymentIntent(await stripe.paymentIntents.retrieve(paymentIntentId), scope);
    },
    async retrievePaymentMethod(paymentMethodId) {
      const scope = await requireScope();
      const method = await stripe.paymentMethods.retrieve(paymentMethodId);
      assertLivemode(method, scope);
      return { id: method.id, customerId: objectId(method.customer), type: method.type,
        livemode: method.livemode, providerScope: scope } satisfies ProgramPaymentMethod;
    },
    async payInvoice(input) {
      const scope = await requireScope();
      const invoice = await stripe.invoices.pay(input.invoiceId, {
        payment_method: input.paymentMethodId,
        off_session: true,
      }, { idempotencyKey: input.idempotencyKey });
      return mapInvoice(invoice, scope);
    },
  };
}

export function buildProgramCheckoutParams(input: {
  order: ProgramBillingOrder;
  attemptId: string;
  attemptNumber: number;
  successUrl: string;
  cancelUrl: string;
}): Stripe.Checkout.SessionCreateParams {
  const order = input.order;
  if (!order.providerScope) throw new Error("Program Stripe platform scope is not persisted");
  const metadata = {
    program_billing_kind: "program_sale",
    program_order_id: order.orderId,
    program_installment_number: "1",
    program_checkout_attempt_id: input.attemptId,
    program_checkout_attempt_number: String(input.attemptNumber),
    program_platform_account_id: order.providerScope.platformAccountId,
    program_livemode: String(order.providerScope.livemode),
  };
  const amount = order.installmentAmountsCents[0];
  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    metadata,
  };
  if (order.installmentCount > 1) paymentIntentData.setup_future_usage = "off_session";
  if (!order.seller.platformOwned) {
    paymentIntentData.application_fee_amount = Math.round((amount * order.seller.applicationFeeBasisPoints) / 10_000);
    paymentIntentData.transfer_data = { destination: order.seller.connectedAccountId };
  }
  return {
    mode: "payment",
    customer: order.stripeCustomerId,
    client_reference_id: input.attemptId,
    payment_method_types: ["card"],
    payment_method_collection: "always",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: amount,
        product_data: { name: "Program purchase" },
      },
    }],
    metadata,
    payment_intent_data: paymentIntentData,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };
}

export function createProgramCheckoutProvider(stripe: Stripe): ProgramCheckoutProvider {
  const invoiceProvider = createProgramInvoiceProvider(stripe);
  return {
    ...invoiceProvider,
    async createCustomer(input) {
      const scope = await invoiceProvider.getProviderScope();
      if (scope.platformAccountId !== input.providerScope.platformAccountId || scope.livemode !== input.providerScope.livemode) {
        throw new Error("Stripe Program platform scope changed before Customer creation");
      }
      const customer = await stripe.customers.create({
        metadata: {
          program_order_id: input.orderId,
          program_billing_purpose: "program_order",
          program_platform_account_id: scope.platformAccountId,
          program_livemode: String(scope.livemode),
        },
      }, { idempotencyKey: input.idempotencyKey });
      return mapCustomer(customer, scope);
    },
    async createCheckoutSession(input) {
      const scope = await invoiceProvider.getProviderScope();
      if (!input.order.providerScope || scope.platformAccountId !== input.order.providerScope.platformAccountId ||
          scope.livemode !== input.order.providerScope.livemode) {
        throw new Error("Stripe Program platform scope changed before Checkout creation");
      }
      const session = await stripe.checkout.sessions.create(buildProgramCheckoutParams(input), {
        idempotencyKey: input.idempotencyKey,
      });
      return mapProgramStripeCheckoutSession(session, scope);
    },
  };
}
