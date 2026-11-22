import { describe, expect, it, vi } from "vitest";
import {
  buildProgramMonthlyAnchors,
  collectProgramInstallment,
  createProgramCheckout,
  deleteDraftProgramInvoiceForCancellation,
  getProgramInvoiceReadiness,
  isValidProgramBillingConsent,
  PROGRAM_BILLING_RETRY_WINDOW_MS,
  retryProgramCheckout,
  verifyProgramCustomerIsolation,
  type ProgramBillingOrder,
  type ProgramBillingStore,
  type ProgramDraftInvoiceDeleteProof,
  type ProgramDraftInvoiceDeleteStore,
  type ProgramCheckoutAttemptIntent,
  type ProgramCheckoutProvider,
  type ProgramCheckoutStore,
  type ProgramInvoiceAttempt,
  type ProgramInvoicePayment,
  type ProgramPaymentIntent,
  type ProgramInvoice,
  type ProgramInvoiceLine,
  type ProgramInvoiceProvider,
  type ProgramProviderScope,
  type ProgramStripeCustomer,
} from "./program-billing";

const order: ProgramBillingOrder = {
  orderId: "program-order-1",
  buyerId: "member-1",
  currency: "usd",
  effectiveTotalCents: 300,
  installmentAmountsCents: [100, 100, 100],
  installmentCount: 3,
  clearedInstallments: 1,
  promotionReservationState: "none",
  stripeCustomerId: "cus_program_1",
  providerScope: { platformAccountId: "acct_program_platform", livemode: false },
  savedPaymentMethodId: "pm_saved_1",
  seller: { platformOwned: true, connectedAccountId: null, applicationFeeBasisPoints: 0 },
  consent: {
    version: 1,
    digest: "a".repeat(64),
    acceptedAt: "2026-01-15T12:00:00.000Z",
    totalCents: 300,
    installmentCount: 3,
    disclosedChargeDates: ["2026-02-15", "2026-03-15"],
    savedCardForOffSession: true,
    retryWindowDays: 7,
    cancellationStopsFutureCharges: true,
  },
  firstSettledAt: "2026-01-15T12:00:00.000Z",
  nextAnchorDate: "2026-02-15",
  retryDeadline: "2026-02-22T23:59:59.999Z",
  canceled: false,
  deletionPending: false,
  financialConflict: false,
  currentAttemptNumber: 1,
};

describe("Program billing dates and consent", () => {
  it("builds finite end-of-month anchors and never adds a final extra date", () => {
    expect(buildProgramMonthlyAnchors({ firstSettledAt: "2026-01-31T10:00:00.000Z", installmentCount: 3 })).toEqual({
      anchor: { day: 31, endOfMonth: true },
      futureDates: ["2026-02-28", "2026-03-31"],
    });
    expect(buildProgramMonthlyAnchors({ firstSettledAt: "2026-01-31T10:00:00.000Z", installmentCount: 1 })?.futureDates).toEqual([]);
    expect(buildProgramMonthlyAnchors({ firstSettledAt: "2026-02-01T02:00:00.000Z", installmentCount: 3 })).toMatchObject({
      anchor: { day: 31, endOfMonth: true },
      futureDates: ["2026-02-28", "2026-03-31"],
    });
  });

  it("accepts only the stored fixed total, disclosed dates, saved card and retry terms", () => {
    expect(isValidProgramBillingConsent({ consent: order.consent!, order, now: "2026-01-20T00:00:00.000Z" })).toBe(true);
    expect(isValidProgramBillingConsent({
      consent: { ...order.consent!, totalCents: 301 },
      order,
      now: "2026-01-20T00:00:00.000Z",
    })).toBe(false);
  });

  it("requires a fresh date confirmation after a missed anchor but permits same-invoice seven-day retries", () => {
    expect(getProgramInvoiceReadiness({ order, installmentNumber: 2, today: "2026-02-16", now: "2026-02-16T12:00:00.000Z" }))
      .toEqual({ status: "buyer_confirmation_required" });
    expect(getProgramInvoiceReadiness({
      order,
      installmentNumber: 2,
      today: "2026-02-16",
      now: "2026-02-16T12:00:00.000Z",
      retryStartedAt: "2026-02-15T10:00:00.000Z",
    })).toMatchObject({ status: "ready", amountCents: 100, dueDate: "2026-02-15" });
    expect(getProgramInvoiceReadiness({
      order,
      installmentNumber: 2,
      today: "2026-02-23",
      now: "2026-02-23T00:00:00.000Z",
      retryStartedAt: "2026-02-15T10:00:00.000Z",
    })).toMatchObject({ status: "blocked", reason: "retry_expired" });
  });

  it("accepts the persisted seven-day deadline exactly, then expires at plus one millisecond", () => {
    const startedAt = "2026-02-15T10:00:00.000Z";
    const retryDeadline = new Date(Date.parse(startedAt) + PROGRAM_BILLING_RETRY_WINDOW_MS).toISOString();
    const input = {
      order,
      installmentNumber: 2,
      today: "2026-02-22",
      retryStartedAt: startedAt,
      retryDeadline,
    };

    expect(getProgramInvoiceReadiness({ ...input, now: retryDeadline })).toMatchObject({ status: "ready", retryDeadline });
    expect(getProgramInvoiceReadiness({
      ...input,
      now: new Date(Date.parse(retryDeadline) + 1).toISOString(),
    })).toMatchObject({ status: "blocked", reason: "retry_expired" });
  });
});

describe("Program Customer inventory completeness", () => {
  const customer = {
    id: order.stripeCustomerId,
    deleted: false,
    balance: 0,
    invoiceCreditBalance: { usd: 0 },
    discountId: null,
    taxExempt: "none",
    metadata: { program_order_id: order.orderId, program_billing_purpose: "program_order",
      program_platform_account_id: order.providerScope!.platformAccountId, program_livemode: "false" },
    livemode: false,
    providerScope: order.providerScope!,
  };

  function provider(overrides: Record<string, unknown> = {}) {
    return {
      getProviderScope: vi.fn(async () => order.providerScope!),
      retrieveCustomer: vi.fn(async () => customer),
      listInvoices: vi.fn(async () => ({ data: [], hasMore: false })),
      hasPendingInvoiceItems: vi.fn(async () => false),
      listSubscriptions: vi.fn(async () => ({ data: [], hasMore: false })),
      listSubscriptionSchedules: vi.fn(async () => ({ data: [], hasMore: false })),
      ...overrides,
    } as unknown as ProgramInvoiceProvider;
  }

  it("rejects missing pagination flags, unknown pending-item inventory, and JSON-null credit balances", async () => {
    await expect(verifyProgramCustomerIsolation(provider({
      listInvoices: vi.fn(async () => ({ data: [] })),
    }), order)).rejects.toThrow(/inventory page is incomplete/);
    await expect(verifyProgramCustomerIsolation(provider({
      hasPendingInvoiceItems: vi.fn(async () => undefined),
    }), order)).rejects.toThrow(/inventory is incomplete or nonempty/);
    await expect(verifyProgramCustomerIsolation(provider({
      retrieveCustomer: vi.fn(async () => ({ ...customer, invoiceCreditBalance: null })),
    }), order)).rejects.toThrow(/not isolated/);
    await expect(verifyProgramCustomerIsolation(provider({
      listSubscriptions: vi.fn(async () => ({ data: [] })),
    }), order)).rejects.toThrow(/inventory page is incomplete/);
  });
});

