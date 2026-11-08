import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/lib/messages";
import type { Profile } from "@/lib/types";

// Everyone the viewer can message right now: a member's coaches, or a coach's members.
export async function loadContacts(profile: Pick<Profile, "id" | "role">) {
  if (profile.role === "admin") return { contacts: [] as Contact[], error: null };

  const supabase = await createClient();
  const isCoach = profile.role === "coach";
  const { data, error } = await supabase
    .from("coach_members")
    .select(
      isCoach
        ? "person:profiles!member_id(id, display_name)"
        : "person:profiles!coach_id(id, display_name)",
    )
    .eq(isCoach ? "coach_id" : "member_id", profile.id);

  const contacts = ((data ?? []) as unknown as { person: { id: string; display_name: string } | null }[])
    .flatMap((row) => (row.person ? [{ ...row.person, connected: true }] : []))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return { contacts, error };
}
