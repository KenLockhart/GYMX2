"use client";

import { useActionState, useEffect, useState, startTransition } from "react";
import { useT } from "@/i18n/client";
import {
  grantFeatureComp,
  revokeFeatureComp,
  searchFeatureCompRecipients,
  saveFeaturePricingRevision,
  type FeaturePricingActionState,
  type FeaturePricingRecipient,
} from "@/app/(app)/admin/monetization/feature-pricing/actions";
import type { Messages } from "@/i18n/messages";
import type {
  PricingAdminDashboard,
  PricingCandidate,
  PricingRevisionSummary,
} from "@/lib/form-coach/pricing-admin-server";

export function pricingOperationStorageKey(adminId: string, operation: "pricing" | "comp"): string {
  return `form-coach-${operation}-operation:v1:${adminId}`;
}

export function discardAdminPricingRetry(adminId: string, remove: (key: string) => void): void {
  remove(pricingOperationStorageKey(adminId, "pricing"));
}

export function usdInputToCents(value: string): number | null {
  const match = /^(\d{1,8})(?:[.,](\d{0,2}))?$/.exec(value.trim());
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) && total >= 1 && total <= 2_147_483_647 ? total : null;
}

export function centsToUsdInput(cents: number, decimalSeparator = "."): string {
  return Number.isSafeInteger(cents) && cents >= 0 ? (cents / 100).toFixed(2).replace(".", decimalSeparator) : "";
}

export function generatedPriceKey(
  billingModel: "subscription" | "per_assessment",
  existingOptions: readonly CandidateDraft["price_options"][number][],
  packCredits = 3,
): string {
  const base = billingModel === "subscription" ? "subscription" : `pack_${packCredits}`;
  const existing = new Set(existingOptions.map((option) => option.price_key));
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

type Copy = Messages["featurePricing"];
type CandidateDraft = PricingCandidate;
type PendingCandidate = {
  requestId: string;
  expectedRevision: number;
  candidate: CandidateDraft;
};
type CompDraft = { userId: string; startsAt: string; expiresAt: string; reason: string };
type PendingComp = {
  requestId: string;
  userId: string;
  startsAt: string;
  expiresAt: string | null;
  reason: string;
  recipient: Omit<FeaturePricingRecipient, "id">;
};

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function utcLocalInputToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "0"] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const timestamp = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(timestamp)
    || parsed.getUTCFullYear() !== parts[0]
    || parsed.getUTCMonth() !== parts[1] - 1
    || parsed.getUTCDate() !== parts[2]
    || parsed.getUTCHours() !== parts[3]
    || parsed.getUTCMinutes() !== parts[4]
    || parsed.getUTCSeconds() !== parts[5]) return null;
  return parsed.toISOString();
}

export function isoToUtcLocalInput(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 16) : "";
}

function readPendingOperation(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readAdminPendingOperations(
  adminId: string,
  read: (key: string) => string | null,
): { pricing: string | null; comp: string | null } {
  return {
    pricing: read(pricingOperationStorageKey(adminId, "pricing")),
    comp: read(pricingOperationStorageKey(adminId, "comp")),
  };
}

function storePendingOperation(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // The server still validates every retry; storage only preserves its idempotency inputs.
  }
}

function toCandidate(revision: PricingRevisionSummary | null): CandidateDraft {
  if (!revision) {
    return {
      status: "pricing_pending",
      payer: "coach",
      currency: "USD",
      display_name: "Form Coach",
      description: "",
      marketing_copy: "",
      trial_days: 0,
      trial_assessments: 0,
      billing_model: null,
      price_options: [],
    };
  }
  return {
    status: revision.status,
    payer: revision.payer,
    currency: revision.currency,
    display_name: revision.displayName,
    description: revision.description,
    marketing_copy: revision.marketingCopy,
    trial_days: revision.trialDays,
    trial_assessments: revision.trialAssessments,
    billing_model: revision.billingModel,
    price_options: revision.priceOptions.map((option) => ({
      price_key: option.priceKey,
      amount_cents: option.amountCents,
      currency: option.currency,
      interval: option.interval,
      credits_per_pack: option.creditsPerPack,
    })),
  };
}

