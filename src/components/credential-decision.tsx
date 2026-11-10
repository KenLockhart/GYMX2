"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideCredential } from "@/app/(app)/admin/credentials/actions";

export function CredentialDecision({ id }: { id: string }) {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    start(async () => {
      const result = await decideCredential({ id, approve, source, note });
      if (result.error) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-semibold">
            Where you checked it (to verify)
          </span>
          <input
            value={source}
            maxLength={200}
            onChange={(e) => setSource(e.target.value)}
            placeholder="NASM online verification, certificate number matched"
            className="field-input"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-semibold">Note to the coach (to reject)</span>
          <input
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="We couldn't find this number. Please upload a clearer certificate."
            className="field-input"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(true)}
          className="btn-primary px-4 py-2 text-sm"
        >
          Mark verified
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(false)}
          className="btn-secondary px-4 py-2 text-sm"
        >
          Can&apos;t verify
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
