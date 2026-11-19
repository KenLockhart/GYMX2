import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function bindArmoryCheckoutSession(intentId: string, sessionId: string) {
  const admin = createAdminClient();
  const { data: bound, error } = await admin.rpc("bind_armory_checkout_session", {
    target_intent_id: intentId,
    target_session_id: sessionId,
  });
  if (!error && bound === true) return true;

  // A response can be lost after the database commits. Read back the exact binding before
  // deciding whether Checkout failed; never replace or expire an uncertain live session.
  const { data: existing, error: readError } = await admin
    .from("armory_checkout_intents")
    .select("stripe_session_id")
    .eq("id", intentId)
    .maybeSingle<{ stripe_session_id: string | null }>();
  return !readError && existing?.stripe_session_id === sessionId;
}
