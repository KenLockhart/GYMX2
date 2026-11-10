"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

const schema = z.object({
  id: idSchema,
  approve: z.boolean(),
  source: z.string().trim().max(200),
  note: z.string().trim().max(500),
});

// The database checks admin rights, requires a source for approvals and records the history.
export async function decideCredential(
  input: unknown,
): Promise<{ error?: string }> {
  await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Something's missing." };
  if (parsed.data.approve && !parsed.data.source)
    return {
      error:
        "Say where you checked it (for example, the issuer's online lookup).",
    };
  if (!parsed.data.approve && !parsed.data.note)
    return { error: "Tell the coach why it couldn't be verified." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_credential", {
    target_credential_id: parsed.data.id,
    approve: parsed.data.approve,
    source: parsed.data.source,
    note: parsed.data.note,
  });
  if (error)
    return {
      error: error.code === "P0001" ? `${error.message}.` : "That didn't work.",
    };
  revalidatePath("/admin/credentials");
  return {};
}
