// Coach credentials: the kinds, form validation and how statuses show. Shared by server and browser.
import { z } from "zod";

export const CREDENTIAL_KINDS = [
  { value: "certification", label: "Certification" },
  { value: "cpr_aed", label: "CPR/AED" },
  { value: "education", label: "Education" },
  { value: "license", label: "Professional license" },
  { value: "insurance", label: "Liability insurance" },
  { value: "continuing_ed", label: "Continuing education" },
] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number]["value"];

// Suggestions only: coaches can type any legitimate organization.
export const KNOWN_ORGANIZATIONS = [
  "NASM",
  "ACE",
  "ACSM",
  "NSCA",
  "ISSA",
  "NCCPT",
  "NESTA",
  "Precision Nutrition",
  "American Red Cross",
  "American Heart Association",
] as const;

export type CredentialRowStatus =
  "unverified" | "pending" | "verified" | "rejected";
export type DisplayStatus = "verified" | "pending" | "unverified" | "expired";

export const DISPLAY_LABEL: Record<DisplayStatus, string> = {
  verified: "Verified",
  pending: "Pending verification",
  unverified: "Unverified",
  expired: "Expired",
};

const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date")
  .nullable()
  .or(z.literal("").transform(() => null));

export const credentialInputSchema = z
  .object({
    kind: z.enum(
      CREDENTIAL_KINDS.map((k) => k.value) as [
        CredentialKind,
        ...CredentialKind[],
      ],
    ),
    organization: z.string().trim().min(1, "Add the organization").max(100),
    title: z.string().trim().min(1, "Add the credential name").max(120),
    credentialNumber: z.string().trim().max(80).default(""),
    issuedOn: optionalDate.default(null),
    expiresOn: optionalDate.default(null),
  })
  .refine((c) => !c.issuedOn || !c.expiresOn || c.expiresOn >= c.issuedOn, {
    message: "The expiry date is before the issue date",
    path: ["expiresOn"],
  });
export type CredentialInput = z.infer<typeof credentialInputSchema>;

// What a credential shows as today: an expired one is never "verified".
export function displayStatus(
  status: CredentialRowStatus,
  expiresOn: string | null,
  today = new Date().toISOString().slice(0, 10),
): DisplayStatus | null {
  if (status === "rejected") return null;
  if (expiresOn && expiresOn < today) return "expired";
  return status;
}

// The badge under a coach's name: verified when at least one current certification or license is
// verified; pending while one is being checked; otherwise unverified.
export function overallVerification(
  items: { kind: string; status: DisplayStatus }[],
): "verified" | "pending" | "unverified" {
  const core = items.filter(
    (c) => c.kind === "certification" || c.kind === "license",
  );
  if (core.some((c) => c.status === "verified")) return "verified";
  if (items.some((c) => c.status === "pending")) return "pending";
  return "unverified";
}

export function kindLabel(kind: string) {
  return CREDENTIAL_KINDS.find((k) => k.value === kind)?.label ?? "Credential";
}
