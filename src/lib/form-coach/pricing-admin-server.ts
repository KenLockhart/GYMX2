import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const PG_INT_MAX = 2_147_483_647;
const PACK_CREDITS_MAX = 1_000_000;
const ADMIN_USER_PAGE_SIZE = 500;
const ADMIN_USER_MAX_ROWS = 50_000;
const ADMIN_USER_MAX_PAGES = 100;
const UuidSchema = z.string().uuid();

const PricingOptionCandidateSchema = z
  .object({
    price_key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    amount_cents: z.number().int().min(1).max(PG_INT_MAX),
    currency: z.string().regex(/^[A-Z]{3}$/),
    interval: z.enum(["month", "year"]).nullable(),
    credits_per_pack: z.number().int().min(1).max(PACK_CREDITS_MAX).nullable(),
  })
  .strict();

export const PricingCandidateSchema = z
  .object({
    status: z.enum(["disabled", "pricing_pending", "live"]),
    payer: z.enum(["coach", "member"]),
    currency: z.string().regex(/^[A-Z]{3}$/),
    display_name: z.string().trim().min(1).max(120),
    description: z.string().max(500),
    marketing_copy: z.string().max(2000),
    trial_days: z.number().int().min(0).max(365),
    trial_assessments: z.number().int().min(0).max(1000),
    billing_model: z.enum(["subscription", "per_assessment"]).nullable(),
    price_options: z.array(PricingOptionCandidateSchema).max(50),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.status !== "live") {
      if (candidate.billing_model !== null || candidate.price_options.length !== 0) {
        context.addIssue({
          code: "custom",
          path: ["price_options"],
          message: "Disabled and pending pricing cannot publish a billing model or prices.",
        });
      }
      return;
    }

    if (!candidate.billing_model || candidate.price_options.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["price_options"],
        message: "Live pricing needs a billing model and at least one option.",
      });
      return;
    }

    if (candidate.billing_model === "subscription" && candidate.price_options.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["price_options"],
        message: "Subscription pricing needs exactly one option.",
      });
    }

    const keys = new Set<string>();
    candidate.price_options.forEach((option, index) => {
      if (option.currency !== candidate.currency) {
        context.addIssue({
          code: "custom",
          path: ["price_options", index, "currency"],
          message: "Each price must use the selected currency.",
        });
      }
      if (keys.has(option.price_key)) {
        context.addIssue({
          code: "custom",
          path: ["price_options", index, "price_key"],
          message: "Price keys must be unique.",
        });
      }
      keys.add(option.price_key);
      if (candidate.billing_model === "subscription"
        && (option.interval === null || option.credits_per_pack !== null)) {
        context.addIssue({
          code: "custom",
          path: ["price_options", index],
          message: "Subscription prices need an interval and cannot include pack credits.",
        });
      }
      if (candidate.billing_model === "per_assessment"
        && (option.interval !== null || option.credits_per_pack === null)) {
        context.addIssue({
          code: "custom",
          path: ["price_options", index],
          message: "Assessment packs need credits and cannot include a subscription interval.",
        });
      }
    });
  });

type ParsedPricingCandidate = z.infer<typeof PricingCandidateSchema>;
type ParsedPricingOptionCandidate = z.infer<typeof PricingOptionCandidateSchema>;
export type PricingCandidate = Readonly<Omit<ParsedPricingCandidate, "price_options">> & {
  readonly price_options: readonly Readonly<ParsedPricingOptionCandidate>[];
};

