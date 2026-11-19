"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { T } from "@/i18n/t";

export function GuestArmoryClaim() {
  const [status, setStatus] = useState<"working" | "invalid">("working");

  useEffect(() => {
    let active = true;
    const fragment = window.location.hash.slice(1);
    const token = new URLSearchParams(fragment).get("token");
    window.history.replaceState(null, "", "/armory/claim");
    if (!token || token.length > 2048) {
      // Defer this UI update after the effect has finished syncing the URL fragment.
      const invalidTimer = window.setTimeout(() => {
        if (active) setStatus("invalid");
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(invalidTimer);
      };
    }

    void fetch("/api/armory/guest-download", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("claim_failed");
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          typeof (result as { url?: unknown }).url !== "string"
        ) {
          throw new Error("claim_failed");
        }
        if (active) window.location.replace((result as { url: string }).url);
      })
      .catch(() => {
        if (active) setStatus("invalid");
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-5 px-4 py-14 sm:px-6">
      <h1 className="text-4xl"><T>Armory download</T></h1>
      {status === "working" ? (
        <p role="status" aria-live="polite" className="text-muted"><T>Checking your order securely…</T></p>
      ) : (
        <div className="space-y-4">
          <p role="alert" className="text-muted"><T>This download link is invalid, expired, or the order was refunded.</T></p>
          <Link href="/armory" className="btn-primary"><T>Browse the Armory</T></Link>
        </div>
      )}
    </main>
  );
}
