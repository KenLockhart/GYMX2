"use client";

import { useFormStatus } from "react-dom";
import { beginPrintfulCostReviewAction, syncPrintfulCatalogAction } from "@/app/(app)/admin/printful/actions";

type PrintfulOperation = "sync" | "cost-review";

const operationCopy = {
  sync: {
    action: syncPrintfulCatalogAction,
    label: "Sync catalog now",
    pendingLabel: "Syncing catalog…",
    pendingMessage: "Reading the complete Printful catalog into the private stage…",
  },
  "cost-review": {
    action: beginPrintfulCostReviewAction,
    label: "Start configured-cost review",
    pendingLabel: "Preparing review…",
    pendingMessage: "Refreshing the private catalog and preparing the cost-review form…",
  },
} satisfies Record<PrintfulOperation, {
  action: () => Promise<void>;
  label: string;
  pendingLabel: string;
  pendingMessage: string;
}>;

export function PrintfulOperationSubmitButton({ operation }: { operation: PrintfulOperation }) {
  const { pending } = useFormStatus();
  const copy = operationCopy[operation];

  return (
    <>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={`rounded-lg px-4 py-2 font-semibold disabled:cursor-wait disabled:opacity-70 ${
          operation === "sync" ? "bg-accent text-accent-foreground" : "border border-border"
        }`}
      >
        {pending ? copy.pendingLabel : copy.label}
      </button>
      {pending && <p role="status" className="text-xs text-muted">{copy.pendingMessage}</p>}
    </>
  );
}

export function PrintfulOperationForm({ operation }: { operation: PrintfulOperation }) {
  return (
    <form action={operationCopy[operation].action} className="space-y-1.5">
      <PrintfulOperationSubmitButton operation={operation} />
    </form>
  );
}