describe("Program installment collection guard", () => {
  it("does not create or pay an invoice when the isolated Customer has an unexpected balance", async () => {
    const prepared: ProgramInvoiceAttempt = {
      order,
      installmentNumber: 2,
      expectedRevision: 4,
      invoiceId: null,
      invoiceItemId: null,
      paymentIntentId: null,
      createInvoiceIdempotencyKey: "program:order:2:create:v1",
      createLineIdempotencyKey: "program:order:2:line:v1",
      finalizeIdempotencyKey: "program:order:2:finalize:v1",
      currentPayAttempt: 0,
      currentPayIdempotencyKey: null,
      currentPayOutcome: "none",
      invoiceCreateOutcome: "not_started",
      lineCreateOutcome: "not_started",
      finalizeOutcome: "not_started",
      retryStartedAt: null,
      collectionStartedAt: null,
      retryDeadline: null,
    };
    const store = {
      prepareInstallmentInvoice: vi.fn(async () => prepared),
      bindInvoice: vi.fn(async () => true),
      bindInvoiceItem: vi.fn(async () => true),
      bindPaymentIntent: vi.fn(async () => true),
      markOperationUnknown: vi.fn(async () => true),
      prepareInvoicePayAttempt: vi.fn(async () => ({ attemptNumber: 1, idempotencyKey: "pay-1" })),
      recordProviderObservation: vi.fn(async () => undefined),
      recordActionRequired: vi.fn(async () => undefined),
    } satisfies Partial<ProgramBillingStore>;
    const stripe = {
      getProviderScope: vi.fn(async () => order.providerScope!),
      retrieveCustomer: vi.fn(async () => ({
        id: order.stripeCustomerId,
        deleted: false,
        balance: -1,
        invoiceCreditBalance: {},
        discountId: null,
        taxExempt: "none",
        metadata: { program_order_id: order.orderId, program_billing_purpose: "program_order" },
      })),
      hasPendingInvoiceItems: vi.fn(async () => false),
      listSubscriptions: vi.fn(async () => ({ data: [], hasMore: false })),
      listSubscriptionSchedules: vi.fn(async () => ({ data: [], hasMore: false })),
      listInvoices: vi.fn(async () => ({ data: [], hasMore: false })),
      createInvoice: vi.fn(),
      payInvoice: vi.fn(),
    } as unknown as ProgramInvoiceProvider;

    const result = await collectProgramInstallment({
      store: store as ProgramBillingStore,
      stripe,
      orderId: order.orderId,
      installmentNumber: 2,
      expectedRevision: 4,
      today: "2026-02-15",
      now: "2026-02-15T12:00:00.000Z",
    });
    expect(result).toEqual({ status: "blocked", reason: "program_customer_inventory_mismatch" });
    expect(stripe.createInvoice).not.toHaveBeenCalled();
    expect(stripe.payInvoice).not.toHaveBeenCalled();
  });

  it("records retry start only for an already durable invoice attempt", () => {
    expect(getProgramInvoiceReadiness({
      order,
      installmentNumber: 2,
      today: "2026-02-15",
      now: "2026-02-15T12:00:00.000Z",
      retryStartedAt: null,
    })).toMatchObject({ status: "ready", dueDate: "2026-02-15" });
  });

  it("binds the exact invoice-generated PaymentIntent association with empty metadata before manual pay", async () => {
    const events: string[] = [];
    const prepared: ProgramInvoiceAttempt = {
      order,
      installmentNumber: 2,
      expectedRevision: 4,
      invoiceId: null,
      invoiceItemId: null,
      paymentIntentId: null,
      createInvoiceIdempotencyKey: "program:invoice-create:a1:i2:p0:v1",
      createLineIdempotencyKey: "program:invoice-item-create:a1:i2:p0:v1",
      finalizeIdempotencyKey: "program:invoice-finalize:a1:i2:p0:v1",
      currentPayAttempt: 0,
      currentPayIdempotencyKey: null,
      currentPayOutcome: "none",
      invoiceCreateOutcome: "not_started",
      lineCreateOutcome: "not_started",
      finalizeOutcome: "not_started",
      retryStartedAt: "2026-02-15T10:00:00.000Z",
      collectionStartedAt: null,
      retryDeadline: null,
    };
    const line: ProgramInvoiceLine = {
      id: "il_program",
      invoiceId: "in_program",
      amount: 100,
      currency: "usd",
      quantity: null,
      invoiceItemId: "ii_program",
      customerId: order.stripeCustomerId,
      description: "Program installment 2",
      discountable: false,
      discounts: [],
      taxRates: [],
      taxAmounts: [],
      proration: false,
      subscriptionId: null,
      metadata: {
        program_order_id: order.orderId,
        program_installment_number: "2",
        program_attempt_number: "1",
        program_billing_kind: "standalone_installment_line",
        program_platform_account_id: order.providerScope!.platformAccountId,
        program_livemode: "false",
      },
      livemode: false,
      providerScope: { platformAccountId: "acct_program_platform", livemode: false },
    };
    let invoiceStatus: ProgramInvoice["status"] = "draft";
    let lineCreated = false;
    let paymentStatus = "requires_payment_method";
    const makeInvoice = (): ProgramInvoice => {
      const amount = lineCreated ? 100 : 0;
      const paid = invoiceStatus === "paid";
      return {
        id: "in_program",
        customerId: order.stripeCustomerId,
        currency: "usd",
        status: invoiceStatus,
        autoAdvance: false,
        collectionMethod: "charge_automatically",
        billingReason: "manual",
        subscriptionId: null,
        parentType: null,
        amountDue: amount,
        amountPaid: paid ? amount : 0,
        amountRemaining: paid ? 0 : amount,
        amountOverpaid: 0,
        amountShipping: 0,
        subtotal: amount,
        total: amount,
        subtotalExcludingTax: amount,
        totalExcludingTax: amount,
        startingBalance: 0,
        endingBalance: 0,
        discounts: [],
        totalDiscountAmounts: [],
        defaultTaxRates: [],
        totalTaxes: [],
        automaticTaxEnabled: false,
        metadata: {
          program_order_id: order.orderId,
          program_installment_number: "2",
          program_attempt_number: "1",
          program_billing_kind: "standalone_installment",
          program_platform_account_id: order.providerScope!.platformAccountId,
          program_livemode: "false",
        },
        defaultPaymentMethodId: order.savedPaymentMethodId,
        lines: { data: lineCreated ? [line] : [], hasMore: false, totalCount: lineCreated ? 1 : 0 },
        livemode: false,
        providerScope: { platformAccountId: "acct_program_platform", livemode: false },
      };
    };
    const store = {
      prepareInstallmentInvoice: vi.fn(async () => prepared),
      bindInvoice: vi.fn(async () => { events.push("bind_invoice"); return true; }),
      bindInvoiceItem: vi.fn(async (value) => {
        expect(value.evidence.id).toBe("il_program");
        events.push("bind_line");
        return true;
      }),
      bindPaymentIntent: vi.fn(async (value) => {
        expect(value.evidence.paymentIntent.id).toBe("pi_program");
        events.push("bind_pi");
        return true;
      }),
      markOperationUnknown: vi.fn(async (value) => {
        events.push(`intent:${value.operationKind}`);
        return true;
      }),
      prepareInvoicePayAttempt: vi.fn(async (value) => {
        expect(value).toMatchObject({
          invoiceId: "in_program",
          paymentIntentId: "pi_program",
          verifiedStatus: "requires_payment_method",
        });
        events.push("intent:invoice_pay");
        return { attemptNumber: 1, idempotencyKey: "program:invoice-pay:a1:i2:p1:v1" };
      }),
      recordProviderObservation: vi.fn(async () => undefined),
      recordActionRequired: vi.fn(async () => undefined),
    };
    const stripe = {
      getProviderScope: vi.fn(async () => order.providerScope!),
      retrieveCustomer: vi.fn(async () => ({
        id: order.stripeCustomerId,
        deleted: false,
        balance: 0,
        invoiceCreditBalance: {},
        discountId: null,
        taxExempt: "none",
        metadata: { program_order_id: order.orderId, program_billing_purpose: "program_order",
          program_platform_account_id: order.providerScope!.platformAccountId, program_livemode: "false" },
        livemode: false,
        providerScope: order.providerScope,
      })),
      hasPendingInvoiceItems: vi.fn(async () => false),
      listSubscriptions: vi.fn(async () => ({ data: [], hasMore: false })),
      listSubscriptionSchedules: vi.fn(async () => ({ data: [], hasMore: false })),
      listInvoices: vi.fn(async () => ({ data: [], hasMore: false })),
      createInvoice: vi.fn(async () => { events.push("create_invoice"); return makeInvoice(); }),
      retrieveInvoice: vi.fn(async () => makeInvoice()),
      createInvoiceLine: vi.fn(async () => { events.push("create_line"); lineCreated = true; return { id: "ii_program" }; }),
      listInvoiceLines: vi.fn(async () => ({ data: lineCreated ? [line] : [], hasMore: false })),
      finalizeInvoice: vi.fn(async () => { events.push("finalize_invoice"); invoiceStatus = "open"; return makeInvoice(); }),
      listInvoicePayments: vi.fn(async () => ({
        data: [{ id: "inpay_program", invoiceId: "in_program", isDefault: true, status: invoiceStatus === "paid" ? "paid" : "open",
          amountRequested: 100, amountPaid: invoiceStatus === "paid" ? 100 : null, currency: "usd",
          type: "payment_intent", paymentIntentId: "pi_program" }],
        hasMore: false,
      })),
      retrievePaymentIntent: vi.fn(async () => ({
        id: "pi_program",
        customerId: order.stripeCustomerId,
        amount: 100,
        amountReceived: paymentStatus === "succeeded" ? 100 : 0,
        currency: "usd",
        status: paymentStatus,
        applicationFeeAmount: null,
        transferDestinationId: null,
        paymentMethodId: order.savedPaymentMethodId,
        latestChargeId: paymentStatus === "succeeded" ? "ch_program" : null,
        livemode: false,
        providerScope: order.providerScope,
        // Stripe's invoice-generated PI is associated through its exact
        // InvoicePayment; the platform does not require metadata copied onto it.
        metadata: {},
      })),
      retrievePaymentMethod: vi.fn(async () => ({ id: order.savedPaymentMethodId, customerId: order.stripeCustomerId, type: "card" })),
      payInvoice: vi.fn(async (value) => {
        events.push("pay_invoice");
        expect(value).toMatchObject({ invoiceId: "in_program", paymentMethodId: order.savedPaymentMethodId, offSession: true });
        invoiceStatus = "paid";
        paymentStatus = "succeeded";
        return makeInvoice();
      }),
    };

    const result = await collectProgramInstallment({
      store: store as unknown as ProgramBillingStore,
      stripe: stripe as unknown as ProgramInvoiceProvider,
      orderId: order.orderId,
      installmentNumber: 2,
      expectedRevision: 4,
      today: "2026-02-15",
      now: "2026-02-15T12:00:00.000Z",
    });
    expect(result).toEqual({
      status: "payment_succeeded_awaiting_ledger",
      invoiceId: "in_program",
      paymentIntentId: "pi_program",
      chargeId: "ch_program",
    });
    expect(events.indexOf("intent:invoice_create")).toBeLessThan(events.indexOf("create_invoice"));
    expect(events.indexOf("intent:invoice_item_create")).toBeLessThan(events.indexOf("create_line"));
    expect(events.indexOf("intent:invoice_finalize")).toBeLessThan(events.indexOf("finalize_invoice"));
    expect(events.indexOf("bind_invoice")).toBeLessThan(events.indexOf("create_line"));
    expect(events.indexOf("bind_line")).toBeLessThan(events.indexOf("finalize_invoice"));
    expect(events.indexOf("bind_pi")).toBeLessThan(events.indexOf("pay_invoice"));
    expect(events.indexOf("intent:invoice_pay")).toBeLessThan(events.indexOf("pay_invoice"));
    expect(stripe.payInvoice).toHaveBeenCalledTimes(1);
  });
});

