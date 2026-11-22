"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ProgramPurchaseConfirmCommand,
  ProgramPurchaseContext,
  ProgramPurchaseQuote,
} from "@/lib/program-purchase-contracts";
import type { ProgramPurchaseHistoryItem } from "@/lib/program-purchase-history-contracts";
import { isStrictStripeCheckoutUrl } from "@/lib/program-checkout-contracts";
import { normalizeProgramPromotionCode } from "@/lib/program-purchase-contracts";
import {
  canRetryProgramPurchaseCheckout,
  emptyProgramPurchaseUiStorage,
  formatProgramPurchaseCents,
  formatProgramPurchaseDate,
  makeProgramPurchaseConfirmCommand,
  parseProgramPurchaseUiStorage,
  programPurchaseCancellationLabel,
  programPurchaseCommandMatchesRequest,
  programPurchasePaymentLabel,
  programPurchaseUiStorageKey,
  serializeProgramPurchaseUiStorage,
  type ProgramPurchaseUiStorage,
} from "@/lib/program-purchase-ui-state";
import {
  confirmProgramPurchaseAction,
  discoverProgramPurchaseAction,
  quoteProgramPurchaseAction,
  recoverProgramPurchaseAction,
  retryProgramCheckoutAction,
  startProgramCheckoutAction,
} from "@/app/(app)/programs/[id]/purchase-actions";

type Props = {
  buyerId: string;
  programId: string;
  programTitle: string;
  purchaseEnabled: boolean;
  checkoutEnabled: boolean;
};

type OwnedPurchase = {
  orderId: string;
  context: ProgramPurchaseContext;
  history: ProgramPurchaseHistoryItem;
};

type PanelMode = "loading" | "empty" | "owned" | "retry_saved" | "blocked";

function isOwnedPurchase(value: unknown, buyerId: string, programId: string): value is {
  status: "found";
  orderId: string;
  context: ProgramPurchaseContext;
  history: ProgramPurchaseHistoryItem;
} {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  const context = result.context as ProgramPurchaseContext | undefined;
  const history = result.history as ProgramPurchaseHistoryItem | undefined;
  return result.status === "found" && typeof result.orderId === "string" &&
    context?.orderId === result.orderId && context.buyerId === buyerId && context.programId === programId &&
    history?.orderId === result.orderId && history.programId === programId;
}

function commandMatchesContext(command: ProgramPurchaseConfirmCommand, context: ProgramPurchaseContext): boolean {
  if (context.requestId !== command.requestId || context.programId !== command.programId ||
      context.offerVersionId !== command.offerVersionId || context.installmentCount !== command.installmentCount ||
      context.promotionCode !== command.promotionCode) return false;
  if (context.paymentPlan === "free") {
    return command.installmentCount === 0 && context.billingRevision === 0 && context.terms === null;
  }
  return context.terms !== null && context.billingRevision >= 1 && context.terms.digest === command.quoteDigest;
}

function safePurchaseError(reason: string): string {
  switch (reason) {
    case "promotion_unavailable": return "This code isn’t available for this Program.";
    case "installment_invalid": return "That payment plan is unavailable.";
    case "charge_below_minimum": return "The total is below the minimum for a paid purchase.";
    case "already_owned": return "We’re checking your existing purchase.";
    case "feature_disabled":
    case "checkout_disabled": return "Checkout is not available right now.";
    case "quote_changed": return "The price or schedule changed. Review the updated details before confirming.";
    case "consent_required":
    case "off_session_consent_required": return "Review and accept the payment details to continue.";
    default: return "We couldn’t complete that request. Your purchase details are being checked.";
  }
}

function safeCheckoutMessage(status: string): string {
  if (status === "paid_awaiting_ledger") return "We’re checking the payment. Access updates only after it is confirmed.";
  if (status === "expired_requires_explicit_retry") return "This checkout expired. You can choose to retry it.";
  return "We couldn’t confirm the checkout status. Refresh the purchase status before trying again.";
}

function isPaidContext(context: ProgramPurchaseContext): boolean {
  return context.paymentPlan !== "free" && context.terms !== null && context.billingRevision > 0;
}

function PurchaseSchedule({ quote }: { quote: ProgramPurchaseQuote }) {
  if (quote.paymentPlan === "free") {
    return <p className="text-sm text-muted">This offer has no charge.</p>;
  }
  if (quote.paymentPlan === "pay_in_full") {
    return <p className="text-sm text-muted">One payment of {formatProgramPurchaseCents(quote.effectiveTotalCents)} at checkout.</p>;
  }
  return (
    <div className="space-y-2 text-sm">
      <p>Fixed total, not a subscription. {formatProgramPurchaseCents(quote.installmentAmountsCents[0] ?? 0)} at checkout.</p>
      <ul className="list-disc space-y-1 pl-5">
        {quote.chargeDates.map((date, index) => (
          <li key={`${date}:${index}`}>
            {formatProgramPurchaseCents(quote.installmentAmountsCents[index + 1] ?? 0)} on {formatProgramPurchaseDate(date)}
          </li>
        ))}
      </ul>
      <p>If a payment fails, it can be retried for 7 days. Cancelling stops future charges; paid lessons remain available. Refunds follow the Program refund policy.</p>
    </div>
  );
}

