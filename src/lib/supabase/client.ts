"use client";

import { createBrowserClient } from "@supabase/ssr";

// Only used for live updates. It signs in with the same session cookie, so row security still applies.
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