describe("Program draft Invoice deletion proof", () => {
  const cancelOrder: ProgramBillingOrder = { ...order, canceled: true };
  const invoiceLine: ProgramInvoiceLine = {
    id: "il_draft",
    invoiceId: "in_draft",
    amount: 100,
    currency: "usd",
    quantity: 1,
    invoiceItemId: "ii_draft",
    customerId: order.stripeCustomerId,
    description: "Program installment 2",
    discountable: false,
    discounts: [],
    taxRates: [],
    taxAmounts: [],
    proration: false,
    subscriptionId: null,
    metadata: {
      program_order_id: order.orderId,
      program_installment_number: "2",
      program_attempt_number: "1",
      program_billing_kind: "standalone_installment_line",
      program_platform_account_id: order.providerScope!.platformAccountId,
      program_livemode: "false",
    },
    livemode: false,
    providerScope: order.providerScope!,
  };
  const draftInvoice: ProgramInvoice = {
    id: "in_draft",
    customerId: order.stripeCustomerId,
    currency: "usd",
    status: "draft",
    autoAdvance: false,
    collectionMethod: "charge_automatically",
    billingReason: "manual",
    subscriptionId: null,
    parentType: null,
    amountDue: 100,
    amountPaid: 0,
    amountRemaining: 100,
    amountOverpaid: 0,
    amountShipping: 0,
    subtotal: 100,
    total: 100,
    subtotalExcludingTax: 100,
    totalExcludingTax: 100,
    startingBalance: 0,
    endingBalance: 0,
    discounts: [],
    totalDiscountAmounts: [],
    defaultTaxRates: [],
    totalTaxes: [],
    automaticTaxEnabled: false,
    metadata: {
      program_order_id: order.orderId,
      program_installment_number: "2",
      program_attempt_number: "1",
      program_billing_kind: "standalone_installment",
      program_platform_account_id: order.providerScope!.platformAccountId,
      program_livemode: "false",
    },
    defaultPaymentMethodId: order.savedPaymentMethodId,
    lines: { data: [invoiceLine], hasMore: false, totalCount: 1 },
    livemode: false,
    providerScope: order.providerScope!,
  };
  const priorIntent: ProgramPaymentIntent = {
    id: "pi_prior",
    customerId: order.stripeCustomerId,
    amount: 100,
    amountReceived: 100,
    currency: "usd",
    status: "succeeded",
    applicationFeeAmount: null,
    transferDestinationId: null,
    paymentMethodId: order.savedPaymentMethodId,
    latestChargeId: "ch_prior",
    metadata: { program_order_id: order.orderId, program_installment_number: "1" },
    livemode: false,
    providerScope: order.providerScope!,
  };

  function draftDeleteProvider(input: {
    invoice: ProgramInvoice;
    lines: readonly ProgramInvoiceLine[];
    deleteDraftInvoice?: () => Promise<{ id: string; object: "invoice"; deleted: true; providerScope: ProgramProviderScope }>;
  }) {
    const customer: ProgramStripeCustomer = {
      id: order.stripeCustomerId,
      deleted: false,
      balance: 0,
      invoiceCreditBalance: { usd: 0 },
      discountId: null,
      taxExempt: "none",
      metadata: {
        program_order_id: order.orderId,
        program_billing_purpose: "program_order",
        program_platform_account_id: order.providerScope!.platformAccountId,
        program_livemode: "false",
      },
      livemode: false,
      providerScope: order.providerScope ?? undefined,
    };
    return {
      getProviderScope: vi.fn(async () => order.providerScope!),
      retrieveCustomer: vi.fn(async () => customer),
      listInvoices: vi.fn(async () => ({ data: [input.invoice], hasMore: false })),
      hasPendingInvoiceItems: vi.fn(async () => false),
      listSubscriptions: vi.fn(async () => ({ data: [], hasMore: false })),
      listSubscriptionSchedules: vi.fn(async () => ({ data: [], hasMore: false })),
      listPaymentIntents: vi.fn(async () => ({ data: [priorIntent], hasMore: false })),
      retrieveInvoice: vi.fn(async () => input.invoice),
      listInvoiceLines: vi.fn(async () => ({ data: [...input.lines], hasMore: false })),
      listInvoicePayments: vi.fn(async () => ({ data: [], hasMore: false })),
      deleteDraftInvoice: vi.fn(input.deleteDraftInvoice ?? (async () => ({
        id: input.invoice.id,
        object: "invoice" as const,
        deleted: true as const,
        providerScope: order.providerScope!,
      }))),
    } as unknown as ProgramInvoiceProvider;
  }

  it("deletes a zero-line draft Invoice without inventing an InvoiceItem", async () => {
    const noLineDraft: ProgramInvoice = {
      ...draftInvoice,
      amountDue: 0,
      amountRemaining: 0,
      subtotal: 0,
      total: 0,
      subtotalExcludingTax: 0,
      totalExcludingTax: 0,
      lines: { data: [], hasMore: false, totalCount: 0 },
    };
    const provider = draftDeleteProvider({ invoice: noLineDraft, lines: [] });
    let storedProof: ProgramDraftInvoiceDeleteProof | null = null;
    const store = {
      getDraftInvoiceDelete: vi.fn(async () => storedProof),
      prepareDraftInvoiceDelete: vi.fn(async (input: Parameters<ProgramDraftInvoiceDeleteStore["prepareDraftInvoiceDelete"]>[0]) => {
        expect(input.snapshot.invoice.id).toBe(noLineDraft.id);
        expect(input.snapshot.lines).toEqual([]);
        storedProof = {
          orderId: order.orderId,
          installmentNumber: 2,
          checkoutAttemptNumber: 1,
          invoiceId: noLineDraft.id,
          customerId: order.stripeCustomerId,
          providerScope: order.providerScope!,
          snapshot: input.snapshot,
          snapshotDigest: input.snapshotDigest,
          proofState: "prepared",
          operationState: "intent",
          idempotencyKey: `program:${order.orderId}:invoice_delete:a1:i2:p0:v1`,
        };
        return { idempotencyKey: `program:${order.orderId}:invoice_delete:a1:i2:p0:v1`, snapshotDigest: input.snapshotDigest };
      }),
      markDraftInvoiceDeleteUnknown: vi.fn(async () => {
        if (storedProof) storedProof = { ...storedProof, proofState: "unknown", operationState: "unknown" };
        return true;
      }),
      reconcileDraftInvoiceDelete: vi.fn(async () => "deleted" as const),
    };

    const result = await deleteDraftProgramInvoiceForCancellation({
      store,
      provider,
      intent: {
        order: cancelOrder,
        installmentNumber: 2,
        checkoutAttemptNumber: 1,
        expectedRevision: 7,
        invoiceId: noLineDraft.id,
        invoiceItemId: null,
        knownPaymentIntentIds: [priorIntent.id],
      },
    });

    expect(result).toEqual({ status: "deleted" });
    expect(provider.deleteDraftInvoice).toHaveBeenCalledWith({
      invoiceId: noLineDraft.id,
      providerScope: order.providerScope!,
      idempotencyKey: `program:${order.orderId}:invoice_delete:a1:i2:p0:v1`,
    });
  });

  it("keeps a draft pending when the durable store has unresolved finalization", async () => {
    const provider = draftDeleteProvider({ invoice: draftInvoice, lines: [invoiceLine] });
    const store = {
      getDraftInvoiceDelete: vi.fn(async () => null),
      prepareDraftInvoiceDelete: vi.fn(async () => ({ blocked: "invoice_finalize_unresolved" })),
      markDraftInvoiceDeleteUnknown: vi.fn(),
      reconcileDraftInvoiceDelete: vi.fn(),
    };

    const result = await deleteDraftProgramInvoiceForCancellation({
      store,
      provider,
      intent: {
        order: cancelOrder,
        installmentNumber: 2,
        checkoutAttemptNumber: 1,
        expectedRevision: 7,
        invoiceId: draftInvoice.id,
        invoiceItemId: "ii_draft",
        knownPaymentIntentIds: [priorIntent.id],
      },
    });

    expect(result).toEqual({ status: "blocked", reason: "invoice_finalize_unresolved" });
    expect(store.prepareDraftInvoiceDelete).toHaveBeenCalledTimes(1);
    expect(provider.deleteDraftInvoice).not.toHaveBeenCalled();
  });

  it("does not delete an Invoice that finalized during the cancellation race", async () => {
    const finalizedInvoice: ProgramInvoice = { ...draftInvoice, status: "open" };
    const provider = draftDeleteProvider({ invoice: finalizedInvoice, lines: [invoiceLine] });
    const store = {
      getDraftInvoiceDelete: vi.fn(async () => null),
      prepareDraftInvoiceDelete: vi.fn(),
      markDraftInvoiceDeleteUnknown: vi.fn(),
      reconcileDraftInvoiceDelete: vi.fn(),
    };

    const result = await deleteDraftProgramInvoiceForCancellation({
      store,
      provider,
      intent: {
        order: cancelOrder,
        installmentNumber: 2,
        checkoutAttemptNumber: 1,
        expectedRevision: 7,
        invoiceId: draftInvoice.id,
        invoiceItemId: "ii_draft",
        knownPaymentIntentIds: [priorIntent.id],
      },
    });

    expect(result).toEqual({ status: "blocked", reason: "draft_invoice_identity_mismatch" });
    expect(store.prepareDraftInvoiceDelete).not.toHaveBeenCalled();
    expect(provider.deleteDraftInvoice).not.toHaveBeenCalled();
  });

  it("recovers a lost draft DELETE reconciliation from the original proof and a qualified 404", async () => {
    const timeline: string[] = [];
    let persistedSnapshotDigest = "";
    const payments: ProgramInvoicePayment[] = [];
    let invoiceListCount = 0;
    let storedProof: ProgramDraftInvoiceDeleteProof | null = null;
    const customer = {
      id: order.stripeCustomerId,
      deleted: false,
      balance: 0,
      invoiceCreditBalance: { usd: 0 },
      discountId: null,
      taxExempt: "none",
      metadata: {
        program_order_id: order.orderId,
        program_billing_purpose: "program_order",
        program_platform_account_id: order.providerScope!.platformAccountId,
        program_livemode: "false",
      },
      livemode: false,
      providerScope: order.providerScope,
    };
    const provider = {
      getProviderScope: vi.fn(async () => order.providerScope!),
      retrieveCustomer: vi.fn(async () => customer),
      listInvoices: vi.fn(async () => ({
        data: invoiceListCount++ === 0 ? [draftInvoice] : [],
        hasMore: false,
      })),
      hasPendingInvoiceItems: vi.fn(async () => false),
      listSubscriptions: vi.fn(async () => ({ data: [], hasMore: false })),
      listSubscriptionSchedules: vi.fn(async () => ({ data: [], hasMore: false })),
      listPaymentIntents: vi.fn(async () => ({ data: [priorIntent], hasMore: false })),
      createInvoice: vi.fn(),
      retrieveInvoice: vi.fn(async () => draftInvoice),
      listInvoiceLines: vi.fn(async () => ({ data: [invoiceLine], hasMore: false })),
      listInvoicePayments: vi.fn(async () => ({ data: payments, hasMore: false })),
      deleteDraftInvoice: vi.fn(async () => {
        timeline.push("delete");
        return { id: draftInvoice.id, object: "invoice" as const, deleted: true as const, providerScope: order.providerScope! };
      }),
      retrieveInvoiceDeleteReadback: vi.fn(async () => {
        timeline.push("readback");
        return {
          status: "missing" as const,
          invoiceId: draftInvoice.id,
          httpStatus: 404 as const,
          errorCode: "resource_missing" as const,
          providerScope: order.providerScope!,
        };
      }),
    } as unknown as ProgramInvoiceProvider;
    let reconcileCount = 0;
    const store = {
      getDraftInvoiceDelete: vi.fn(async () => {
        timeline.push("get_proof");
        return storedProof;
      }),
      prepareDraftInvoiceDelete: vi.fn(async (input: Parameters<ProgramDraftInvoiceDeleteStore["prepareDraftInvoiceDelete"]>[0]) => {
        timeline.push("persist_snapshot");
        persistedSnapshotDigest = input.snapshotDigest;
        expect(input.snapshot.invoice.id).toBe(draftInvoice.id);
        expect(input.snapshot.lines).toEqual([invoiceLine]);
        expect(input.snapshot.invoicePayments).toEqual([]);
        expect(JSON.parse(JSON.stringify(input.snapshot.customer))).toEqual({
          id: order.stripeCustomerId,
          deleted: false,
          balance: 0,
          invoiceCreditBalance: { usd: 0 },
          discountId: null,
          taxExempt: "none",
          metadata: {
            program_order_id: order.orderId,
            program_billing_purpose: "program_order",
            program_platform_account_id: order.providerScope!.platformAccountId,
            program_livemode: "false",
          },
          livemode: false,
          providerScope: order.providerScope,
        });
        expect(input.snapshot.pendingInvoiceItemCount).toBe(0);
        storedProof = {
          orderId: order.orderId,
          installmentNumber: 2,
          checkoutAttemptNumber: 1,
          invoiceId: draftInvoice.id,
          customerId: order.stripeCustomerId,
          providerScope: order.providerScope!,
          snapshot: input.snapshot,
          snapshotDigest: input.snapshotDigest,
          proofState: "prepared",
          operationState: "intent",
          idempotencyKey: `program:${order.orderId}:invoice_delete:a1:i2:p0:v1`,
        };
        return { idempotencyKey: `program:${order.orderId}:invoice_delete:a1:i2:p0:v1`, snapshotDigest: input.snapshotDigest };
      }),
      markDraftInvoiceDeleteUnknown: vi.fn(async () => {
        timeline.push("mark_unknown");
        if (storedProof) {
          storedProof = { ...storedProof, proofState: "unknown", operationState: "unknown" };
        }
        return true;
      }),
      reconcileDraftInvoiceDelete: vi.fn(async (input: Parameters<ProgramDraftInvoiceDeleteStore["reconcileDraftInvoiceDelete"]>[0]) => {
        timeline.push("persist_terminal");
        if (input.terminal.status === "missing") {
          expect(input.terminal.inventory.completeInventory).toBe(true);
          expect(input.terminal.inventory.customer.id).toBe(order.stripeCustomerId);
          expect(input.terminal.inventory.invoices).toEqual([]);
          expect(input.terminal.inventory.paymentIntents).toEqual([priorIntent]);
        } else {
          expect(input.terminal).toMatchObject({ status: "deleted", invoiceId: draftInvoice.id, object: "invoice", deleted: true });
        }
        expect(input.terminalDigest).toMatch(/^[0-9a-f]{64}$/);
        reconcileCount += 1;
        if (reconcileCount === 1) throw new Error("reconciliation response lost before durable write");
        return "deleted" as const;
      }),
    };

    const intent = {
      order: cancelOrder,
      installmentNumber: 2,
      checkoutAttemptNumber: 1,
      expectedRevision: 7,
      invoiceId: draftInvoice.id,
      invoiceItemId: "ii_draft",
      knownPaymentIntentIds: [priorIntent.id],
    };
    const firstResult = await deleteDraftProgramInvoiceForCancellation({
      store,
      provider,
      intent,
    });
    const result = await deleteDraftProgramInvoiceForCancellation({ store, provider, intent });

    expect(firstResult).toMatchObject({ status: "unknown", reason: "draft_invoice_delete_reconciliation_pending" });
    expect(result).toEqual({ status: "deleted" });
    expect(timeline).toEqual(["get_proof", "persist_snapshot", "get_proof", "mark_unknown", "delete", "persist_terminal",
      "get_proof", "readback", "persist_terminal"]);
    expect(store.prepareDraftInvoiceDelete).toHaveBeenCalledTimes(1);
    expect(provider.retrieveInvoice).toHaveBeenCalledTimes(1);
    expect(provider.deleteDraftInvoice).toHaveBeenCalledWith({
      invoiceId: draftInvoice.id,
      providerScope: order.providerScope,
      idempotencyKey: `program:${order.orderId}:invoice_delete:a1:i2:p0:v1`,
    });
    expect(provider.deleteDraftInvoice).toHaveBeenCalledTimes(1);
    expect(provider.retrieveInvoiceDeleteReadback).toHaveBeenCalledTimes(1);
    expect(store.reconcileDraftInvoiceDelete).toHaveBeenLastCalledWith(expect.objectContaining({
      invoiceId: draftInvoice.id,
      idempotencyKey: `program:${order.orderId}:invoice_delete:a1:i2:p0:v1`,
      snapshotDigest: persistedSnapshotDigest,
    }));
    expect(provider.createInvoice).not.toHaveBeenCalled();
  });

  it.each([
    { readbackStatus: "draft", paymentActivity: false, expectedStatus: "deleted", expectedDeleteCount: 2 },
    { readbackStatus: "open", paymentActivity: false, expectedStatus: "blocked", expectedDeleteCount: 1 },
    { readbackStatus: "draft", paymentActivity: true, expectedStatus: "blocked", expectedDeleteCount: 1 },
  ] as const)("continues only an unchanged unknown draft after a transient failure (%o)", async (scenario) => {
    let storedProof: ProgramDraftInvoiceDeleteProof | null = null;
    let invoicePresent = true;
    let deleteCount = 0;
    let readbackStatus: ProgramInvoice["status"] = "draft";
    let paymentActivity = false;
    const customer: ProgramStripeCustomer = {
      id: order.stripeCustomerId,
      deleted: false,
      balance: 0,
      invoiceCreditBalance: { usd: 0 },
      discountId: null,
      taxExempt: "none",
      metadata: {
        program_order_id: order.orderId,
        program_billing_purpose: "program_order",
        program_platform_account_id: order.providerScope!.platformAccountId,
        program_livemode: "false",
      },
      livemode: false,
      providerScope: order.providerScope!,
    };
    const missingReadback = () => ({
      status: "missing" as const,
      invoiceId: draftInvoice.id,
      httpStatus: 404 as const,
      errorCode: "resource_missing" as const,
      providerScope: order.providerScope!,
    });
    const provider = {
      getProviderScope: vi.fn(async () => order.providerScope!),
      retrieveCustomer: vi.fn(async () => customer),
      listInvoices: vi.fn(async () => ({ data: invoicePresent ? [draftInvoice] : [], hasMore: false })),
      hasPendingInvoiceItems: vi.fn(async () => false),
      listSubscriptions: vi.fn(async () => ({ data: [], hasMore: false })),
      listSubscriptionSchedules: vi.fn(async () => ({ data: [], hasMore: false })),
      listPaymentIntents: vi.fn(async () => ({ data: [priorIntent], hasMore: false })),
      retrieveInvoice: vi.fn(async () => draftInvoice),
      listInvoiceLines: vi.fn(async () => ({ data: [invoiceLine], hasMore: false })),
      listInvoicePayments: vi.fn(async () => ({
        data: paymentActivity ? [{
          id: "inpay_late",
          invoiceId: draftInvoice.id,
          isDefault: true,
          status: "open",
          amountRequested: 100,
          amountPaid: 0,
          currency: "usd",
          type: "payment_intent",
          paymentIntentId: "pi_unexpected",
        }] : [],
        hasMore: false,
      })),
      deleteDraftInvoice: vi.fn(async () => {
        deleteCount += 1;
        if (deleteCount === 1) throw new Error("transient DELETE failure; invoice remains draft");
        invoicePresent = false;
        return { id: draftInvoice.id, object: "invoice" as const, deleted: true as const, providerScope: order.providerScope! };
      }),
      retrieveInvoiceDeleteReadback: vi.fn(async () => invoicePresent
        ? { status: "present" as const, invoice: { ...draftInvoice, status: readbackStatus }, providerScope: order.providerScope! }
        : missingReadback()),
      createInvoice: vi.fn(),
    } as unknown as ProgramInvoiceProvider;
    const store = {
      getDraftInvoiceDelete: vi.fn(async () => storedProof),
      prepareDraftInvoiceDelete: vi.fn(async (input: Parameters<ProgramDraftInvoiceDeleteStore["prepareDraftInvoiceDelete"]>[0]) => {
        storedProof = {
          orderId: order.orderId,
          installmentNumber: 2,
          checkoutAttemptNumber: 1,
          invoiceId: draftInvoice.id,
          customerId: order.stripeCustomerId,
          providerScope: order.providerScope!,
          snapshot: input.snapshot,
          snapshotDigest: input.snapshotDigest,
          proofState: "prepared",
          operationState: "intent",
          idempotencyKey: `program:${order.orderId}:invoice_delete:a1:i2:p0:v1`,
        };
        return { idempotencyKey: storedProof.idempotencyKey, snapshotDigest: input.snapshotDigest };
      }),
      markDraftInvoiceDeleteUnknown: vi.fn(async () => {
        if (storedProof) storedProof = { ...storedProof, proofState: "unknown", operationState: "unknown" };
        return true;
      }),
      reconcileDraftInvoiceDelete: vi.fn(async (input: Parameters<ProgramDraftInvoiceDeleteStore["reconcileDraftInvoiceDelete"]>[0]) => {
        expect(input.idempotencyKey).toBe(`program:${order.orderId}:invoice_delete:a1:i2:p0:v1`);
        expect(input.snapshotDigest).toBe(storedProof?.snapshotDigest);
        expect(input.terminal.status).toBe("missing");
        return "deleted" as const;
      }),
    };
    const intent = {
      order: cancelOrder,
      installmentNumber: 2,
      checkoutAttemptNumber: 1,
      expectedRevision: 7,
      invoiceId: draftInvoice.id,
      invoiceItemId: "ii_draft",
      knownPaymentIntentIds: [priorIntent.id],
    };

    const first = await deleteDraftProgramInvoiceForCancellation({ store, provider, intent });
    readbackStatus = scenario.readbackStatus;
    paymentActivity = scenario.paymentActivity;
    const second = await deleteDraftProgramInvoiceForCancellation({ store, provider, intent });

    expect(first).toMatchObject({ status: "unknown", reason: "draft_invoice_still_present" });
    expect(second.status).toBe(scenario.expectedStatus);
    expect(provider.deleteDraftInvoice).toHaveBeenCalledTimes(scenario.expectedDeleteCount);
    expect(provider.deleteDraftInvoice).toHaveBeenNthCalledWith(1, {
      invoiceId: draftInvoice.id,
      providerScope: order.providerScope,
      idempotencyKey: `program:${order.orderId}:invoice_delete:a1:i2:p0:v1`,
    });
    if (scenario.expectedDeleteCount === 2) {
      expect(provider.deleteDraftInvoice).toHaveBeenNthCalledWith(2, {
        invoiceId: draftInvoice.id,
        providerScope: order.providerScope,
        idempotencyKey: `program:${order.orderId}:invoice_delete:a1:i2:p0:v1`,
      });
    }
    expect(provider.retrieveInvoice).toHaveBeenCalledTimes(1);
    expect(provider.retrieveInvoiceDeleteReadback).toHaveBeenCalledTimes(scenario.expectedDeleteCount === 2 ? 3 : 2);
    expect(provider.createInvoice).not.toHaveBeenCalled();
    expect(store.prepareDraftInvoiceDelete).toHaveBeenCalledTimes(1);
    expect(store.markDraftInvoiceDeleteUnknown).toHaveBeenCalledTimes(1);
    expect(store.reconcileDraftInvoiceDelete).toHaveBeenCalledTimes(scenario.expectedDeleteCount === 2 ? 1 : 0);
  });

  it("does not prepare or delete when InvoicePayment inventory is unavailable or nonempty", async () => {
    const provider = {
      getProviderScope: vi.fn(async () => order.providerScope!),
      retrieveCustomer: vi.fn(async () => ({
        id: order.stripeCustomerId,
        deleted: false,
        balance: 0,
        invoiceCreditBalance: { usd: 0 },
        discountId: null,
        taxExempt: "none",
        metadata: { program_order_id: order.orderId, program_billing_purpose: "program_order",
          program_platform_account_id: order.providerScope!.platformAccountId, program_livemode: "false" },
        livemode: false,
        providerScope: order.providerScope,
      })),
      listInvoices: vi.fn(async () => ({ data: [draftInvoice], hasMore: false })),
      hasPendingInvoiceItems: vi.fn(async () => false),
      listSubscriptions: vi.fn(async () => ({ data: [], hasMore: false })),
      listSubscriptionSchedules: vi.fn(async () => ({ data: [], hasMore: false })),
      listPaymentIntents: vi.fn(async () => ({ data: [priorIntent], hasMore: false })),
      retrieveInvoice: vi.fn(async () => draftInvoice),
      listInvoiceLines: vi.fn(async () => ({ data: [invoiceLine], hasMore: false })),
      listInvoicePayments: vi.fn(async () => ({ data: [{ id: "inpay_extra" }], hasMore: false })),
      deleteDraftInvoice: vi.fn(),
    } as unknown as ProgramInvoiceProvider;
    const store = {
      getDraftInvoiceDelete: vi.fn(async () => null),
      prepareDraftInvoiceDelete: vi.fn(),
      markDraftInvoiceDeleteUnknown: vi.fn(),
      reconcileDraftInvoiceDelete: vi.fn(),
    };

    const result = await deleteDraftProgramInvoiceForCancellation({
      store,
      provider,
      intent: {
        order: cancelOrder,
        installmentNumber: 2,
        checkoutAttemptNumber: 1,
        expectedRevision: 7,
        invoiceId: draftInvoice.id,
        invoiceItemId: "ii_draft",
        knownPaymentIntentIds: [priorIntent.id],
      },
    });

    expect(result).toMatchObject({ status: "blocked", reason: "draft_invoice_payment_inventory_mismatch" });
    expect(store.prepareDraftInvoiceDelete).not.toHaveBeenCalled();
    expect(provider.deleteDraftInvoice).not.toHaveBeenCalled();
  });
});