export function ProgramPurchasePanel({
  buyerId,
  programId,
  programTitle,
  purchaseEnabled,
  checkoutEnabled,
}: Props) {
  const router = useRouter();
  const storageKey = programPurchaseUiStorageKey(buyerId, programId);
  const fence = useRef(0);
  const quoteSequence = useRef(0);
  const quoteLock = useRef(false);
  const quoteLockSequence = useRef<number | null>(null);
  const confirmLock = useRef(false);
  const checkoutLock = useRef(false);
  const storageRef = useRef<ProgramPurchaseUiStorage>(emptyProgramPurchaseUiStorage(buyerId, programId));

  const [mode, setMode] = useState<PanelMode>("loading");
  const [storageReady, setStorageReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [savedConfirmation, setSavedConfirmation] = useState<ProgramPurchaseConfirmCommand | null>(null);
  const [purchase, setPurchase] = useState<OwnedPurchase | null>(null);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
  const [promotionInput, setPromotionInput] = useState("");
  const [selectedInstallments, setSelectedInstallments] = useState(1);
  const [quote, setQuote] = useState<ProgramPurchaseQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState<string | null>(null);
  const [billingConsent, setBillingConsent] = useState(false);
  const [offSessionConsent, setOffSessionConsent] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutHref, setCheckoutHref] = useState<string | null>(null);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);

  const isCurrent = useCallback((requestFence: number): boolean => {
    return fence.current === requestFence;
  }, []);

  const writeStorage = useCallback((next: ProgramPurchaseUiStorage): boolean => {
    try {
      window.sessionStorage.setItem(storageKey, serializeProgramPurchaseUiStorage(next));
      storageRef.current = next;
      return true;
    } catch {
      setStorageAvailable(false);
      setPanelMessage("This browser cannot save a pending purchase safely. You can still review your purchase status.");
      return false;
    }
  }, [storageKey]);

  const updateStorage = useCallback((patch: Partial<Pick<ProgramPurchaseUiStorage, "confirmation" | "checkoutRetry">>): boolean => {
    return writeStorage({ ...storageRef.current, ...patch });
  }, [writeStorage]);

  const acceptOwnedPurchase = useCallback((value: unknown, requestFence: number, expectedOrderId?: string): boolean => {
    if (!isCurrent(requestFence) || !isOwnedPurchase(value, buyerId, programId) ||
        (expectedOrderId && value.orderId !== expectedOrderId)) return false;
    setPurchase({ orderId: value.orderId, context: value.context, history: value.history });
    setMode("owned");
    setSavedConfirmation(null);
    setCheckoutHref(null);
    return true;
  }, [buyerId, isCurrent, programId]);

  async function discover(requestFence: number): Promise<"empty" | "found" | "unavailable" | "invalid_response"> {
    try {
      const result = await discoverProgramPurchaseAction(programId);
      if (!isCurrent(requestFence)) return "unavailable";
      if (result.status === "empty") {
        return "empty";
      }
      if (result.status === "found") {
        if (!acceptOwnedPurchase(result, requestFence)) {
          setMode("blocked");
          setPanelMessage("We couldn’t verify the purchase details for this Program.");
          return "invalid_response";
        }
        return "found";
      }
      return result.status === "invalid_response" ? "invalid_response" : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  useEffect(() => {
    const requestFence = fence.current + 1;
    fence.current = requestFence;
    let active = true;
    const stillActive = () => active && isCurrent(requestFence);

    async function load() {
      let parsed = parseProgramPurchaseUiStorage(null, buyerId, programId);
      let storageReadable = true;
      try {
        parsed = parseProgramPurchaseUiStorage(window.sessionStorage.getItem(storageKey), buyerId, programId);
      } catch {
        storageReadable = false;
      }

      if (!stillActive()) return;
      setStorageReady(true);
      setStorageAvailable(storageReadable && parsed.status !== "invalid");
      if (parsed.status === "invalid" || !storageReadable) {
        setPanelMessage("This browser could not read a saved purchase request. Existing purchase status can still be checked.");
        const result = await discoverProgramPurchaseAction(programId).catch(() => ({ status: "unavailable" as const }));
        if (!stillActive()) return;
        if (result.status === "found" && acceptOwnedPurchase(result, requestFence)) return;
        if (result.status === "empty") setMode("empty");
        else setMode("blocked");
        return;
      }

      storageRef.current = parsed.value;
      if (parsed.value.confirmation) {
        const command = parsed.value.confirmation;
        setSavedConfirmation(command);
        const recovered = await recoverProgramPurchaseAction(command.requestId, programId).catch(() => ({ status: "unavailable" as const }));
        if (!stillActive()) return;
        if (recovered.status === "found") {
          const isSameRequest = recovered.request.buyerId === buyerId && recovered.request.programId === programId &&
            programPurchaseCommandMatchesRequest(command, recovered.request) &&
            commandMatchesContext(command, recovered.context) && acceptOwnedPurchase(recovered, requestFence);
          if (isSameRequest) {
            updateStorage({ confirmation: null });
            setPanelMessage(null);
            return;
          }
          setMode("blocked");
          setPanelMessage("We couldn’t verify the saved request. Refresh to check the purchase status.");
          return;
        }
        if (recovered.status === "not_found") {
          const existing = await discoverProgramPurchaseAction(programId).catch(() => ({ status: "unavailable" as const }));
          if (!stillActive()) return;
          if (existing.status === "found" && acceptOwnedPurchase(existing, requestFence)) {
            setPanelMessage("An existing purchase was found for this Program.");
            return;
          }
          if (existing.status === "empty") {
            setMode("retry_saved");
            setPanelMessage("The saved purchase was not found. You may retry the same request.");
            return;
          }
        } else {
          const existing = await discoverProgramPurchaseAction(programId).catch(() => ({ status: "unavailable" as const }));
          if (!stillActive()) return;
          if (existing.status === "found" && acceptOwnedPurchase(existing, requestFence)) return;
        }
        setMode("blocked");
        setPanelMessage("We couldn’t verify whether this purchase completed. Refresh and check again before retrying.");
        return;
      }

      if (parsed.value.checkoutRetry) {
        const existing = await discoverProgramPurchaseAction(programId).catch(() => ({ status: "unavailable" as const }));
        if (!stillActive()) return;
        if (existing.status === "found" && existing.orderId === parsed.value.checkoutRetry.orderId &&
            acceptOwnedPurchase(existing, requestFence, parsed.value.checkoutRetry.orderId)) return;
        setMode("blocked");
        setPanelMessage("We couldn’t verify the checkout retry. Refresh the purchase status before trying again.");
        return;
      }

      const existing = await discoverProgramPurchaseAction(programId).catch(() => ({ status: "unavailable" as const }));
      if (!stillActive()) return;
      if (existing.status === "found") {
        if (!acceptOwnedPurchase(existing, requestFence)) {
          setMode("blocked");
          setPanelMessage("We couldn’t verify the purchase details for this Program.");
        }
        return;
      }
      if (existing.status === "empty") {
        setMode("empty");
        return;
      }
      setMode("blocked");
      setPanelMessage("Purchase status is temporarily unavailable. Try refreshing this page.");
    }

    void load();
    return () => {
      active = false;
      if (fence.current === requestFence) fence.current += 1;
    };
  }, [acceptOwnedPurchase, buyerId, isCurrent, programId, storageKey, updateStorage]);

  const normalizedPromotion = normalizeProgramPromotionCode(promotionInput);
  const quoteMatchesSelection = Boolean(quote && normalizedPromotion !== undefined &&
    quote.programId === programId && quote.installmentCount === selectedInstallments &&
    quote.promotionCode === normalizedPromotion);

  async function requestQuote(installmentCount: number, promotionCode: string | null, probeCode = false) {
    if (quoteLock.current || !purchaseEnabled || mode !== "empty") return;
    quoteLock.current = true;
    const requestFence = fence.current;
    const sequence = ++quoteSequence.current;
    quoteLockSequence.current = sequence;
    setQuoteBusy(true);
    setQuoteMessage(null);
    setBillingConsent(false);
    setOffSessionConsent(false);
    setQuote(null);
    try {
      let result = await quoteProgramPurchaseAction(programId, installmentCount, promotionCode);
      if (!isCurrent(requestFence) || sequence !== quoteSequence.current) return;
      if (result.ok === false && result.reason === "installment_invalid" && probeCode && promotionCode !== null) {
        result = await quoteProgramPurchaseAction(programId, 1, promotionCode);
      }
      if (!isCurrent(requestFence) || sequence !== quoteSequence.current) return;
      if (result.ok) {
        setQuote(result.quote);
        setSelectedInstallments(result.quote.installmentCount);
        return;
      }
      setQuoteMessage(safePurchaseError(result.reason));
      if (result.reason === "already_owned") {
        const discovered = await discover(requestFence);
        if (discovered === "empty") setQuoteMessage("An existing purchase was not available to read. Try refreshing before continuing.");
      }
    } catch {
      if (isCurrent(requestFence) && sequence === quoteSequence.current) {
        setQuoteMessage("We couldn’t get the current price. Please try again.");
      }
    } finally {
      if (isCurrent(requestFence) && sequence === quoteSequence.current) setQuoteBusy(false);
      if (quoteLockSequence.current === sequence) {
        quoteLockSequence.current = null;
        quoteLock.current = false;
      }
    }
  }

  async function applyPromotion() {
    if (normalizedPromotion === undefined) {
      setQuoteMessage("Enter a valid promotion code.");
      return;
    }
    if (normalizedPromotion === null) {
      await requestQuote(1, null);
      return;
    }
    await requestQuote(0, normalizedPromotion, true);
  }

  function updatePromotion(value: string) {
    const invalidatedSequence = quoteSequence.current;
    quoteSequence.current += 1;
    if (quoteLockSequence.current === invalidatedSequence) {
      quoteLockSequence.current = null;
      quoteLock.current = false;
    }
    setPromotionInput(value);
    setQuote(null);
    setQuoteBusy(false);
    setQuoteMessage(null);
    setBillingConsent(false);
    setOffSessionConsent(false);
    setSelectedInstallments(1);
  }

  async function checkPriceWithoutPromotion() {
    updatePromotion("");
    await requestQuote(1, null);
  }

  function updateInstallmentCount(value: string) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > (quote?.maximumInstallments ?? 1)) return;
    setSelectedInstallments(count);
    setBillingConsent(false);
    setOffSessionConsent(false);
    setQuoteMessage(null);
  }

  function verifiedView(value: unknown, requestFence: number, expectedOrderId?: string): value is {
    status: "found";
    orderId: string;
    context: ProgramPurchaseContext;
    history: ProgramPurchaseHistoryItem;
  } {
    return isOwnedPurchase(value, buyerId, programId) && isCurrent(requestFence) &&
      (!expectedOrderId || value.orderId === expectedOrderId);
  }

  async function refreshOwned(orderId: string, requestFence: number): Promise<OwnedPurchase | null> {
    try {
      const result = await discoverProgramPurchaseAction(programId);
      if (!isCurrent(requestFence) || !verifiedView(result, requestFence, orderId)) return null;
      acceptOwnedPurchase(result, requestFence, orderId);
      return { orderId: result.orderId, context: result.context, history: result.history };
    } catch {
      return null;
    }
  }

  async function reconcileConfirmation(command: ProgramPurchaseConfirmCommand, requestFence: number) {
    const recovered = await recoverProgramPurchaseAction(command.requestId, programId).catch(() => ({ status: "unavailable" as const }));
    if (!isCurrent(requestFence)) return;
    if (recovered.status === "found") {
      const valid = recovered.request.buyerId === buyerId && recovered.request.programId === programId &&
        programPurchaseCommandMatchesRequest(command, recovered.request) &&
        commandMatchesContext(command, recovered.context) && verifiedView(recovered, requestFence);
      if (valid) {
        acceptOwnedPurchase(recovered, requestFence);
        updateStorage({ confirmation: null });
        setPanelMessage(null);
        setConfirmBusy(false);
        if (recovered.context.paymentPlan === "free") router.refresh();
        return;
      }
      setMode("blocked");
      setPanelMessage("We couldn’t verify the saved purchase. Refresh to check its status.");
      return;
    }

    if (recovered.status === "not_found") {
      const existing = await discoverProgramPurchaseAction(programId).catch(() => ({ status: "unavailable" as const }));
      if (!isCurrent(requestFence)) return;
      if (existing.status === "found") {
        if (acceptOwnedPurchase(existing, requestFence)) {
          setPanelMessage("An existing purchase was found for this Program.");
          return;
        }
      }
      if (existing.status === "empty") {
        setMode("retry_saved");
        setPanelMessage("This purchase was not found. Retry the same saved request to continue.");
      } else {
        setMode("blocked");
        setPanelMessage("We couldn’t verify whether a purchase exists. Refresh before trying again.");
      }
      return;
    }

    const existing = await discoverProgramPurchaseAction(programId).catch(() => ({ status: "unavailable" as const }));
    if (!isCurrent(requestFence)) return;
    if (existing.status === "found" && acceptOwnedPurchase(existing, requestFence)) {
      setPanelMessage("An existing purchase was found for this Program.");
      return;
    }
    setMode("blocked");
    setPanelMessage("We couldn’t verify whether this purchase completed. Refresh and check again before retrying.");
  }

  async function submitConfirmCommand(command: ProgramPurchaseConfirmCommand, requestFence: number) {
    if (confirmLock.current || !isCurrent(requestFence) || !purchaseEnabled ||
        (command.installmentCount > 0 && !checkoutEnabled)) return;
    confirmLock.current = true;
    setConfirmBusy(true);
    setMode("loading");
    setPanelMessage("Saving your purchase securely…");
    try {
      const result = await confirmProgramPurchaseAction(command, buyerId);
      if (!isCurrent(requestFence)) return;
      if (!result.ok && result.reason === "quote_changed") {
        const oldQuote = quote;
        updateStorage({ confirmation: null });
        setSavedConfirmation(null);
        setMode("empty");
        setPanelMessage("The price or schedule changed. Review the updated details before confirming.");
        setQuote(null);
        setBillingConsent(false);
        setOffSessionConsent(false);
        setConfirmBusy(false);
        if (oldQuote) await requestQuote(oldQuote.installmentCount, oldQuote.promotionCode, oldQuote.installmentCount === 0);
        return;
      }
      if (!result.ok && result.reason === "buyer_auth_required") {
        setMode("blocked");
        setPanelMessage("This purchase is linked to the signed-in account that started it. Sign in to that account to continue checking it.");
        setConfirmBusy(false);
        return;
      }
      await reconcileConfirmation(command, requestFence);
    } catch {
      if (isCurrent(requestFence)) await reconcileConfirmation(command, requestFence);
    } finally {
      confirmLock.current = false;
      if (isCurrent(requestFence)) setConfirmBusy(false);
    }
  }

  async function beginPurchase() {
    if (confirmLock.current || !quote || !quoteMatchesSelection || !storageReady || !storageAvailable ||
        !purchaseEnabled || mode !== "empty") return;
    if (quote.effectiveTotalCents > 0 && (!checkoutEnabled || !billingConsent ||
        (quote.offSessionConsent && !offSessionConsent))) return;

    const requestFence = fence.current;
    confirmLock.current = true;
    setConfirmBusy(true);
    setPanelMessage("Checking for an existing purchase…");
    try {
      const existing = await discoverProgramPurchaseAction(programId);
      if (!isCurrent(requestFence)) return;
      if (existing.status === "found") {
        if (acceptOwnedPurchase(existing, requestFence)) {
          setPanelMessage("An existing purchase was found for this Program.");
          return;
        }
        setMode("blocked");
        setPanelMessage("We couldn’t verify the existing purchase. Refresh before continuing.");
        return;
      }
      if (existing.status !== "empty") {
        setPanelMessage("Purchase status is unavailable. Refresh before continuing.");
        return;
      }

      const requestId = globalThis.crypto?.randomUUID?.();
      if (!requestId) {
        setPanelMessage("This browser cannot create a secure purchase request. Refresh and try again.");
        return;
      }
      const command = makeProgramPurchaseConfirmCommand({
        quote,
        requestId,
        billingConsent: quote.effectiveTotalCents > 0 ? billingConsent : false,
        offSessionConsent: quote.offSessionConsent ? offSessionConsent : false,
      });
      if (!command) {
        setPanelMessage("The purchase details need to be refreshed before continuing.");
        return;
      }
      if (!updateStorage({ confirmation: command })) return;
      setSavedConfirmation(command);
      confirmLock.current = false;
      await submitConfirmCommand(command, requestFence);
    } catch {
      if (isCurrent(requestFence)) setPanelMessage("Purchase status is unavailable. Refresh before continuing.");
    } finally {
      confirmLock.current = false;
      if (isCurrent(requestFence)) setConfirmBusy(false);
    }
  }

  async function retrySavedPurchase() {
    if (!savedConfirmation || confirmLock.current || !storageAvailable || !purchaseEnabled ||
        (savedConfirmation.installmentCount > 0 && !checkoutEnabled)) return;
    const requestFence = fence.current;
    confirmLock.current = true;
    setConfirmBusy(true);
    setMode("loading");
    setPanelMessage("Checking the saved purchase request…");
    try {
      const recovered = await recoverProgramPurchaseAction(savedConfirmation.requestId, programId);
      if (!isCurrent(requestFence)) return;
      if (recovered.status === "found") {
        const valid = recovered.request.buyerId === buyerId && programPurchaseCommandMatchesRequest(savedConfirmation, recovered.request) &&
          commandMatchesContext(savedConfirmation, recovered.context) && acceptOwnedPurchase(recovered, requestFence);
        if (valid) {
          updateStorage({ confirmation: null });
          setPanelMessage(null);
          if (recovered.context.paymentPlan === "free") router.refresh();
          return;
        }
        setMode("blocked");
        setPanelMessage("We couldn’t verify the saved purchase. Refresh to check its status.");
        return;
      }
      if (recovered.status !== "not_found") {
        setMode("blocked");
        setPanelMessage("The saved purchase status is unavailable. Refresh before retrying.");
        return;
      }
      const existing = await discoverProgramPurchaseAction(programId);
      if (!isCurrent(requestFence)) return;
      if (existing.status === "found") {
        if (acceptOwnedPurchase(existing, requestFence)) setPanelMessage("An existing purchase was found for this Program.");
        else setMode("blocked");
        return;
      }
      if (existing.status !== "empty") {
        setMode("blocked");
        setPanelMessage("Purchase status is unavailable. Refresh before retrying.");
        return;
      }
      confirmLock.current = false;
      await submitConfirmCommand(savedConfirmation, requestFence);
    } catch {
      if (isCurrent(requestFence)) {
        setMode("blocked");
        setPanelMessage("The saved purchase status is unavailable. Refresh before retrying.");
      }
    } finally {
      confirmLock.current = false;
      if (isCurrent(requestFence)) setConfirmBusy(false);
    }
  }

  async function refreshPurchaseStatus() {
    const requestFence = fence.current;
    setPanelMessage("Refreshing purchase status…");
    const status = await discover(requestFence);
    if (!isCurrent(requestFence)) return;
    if (status === "found") setPanelMessage(null);
    else if (status === "empty") {
      setMode("empty");
      setPurchase(null);
      setPanelMessage("No purchase is currently recorded for this Program.");
    } else setPanelMessage("Purchase status is temporarily unavailable. Try again later.");
  }

  async function handleCheckoutResult(result: Awaited<ReturnType<typeof startProgramCheckoutAction>> | Awaited<ReturnType<typeof retryProgramCheckoutAction>>, requestFence: number, orderId: string) {
    if (!isCurrent(requestFence)) return;
    if (result.status === "checkout_ready" && isStrictStripeCheckoutUrl(result.checkoutUrl)) {
      setCheckoutHref(result.checkoutUrl);
      setCheckoutMessage(null);
      if (storageRef.current.checkoutRetry?.orderId === orderId) updateStorage({ checkoutRetry: null });
      return;
    }
    setCheckoutHref(null);
    setCheckoutMessage(result.status === "blocked"
      ? "Checkout could not be started. Refresh purchase status before trying again."
      : safeCheckoutMessage(result.status));
    await refreshOwned(orderId, requestFence);
  }

  async function startCheckout() {
    if (!purchase || checkoutLock.current || !checkoutEnabled || !isPaidContext(purchase.context)) return;
    const requestFence = fence.current;
    checkoutLock.current = true;
    setCheckoutBusy(true);
    setCheckoutMessage("Checking the latest purchase status…");
    setCheckoutHref(null);
    try {
      const fresh = await refreshOwned(purchase.orderId, requestFence);
      if (!isCurrent(requestFence) || !fresh) {
        setCheckoutMessage("Purchase status is unavailable. No checkout was started.");
        return;
      }
      if (!isPaidContext(fresh.context) || fresh.context.canceled || fresh.context.cancellationRequested ||
          fresh.context.financialConflict || fresh.context.billingRevision < 1 || fresh.history.safetyStage !== "clear") {
        setCheckoutMessage("This purchase is not ready for checkout. Refresh its status later.");
        return;
      }
      const result = await startProgramCheckoutAction(fresh.orderId, fresh.context.billingRevision, buyerId);
      await handleCheckoutResult(result, requestFence, fresh.orderId);
    } catch {
      if (isCurrent(requestFence)) {
        setCheckoutMessage("Checkout status is uncertain. Refresh the purchase status before trying again.");
        await refreshOwned(purchase.orderId, requestFence);
      }
    } finally {
      checkoutLock.current = false;
      if (isCurrent(requestFence)) setCheckoutBusy(false);
    }
  }

  async function retryCheckout() {
    if (!purchase || checkoutLock.current || !checkoutEnabled || !storageAvailable ||
        !canRetryProgramPurchaseCheckout(purchase.history)) return;
    const requestFence = fence.current;
    checkoutLock.current = true;
    setCheckoutBusy(true);
    setCheckoutMessage("Checking the latest purchase status…");
    setCheckoutHref(null);
    try {
      const fresh = await refreshOwned(purchase.orderId, requestFence);
      if (!isCurrent(requestFence) || !fresh) {
        setCheckoutMessage("Purchase status is unavailable. No checkout retry was started.");
        return;
      }
      if (!canRetryProgramPurchaseCheckout(fresh.history) || fresh.context.canceled ||
          fresh.context.cancellationRequested || fresh.context.financialConflict || fresh.context.billingRevision < 1) {
        setCheckoutMessage("A checkout retry is not available for the current purchase status.");
        return;
      }
      const savedRetry = storageRef.current.checkoutRetry;
      const requestId = savedRetry?.orderId === fresh.orderId ? savedRetry.requestId : globalThis.crypto?.randomUUID?.();
      if (!requestId) {
        setCheckoutMessage("This browser cannot create a secure checkout retry. Refresh and try again.");
        return;
      }
      if (!updateStorage({ checkoutRetry: { orderId: fresh.orderId, requestId } })) return;
      const result = await retryProgramCheckoutAction(fresh.orderId, fresh.context.billingRevision, requestId, buyerId);
      await handleCheckoutResult(result, requestFence, fresh.orderId);
    } catch {
      if (isCurrent(requestFence)) {
        setCheckoutMessage("Checkout retry status is uncertain. Refresh the purchase status before trying again.");
        await refreshOwned(purchase.orderId, requestFence);
      }
    } finally {
      checkoutLock.current = false;
      if (isCurrent(requestFence)) setCheckoutBusy(false);
    }
  }

  const currentQuote = quoteMatchesSelection ? quote : null;
  const canRetrySavedConfirmation = Boolean(savedConfirmation && purchaseEnabled && storageAvailable &&
    (savedConfirmation.installmentCount === 0 || checkoutEnabled));
  const canSubmitPurchase = Boolean(currentQuote && purchaseEnabled && storageReady && storageAvailable &&
    !quoteBusy && !confirmBusy && (currentQuote.effectiveTotalCents === 0 ||
      (checkoutEnabled && billingConsent && (!currentQuote.offSessionConsent || offSessionConsent))));

  return (
    <section className="max-w-3xl space-y-4 rounded-lg border border-border bg-surface p-5" aria-labelledby="program-purchase-heading">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">Program</p>
        <h2 id="program-purchase-heading" className="mt-1 text-2xl">Purchase {programTitle}</h2>
      </div>

      {mode === "loading" && <p role="status" className="text-sm text-muted">Loading purchase information…</p>}
      {panelMessage && <p role="status" className="text-sm text-muted">{panelMessage}</p>}
      {!storageAvailable && mode !== "loading" && (
        <p className="rounded-lg border border-border p-3 text-sm text-muted">
          Saved purchase requests are unavailable in this browser. Existing purchase status can still be viewed.
        </p>
      )}

      {mode === "retry_saved" && savedConfirmation && (
        <>
          {!purchaseEnabled && <p className="text-sm text-muted">New purchases are not available right now. Your saved request can still be checked later.</p>}
          {purchaseEnabled && savedConfirmation.installmentCount > 0 && !checkoutEnabled && (
            <p className="text-sm text-muted">Paid checkout is not available right now. Your saved request can be checked again later.</p>
          )}
          <button type="button" className="btn-primary" disabled={confirmBusy || !canRetrySavedConfirmation} onClick={() => void retrySavedPurchase()}>
            {confirmBusy ? "Checking saved request…" : "Retry saved purchase"}
          </button>
        </>
      )}

      {mode === "empty" && (
        <div className="space-y-4">
          {purchaseEnabled ? (
            <>
              <p className="text-sm text-muted">Check the current total and payment schedule before deciding to buy.</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block min-w-56 flex-1 space-y-1.5">
                  <span className="text-sm font-medium">Promotion code</span>
                  <input
                    value={promotionInput}
                    onChange={(event) => updatePromotion(event.currentTarget.value)}
                    maxLength={128}
                    autoComplete="off"
                    className="field-input"
                    aria-label="Promotion code"
                  />
                </label>
                <button type="button" className="btn-secondary" disabled={quoteBusy || confirmBusy} onClick={() => void applyPromotion()}>
                  {quoteBusy ? "Checking…" : promotionInput.trim() ? "Apply code" : "Check price"}
                </button>
                {promotionInput.trim() && (
                  <button type="button" className="text-sm text-muted underline" disabled={quoteBusy} onClick={() => void checkPriceWithoutPromotion()}>
                    Check price without code
                  </button>
                )}
              </div>
              {quoteMessage && <p role="status" className="text-sm text-muted">{quoteMessage}</p>}

              {quote && (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold">Total</span>
                    <span className="font-semibold">{formatProgramPurchaseCents(quote.effectiveTotalCents)}</span>
                  </div>
                  {quote.discountCents > 0 && (
                    <div className="flex justify-between gap-2 text-sm text-muted">
                      <span>Discount</span><span>−{formatProgramPurchaseCents(quote.discountCents)}</span>
                    </div>
                  )}
                  <PurchaseSchedule quote={quote} />
                  {quote.paymentPlan !== "free" && quote.maximumInstallments > 1 && (
                    <label className="block max-w-sm space-y-1.5">
                      <span className="text-sm font-medium">Number of payments</span>
                      <select className="field-input" value={selectedInstallments} onChange={(event) => updateInstallmentCount(event.currentTarget.value)}>
                        {Array.from({ length: quote.maximumInstallments }, (_, index) => index + 1).map((count) => (
                          <option value={count} key={count}>{count === 1 ? "Pay in full" : `${count} payments`}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!quoteMatchesSelection && quote.paymentPlan !== "free" && (
                    <>
                      <p className="text-sm text-muted">Your selected plan changed. Recheck the total and dates before confirming.</p>
                      <button type="button" className="btn-secondary" disabled={quoteBusy} onClick={() => void requestQuote(selectedInstallments, normalizedPromotion ?? null)}>
                        {quoteBusy ? "Checking…" : "Update payment plan"}
                      </button>
                    </>
                  )}
                  {quoteMatchesSelection && quote.effectiveTotalCents > 0 && (
                    <div className="space-y-3 border-t border-border pt-3">
                      <p className="text-sm text-muted">Paid lessons unlock as payments clear. Full access is available when the plan is paid in full.</p>
                      <label className="flex items-start gap-3 text-sm">
                        <input type="checkbox" className="mt-0.5 size-4 accent-accent" checked={billingConsent} onChange={(event) => setBillingConsent(event.currentTarget.checked)} />
                        <span>I agree to the fixed total and payment schedule shown above.</span>
                      </label>
                      {quote.offSessionConsent && (
                        <label className="flex items-start gap-3 text-sm">
                          <input type="checkbox" className="mt-0.5 size-4 accent-accent" checked={offSessionConsent} onChange={(event) => setOffSessionConsent(event.currentTarget.checked)} />
                          <span>I agree to save my payment method for the future charges listed above.</span>
                        </label>
                      )}
                      {!checkoutEnabled && <p className="text-sm text-muted">Paid checkout is not available right now.</p>}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!canSubmitPurchase}
                    onClick={() => void beginPurchase()}
                  >
                    {confirmBusy ? "Saving…" : quote.effectiveTotalCents === 0 ? "Claim free access" : "Confirm purchase"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">Purchases are not available right now.</p>
          )}
        </div>
      )}

      {mode === "owned" && purchase && (
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-border p-4">
            <p className="font-semibold">{programPurchasePaymentLabel(purchase.history)}</p>
            {programPurchaseCancellationLabel(purchase.history) && (
              <p className="text-sm text-muted">{programPurchaseCancellationLabel(purchase.history)}</p>
            )}
            <p className="text-sm">Total: {formatProgramPurchaseCents(purchase.context.effectiveTotalCents)}</p>
            {purchase.context.terms?.chargeDates.map((date, index) => (
              <p className="text-sm text-muted" key={`${date}:${index}`}>
                Scheduled charge: {formatProgramPurchaseDate(date)}
              </p>
            ))}
            {purchase.history.nextDueDate && (
              <p className="text-sm text-muted">Next scheduled charge: {formatProgramPurchaseDate(purchase.history.nextDueDate)}</p>
            )}
            {purchase.history.retryDeadline && (
              <p className="text-sm text-muted">Payment retry window ends {formatProgramPurchaseDate(purchase.history.retryDeadline.slice(0, 10))}</p>
            )}
            {purchase.context.paymentPlan === "free" && (
              <p className="text-sm text-muted">Your access is checked from your Program progress.</p>
            )}
            {isPaidContext(purchase.context) && (
              <p className="text-sm text-muted">Paid lessons unlock as payments clear. Cancelling stops future charges; paid lessons remain available. Refunds follow the Program refund policy.</p>
            )}
          </div>

          {checkoutHref && (
            <a className="btn-primary inline-flex" href={checkoutHref} rel="noopener noreferrer">
              Open secure checkout
            </a>
          )}
          {checkoutMessage && <p role="status" className="text-sm text-muted">{checkoutMessage}</p>}
          {isPaidContext(purchase.context) && !checkoutHref && (
            <div className="flex flex-wrap gap-3">
              {purchase.history.checkoutRetryHint ? (
                <button type="button" className="btn-primary" disabled={!checkoutEnabled || !storageAvailable || checkoutBusy} onClick={() => void retryCheckout()}>
                  {checkoutBusy ? "Checking…" : "Retry checkout"}
                </button>
              ) : ["checkout_required", "checkout_pending", "checkout_open", "payment_pending"].includes(purchase.history.paymentStage) && purchase.history.safetyStage === "clear" && purchase.history.cancellationStage === "none" ? (
                <button type="button" className="btn-primary" disabled={!checkoutEnabled || checkoutBusy} onClick={() => void startCheckout()}>
                  {checkoutBusy ? "Checking…" : purchase.history.paymentStage === "payment_pending" ? "Check checkout status" : "Continue to checkout"}
                </button>
              ) : null}
              {!checkoutEnabled && purchase.history.paymentStage !== "settled" && (
                <p className="self-center text-sm text-muted">Checkout is not available right now.</p>
              )}
            </div>
          )}
          <button type="button" className="text-sm text-muted underline" disabled={checkoutBusy} onClick={() => void refreshPurchaseStatus()}>
            Refresh purchase status
          </button>
        </div>
      )}
    </section>
  );
}
