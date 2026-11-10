"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireCoach } from "@/lib/auth";
import {
  type OwnCredential,
  loadOwnCredentials,
} from "@/lib/credentials-server";
import { credentialInputSchema } from "@/lib/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

const DOC_BUCKET = "credential-docs";
const DOC_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

type Result = { error?: string; credentials?: OwnCredential[] };

async function done(coachId: string): Promise<Result> {
  revalidatePath("/profile/coach");
  revalidatePath(`/coaches/${coachId}`);
  return { credentials: await loadOwnCredentials(coachId) };
}

// Row security: coaches can add, change and remove only their own credentials, and can't set a status.
export async function addCredential(input: unknown): Promise<Result> {
  const { profile } = await requireCoach();
  const parsed = credentialInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { count } = await supabase
    .from("coach_credentials")
    .select("id", { count: "exact", head: true })
    .eq("coach_id", profile.id);
  if ((count ?? 0) >= 20)
    return { error: "You can list up to 20 credentials." };
  const { error } = await supabase.from("coach_credentials").insert({
    coach_id: profile.id,
    kind: parsed.data.kind,
    organization: parsed.data.organization,
    title: parsed.data.title,
    credential_number: parsed.data.credentialNumber,
    issued_on: parsed.data.issuedOn,
    expires_on: parsed.data.expiresOn,
  });
  if (error) return { error: "We couldn't add that. Please try again." };
  return done(profile.id);
}

export async function deleteCredential(id: string): Promise<Result> {
  const { profile } = await requireCoach();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: "That credential wasn't found." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_credentials")
    .delete()
    .eq("id", parsed.data)
    .eq("coach_id", profile.id)
    .select("document_path");
  const path = data?.[0]?.document_path as string | null | undefined;
  if (path) await createAdminClient().storage.from(DOC_BUCKET).remove([path]);
  return done(profile.id);
}

export async function prepareCredentialDocument(file: {
  name: string;
  size: number;
}): Promise<{ error?: string; path?: string; token?: string }> {
  const { profile } = await requireCoach();
  const extension =
    String(file?.name ?? "")
      .split(".")
      .pop()
      ?.toLowerCase() ?? "";
  if (!(extension in DOC_TYPES))
    return { error: "Use a PDF, JPG, PNG or WebP file." };
  if (!(file.size > 0) || file.size > 10 * 1024 * 1024)
    return { error: "Documents can be up to 10 MB." };
  const { data, error } = await createAdminClient()
    .storage.from(DOC_BUCKET)
    .createSignedUploadUrl(`${profile.id}/${randomUUID()}.${extension}`);
  if (error || !data) return { error: "We couldn't start the upload." };
  return { path: data.path, token: data.token };
}

// Attaches an uploaded certificate. Changing the document sends a verified credential back for review
// (the database does that).
export async function attachCredentialDocument(
  id: string,
  path: string,
): Promise<Result> {
  const { profile } = await requireCoach();
  const parsed = idSchema.safeParse(id);
  if (
    !parsed.success ||
    typeof path !== "string" ||
    !new RegExp(`^${profile.id}/[0-9a-f-]{36}\\.(pdf|jpg|jpeg|png|webp)$`).test(
      path,
    )
  )
    return { error: "That upload didn't work." };
  const admin = createAdminClient();
  const { data: files } = await admin.storage
    .from(DOC_BUCKET)
    .list(profile.id, { search: path.split("/")[1] });
  if (!files?.some((file) => `${profile.id}/${file.name}` === path))
    return { error: "The document didn't finish uploading." };
  const supabase = await createClient();
  const { data: before } = await supabase
    .from("coach_credentials")
    .select("document_path")
    .eq("id", parsed.data)
    .eq("coach_id", profile.id)
    .maybeSingle();
  if (!before) return { error: "That credential wasn't found." };
  const { error } = await supabase
    .from("coach_credentials")
    .update({ document_path: path })
    .eq("id", parsed.data)
    .eq("coach_id", profile.id);
  if (error) return { error: "We couldn't attach the document." };
  if (before.document_path)
    await admin.storage
      .from(DOC_BUCKET)
      .remove([before.document_path as string]);
  return done(profile.id);
}

export async function requestVerification(id: string): Promise<Result> {
  const { profile } = await requireCoach();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: "That credential wasn't found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_credential_verification", {
    target_credential_id: parsed.data,
  });
  if (error)
    return {
      error:
        error.code === "P0001" ? `${error.message}.` : "We couldn't send that.",
    };
  revalidatePath("/admin/credentials");
  return done(profile.id);
}