const checkoutOrder: ProgramBillingOrder = {
  ...order,
  clearedInstallments: 0,
  promotionReservationState: "reserved",
  firstSettledAt: null,
  nextAnchorDate: null,
  retryDeadline: null,
  currentAttemptNumber: 1,
  consent: {
    ...order.consent!,
    acceptedAt: "2026-01-10T12:00:00.000Z",
    disclosedChargeDates: ["2026-02-10", "2026-03-10"],
  },
};

function checkoutSession(input: {
  id: string;
  attemptId: string;
  attemptNumber: number;
  paymentIntentId: string | null;
  status: string;
  paymentStatus: string;
}): import("./program-billing").ProgramCheckoutSession {
  return {
    id: input.id,
    url: input.status === "open" ? `https://checkout.example/${input.id}` : null,
    customerId: checkoutOrder.stripeCustomerId,
    clientReferenceId: input.attemptId,
    mode: "payment",
    status: input.status,
    paymentStatus: input.paymentStatus,
    amountTotal: checkoutOrder.installmentAmountsCents[0],
    currency: "usd",
    paymentIntentId: input.paymentIntentId,
    livemode: checkoutOrder.providerScope!.livemode,
    providerScope: checkoutOrder.providerScope ?? undefined,
    metadata: {
      program_billing_kind: "program_sale",
      program_order_id: checkoutOrder.orderId,
      program_checkout_attempt_id: input.attemptId,
      program_checkout_attempt_number: String(input.attemptNumber),
      program_platform_account_id: checkoutOrder.providerScope!.platformAccountId,
      program_livemode: String(checkoutOrder.providerScope!.livemode),
    },
  };
}