function isPendingCandidate(value: unknown): value is PendingCandidate {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const candidate = row.candidate && typeof row.candidate === "object"
    ? row.candidate as Record<string, unknown>
    : null;
  return typeof row.requestId === "string"
    && /^[0-9a-f-]{36}$/i.test(row.requestId)
    && typeof row.expectedRevision === "number"
    && Number.isSafeInteger(row.expectedRevision)
    && candidate !== null
    && ["disabled", "pricing_pending", "live"].includes(String(candidate.status))
    && ["coach", "member"].includes(String(candidate.payer))
    && Array.isArray(candidate.price_options)
    && typeof candidate.currency === "string"
    && typeof candidate.display_name === "string"
    && typeof candidate.description === "string"
    && typeof candidate.marketing_copy === "string"
    && typeof candidate.trial_days === "number"
    && typeof candidate.trial_assessments === "number";
}

function isPendingComp(value: unknown): value is PendingComp {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.requestId === "string"
    && /^[0-9a-f-]{36}$/i.test(row.requestId)
    && typeof row.userId === "string"
    && typeof row.startsAt === "string"
    && (row.expiresAt === null || typeof row.expiresAt === "string")
    && typeof row.reason === "string"
    && row.recipient !== null
    && typeof row.recipient === "object";
}

function resultText(state: FeaturePricingActionState, copy: Copy): string | null {
  const key = state.errorCode ?? state.status;
  return key && key in copy.result
    ? copy.result[key as keyof typeof copy.result]
    : null;
}

function formatDate(value: string): string {
  return value || "—";
}

function ActionFeedback({ state, copy }: { state: FeaturePricingActionState; copy: Copy }) {
  const text = resultText(state, copy);
  if (!text) return null;
  const failed = state.status === "error";
  return (
    <p role={failed ? "alert" : "status"} className={`text-sm ${failed ? "text-danger" : "text-success"}`}>
      {text}
    </p>
  );
}

function RevokeCompForm({ grantId, copy, disabled }: { grantId: string; copy: Copy; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(revokeFeatureComp, {});
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state.status === "revoked" ? (
        <span className="text-xs font-semibold text-muted">{copy.compRevoked}</span>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="grant_id" value={grantId} />
          <button className="btn-secondary min-h-9 px-3" type="submit" disabled={pending || disabled}>
            {pending ? copy.revoking : copy.revoke}
          </button>
        </form>
      )}
      <ActionFeedback state={state} copy={copy} />
    </div>
  );
}