export function normalizePricingCandidate(input: unknown): PricingCandidate {
  const parsed = PricingCandidateSchema.parse(input);
  return Object.freeze({
    ...parsed,
    display_name: parsed.display_name.trim(),
    price_options: Object.freeze(
      [...parsed.price_options]
        .map((option) => Object.freeze({ ...option }))
        .sort((left, right) => left.price_key.localeCompare(right.price_key, "en")),
    ),
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function pricingCandidateDigest(candidate: PricingCandidate): string {
  return createHash("sha256").update(stableJson(candidate), "utf8").digest("hex");
}

export function samePricingCandidate(left: unknown, right: PricingCandidate): boolean {
  const parsed = PricingCandidateSchema.safeParse(left);
  return parsed.success
    && stableJson(normalizePricingCandidate(parsed.data)) === stableJson(right);
}

export type PricingOptionSummary = {
  priceKey: string;
  amountCents: number;
  currency: string;
  interval: "month" | "year" | null;
  creditsPerPack: number | null;
};

export type PricingRevisionSummary = {
  revision: number;
  status: "disabled" | "pricing_pending" | "live";
  payer: "coach" | "member";
  billingModel: "subscription" | "per_assessment" | null;
  currency: string;
  displayName: string;
  description: string;
  marketingCopy: string;
  trialDays: number;
  trialAssessments: number;
  createdAt: string;
  priceOptions: PricingOptionSummary[];
};

export type PricingAdminDashboard = {
  current: PricingRevisionSummary | null;
  revisions: PricingRevisionSummary[];
  changes: Array<{ revision: number; previousRevision: number | null; changedAt: string }>;
  syncRequests: Array<{
    expectedRevision: number;
    publishedRevision: number | null;
    state: string;
    updatedAt: string;
    objects: Array<{ kind: "product" | "price"; priceKey: string | null; state: string }>;
  }>;
  comps: Array<{
    id: string;
    recipientName: string;
    recipientEmail: string | null;
    recipientDeleted: boolean;
    grantedByName: string;
    grantedByEmail: string | null;
    startsAt: string;
    expiresAt: string | null;
    reason: string;
    grantedAt: string;
    revoked: boolean;
    revokedAt: string | null;
    revokedByName: string | null;
    revokedByEmail: string | null;
  }>;
  legacyContractCount: number | null;
  moveStateCounts: Record<string, number>;
  readErrors: string[];
};

type RawRecord = Record<string, unknown>;

function rows(value: unknown): RawRecord[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is RawRecord => entry !== null && typeof entry === "object")
    : [];
}

function record(value: unknown): RawRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RawRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function mapRevision(row: RawRecord, options: PricingOptionSummary[]): PricingRevisionSummary | null {
  const revision = numberOrNull(row.revision);
  const status = row.status;
  const payer = row.payer;
  const billingModel = row.billing_model;
  if (revision === null
    || (status !== "disabled" && status !== "pricing_pending" && status !== "live")
    || (payer !== "coach" && payer !== "member")
    || (billingModel !== null && billingModel !== "subscription" && billingModel !== "per_assessment")) {
    return null;
  }
  return {
    revision,
    status,
    payer,
    billingModel,
    currency: text(row.currency),
    displayName: text(row.display_name),
    description: text(row.description),
    marketingCopy: text(row.marketing_copy),
    trialDays: numberOrNull(row.trial_days) ?? 0,
    trialAssessments: numberOrNull(row.trial_assessments) ?? 0,
    createdAt: text(row.created_at),
    priceOptions: options,
  };
}

/** Copy only fields the admin screen needs; never serialize provider IDs or raw database rows. */
export function toPricingAdminDashboard(input: {
  current: unknown;
  revisions: unknown;
  options: unknown;
  changes: unknown;
  syncRequests: unknown;
  syncObjects: unknown;
  grants: unknown;
  grantEvents: unknown;
  accounts?: unknown;
  legacyContractCount: number | null;
  moveStates: unknown;
  readErrors?: string[];
}): PricingAdminDashboard {
  const currentRow = record(input.current);
  const currentRevision = numberOrNull(currentRow?.revision);
  const optionRows = rows(input.options);
  const optionByRevision = new Map<number, PricingOptionSummary[]>();
  for (const row of optionRows) {
    const revision = numberOrNull(row.revision);
    if (revision === null) continue;
    const option = {
      priceKey: text(row.price_key),
      amountCents: numberOrNull(row.amount_cents) ?? 0,
      currency: text(row.currency),
      interval: row.interval === "month" || row.interval === "year" ? row.interval : null,
      creditsPerPack: numberOrNull(row.credits_per_pack),
    } satisfies PricingOptionSummary;
    const list = optionByRevision.get(revision) ?? [];
    list.push(option);
    optionByRevision.set(revision, list);
  }

  const revisions = rows(input.revisions)
    .map((row) => mapRevision(row, optionByRevision.get(numberOrNull(row.revision) ?? -1) ?? []))
    .filter((row): row is PricingRevisionSummary => row !== null);
  const current = revisions.find((row) => row.revision === currentRevision) ?? null;
  const eventsByGrant = new Map<string, RawRecord>();
  for (const event of rows(input.grantEvents)) {
    if (event.action === "revoked") eventsByGrant.set(text(event.grant_id), event);
  }

  const accountsById = new Map<string, { name: string; email: string }>();
  for (const account of rows(input.accounts)) {
    const id = text(account.id);
    if (id) accountsById.set(id, { name: text(account.display_name), email: text(account.email) });
  }
  const accountReadFailed = input.readErrors?.includes("comp account labels") ?? false;

  const comps = rows(input.grants)
    .filter((row) => row.feature_key === "form_coach" && row.grant_kind === "comp")
    .map((row) => {
      const id = text(row.id);
      const revoked = eventsByGrant.get(id);
      const recipient = accountsById.get(text(row.user_id));
      const grantor = accountsById.get(text(row.granted_by));
      const revoker = revoked ? accountsById.get(text(revoked.actor_id)) : undefined;
      return {
        id,
        recipientName: recipient?.name || recipient?.email || (accountReadFailed ? "" : "Deleted account"),
        recipientEmail: recipient?.email || null,
        recipientDeleted: !recipient && !accountReadFailed,
        grantedByName: grantor?.name || grantor?.email || (accountReadFailed ? "" : "Deleted account"),
        grantedByEmail: grantor?.email || null,
        startsAt: text(row.starts_at),
        expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
        reason: text(row.reason),
        grantedAt: text(row.granted_at),
        revoked: Boolean(revoked),
        revokedAt: revoked ? text(revoked.recorded_at) : null,
        revokedByName: revoked ? (revoker?.name || revoker?.email || (accountReadFailed ? "" : "Deleted account")) : null,
        revokedByEmail: revoked ? (revoker?.email || null) : null,
      };
    });

  const objectsByRequest = new Map<string, PricingAdminDashboard["syncRequests"][number]["objects"]>();
  for (const row of rows(input.syncObjects)) {
    const requestId = text(row.request_id);
    const kind = row.object_kind;
    if (kind !== "product" && kind !== "price") continue;
    const list = objectsByRequest.get(requestId) ?? [];
    list.push({ kind, priceKey: typeof row.price_key === "string" ? row.price_key : null, state: text(row.state) });
    objectsByRequest.set(requestId, list);
  }
  const syncRequests = rows(input.syncRequests).map((row) => ({
    expectedRevision: numberOrNull(row.expected_revision) ?? 0,
    publishedRevision: numberOrNull(row.published_revision),
    state: text(row.state),
    updatedAt: text(row.updated_at),
    objects: objectsByRequest.get(text(row.request_id)) ?? [],
  }));

  const moveStateCounts: Record<string, number> = {};
  for (const row of rows(input.moveStates)) {
    const state = text(row.state) || "unknown";
    moveStateCounts[state] = (moveStateCounts[state] ?? 0) + 1;
  }

  return {
    current,
    revisions,
    changes: rows(input.changes).map((row) => ({
      revision: numberOrNull(row.revision) ?? 0,
      previousRevision: numberOrNull(row.previous_revision),
      changedAt: text(row.recorded_at),
    })),
    syncRequests,
    comps,
    legacyContractCount: input.legacyContractCount,
    moveStateCounts,
    readErrors: input.readErrors ?? [],
  };
}

export type ExistingPricingRequest = {
  request_id: string;
  feature_key: string;
  expected_revision: number;
  requested_by: string;
  request_digest: string;
  candidate_payload: unknown;
  state: string;
  published_revision: number | null;
};

export function matchesPricingRequest(input: {
  request: ExistingPricingRequest;
  requestId: string;
  adminId: string;
  expectedRevision: number;
  digest: string;
  candidate: PricingCandidate;
}): boolean {
  const { request } = input;
  return request.request_id === input.requestId
    && request.feature_key === "form_coach"
    && request.expected_revision === input.expectedRevision
    && request.requested_by === input.adminId
    && request.request_digest === input.digest
    && samePricingCandidate(request.candidate_payload, input.candidate);
}

async function read<T>(name: string, query: PromiseLike<{ data: T | null; error: unknown }>, errors: string[]) {
  try {
    const result = await query;
    if (result.error) errors.push(name);
    return result.data;
  } catch {
    errors.push(name);
    return null;
  }
}

async function readCount(
  name: string,
  query: PromiseLike<{ count: number | null; error: unknown }>,
  errors: string[],
): Promise<number | null> {
  try {
    const result = await query;
    if (result.error) errors.push(name);
    return result.count;
  } catch {
    errors.push(name);
    return null;
  }
}

/** Read the full stable admin RPC result or fail closed; never mistake a truncated page for a missing account. */
export async function loadAllAdminUsers(
  session: Awaited<ReturnType<typeof createClient>>,
): Promise<RawRecord[]> {
  const users: RawRecord[] = [];
  const seenIds = new Set<string>();
  let totalCount: number | null = null;
  let offset = 0;
  let pages = 0;

  while (totalCount === null || offset < totalCount) {
    if (pages >= ADMIN_USER_MAX_PAGES) throw new Error("Admin user pagination exceeded its page limit");
    const { data, error, count } = await session
      .rpc("admin_list_users", {}, { count: "exact" })
      .order("id", { ascending: true })
      .range(offset, offset + ADMIN_USER_PAGE_SIZE - 1);
    if (error) throw error;
    if (count === null || !Number.isSafeInteger(count) || count < 0 || count > ADMIN_USER_MAX_ROWS) {
      throw new Error("Admin user count is missing or exceeds the safe read limit");
    }
    if (totalCount === null) totalCount = count;
    else if (count !== totalCount) throw new Error("Admin user list changed during pagination");
    if (!Array.isArray(data)) throw new Error("Admin user pagination did not return rows");
    const pageRows = rows(data);
    if (totalCount === 0) {
      if (pageRows.length !== 0) throw new Error("Admin user count disagrees with its first page");
      return [];
    }
    if (pageRows.length !== data.length || pageRows.length === 0 || pageRows.length > ADMIN_USER_PAGE_SIZE || offset + pageRows.length > totalCount) {
      throw new Error("Admin user pagination returned an incomplete page");
    }
    for (const row of pageRows) {
      const id = text(row.id);
      if (!UuidSchema.safeParse(id).success || seenIds.has(id)) {
        throw new Error("Admin user pagination returned a missing or duplicate identity");
      }
      seenIds.add(id);
    }
    users.push(...pageRows);
    offset += pageRows.length;
    pages += 1;
  }

  if (users.length !== totalCount) throw new Error("Admin user pagination did not return its exact count");
  return users;
}

/** Read revocation events only for the visible Form Coach comp grants. */
export async function readVisibleCompRevocationEvents(
  db: ReturnType<typeof createAdminClient>,
  grants: unknown,
): Promise<RawRecord[]> {
  const grantIds = [...new Set(rows(grants)
    .filter((grant) => grant.feature_key === "form_coach" && grant.grant_kind === "comp")
    .map((grant) => text(grant.id))
    .filter(Boolean))];
  if (grantIds.length === 0) return [];

  const { data, error } = await db
    .from("feature_access_grant_events")
    .select("grant_id,action,actor_id,recorded_at")
    .eq("action", "revoked")
    .in("grant_id", grantIds);
  if (error) throw error;
  return rows(data);
}

/** Admin-only server loader. Queries sensitive tables only after its own authorization check. */
export async function loadPricingAdminDashboard(): Promise<PricingAdminDashboard> {
  await requireAdmin();
  const db = createAdminClient();
  const errors: string[] = [];
  const [current, revisions, options, changes, syncRequests, syncObjects, grants, legacyContractCount, moveIntents] = await Promise.all([
    read("current pricing", db.from("feature_pricing_current").select("feature_key,revision,changed_at").eq("feature_key", "form_coach").maybeSingle(), errors),
    read("pricing revisions", db.from("feature_pricing_revisions").select("feature_key,revision,status,payer,billing_model,currency,display_name,description,marketing_copy,trial_days,trial_assessments,created_at").eq("feature_key", "form_coach").order("revision", { ascending: false }).limit(50), errors),
    read("pricing options", db.from("feature_pricing_options").select("feature_key,revision,price_key,amount_cents,currency,interval,credits_per_pack").eq("feature_key", "form_coach").order("revision", { ascending: false }).limit(100), errors),
    read("pricing history", db.from("feature_pricing_change_log").select("feature_key,revision,previous_revision,recorded_at").eq("feature_key", "form_coach").order("id", { ascending: false }).limit(50), errors),
    read("pricing sync requests", db.from("feature_pricing_sync_requests").select("request_id,expected_revision,state,published_revision,updated_at").eq("feature_key", "form_coach").order("created_at", { ascending: false }).limit(25), errors),
    read("pricing sync states", db.from("feature_pricing_sync_objects").select("request_id,object_kind,price_key,state").order("created_at", { ascending: false }).limit(100), errors),
    read("comp grants", db.from("feature_access_grants").select("id,feature_key,grant_kind,user_id,starts_at,expires_at,reason,granted_by,granted_at").eq("feature_key", "form_coach").eq("grant_kind", "comp").order("granted_at", { ascending: false }).limit(50), errors),
    readCount("legacy subscription contracts", db.from("feature_subscription_contract_current").select("stripe_subscription_id", { count: "exact", head: true }).eq("feature_key", "form_coach"), errors),
    read("subscriber move requests", db.from("feature_subscription_contract_move_intents").select("request_id").eq("feature_key", "form_coach").limit(100), errors),
  ]);
  const moveIntentIds = rows(moveIntents).map((row) => text(row.request_id)).filter(Boolean);
  const moveStates = moveIntentIds.length
    ? await read("subscriber move states", db.from("feature_subscription_contract_move_state").select("request_id,state").in("request_id", moveIntentIds), errors)
    : [];
  const session = await createClient();
  let accounts: unknown = null;
  try {
    accounts = await loadAllAdminUsers(session);
  } catch {
    errors.push("comp account labels");
  }
  let grantEvents: unknown = [];
  try {
    grantEvents = await readVisibleCompRevocationEvents(db, grants);
  } catch {
    errors.push("comp revocations");
  }

  return toPricingAdminDashboard({
    current,
    revisions,
    options,
    changes,
    syncRequests,
    syncObjects,
    grants,
    grantEvents,
    accounts,
    legacyContractCount,
    moveStates,
    readErrors: errors,
  });
}

export function pricingAdminErrorCode(error: unknown): string | null {
  const row = record(error);
  return typeof row?.code === "string" ? row.code : null;
}

export function pricingAdminErrorMessage(error: unknown): string {
  const row = record(error);
  return typeof row?.message === "string" ? row.message : "";
}