function checkoutIntent(input?: Partial<ProgramCheckoutAttemptIntent>): ProgramCheckoutAttemptIntent {
  const attemptId = input?.attempt?.attemptId ?? "00000000-0000-4000-8000-000000000003";
  return {
    order: checkoutOrder,
    attempt: {
      attemptNumber: 1,
      attemptId,
      checkoutSessionId: null,
      paymentIntentId: null,
      ...input?.attempt,
    },
    priorAttempts: [],
    expectedRevision: 4,
    idempotencyKey: "program:order:checkout_create:a1:i0:p0:v1",
    createRequestedAt: "2026-01-14T10:00:00.000Z",
    createOutcome: "not_started",
    successUrl: "https://example.test/program/success",
    cancelUrl: "https://example.test/program/cancel",
    retryProofDigest: null,
    retryRequestId: null,
    ...input,
  };
}

function checkoutPaymentIntent(input: {
  id: string;
  attemptId: string;
  attemptNumber: number;
  status: string;
}): import("./program-billing").ProgramPaymentIntent {
  const amount = checkoutOrder.installmentAmountsCents[0];
  return {
    id: input.id,
    customerId: checkoutOrder.stripeCustomerId,
    amount,
    amountReceived: input.status === "succeeded" ? amount : 0,
    currency: "usd",
    status: input.status,
    applicationFeeAmount: null,
    transferDestinationId: null,
    paymentMethodId: input.status === "succeeded" ? "pm_checkout" : null,
    latestChargeId: input.status === "succeeded" ? "ch_checkout" : null,
    livemode: checkoutOrder.providerScope!.livemode,
    providerScope: checkoutOrder.providerScope ?? undefined,
    metadata: {
      program_billing_kind: "program_sale",
      program_order_id: checkoutOrder.orderId,
      program_installment_number: "1",
      program_checkout_attempt_id: input.attemptId,
      program_checkout_attempt_number: String(input.attemptNumber),
      program_platform_account_id: checkoutOrder.providerScope!.platformAccountId,
      program_livemode: String(checkoutOrder.providerScope!.livemode),
    },
  };
}

