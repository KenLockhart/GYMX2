import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import {
  buildProgramCheckoutParams,
  buildProgramInvoiceCreateParams,
  createProgramInvoiceProvider,
} from "./program-billing-stripe";
import type { ProgramBillingOrder } from "./program-billing";

const providerScope = { platformAccountId: "acct_platform", livemode: false } as const;

const order: ProgramBillingOrder = {
  orderId: "00000000-0000-4000-8000-000000000001",
  buyerId: "00000000-0000-4000-8000-000000000002",
  currency: "usd",
  effectiveTotalCents: 1000,
  installmentAmountsCents: [334, 333, 333],
  installmentCount: 3,
  clearedInstallments: 0,
  promotionReservationState: "reserved",
  stripeCustomerId: "cus_program",
  providerScope,
  savedPaymentMethodId: "pm_saved",
  seller: { platformOwned: false, connectedAccountId: "acct_coach", applicationFeeBasisPoints: 1000 },
  consent: null,
  firstSettledAt: null,
  nextAnchorDate: null,
  retryDeadline: null,
  canceled: false,
  deletionPending: false,
  financialConflict: false,
  currentAttemptNumber: 1,
};

function invoice(status: "open" | "paid" = "open") {
  return {
    id: "in_program",
    customer: "cus_program",
    currency: "usd",
    status,
    auto_advance: false,
    collection_method: "charge_automatically",
    billing_reason: "manual",
    parent: null,
    amount_due: 333,
    amount_paid: status === "paid" ? 333 : 0,
    amount_remaining: status === "paid" ? 0 : 333,
    amount_overpaid: 0,
    amount_shipping: 0,
    subtotal: 333,
    total: 333,
    subtotal_excluding_tax: 333,
    total_excluding_tax: 333,
    starting_balance: 0,
    ending_balance: 0,
    discounts: [],
    total_discount_amounts: [],
    default_tax_rates: [],
    total_taxes: [],
    automatic_tax: { enabled: false },
    metadata: { program_order_id: order.orderId, program_installment_number: "2", program_attempt_number: "1", program_billing_kind: "standalone_installment" },
    default_payment_method: "pm_saved",
    lines: { data: [], has_more: false, total_count: 0, url: "" },
    livemode: false,
  } as unknown as Stripe.Invoice;
}

function stripeScopeMock() {
  return {
    accounts: { retrieve: vi.fn(async () => ({ id: providerScope.platformAccountId })) },
    balance: { retrieve: vi.fn(async () => ({ livemode: providerScope.livemode })) },
  };
}

