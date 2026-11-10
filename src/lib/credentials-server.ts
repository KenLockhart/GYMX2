import "server-only";
import {
  type CredentialRowStatus,
  displayStatus,
  type DisplayStatus,
} from "@/lib/credentials";
import { createClient } from "@/lib/supabase/server";

export type OwnCredential = {
  id: string;
  kind: string;
  organization: string;
  title: string;
  credentialNumber: string;
  issuedOn: string | null;
  expiresOn: string | null;
  hasDocument: boolean;
  status: CredentialRowStatus;
  shown: DisplayStatus | null;
  adminNote: string;
};

// A coach's own credentials, with everything they entered (row security: only theirs).
export async function loadOwnCredentials(
  coachId: string,
): Promise<OwnCredential[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_credentials")
    .select(
      "id, kind, organization, title, credential_number, issued_on, expires_on, document_path, status, admin_note",
    )
    .eq("coach_id", coachId)
    .order("created_at");
  return (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    organization: row.organization as string,
    title: row.title as string,
    credentialNumber: row.credential_number as string,
    issuedOn: row.issued_on as string | null,
    expiresOn: row.expires_on as string | null,
    hasDocument: Boolean(row.document_path),
    status: row.status as CredentialRowStatus,
    shown: displayStatus(
      row.status as CredentialRowStatus,
      row.expires_on as string | null,
    ),
    adminNote: row.admin_note as string,
  }));
}
