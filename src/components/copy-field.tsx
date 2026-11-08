"use client";

import { useState } from "react";

// A read-only value with a Copy button, for links people share.
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          aria-label={label}
          className="field-input min-w-0 flex-1 font-mono text-sm"
        />
        <button
          type="button"
          className="btn-secondary shrink-0 px-3 py-2 text-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