describe("Stripe invoice adapter", () => {
  it("normalizes Stripe Customer wire fields to the Program billing DTO", async () => {
    const retrieve = vi.fn(async () => ({
      id: order.stripeCustomerId,
      livemode: false,
      balance: 0,
      invoice_credit_balance: { usd: 0 },
      discount: null,
      tax_exempt: "none",
      metadata: { program_order_id: order.orderId, program_billing_purpose: "program_order" },
    } as unknown as Stripe.Customer));
    const provider = createProgramInvoiceProvider({
      ...stripeScopeMock(),
      customers: { retrieve },
    } as unknown as Stripe);

    const customer = await provider.retrieveCustomer(order.stripeCustomerId);

    expect(customer).toMatchObject({
      id: order.stripeCustomerId,
      deleted: false,
      balance: 0,
      invoiceCreditBalance: { usd: 0 },
      discountId: null,
      taxExempt: "none",
    });
    expect(customer).not.toHaveProperty("invoice_credit_balance");
    expect(customer).not.toHaveProperty("discount");
    expect(customer).not.toHaveProperty("tax_exempt");
  });

  it("creates a manual-advance invoice that excludes the pending-item pool", () => {
    const params = buildProgramInvoiceCreateParams({
      customerId: order.stripeCustomerId,
      savedPaymentMethodId: order.savedPaymentMethodId!,
      amountCents: 333,
      orderId: order.orderId,
      installmentNumber: 2,
      attemptNumber: 1,
      seller: order.seller,
      providerScope,
    });
    expect(params).toMatchObject({
      customer: "cus_program",
      auto_advance: false,
      pending_invoice_items_behavior: "exclude",
      collection_method: "charge_automatically",
      default_payment_method: "pm_saved",
      default_tax_rates: [],
      discounts: [],
      automatic_tax: { enabled: false },
      payment_settings: { payment_method_types: ["card"] },
      application_fee_amount: 33,
      transfer_data: { destination: "acct_coach" },
    });
  });

  it("uses one card payment Session and saves the card off session only for installments", () => {
    const params = buildProgramCheckoutParams({
      order,
      attemptId: "00000000-0000-4000-8000-000000000003",
      attemptNumber: 1,
      successUrl: "https://example.test/paid",
      cancelUrl: "https://example.test/cancel",
    });
    expect(params).toMatchObject({
      mode: "payment",
      customer: "cus_program",
      payment_method_types: ["card"],
      payment_method_collection: "always",
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 334 } }],
      payment_intent_data: {
        setup_future_usage: "off_session",
        application_fee_amount: 33,
        transfer_data: { destination: "acct_coach" },
      },
    });
    expect("subscription_data" in params).toBe(false);
  });

  it("pins invoice-item creation, finalization and payment to the exact invoice", async () => {
    const create = vi.fn(async () => ({ id: "ii_program" }));
    const finalizeInvoice = vi.fn(async () => invoice());
    const pay = vi.fn(async () => invoice("paid"));
    const provider = createProgramInvoiceProvider({
      ...stripeScopeMock(),
      invoiceItems: { create },
      invoices: { finalizeInvoice, pay },
    } as unknown as Stripe);

    await provider.createInvoiceLine({
      invoiceId: "in_program",
      customerId: "cus_program",
      amountCents: 333,
      currency: "usd",
      orderId: order.orderId,
      installmentNumber: 2,
      attemptNumber: 1,
      idempotencyKey: "line-key",
      providerScope,
    });
    await provider.finalizeInvoice({ invoiceId: "in_program", autoAdvance: false, idempotencyKey: "finalize-key" });
    await provider.payInvoice({ invoiceId: "in_program", paymentMethodId: "pm_saved", offSession: true, idempotencyKey: "pay-key" });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      customer: "cus_program",
      invoice: "in_program",
      amount: 333,
      discounts: [],
      tax_rates: [],
      discountable: false,
    }), { idempotencyKey: "line-key" });
    expect(finalizeInvoice).toHaveBeenCalledWith("in_program", { auto_advance: false }, { idempotencyKey: "finalize-key" });
    expect(pay).toHaveBeenCalledWith("in_program", { payment_method: "pm_saved", off_session: true }, { idempotencyKey: "pay-key" });
  });

  it("deletes only by exact invoice ID and returns the provider's deleted response", async () => {
    const del = vi.fn(async (id: string) => ({ id, object: "invoice" as const, deleted: true as const }));
    const provider = createProgramInvoiceProvider({
      ...stripeScopeMock(),
      invoices: { del },
    } as unknown as Stripe);

    await expect(provider.deleteDraftInvoice({
      invoiceId: "in_program",
      providerScope,
      idempotencyKey: "delete-key",
    })).resolves.toEqual({
      id: "in_program",
      object: "invoice",
      deleted: true,
      providerScope,
    });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("in_program", { idempotencyKey: "delete-key" });
  });

  it("classifies only exact scoped 404 resource_missing as a draft-delete readback", async () => {
    const missing = Object.assign(new Error("No such invoice"), {
      type: "StripeInvalidRequestError",
      statusCode: 404,
      code: "resource_missing",
    });
    const retrieve = vi.fn(async () => { throw missing; });
    const provider = createProgramInvoiceProvider({
      ...stripeScopeMock(),
      invoices: { retrieve },
    } as unknown as Stripe);

    await expect(provider.retrieveInvoiceDeleteReadback({ invoiceId: "in_program", providerScope })).resolves.toEqual({
      status: "missing",
      invoiceId: "in_program",
      httpStatus: 404,
      errorCode: "resource_missing",
      providerScope,
    });
    expect(retrieve).toHaveBeenCalledWith("in_program");
  });

  it("keeps permission, scope and other retrieve errors unresolved", async () => {
    const permission = Object.assign(new Error("Account unavailable"), {
      type: "StripeInvalidRequestError",
      statusCode: 403,
      code: "account_invalid",
    });
    const retrieve = vi.fn(async () => { throw permission; });
    const provider = createProgramInvoiceProvider({
      ...stripeScopeMock(),
      invoices: { retrieve },
    } as unknown as Stripe);
    await expect(provider.retrieveInvoiceDeleteReadback({ invoiceId: "in_program", providerScope })).rejects.toBe(permission);

    const mismatchedScope = createProgramInvoiceProvider({
      accounts: { retrieve: vi.fn(async () => ({ id: "acct_other" })) },
      balance: { retrieve: vi.fn(async () => ({ livemode: false })) },
      invoices: { retrieve },
    } as unknown as Stripe);
    await expect(mismatchedScope.retrieveInvoiceDeleteReadback({ invoiceId: "in_program", providerScope })).rejects.toThrow(/scope changed/);
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it("resolves the PaymentIntent only from the paginated exact InvoicePayment association", async () => {
    const page = vi.fn(async () => ({
      data: [{
        id: "inpay_program",
        invoice: "in_program",
        is_default: true,
        status: "open",
        amount_requested: 333,
        amount_paid: null,
        currency: "usd",
        payment: { type: "payment_intent", payment_intent: "pi_program" },
        livemode: false,
      }],
      has_more: false,
    }));
    const provider = createProgramInvoiceProvider({
      ...stripeScopeMock(),
      invoicePayments: { list: page },
    } as unknown as Stripe);

    await expect(provider.listInvoicePayments({ invoiceId: "in_program" })).resolves.toEqual({
      data: [{ id: "inpay_program", invoiceId: "in_program", isDefault: true, status: "open", amountRequested: 333,
        amountPaid: null, currency: "usd", type: "payment_intent", paymentIntentId: "pi_program", livemode: false, providerScope }],
      hasMore: false,
    });
    expect(page).toHaveBeenCalledWith({ invoice: "in_program", limit: 100 });
  });
});
