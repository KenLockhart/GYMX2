export type LegacyPhysicalPayment = {
  sessionId: string;
  paymentIntentId: string | null;
  amountCents: number | null;
  currency: string | null;
  paymentStatus: string | null;
  checkoutIntentId: string | null;
};

export type LegacyResolutionRpc = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown | null }>;
};

export type LegacyPhysicalResolution = "not_applicable" | "not_cutover" | "recorded" | "failed";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_PATTERN = /^cs_[A-Za-z0-9_]{8,240}$/;
const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]{8,240}$/;

/**
 * Once physical manual sales are cut over, a signed late-paid legacy session must be durably
 * held for admin resolution instead of entering the ordinary purchases/to_ship path.
 */
export async function recordLegacyPhysicalPaidResolution(
  admin: LegacyResolutionRpc,
  input: LegacyPhysicalPayment,
): Promise<LegacyPhysicalResolution> {
  if (input.paymentStatus !== "paid") return "not_applicable";

  const cutover = await admin.rpc("is_printful_apparel_auto_only");
  if (cutover.error || typeof cutover.data !== "boolean") return "failed";
  if (!cutover.data) return "not_cutover";

  if (
    !SESSION_PATTERN.test(input.sessionId) ||
    !Number.isSafeInteger(input.amountCents) ||
    (input.amountCents ?? 0) < 1 ||
    input.currency?.toLowerCase() !== "usd" ||
    (input.paymentIntentId !== null && !PAYMENT_INTENT_PATTERN.test(input.paymentIntentId)) ||
    (input.checkoutIntentId !== null && !UUID_PATTERN.test(input.checkoutIntentId))
  ) {
    return "failed";
  }

  const { error } = await admin.rpc("record_printful_apparel_legacy_paid_resolution", {
    target_checkout_intent_id: input.checkoutIntentId,
    target_session_id: input.sessionId,
    target_payment_intent_id: input.paymentIntentId,
    target_amount_cents: input.amountCents,
    target_currency: input.currency.toLowerCase(),
    target_reason_code: input.checkoutIntentId
      ? "physical_paid_after_auto_only_cutover"
      : "legacy_physical_without_intent",
  });
  return error ? "failed" : "recorded";
}
