import "server-only";
import { createClient } from "@/lib/supabase/server";

// The members a coach can invite: everyone who has joined them, sorted by name.
export async function loadCoachMembers(coachId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coach_members")
    .select("member:profiles!member_id(id, display_name)")
    .eq("coach_id", coachId);

  const members = (
    (data ?? []) as unknown as {
      member: { id: string; display_name: string } | null;
    }[]
  )
    .flatMap((row) => (row.member ? [row.member] : []))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return { members, error };
}