function isolatedCheckoutProvider(input: {
  sessions?: import("./program-billing").ProgramCheckoutSession[];
  intents?: import("./program-billing").ProgramPaymentIntent[];
  unlistedIntent?: import("./program-billing").ProgramPaymentIntent;
  createSession?: (value: { order: ProgramBillingOrder; attemptId: string; attemptNumber: number; idempotencyKey: string }) => Promise<import("./program-billing").ProgramCheckoutSession>;
}) {
  const sessions = input.sessions ?? [];
  const intents = input.intents ?? [];
  const bySessionId = new Map(sessions.map((row) => [row.id, row]));
  return {
    getProviderScope: vi.fn(async () => checkoutOrder.providerScope!),
    retrieveCustomer: vi.fn(async () => ({
      id: checkoutOrder.stripeCustomerId,
      deleted: false,
      balance: 0,
      invoiceCreditBalance: {},
      discountId: null,
      taxExempt: "none",
      metadata: { program_order_id: checkoutOrder.orderId, program_billing_purpose: "program_order",
        program_platform_account_id: checkoutOrder.providerScope!.platformAccountId, program_livemode: "false" },
      livemode: false,
      providerScope: checkoutOrder.providerScope!,
    })),
    hasPendingInvoiceItems: vi.fn(async () => false),
    listSubscriptions: vi.fn(async () => ({ data: [], hasMore: false })),
    listSubscriptionSchedules: vi.fn(async () => ({ data: [], hasMore: false })),
    listInvoices: vi.fn(async () => ({ data: [], hasMore: false })),
    listCheckoutSessions: vi.fn(async () => ({ data: [...sessions], hasMore: false })),
    listPaymentIntents: vi.fn(async () => ({ data: [...intents], hasMore: false })),
    retrieveCheckoutSession: vi.fn(async (id: string) => {
      const found = bySessionId.get(id);
      if (!found) throw new Error("unknown session");
      return found;
    }),
    retrievePaymentIntent: vi.fn(async (id: string) => {
      const found = intents.find((row) => row.id === id);
      if (found) return found;
      if (input.unlistedIntent?.id === id) return input.unlistedIntent;
      throw new Error("unknown PaymentIntent");
    }),
    retrievePaymentMethod: vi.fn(async (id: string) => ({ id, customerId: checkoutOrder.stripeCustomerId, type: "card" })),
    createCustomer: vi.fn(async () => { throw new Error("not used"); }),
    createCheckoutSession: vi.fn(async (value: { order: ProgramBillingOrder; attemptId: string; attemptNumber: number; idempotencyKey: string }) => {
      if (!input.createSession) throw new Error("createSession callback missing");
      const created = await input.createSession(value);
      bySessionId.set(created.id, created);
      return created;
    }),
  };
}

