import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Whether a seller can be paid for paid downloads. Admins sell on GYMX2's behalf, so they need no account.
export async function loadPayoutStatus(profile: Pick<Profile, "id" | "role">) {
  if (profile.role === "admin") return "platform" as const;
  const supabase = await createClient();
  const { data } = await supabase
    .from("payout_accounts")
    .select("charges_enabled")
    .eq("coach_id", profile.id)
    .maybeSingle();
  return data?.charges_enabled ? ("ready" as const) : ("missing" as const);
}
