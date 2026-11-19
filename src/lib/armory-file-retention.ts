import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export function mayDeleteArmoryFile(input: {
  referenceCheckSucceeded: boolean;
  referenceCount: number;
}) {
  return input.referenceCheckSucceeded && input.referenceCount === 0;
}

// A private file may be replaced in the catalog while Checkout is open. Keep any version
// referenced by a pending or paid checkout intent so the order settles against its snapshot.
export async function hasRetainedArmoryFileReference(path: string) {
  const { count, error } = await createAdminClient()
    .from("armory_checkout_intents")
    .select("id", { count: "exact", head: true })
    .eq("file_path", path)
    .in("status", ["pending", "paid"]);
  // Errors fail closed: callers must not delete a file they could not check.
  return !mayDeleteArmoryFile({
    referenceCheckSucceeded: !error,
    referenceCount: count ?? -1,
  });
}