export function AdminFeaturePricing({
  dashboard,
  adminId,
  initialRequestId,
  initialCompRequestId,
}: {
  dashboard: PricingAdminDashboard;
  adminId: string;
  initialRequestId: string;
  initialCompRequestId: string;
}) {
  const copy = useT().featurePricing;
  const pendingCandidateKey = pricingOperationStorageKey(adminId, "pricing");
  const pendingCompKey = pricingOperationStorageKey(adminId, "comp");
  const initialRevision = dashboard.current?.revision ?? 0;
  const [candidate, setCandidate] = useState<CandidateDraft>(() => toCandidate(dashboard.current));
  const [expectedRevision, setExpectedRevision] = useState(initialRevision);
  const [requestId, setRequestId] = useState(initialRequestId);
  const [pendingOperation, setPendingOperation] = useState<PendingCandidate | null>(null);
  const [restoredOperation, setRestoredOperation] = useState(false);
  const [priceAmountTexts, setPriceAmountTexts] = useState<Record<string, string>>({});
  const [saveState, saveAction, savePending] = useActionState(saveFeaturePricingRevision, {});
  const [compDraft, setCompDraft] = useState<CompDraft>({ userId: "", startsAt: "", expiresAt: "", reason: "" });
  const [selectedRecipient, setSelectedRecipient] = useState<FeaturePricingRecipient | null>(null);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [compRequestId, setCompRequestId] = useState(initialCompRequestId);
  const [restoredComp, setRestoredComp] = useState(false);
  const [compState, compAction, compPending] = useActionState(grantFeatureComp, {});
  const [recipientSearchState, recipientSearchAction, recipientSearchPending] = useActionState(searchFeatureCompRecipients, {});
  const [dirtySinceResult, setDirtySinceResult] = useState(false);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const scopedOperations = readAdminPendingOperations(adminId, readPendingOperation);
        const raw = scopedOperations.pricing;
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (isPendingCandidate(parsed)) {
          setPendingOperation(parsed);
          setCandidate(parsed.candidate);
          setExpectedRevision(parsed.expectedRevision);
          setRequestId(parsed.requestId);
          setRestoredOperation(true);
        }
        const compRaw = scopedOperations.comp;
        const parsedComp: unknown = compRaw ? JSON.parse(compRaw) : null;
        if (isPendingComp(parsedComp)) {
          setCompDraft({
            userId: parsedComp.userId,
            startsAt: isoToUtcLocalInput(parsedComp.startsAt),
            expiresAt: parsedComp.expiresAt ? isoToUtcLocalInput(parsedComp.expiresAt) : "",
            reason: parsedComp.reason,
          });
          setSelectedRecipient({ id: parsedComp.userId, ...parsedComp.recipient });
          setCompRequestId(parsedComp.requestId);
          setRestoredComp(true);
        }
      } catch {
        storePendingOperation(pendingCandidateKey, null);
        storePendingOperation(pendingCompKey, null);
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, [adminId, pendingCandidateKey, pendingCompKey]);

  useEffect(() => {
    if (saveState.status === "saved" || saveState.status === "already_applied") {
      storePendingOperation(pendingCandidateKey, null);
    }
  }, [pendingCandidateKey, saveState.status]);

  useEffect(() => {
    if (compState.status === "granted") {
      storePendingOperation(pendingCompKey, null);
    }
  }, [compState.status, pendingCompKey]);

  const canEdit = dashboard.current !== null && dashboard.current.currency === "USD" && dashboard.readErrors.length === 0;
  const canManageComps = dashboard.current !== null && dashboard.readErrors.length === 0;
  const hasInvalidAmount = candidate.price_options.some((option) => {
    const draft = priceAmountTexts[option.price_key];
    return draft !== undefined && usdInputToCents(draft) === null;
  });
  const statusNotice = candidate.status === "live"
    ? copy.liveNotice
    : candidate.status === "disabled"
      ? copy.disabledNotice
      : copy.pendingNotice;

  function editCandidate(next: Partial<CandidateDraft>) {
    setCandidate((previous) => ({ ...previous, ...next }));
    setRequestId(newRequestId());
    setExpectedRevision(dashboard.current?.revision ?? expectedRevision);
    setPendingOperation(null);
    setRestoredOperation(false);
    setDirtySinceResult(true);
    storePendingOperation(pendingCandidateKey, null);
  }

  function editComp(next: Partial<CompDraft>) {
    setCompDraft((previous) => ({ ...previous, ...next }));
    setCompRequestId(newRequestId());
    setRestoredComp(false);
    storePendingOperation(pendingCompKey, null);
  }

  function discardPricingAndReload() {
    discardAdminPricingRetry(adminId, (key) => storePendingOperation(key, null));
    window.location.reload();
  }

  function handleRecipientSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageComps || recipientSearchPending) return;
    const formData = new FormData();
    formData.set("query", recipientQuery);
    startTransition(() => recipientSearchAction(formData));
  }

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || savePending) return;
    const submittedCandidate: CandidateDraft = candidate.status === "live"
      ? candidate
      : { ...candidate, billing_model: null, price_options: [] };
    const operation = pendingOperation ?? {
      requestId,
      expectedRevision,
      candidate: submittedCandidate,
    };
    const formData = new FormData();
    formData.set("request_id", operation.requestId);
    formData.set("expected_revision", String(operation.expectedRevision));
    formData.set("candidate_json", JSON.stringify(operation.candidate));
    storePendingOperation(pendingCandidateKey, JSON.stringify(operation));
    setPendingOperation(operation);
    setDirtySinceResult(false);
    startTransition(() => saveAction(formData));
  }

  function handleGrant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (compPending) return;
    const normalizedStart = utcLocalInputToIso(compDraft.startsAt);
    const normalizedExpiry = compDraft.expiresAt ? utcLocalInputToIso(compDraft.expiresAt) : null;
    const datesValid = normalizedStart !== null && (!compDraft.expiresAt || normalizedExpiry !== null);
    const operation: PendingComp = {
      requestId: compRequestId,
      userId: selectedRecipient?.id ?? "",
      startsAt: normalizedStart ?? compDraft.startsAt,
      expiresAt: compDraft.expiresAt ? normalizedExpiry ?? compDraft.expiresAt : null,
      reason: compDraft.reason,
      recipient: selectedRecipient
        ? { displayName: selectedRecipient.displayName, email: selectedRecipient.email, role: selectedRecipient.role }
        : { displayName: "", email: "", role: "member" },
    };
    const formData = new FormData();
    formData.set("request_id", operation.requestId);
    formData.set("user_id", operation.userId);
    formData.set("starts_at", operation.startsAt);
    formData.set("expires_at", operation.expiresAt ?? "");
    formData.set("reason", operation.reason);
    if (datesValid) storePendingOperation(pendingCompKey, JSON.stringify(operation));
    startTransition(() => compAction(formData));
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="mt-2 text-muted">{copy.intro}</p>
      </section>

      {dashboard.readErrors.length > 0 && (
        <section className="rounded-xl border border-danger/40 bg-danger/5 p-4" aria-labelledby="pricing-read-error">
          <h2 id="pricing-read-error" className="font-semibold">{copy.partialReadError}</h2>
          <ul className="mt-2 list-inside list-disc text-sm">
            {dashboard.readErrors.map((key) => (
              <li key={key}>{copy.readErrors[key as keyof typeof copy.readErrors] ?? copy.unavailable}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="pricing-current-heading">
        <h2 id="pricing-current-heading" className="text-xl font-semibold">{copy.currentHeading}</h2>
        {dashboard.current ? (
          <p className="mt-1 text-sm text-muted">{copy.currentRevision(dashboard.current.revision)}</p>
        ) : (
          <p className="mt-3 text-sm text-danger" role="alert">{copy.noConfiguration}</p>
        )}
        <p className="mt-3 rounded-lg bg-surface-raised p-3 text-sm">{statusNotice}</p>
        {!canEdit && (
          <p className="mt-3 text-sm text-danger" role="alert">{dashboard.current && dashboard.current.currency !== "USD" ? copy.unsupportedCurrency : copy.unavailable}</p>
        )}

        {canEdit && (
        <form className="mt-5 space-y-5" action={saveAction} onSubmit={handleSave} aria-describedby="pricing-status-hint">
            <input type="hidden" name="request_id" value={requestId} />
            <input type="hidden" name="expected_revision" value={expectedRevision} />
            <input type="hidden" name="candidate_json" value={JSON.stringify(candidate.status === "live" ? candidate : { ...candidate, billing_model: null, price_options: [] })} />
            <p id="pricing-status-hint" className="text-sm text-muted">{copy.statusHint}</p>
            {restoredOperation && saveState.status !== "saved" && saveState.status !== "already_applied" && <p role="status" className="text-sm text-muted">{copy.restorePending}</p>}
            {saveState.status && !dirtySinceResult && <ActionFeedback state={saveState} copy={copy} />}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="block text-sm font-medium">{copy.status}</span>
                <select className="field-input min-h-11" value={candidate.status} disabled={savePending} onChange={(event) => {
                  const status = event.target.value as CandidateDraft["status"];
                  editCandidate({ status, ...(status === "live" ? {} : { billing_model: null, price_options: [] }) });
                }}>
                  <option value="pricing_pending">{copy.statuses.pricing_pending}</option>
                  <option value="disabled">{copy.statuses.disabled}</option>
                  <option value="live">{copy.statuses.live}</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="block text-sm font-medium">{copy.payer}</span>
                <select className="field-input min-h-11" value={candidate.payer} disabled={savePending} onChange={(event) => editCandidate({ payer: event.target.value as CandidateDraft["payer"] })}>
                  <option value="coach">{copy.payers.coach}</option>
                  <option value="member">{copy.payers.member}</option>
                </select>
              </label>
              <p className="self-end pb-2 text-sm text-muted">{copy.currency}: {candidate.currency}</p>
              <label className="space-y-1.5">
                <span className="block text-sm font-medium">{copy.displayName}</span>
                <input className="field-input min-h-11" value={candidate.display_name} maxLength={120} disabled={savePending} onChange={(event) => editCandidate({ display_name: event.target.value })} />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="block text-sm font-medium">{copy.description}</span>
                <textarea className="field-input min-h-20" value={candidate.description} maxLength={500} disabled={savePending} onChange={(event) => editCandidate({ description: event.target.value })} />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="block text-sm font-medium">{copy.marketingCopy}</span>
                <textarea className="field-input min-h-20" value={candidate.marketing_copy} maxLength={2000} disabled={savePending} onChange={(event) => editCandidate({ marketing_copy: event.target.value })} />
              </label>
              <label className="space-y-1.5">
                <span className="block text-sm font-medium">{copy.trialDays}</span>
                <input className="field-input min-h-11" type="number" min={0} max={365} step={1} value={candidate.trial_days} disabled={savePending} onChange={(event) => editCandidate({ trial_days: event.target.value === "" ? Number.NaN : Number(event.target.value) })} />
              </label>
              <label className="space-y-1.5">
                <span className="block text-sm font-medium">{copy.trialAssessments}</span>
                <input className="field-input min-h-11" type="number" min={0} max={1000} step={1} value={candidate.trial_assessments} disabled={savePending} onChange={(event) => editCandidate({ trial_assessments: event.target.value === "" ? Number.NaN : Number(event.target.value) })} />
              </label>
            </div>

            {candidate.status === "live" && (
              <fieldset className="space-y-4 rounded-xl border border-border p-4">
                <legend className="px-1 text-base font-semibold">{copy.priceOptions}</legend>
                <label className="block max-w-sm space-y-1.5">
                  <span className="block text-sm font-medium">{copy.billingModel}</span>
                  <select className="field-input min-h-11" value={candidate.billing_model ?? ""} disabled={savePending} onChange={(event) => {
                    const billingModel = event.target.value === "subscription" || event.target.value === "per_assessment" ? event.target.value : null;
                    const price_options = candidate.price_options.map((option) => billingModel === "subscription"
                      ? { ...option, interval: option.interval ?? "month", credits_per_pack: null }
                      : { ...option, interval: null, credits_per_pack: option.credits_per_pack ?? 1 });
                    editCandidate({ billing_model: billingModel, price_options });
                  }}>
                    <option value="">{copy.models.none}</option>
                    <option value="subscription">{copy.models.subscription}</option>
                    <option value="per_assessment">{copy.models.per_assessment}</option>
                  </select>
                </label>
                <div className="space-y-3">
                  {candidate.price_options.map((option, index) => (
                    <fieldset key={`${index}-${option.price_key}`} className="grid gap-3 rounded-lg bg-surface-raised p-3 sm:grid-cols-2 lg:grid-cols-4">
                      <legend className="sr-only">{copy.priceOptionNumber(index + 1)}</legend>
                      <label className="space-y-1">
                        <span className="block text-sm font-medium">{copy.amountUsd}</span>
                        <input className="field-input min-h-10" type="text" inputMode="decimal" placeholder={copy.amountPlaceholder} value={priceAmountTexts[option.price_key] ?? copy.amountInput(option.amount_cents)} disabled={savePending} onChange={(event) => {
                          const amountText = event.target.value;
                          setPriceAmountTexts((current) => ({ ...current, [option.price_key]: amountText }));
                          const amount_cents = usdInputToCents(amountText);
                          if (amount_cents !== null) {
                            const price_options = candidate.price_options.map((row, rowIndex) => rowIndex === index ? { ...row, amount_cents } : row);
                            editCandidate({ price_options });
                          }
                        }} onBlur={() => setPriceAmountTexts((current) => {
                          if (current[option.price_key] !== undefined && usdInputToCents(current[option.price_key]) === null) return current;
                          const next = { ...current };
                          delete next[option.price_key];
                          return next;
                        })} aria-invalid={priceAmountTexts[option.price_key] !== undefined && usdInputToCents(priceAmountTexts[option.price_key]) === null} />
                        {priceAmountTexts[option.price_key] !== undefined && usdInputToCents(priceAmountTexts[option.price_key]) === null && <span className="text-xs text-danger" role="alert">{copy.invalidAmount}</span>}
                      </label>
                      {candidate.billing_model === "subscription" ? (
                        <label className="space-y-1">
                          <span className="block text-sm font-medium">{copy.interval}</span>
                        <select className="field-input min-h-10" value={option.interval ?? "month"} disabled={savePending} onChange={(event) => {
                            const interval = event.target.value as "month" | "year";
                            const price_options = candidate.price_options.map((row, rowIndex) => rowIndex === index ? { ...row, interval, credits_per_pack: null } : row);
                            editCandidate({ price_options });
                          }}>
                            <option value="month">{copy.intervalMonth}</option>
                            <option value="year">{copy.intervalYear}</option>
                          </select>
                        </label>
                      ) : (
                        <label className="space-y-1">
                          <span className="block text-sm font-medium">{copy.creditsPerPack}</span>
                          <input className="field-input min-h-10" type="number" min={1} max={1_000_000} step={1} value={option.credits_per_pack ?? ""} disabled={savePending} onChange={(event) => {
                            const credits_per_pack = event.target.value === "" ? Number.NaN : Number(event.target.value);
                            const price_options = candidate.price_options.map((row, rowIndex) => rowIndex === index ? { ...row, interval: null, credits_per_pack } : row);
                            editCandidate({ price_options });
                          }} />
                        </label>
                      )}
                      <button className="btn-secondary min-h-10 self-end" type="button" disabled={savePending} onClick={() => {
                        setPriceAmountTexts((current) => {
                          const next = { ...current };
                          delete next[option.price_key];
                          return next;
                        });
                        editCandidate({ price_options: candidate.price_options.filter((_, rowIndex) => rowIndex !== index) });
                      }}>
                        {copy.removePrice}
                      </button>
                    </fieldset>
                  ))}
                </div>
                <button className="btn-secondary min-h-10" type="button" disabled={savePending || candidate.price_options.length >= 50 || !candidate.billing_model || (candidate.billing_model === "subscription" && candidate.price_options.length > 0)} onClick={() => {
                  if (!candidate.billing_model) return;
                  const credits = 3;
                  const nextOption = {
                    price_key: generatedPriceKey(candidate.billing_model, candidate.price_options, credits),
                    amount_cents: 1200,
                    currency: candidate.currency,
                    interval: candidate.billing_model === "subscription" ? "month" as const : null,
                    credits_per_pack: candidate.billing_model === "subscription" ? null : credits,
                  };
                  editCandidate({ price_options: [...candidate.price_options, nextOption] });
                }}>{copy.addPrice}</button>
              </fieldset>
            )}

            {candidate.status === "live" && <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">{copy.liveNotice}</p>}
            {candidate.status !== "live" && <p className="rounded-lg border border-border bg-surface-raised p-3 text-sm">{statusNotice}</p>}
            <div className="flex flex-wrap gap-3">
              <button className="btn-primary min-h-11" type="submit" disabled={!canEdit || savePending || hasInvalidAmount || !candidate.status}>
                {savePending ? copy.saving : copy.save}
              </button>
              <button className="btn-secondary min-h-11" type="button" onClick={discardPricingAndReload}>
                {copy.refreshCurrent}
              </button>
            </div>
          </form>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="pricing-history-heading">
          <h2 id="pricing-history-heading" className="text-xl font-semibold">{copy.historyHeading}</h2>
          {dashboard.revisions.length === 0 ? <p className="mt-3 text-sm text-muted">{copy.historyEmpty}</p> : (
            <ol className="mt-3 space-y-3">
              {dashboard.revisions.map((revision) => (
                <li key={revision.revision} className="rounded-lg bg-surface-raised p-3 text-sm">
                  <p className="font-semibold">{copy.currentRevision(revision.revision)} · {copy.statuses[revision.status]}</p>
                  <p>{revision.displayName} · {copy.payers[revision.payer]} · {revision.billingModel ? copy.models[revision.billingModel] : copy.models.none}</p>
                  <p className="text-muted">{revision.priceOptions.map((option) => copy.optionSummary(option.amountCents, option.currency, option.creditsPerPack, option.interval)).join("; ") || "—"}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="pricing-change-heading">
          <h2 id="pricing-change-heading" className="text-xl font-semibold">{copy.changeHeading}</h2>
          {dashboard.changes.length === 0 ? <p className="mt-3 text-sm text-muted">{copy.changeEmpty}</p> : (
            <ol className="mt-3 space-y-2 text-sm">
              {dashboard.changes.map((change) => <li key={`${change.revision}-${change.changedAt}`} className="rounded-lg bg-surface-raised p-3">{copy.currentRevision(change.revision)} · {change.previousRevision === null ? "—" : copy.currentRevision(change.previousRevision)} · {formatDate(change.changedAt)}</li>)}
            </ol>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="pricing-sync-heading">
        <h2 id="pricing-sync-heading" className="text-xl font-semibold">{copy.syncHeading}</h2>
        <p className="mt-1 text-sm text-muted">{copy.syncStepNote}</p>
        {dashboard.syncRequests.length === 0 ? <p className="mt-3 text-sm text-muted">{copy.syncEmpty}</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {dashboard.syncRequests.map((request, index) => <li key={`${request.expectedRevision}-${request.updatedAt}-${index}`} className="rounded-lg bg-surface-raised p-3">{copy.currentRevision(request.expectedRevision)} · {copy.workflowStates[request.state as keyof typeof copy.workflowStates] ?? request.state} · {request.publishedRevision ? copy.currentRevision(request.publishedRevision) : "—"} · {request.objects.map((object) => `${object.kind === "product" ? copy.syncProduct : copy.syncPrice}: ${copy.workflowStates[object.state as keyof typeof copy.workflowStates] ?? object.state}`).join("; ") || "—"}</li>)}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="pricing-contracts-heading">
        <h2 id="pricing-contracts-heading" className="text-xl font-semibold">{copy.legacyHeading}</h2>
        <p className="mt-2 text-sm">{dashboard.legacyContractCount === null ? copy.legacyUnavailable : copy.legacyCount(dashboard.legacyContractCount)}</p>
        <p className="mt-3 text-sm text-muted">{copy.moveDeferred}</p>
        {Object.keys(dashboard.moveStateCounts).length > 0 && (
          <ul className="mt-2 text-sm text-muted">
            {Object.entries(dashboard.moveStateCounts).map(([state, count]) => <li key={state}>{copy.workflowStates[state as keyof typeof copy.workflowStates] ?? state}: {count}</li>)}
          </ul>
        )}
      </section>

      <section className="space-y-5 rounded-2xl border border-border bg-surface p-5" aria-labelledby="pricing-comps-heading">
        <div>
          <h2 id="pricing-comps-heading" className="text-xl font-semibold">{copy.compHeading}</h2>
          <p className="mt-1 text-sm text-muted">{copy.compIntro}</p>
        </div>
        <form className="flex flex-wrap items-end gap-3" action={recipientSearchAction} onSubmit={handleRecipientSearch}>
          <label className="min-w-[260px] flex-1 space-y-1.5">
            <span className="block text-sm font-medium">{copy.recipientSearch}</span>
            <input className="field-input min-h-11" name="query" value={recipientQuery} disabled={recipientSearchPending || !canManageComps} onChange={(event) => setRecipientQuery(event.target.value)} />
          </label>
          <button className="btn-secondary min-h-11" type="submit" disabled={recipientSearchPending || !canManageComps || recipientQuery.trim().length < 2}>
            {recipientSearchPending ? copy.searching : copy.search}
          </button>
        </form>
        {recipientSearchState.errorCode && <ActionFeedback state={recipientSearchState} copy={copy} />}
        {recipientSearchState.status === "searched" && (
          <div aria-live="polite">
            <h3 className="font-semibold">{copy.searchResults}</h3>
            {recipientSearchState.recipients?.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {recipientSearchState.recipients.map((recipient) => (
                  <li key={recipient.id}>
                    <button className={`rounded-lg border px-3 py-2 text-left text-sm ${selectedRecipient?.id === recipient.id ? "border-accent bg-accent/10" : "border-border bg-surface-raised"}`} type="button" aria-pressed={selectedRecipient?.id === recipient.id} onClick={() => {
                      setSelectedRecipient(recipient);
                      editComp({ userId: recipient.id });
                    }}>
                      <span className="block font-semibold">{recipient.displayName || recipient.email || copy.accountUnavailable}</span>
                      <span className="block text-muted">{recipient.email} · {copy.roles[recipient.role as keyof typeof copy.roles] ?? recipient.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-muted">{copy.noRecipients}</p>}
          </div>
        )}
        {selectedRecipient && (
          <p className="rounded-lg bg-surface-raised p-3 text-sm" aria-live="polite">
            {copy.selectedRecipient}: <span className="font-semibold">{selectedRecipient.displayName || selectedRecipient.email || copy.accountUnavailable}</span> · {copy.roles[selectedRecipient.role as keyof typeof copy.roles] ?? selectedRecipient.role}
          </p>
        )}
        <form className="grid gap-4 sm:grid-cols-2" action={compAction} onSubmit={handleGrant}>
          <label className="space-y-1.5">
            <span className="block text-sm font-medium">{copy.compUserId}</span>
            <input type="hidden" name="user_id" value={selectedRecipient?.id ?? ""} />
            <span className="field-input flex min-h-11 items-center">{selectedRecipient ? `${selectedRecipient.displayName || selectedRecipient.email || copy.accountUnavailable} · ${selectedRecipient.email}` : copy.noRecipients}</span>
          </label>
          <label className="space-y-1.5">
            <span className="block text-sm font-medium">{copy.compStartsAt}</span>
            <input className="field-input min-h-11" type="datetime-local" value={compDraft.startsAt} disabled={compPending || !canManageComps} onChange={(event) => editComp({ startsAt: event.target.value })} />
          </label>
          <label className="space-y-1.5">
            <span className="block text-sm font-medium">{copy.compExpiresAt}</span>
            <input className="field-input min-h-11" type="datetime-local" value={compDraft.expiresAt} disabled={compPending || !canManageComps} onChange={(event) => editComp({ expiresAt: event.target.value })} />
          </label>
          <label className="space-y-1.5">
            <span className="block text-sm font-medium">{copy.compReason}</span>
            <input className="field-input min-h-11" name="reason" value={compDraft.reason} maxLength={500} disabled={compPending || !canManageComps} onChange={(event) => editComp({ reason: event.target.value })} />
          </label>
          <input type="hidden" name="request_id" value={compRequestId} />
          <input type="hidden" name="starts_at" value={utcLocalInputToIso(compDraft.startsAt) ?? ""} />
          <input type="hidden" name="expires_at" value={utcLocalInputToIso(compDraft.expiresAt) ?? ""} />
          <p className="text-sm text-muted sm:col-span-2">{copy.compTimezoneHint}</p>
          {restoredComp && compState.status !== "granted" && <p className="text-sm text-muted sm:col-span-2">{copy.restorePending}</p>}
          {compState.status && <div className="sm:col-span-2"><ActionFeedback state={compState} copy={copy} /></div>}
          <button className="btn-primary min-h-11 sm:col-span-2 sm:justify-self-start" type="submit" disabled={compPending || !canManageComps || !selectedRecipient}>
            {compPending ? copy.granting : copy.grant}
          </button>
        </form>
        {dashboard.comps.length === 0 ? <p className="text-sm text-muted">{copy.compEmpty}</p> : (
          <>
            <p className="text-xs text-muted">{copy.compHistoryLimit}</p>
            <ul className="space-y-3">
              {dashboard.comps.map((grant) => (
                <li key={grant.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-surface-raised p-3">
                  <div className="text-sm">
                    <p className="font-semibold">{grant.recipientDeleted ? copy.deletedAccount : grant.recipientName || copy.accountUnavailable}</p>
                    {grant.recipientEmail && <p>{grant.recipientEmail}</p>}
                    <p>{copy.compDates(grant.startsAt, grant.expiresAt)}</p>
                    <p>{copy.compReason}: {grant.reason}</p>
                    <p className="text-xs text-muted">{copy.grantDate}: {grant.grantedAt} · {copy.grantedBy}: {grant.grantedByName || copy.accountUnavailable}{grant.grantedByEmail ? ` (${grant.grantedByEmail})` : ""}</p>
                    {grant.revoked && grant.revokedAt && <p className="text-xs text-muted">{copy.revokedAt}: {grant.revokedAt}{grant.revokedByName ? ` · ${copy.revokedBy}: ${grant.revokedByName}${grant.revokedByEmail ? ` (${grant.revokedByEmail})` : ""}` : ""}</p>}
                  </div>
                  {grant.revoked ? <span className="text-xs font-semibold text-muted">{copy.compRevoked}</span> : <RevokeCompForm grantId={grant.id} copy={copy} disabled={!canManageComps} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