function checkoutStore(intent: ProgramCheckoutAttemptIntent, events: string[]) {
  return {
    prepareProgramCustomer: vi.fn(),
    bindProgramCustomer: vi.fn(),
    markProgramCustomerCreateUnknown: vi.fn(),
    recordProgramCustomerCreateUnknown: vi.fn(),
    recordProgramCustomerConflict: vi.fn(),
    prepareCheckoutAttempt: vi.fn(async () => intent),
    markCheckoutCreateUnknown: vi.fn(async () => { events.push("mark_unknown"); return true; }),
    bindCheckoutSession: vi.fn(async () => { events.push("bind_session"); return true; }),
    recordCheckoutObservation: vi.fn(async () => { events.push("observe_session"); }),
    recordCheckoutCreateUnknown: vi.fn(async () => undefined),
    recordCheckoutConflict: vi.fn(async () => undefined),
    prepareBuyerRetry: vi.fn(),
    advanceCheckoutAttempt: vi.fn(),
  };
}

describe("Program Checkout attempt reconciliation", () => {
  it("stores unknown intent before first Checkout call and binds the exact Session and PaymentIntent", async () => {
    const events: string[] = [];
    const attempt = checkoutIntent();
    const session = checkoutSession({
      id: "cs_program_1",
      attemptId: attempt.attempt.attemptId,
      attemptNumber: 1,
      paymentIntentId: "pi_program_1",
      status: "open",
      paymentStatus: "unpaid",
    });
    const provider = isolatedCheckoutProvider({
      unlistedIntent: checkoutPaymentIntent({
        id: "pi_program_1",
        attemptId: attempt.attempt.attemptId,
        attemptNumber: 1,
        status: "requires_payment_method",
      }),
      createSession: async () => {
        events.push("create_session");
        return session;
      },
    });
    const store = checkoutStore(attempt, events);
    const result = await createProgramCheckout({
      store: store as unknown as ProgramCheckoutStore,
      provider: provider as unknown as ProgramCheckoutProvider,
      orderId: checkoutOrder.orderId,
      expectedRevision: 4,
      successUrl: "https://example.test/program/success",
      cancelUrl: "https://example.test/program/cancel",
      today: "2026-01-14",
      now: "2026-01-14T12:00:00.000Z",
    });
    expect(result).toEqual({ status: "checkout_ready", checkoutUrl: session.url, attemptNumber: 1 });
    expect(events.indexOf("mark_unknown")).toBeLessThan(events.indexOf("create_session"));
    expect(store.bindCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: session.id,
      paymentIntentId: "pi_program_1",
      evidence: { session, paymentIntent: expect.objectContaining({ id: "pi_program_1" }) },
    }));
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: attempt.idempotencyKey,
      attemptId: attempt.attempt.attemptId,
      attemptNumber: 1,
    }));
  });

  it("retries a missing unknown Session only with the same idempotency key inside the 23-hour window", async () => {
    const events: string[] = [];
    const attempt = checkoutIntent({ createOutcome: "unknown" });
    const session = checkoutSession({
      id: "cs_program_retry_same_key",
      attemptId: attempt.attempt.attemptId,
      attemptNumber: 1,
      paymentIntentId: "pi_program_retry_same_key",
      status: "open",
      paymentStatus: "unpaid",
    });
    const provider = isolatedCheckoutProvider({
      unlistedIntent: checkoutPaymentIntent({
        id: "pi_program_retry_same_key",
        attemptId: attempt.attempt.attemptId,
        attemptNumber: 1,
        status: "requires_payment_method",
      }),
      createSession: async () => session,
    });
    const store = checkoutStore(attempt, events);
    const result = await createProgramCheckout({
      store: store as unknown as ProgramCheckoutStore,
      provider: provider as unknown as ProgramCheckoutProvider,
      orderId: checkoutOrder.orderId,
      expectedRevision: 4,
      successUrl: "https://example.test/program/success",
      cancelUrl: "https://example.test/program/cancel",
      today: "2026-01-14",
      now: "2026-01-14T12:00:00.000Z",
    });
    expect(result.status).toBe("checkout_ready");
    expect(provider.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: attempt.idempotencyKey }));
  });

  it("does not repeat an unknown creation after the safe provider idempotency window", async () => {
    const events: string[] = [];
    const attempt = checkoutIntent({ createOutcome: "unknown" });
    const provider = isolatedCheckoutProvider({
      createSession: async () => checkoutSession({
        id: "cs_should_not_exist",
        attemptId: attempt.attempt.attemptId,
        attemptNumber: 1,
        paymentIntentId: "pi_should_not_exist",
        status: "open",
        paymentStatus: "unpaid",
      }),
    });
    const result = await createProgramCheckout({
      store: checkoutStore(attempt, events) as unknown as ProgramCheckoutStore,
      provider: provider as unknown as ProgramCheckoutProvider,
      orderId: checkoutOrder.orderId,
      expectedRevision: 4,
      successUrl: "https://example.test/program/success",
      cancelUrl: "https://example.test/program/cancel",
      today: "2026-01-15",
      now: "2026-01-15T10:00:00.000Z",
    });
    expect(result).toEqual({ status: "unknown" });
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("retries the same order only after all earlier unpaid sessions and canceled PIs reconcile", async () => {
    const events: string[] = [];
    const priorAttempt = {
      attemptNumber: 1,
      attemptId: "00000000-0000-4000-8000-000000000003",
      checkoutSessionId: "cs_expired_1",
      paymentIntentId: "pi_canceled_1",
    };
    const priorSession = checkoutSession({
      id: priorAttempt.checkoutSessionId,
      attemptId: priorAttempt.attemptId,
      attemptNumber: 1,
      paymentIntentId: priorAttempt.paymentIntentId,
      status: "expired",
      paymentStatus: "unpaid",
    });
    const priorIntent = checkoutPaymentIntent({
      id: priorAttempt.paymentIntentId,
      attemptId: priorAttempt.attemptId,
      attemptNumber: 1,
      status: "canceled",
    });
    const secondAttemptId = "00000000-0000-4000-8000-000000000004";
    const secondSession = checkoutSession({
      id: "cs_open_2",
      attemptId: secondAttemptId,
      attemptNumber: 2,
      paymentIntentId: "pi_open_2",
      status: "open",
      paymentStatus: "unpaid",
    });
    const secondIntent = checkoutPaymentIntent({ id: "pi_open_2", attemptId: secondAttemptId, attemptNumber: 2, status: "requires_payment_method" });
    const provider = isolatedCheckoutProvider({
      sessions: [priorSession],
      intents: [priorIntent],
      createSession: async () => {
        events.push("create_second_session");
        return secondSession;
      },
    });
    const nextIntent: ProgramCheckoutAttemptIntent = {
      ...checkoutIntent({
        order: { ...checkoutOrder, currentAttemptNumber: 2 },
        attempt: { attemptNumber: 2, attemptId: secondAttemptId, checkoutSessionId: null, paymentIntentId: null },
        idempotencyKey: "program:order:checkout_create:a2:i0:p0:v1",
        createOutcome: "not_started",
        retryRequestId: "00000000-0000-4000-8000-000000000005",
        retryProofDigest: "b".repeat(64),
      }),
      priorAttempts: [priorAttempt],
    };
    const store = checkoutStore(nextIntent, events);
    store.prepareBuyerRetry.mockResolvedValue({ order: checkoutOrder, expectedRevision: 4, attempts: [priorAttempt] });
    store.advanceCheckoutAttempt.mockImplementation(async (input) => {
      expect(input.orderId).toBe(checkoutOrder.orderId);
      expect(input.proof.attempts).toHaveLength(1);
      return nextIntent;
    });
    provider.retrieveCheckoutSession.mockImplementation(async (id: string) => {
      if (id === secondSession.id) return secondSession;
      return priorSession;
    });
    provider.retrievePaymentIntent.mockImplementation(async (id: string) => id === secondIntent.id ? secondIntent : priorIntent);
    const result = await retryProgramCheckout({
      store: store as unknown as ProgramCheckoutStore,
      provider: provider as unknown as ProgramCheckoutProvider,
      orderId: checkoutOrder.orderId,
      expectedRevision: 4,
      explicitRequestId: "00000000-0000-4000-8000-000000000005",
      requestedAt: "2026-01-14T12:00:00.000Z",
      today: "2026-01-14",
      now: "2026-01-14T12:00:00.000Z",
    });
    expect(result).toEqual({ status: "checkout_ready", checkoutUrl: secondSession.url, attemptNumber: 2 });
    expect(store.advanceCheckoutAttempt).toHaveBeenCalledTimes(1);
    expect(provider.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      order: expect.objectContaining({ orderId: checkoutOrder.orderId }),
      attemptNumber: 2,
      attemptId: secondAttemptId,
    }));
  });

  it("does not open a new attempt when an expired prior PI actually succeeded", async () => {
    const priorAttempt = {
      attemptNumber: 1,
      attemptId: "00000000-0000-4000-8000-000000000003",
      checkoutSessionId: "cs_expired_late_success",
      paymentIntentId: "pi_late_success",
    };
    const staleSession = checkoutSession({
      id: priorAttempt.checkoutSessionId,
      attemptId: priorAttempt.attemptId,
      attemptNumber: 1,
      paymentIntentId: priorAttempt.paymentIntentId,
      status: "expired",
      paymentStatus: "unpaid",
    });
    const lateSuccess = checkoutPaymentIntent({ id: priorAttempt.paymentIntentId, attemptId: priorAttempt.attemptId, attemptNumber: 1, status: "succeeded" });
    const provider = isolatedCheckoutProvider({ sessions: [staleSession], intents: [lateSuccess] });
    const store = checkoutStore(checkoutIntent(), []);
    store.prepareBuyerRetry.mockResolvedValue({ order: checkoutOrder, expectedRevision: 4, attempts: [priorAttempt] });
    const result = await retryProgramCheckout({
      store: store as unknown as ProgramCheckoutStore,
      provider: provider as unknown as ProgramCheckoutProvider,
      orderId: checkoutOrder.orderId,
      expectedRevision: 4,
      explicitRequestId: "00000000-0000-4000-8000-000000000005",
      requestedAt: "2026-01-14T12:00:00.000Z",
      today: "2026-01-14",
      now: "2026-01-14T12:00:00.000Z",
    });
    expect(result).toEqual({ status: "unknown" });
    expect(store.advanceCheckoutAttempt).not.toHaveBeenCalled();
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("retries an expired unpaid Session whose exact provider state has no PaymentIntent", async () => {
    const priorAttempt = {
      attemptNumber: 1,
      attemptId: "00000000-0000-4000-8000-000000000003",
      checkoutSessionId: "cs_expired_without_pi",
      paymentIntentId: null,
    };
    const priorSession = checkoutSession({
      id: priorAttempt.checkoutSessionId,
      attemptId: priorAttempt.attemptId,
      attemptNumber: 1,
      paymentIntentId: null,
      status: "expired",
      paymentStatus: "unpaid",
    });
    const secondAttemptId = "00000000-0000-4000-8000-000000000004";
    const secondSession = checkoutSession({
      id: "cs_open_after_null_pi_retry",
      attemptId: secondAttemptId,
      attemptNumber: 2,
      paymentIntentId: "pi_open_after_null_pi_retry",
      status: "open",
      paymentStatus: "unpaid",
    });
    const secondIntent = checkoutPaymentIntent({
      id: "pi_open_after_null_pi_retry",
      attemptId: secondAttemptId,
      attemptNumber: 2,
      status: "requires_payment_method",
    });
    const provider = isolatedCheckoutProvider({
      sessions: [priorSession],
      intents: [],
      createSession: async () => secondSession,
    });
    const nextIntent: ProgramCheckoutAttemptIntent = {
      ...checkoutIntent({
        order: { ...checkoutOrder, currentAttemptNumber: 2 },
        attempt: { attemptNumber: 2, attemptId: secondAttemptId, checkoutSessionId: null, paymentIntentId: null },
        idempotencyKey: "program:order:checkout_create:a2:i0:p0:v1",
        createOutcome: "not_started",
        retryRequestId: "00000000-0000-4000-8000-000000000005",
        retryProofDigest: "b".repeat(64),
      }),
      priorAttempts: [priorAttempt],
    };
    const store = checkoutStore(nextIntent, []);
    store.prepareBuyerRetry.mockResolvedValue({ order: checkoutOrder, expectedRevision: 4, attempts: [priorAttempt] });
    store.advanceCheckoutAttempt.mockImplementation(async (input) => {
      expect(input.proof.paymentIntentIds).toEqual([]);
      expect(input.proof.attempts[0]).toMatchObject({
        paymentIntentId: null,
        paymentIntentStatus: null,
        amountReceivedCents: 0,
      });
      return nextIntent;
    });
    provider.retrieveCheckoutSession.mockImplementation(async (id: string) =>
      id === secondSession.id ? secondSession : priorSession,
    );
    provider.retrievePaymentIntent.mockImplementation(async (id: string) => {
      if (id === secondIntent.id) return secondIntent;
      throw new Error("the expired Session has no PaymentIntent");
    });

    const result = await retryProgramCheckout({
      store: store as unknown as ProgramCheckoutStore,
      provider: provider as unknown as ProgramCheckoutProvider,
      orderId: checkoutOrder.orderId,
      expectedRevision: 4,
      explicitRequestId: "00000000-0000-4000-8000-000000000005",
      requestedAt: "2026-01-14T12:00:00.000Z",
      today: "2026-01-14",
      now: "2026-01-14T12:00:00.000Z",
    });

    expect(result).toEqual({ status: "checkout_ready", checkoutUrl: secondSession.url, attemptNumber: 2 });
    expect(provider.retrievePaymentIntent).toHaveBeenCalledTimes(1);
    expect(provider.retrievePaymentIntent).toHaveBeenCalledWith(secondIntent.id);
    expect(store.advanceCheckoutAttempt).toHaveBeenCalledTimes(1);
  });
});
