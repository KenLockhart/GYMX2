"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ProgramPurchaseHistoryItem } from "@/lib/program-purchase-history-contracts";
import {
  canRequestProgramPurchaseCancellation,
  parseProgramPurchaseCancellationStorage,
  programPurchaseCancellationStorageKey,
  serializeProgramPurchaseCancellationStorage,
  type ProgramPurchaseCancellationStorage,
} from "@/lib/program-purchase-history-ui";
import {
  refreshProgramPurchaseCancellationStatusAction,
  requestProgramPurchaseCancellationAction,
} from "@/app/(app)/program-purchases/actions";

type Props = {
  accountId: string;
  item: ProgramPurchaseHistoryItem;
};

type StorageState = "loading" | "ready" | "unavailable" | "invalid";
const STORAGE_CHANGE_EVENT = "program-purchase-cancellation-storage-change";

function getStorageSnapshot(storageKey: string): string {
  try {
    const value = window.sessionStorage.getItem(storageKey);
    return value === null ? "ready" : `saved:${value}`;
  } catch {
    return "unavailable";
  }
}

function subscribeToStorage(notify: () => void): () => void {
  window.addEventListener(STORAGE_CHANGE_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(STORAGE_CHANGE_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
}

function announceStorageChange() {
  window.dispatchEvent(new Event(STORAGE_CHANGE_EVENT));
}

function messageForActionStatus(status: string): string {
  switch (status) {
    case "cancellation_requested":
      return "Your request was submitted. The saved purchase status will show when cancellation processing is complete.";
    case "already_requested":
      return "This same request was already recorded. Refresh the saved purchase status to see its progress.";
    case "already_closed":
      return "This purchase is closed to new cancellation requests. Refresh its saved status to see the latest result.";
    case "not_found":
      return "This purchase could not be verified. No cancellation status was changed.";
    case "billing_history_only":
      return "This saved purchase has no active billing record to cancel.";
    case "account_fenced":
      return "This account is temporarily unable to submit a cancellation request. Refresh the saved status before retrying.";
    default:
      return "We could not confirm whether your request was received. Refresh the saved status before trying again.";
  }
}

export function ProgramPurchaseCancellationForm({ accountId, item }: Props) {
  return <ProgramPurchaseCancellationFormInstance key={`${accountId}:${item.orderId}:${JSON.stringify(item)}`} accountId={accountId} item={item} />;
}

function ProgramPurchaseCancellationFormInstance({ accountId, item }: Props) {
  const router = useRouter();
  const storageKey = programPurchaseCancellationStorageKey(accountId, item.orderId);
  const requestFence = useRef(0);
  const requestLock = useRef(false);
  const refreshLock = useRef(false);
  const storageSnapshot = useSyncExternalStore(
    subscribeToStorage,
    () => getStorageSnapshot(storageKey),
    () => "loading",
  );
  const [refreshResult, setRefreshResult] = useState<{
    accountId: string;
    orderId: string;
    baseline: string;
    item: ProgramPurchaseHistoryItem;
  } | null>(null);
  const [consented, setConsented] = useState(false);
  const [canRetrySavedRequest, setCanRetrySavedRequest] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isRequestPending, startRequest] = useTransition();
  const [isRefreshPending, startRefresh] = useTransition();
  const parsedStorage = storageSnapshot.startsWith("saved:")
    ? parseProgramPurchaseCancellationStorage(storageSnapshot.slice("saved:".length), accountId, item.orderId)
    : null;
  const storageState: StorageState = storageSnapshot === "loading"
    ? "loading"
    : storageSnapshot === "unavailable"
      ? "unavailable"
      : parsedStorage?.status === "invalid"
        ? "invalid"
        : "ready";
  const intent: ProgramPurchaseCancellationStorage | null = parsedStorage?.status === "valid"
    ? parsedStorage.value
    : null;
  const storageMessage = storageState === "invalid"
    ? "A saved cancellation request could not be verified. Refresh the purchase status; no new request will be sent."
    : storageState === "unavailable"
      ? "This browser cannot read a saved cancellation request, so a new request is disabled."
      : intent
        ? "A cancellation request may already have been sent. Refresh the saved purchase status before retrying."
        : null;
  const currentItem = refreshResult?.accountId === accountId && refreshResult.orderId === item.orderId &&
      refreshResult.baseline === JSON.stringify(item)
    ? refreshResult.item
    : item;
  const canRequestCurrent = canRequestProgramPurchaseCancellation(currentItem);

  useEffect(() => {
    return () => { requestFence.current += 1; };
  }, []);

  if (!canRequestCurrent && intent === null) return null;

  const fence = requestFence.current;
  const isCurrent = () => requestFence.current === fence;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRequestCurrent || storageState !== "ready" || !consented || requestLock.current ||
        (intent !== null && !canRetrySavedRequest)) return;

    let savedIntent = intent;
    if (!savedIntent) {
      let requestId: string;
      try {
        requestId = window.crypto.randomUUID();
      } catch {
        setMessage("This browser cannot create a safe request identifier. No cancellation request was sent.");
        return;
      }
      savedIntent = { version: 1, accountId, orderId: currentItem.orderId, requestId };
      try {
        window.sessionStorage.setItem(storageKey, serializeProgramPurchaseCancellationStorage(savedIntent));
        announceStorageChange();
      } catch {
        setMessage("This browser cannot save the request safely, so no cancellation request was sent.");
        return;
      }
    }

    requestLock.current = true;
    setCanRetrySavedRequest(false);
    setMessage("Sending your cancellation request…");
    const actionOrderId = currentItem.orderId;
    const actionRequestId = savedIntent.requestId;

    startRequest(async () => {
      try {
        const result = await requestProgramPurchaseCancellationAction(actionOrderId, actionRequestId);
        if (!isCurrent()) return;
        setMessage(messageForActionStatus(result.status));
      } catch {
        if (!isCurrent()) return;
        setMessage("We could not confirm whether your request was received. Refresh the saved status before trying again.");
      } finally {
        if (isCurrent()) requestLock.current = false;
      }
    });
  }

  function refreshSavedStatus() {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setCanRetrySavedRequest(false);
    startRefresh(async () => {
      try {
        const result = await refreshProgramPurchaseCancellationStatusAction(currentItem.orderId);
        if (!isCurrent()) return;
        if (result.status !== "found") {
          setMessage(result.status === "not_found"
            ? "The purchase is no longer in your saved history. No new request was sent."
            : "We could not refresh the saved status. No new request was sent.");
          return;
        }

        setRefreshResult({ accountId, orderId: currentItem.orderId, baseline: JSON.stringify(item), item: result.item });
        if (result.item.cancellationStage === "requested" || result.item.cancellationStage === "completed") {
          try {
            window.sessionStorage.removeItem(storageKey);
            announceStorageChange();
          } catch {
            // The authoritative saved status remains usable when local cleanup is denied.
          }
          setMessage(result.item.cancellationStage === "completed"
            ? "The refreshed saved status shows cancellation is complete."
            : "The refreshed saved status shows cancellation was requested; processing is not yet complete.");
          router.refresh();
          return;
        }
        if (!canRequestProgramPurchaseCancellation(result.item)) {
          setMessage("The refreshed saved status is not clear enough to retry. This request identifier has been retained; refresh again before retrying.");
          router.refresh();
          return;
        }

        if (intent) {
          setConsented(false);
          setCanRetrySavedRequest(true);
          setMessage("The refreshed saved status shows no cancellation request. If you retry, this browser will reuse the same request identifier.");
        } else {
          setCanRetrySavedRequest(false);
          setMessage("The refreshed saved history still shows future charges. This browser cannot safely save a cancellation request, so no new request is enabled.");
        }
      } catch {
        if (isCurrent()) setMessage("We could not refresh the saved status. No new request was sent.");
      } finally {
        if (isCurrent()) refreshLock.current = false;
      }
    });
  }

  return (
    <section className="rounded-2xl border border-amber-200/20 bg-slate-950/60 p-5 sm:p-6" aria-labelledby="cancel-future-charges-title">
      <h2 id="cancel-future-charges-title" className="text-xl font-semibold text-white">Stop future charges</h2>
      <p className="mt-2 text-sm leading-6 text-slate-300">
        A cancellation request stops future scheduled charges when processing is complete. A payment already in flight may still finish. Previously paid stages remain available subject to normal access rules. A cancellation request does not automatically refund prior payments; refund requests follow the existing policy.
      </p>

      {message ?? storageMessage ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-sm leading-6 text-slate-200" role="status">
          {message ?? storageMessage}
        </p>
      ) : null}

      {storageState === "loading" ? (
        <p className="mt-4 text-sm text-slate-400" role="status">Checking for a saved cancellation request…</p>
      ) : null}

      {storageState === "unavailable" || storageState === "invalid" ? (
        <p className="mt-4 text-sm font-medium text-amber-100">
          Cancellation requests are disabled until this browser can safely verify its saved request.
        </p>
      ) : null}

      {(intent && storageState === "ready") || storageState === "invalid" || storageState === "unavailable" ? (
        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={refreshSavedStatus}
            disabled={isRefreshPending || isRequestPending}
            className="inline-flex min-h-11 items-center rounded-xl border border-white/20 px-4 text-sm font-semibold text-white transition hover:border-lime-300/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
          >
            {isRefreshPending ? "Refreshing saved status…" : "Refresh saved status"}
          </button>
        </div>
      ) : null}

      {storageState === "ready" && canRequestCurrent && (!intent || canRetrySavedRequest) ? (
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-slate-200">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.currentTarget.checked)}
              className="mt-1 size-4 shrink-0 accent-lime-300"
            />
            <span>
              I understand this requests cancellation of future charges. A payment in flight may still finish. Previously paid stages remain available subject to normal access rules. This request does not automatically refund prior payments; refund requests follow the existing policy.
            </span>
          </label>
          <button
            type="submit"
            disabled={!consented || isRequestPending || isRefreshPending}
            className="inline-flex min-h-11 items-center rounded-xl bg-lime-300 px-5 text-sm font-bold text-slate-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
          >
            {isRequestPending
              ? "Submitting request…"
              : intent ? "Retry the same request" : "Request cancellation"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
