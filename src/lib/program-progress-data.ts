import "server-only";
import type { Pillar } from "@/lib/achievements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ProgramProgressSummary = {
  program_id: string;
  program_title: string;
  program_exists: boolean;
  member_id: string;
  enrollment_id: string | null;
  mode:
    | "legacy_free"
    | "free_snapshot"
    | "paid_order"
    | "history_only"
    | "not_enrolled";
  content_version_id: string | null;
  started_on: string | null;
  required_count: number;
  current_completed_count: number;
  completed_once_count: number;
};

export type ProgramCompletedOnceActivity = {
  member_id: string;
  program_id: string;
  lesson_identity_id: string;
  first_completed_at: string;
  pillar: Pillar | null;
};

export type ProgramReminderCandidate = {
  member_id: string;
  program_id: string;
  program_title: string;
  enrollment_id: string;
  content_version_id: string | null;
  lesson_id: string;
  lesson_title: string;
  lesson_ordinal: number;
  timeline_day_number: number;
  reminder_key: string;
};

export type ProgramProgressHistoryFact = {
  lessonOrdinal: number;
  timelineDayNumber: number;
  title: string;
  pillar: Pillar;
  state: "completed" | "undone";
  occurredAt: string;
};

export type ProgramProgressRpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

type SummaryPage<T> = {
  rows: T[];
  has_more: boolean;
  page: number;
  page_size: number;
};

type OffsetPage<T> = {
  rows: T[];
  has_more: boolean;
  next_offset: number;
};

const PAGE_SIZE = 50;
const BATCH_SIZE = 200;
const PAGE_ROW_LIMIT = 50_000;
const OFFSET_ROW_LIMIT = 100_000;
const REQUEST_LIMIT = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isPillar(value: unknown): value is Pillar {
  return value === "mind" || value === "body" || value === "spirit";
}

function parseSummary(value: unknown): ProgramProgressSummary | null {
  if (!isRecord(value)) return null;
  const modes: ProgramProgressSummary["mode"][] = [
    "legacy_free",
    "free_snapshot",
    "paid_order",
    "history_only",
    "not_enrolled",
  ];
  if (
    !isNonEmptyString(value.program_id) ||
    !isNonEmptyString(value.program_title) ||
    typeof value.program_exists !== "boolean" ||
    !isNonEmptyString(value.member_id) ||
    !isNullableString(value.enrollment_id) ||
    typeof value.mode !== "string" ||
    !modes.includes(value.mode as ProgramProgressSummary["mode"]) ||
    !isNullableString(value.content_version_id) ||
    !isNullableString(value.started_on) ||
    !isNonNegativeInteger(value.required_count) ||
    !isNonNegativeInteger(value.current_completed_count) ||
    !isNonNegativeInteger(value.completed_once_count)
  ) {
    return null;
  }

  return {
    program_id: value.program_id,
    program_title: value.program_title,
    program_exists: value.program_exists,
    member_id: value.member_id,
    enrollment_id: value.enrollment_id,
    mode: value.mode as ProgramProgressSummary["mode"],
    content_version_id: value.content_version_id,
    started_on: value.started_on,
    required_count: value.required_count,
    current_completed_count: value.current_completed_count,
    completed_once_count: value.completed_once_count,
  };
}

function parseActivity(value: unknown): ProgramCompletedOnceActivity | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.member_id) ||
    !isNonEmptyString(value.program_id) ||
    !isNonEmptyString(value.lesson_identity_id) ||
    !isNonEmptyString(value.first_completed_at) ||
    !Number.isFinite(new Date(value.first_completed_at).getTime()) ||
    (value.pillar !== null && !isPillar(value.pillar))
  ) {
    return null;
  }
  return {
    member_id: value.member_id,
    program_id: value.program_id,
    lesson_identity_id: value.lesson_identity_id,
    first_completed_at: value.first_completed_at,
    pillar: value.pillar,
  };
}

function parseReminder(value: unknown): ProgramReminderCandidate | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.member_id) ||
    !isNonEmptyString(value.program_id) ||
    !isNonEmptyString(value.program_title) ||
    !isNonEmptyString(value.enrollment_id) ||
    !isNullableString(value.content_version_id) ||
    !isNonEmptyString(value.lesson_id) ||
    !isNonEmptyString(value.lesson_title) ||
    !isPositiveInteger(value.lesson_ordinal) ||
    !isPositiveInteger(value.timeline_day_number) ||
    !isNonEmptyString(value.reminder_key)
  ) {
    return null;
  }
  return {
    member_id: value.member_id,
    program_id: value.program_id,
    program_title: value.program_title,
    enrollment_id: value.enrollment_id,
    content_version_id: value.content_version_id,
    lesson_id: value.lesson_id,
    lesson_title: value.lesson_title,
    lesson_ordinal: value.lesson_ordinal,
    timeline_day_number: value.timeline_day_number,
    reminder_key: value.reminder_key,
  };
}

async function callRpcPage<T>(
  client: ProgramProgressRpcClient,
  name: string,
  args: Record<string, unknown>,
  parseRow: (value: unknown) => T | null,
): Promise<Record<string, unknown> & { rows: T[] }> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error("Program progress is temporarily unavailable.");
  if (!isRecord(data) || !Array.isArray(data.rows)) {
    throw new Error("Program progress returned an invalid response.");
  }
  const rows = data.rows.map(parseRow);
  if (rows.some((row) => row === null)) {
    throw new Error("Program progress returned an invalid response.");
  }
  return { ...data, rows: rows as T[] };
}

async function summaryPages(
  client: ProgramProgressRpcClient,
  filters: { programId?: string | null; memberId?: string | null },
) {
  const result: ProgramProgressSummary[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= REQUEST_LIMIT; page += 1) {
    const response = await callRpcPage(
      client,
      "list_program_progress_summaries",
      {
        target_page: page,
        target_page_size: PAGE_SIZE,
        target_program_id: filters.programId ?? null,
        target_member_id: filters.memberId ?? null,
      },
      parseSummary,
    );
    const summaryResponse = response as unknown as SummaryPage<ProgramProgressSummary>;
    if (
      summaryResponse.page !== page ||
      summaryResponse.page_size !== PAGE_SIZE ||
      typeof summaryResponse.has_more !== "boolean" ||
      summaryResponse.rows.length > PAGE_SIZE
    ) {
      throw new Error("Program progress returned an invalid response.");
    }
    for (const row of summaryResponse.rows) {
      const key = `${row.program_id}:${row.member_id}`;
      if (seen.has(key)) {
        throw new Error("Program progress returned duplicate subjects.");
      }
      seen.add(key);
    }
    result.push(...summaryResponse.rows);
    if (result.length > PAGE_ROW_LIMIT) {
      throw new Error("Program progress exceeded the supported result limit.");
    }
    if (!summaryResponse.has_more) return result;
    if (summaryResponse.rows.length === 0) {
      throw new Error("Program progress returned an invalid response.");
    }
  }
  throw new Error("Program progress exceeded the supported page limit.");
}

async function offsetPages<T>(input: {
  client: ProgramProgressRpcClient;
  name: string;
  baseArgs: Record<string, unknown>;
  parseRow: (value: unknown) => T | null;
}) {
  const result: T[] = [];
  let offset = 0;
  for (let request = 0; request < REQUEST_LIMIT; request += 1) {
    const response = await callRpcPage(
      input.client,
      input.name,
      {
        ...input.baseArgs,
        target_offset: offset,
        target_limit: BATCH_SIZE,
      },
      input.parseRow,
    );
    const offsetResponse = response as unknown as OffsetPage<T>;
    if (
      typeof offsetResponse.has_more !== "boolean" ||
      !isNonNegativeInteger(offsetResponse.next_offset) ||
      offsetResponse.rows.length > BATCH_SIZE ||
      (offsetResponse.has_more &&
        (offsetResponse.rows.length === 0 ||
          offsetResponse.next_offset !== offset + offsetResponse.rows.length))
    ) {
      throw new Error("Program progress returned an invalid response.");
    }
    result.push(...offsetResponse.rows);
    if (result.length > OFFSET_ROW_LIMIT) {
      throw new Error("Program progress exceeded the supported result limit.");
    }
    if (!offsetResponse.has_more) return result;
    offset = offsetResponse.next_offset;
  }
  throw new Error("Program progress exceeded the supported page limit.");
}

export async function loadOwnProgramProgressSummaries() {
  return summaryPages(
    (await createClient()) as unknown as ProgramProgressRpcClient,
    {},
  );
}

export async function loadProgramProgressSummariesForProgram(
  programId: string,
  client?: ProgramProgressRpcClient,
) {
  if (!isNonEmptyString(programId)) return [];
  const authenticatedClient =
    client ??
    ((await createClient()) as unknown as ProgramProgressRpcClient);
  return summaryPages(authenticatedClient, {
    programId,
  });
}

export async function loadProgramProgressSummariesForMember(memberId: string) {
  if (!isNonEmptyString(memberId)) return [];
  return summaryPages(createAdminClient() as unknown as ProgramProgressRpcClient, {
    memberId,
  });
}

// Explicit-member service read for the person's export. Only lesson history facts are returned;
// accessible lesson instructions and all media/provider identifiers are discarded.
export async function loadProgramProgressHistoryForMember(
  programId: string,
  memberId: string,
): Promise<ProgramProgressHistoryFact[]> {
  if (!isNonEmptyString(programId) || !isNonEmptyString(memberId)) return [];
  const { data, error } = await createAdminClient().rpc(
    "get_program_versioned_progress",
    {
      target_program_id: programId,
      target_member_id: memberId,
    },
  );
  if (error || !isRecord(data) || !Array.isArray(data.history)) {
    throw new Error("Program progress is temporarily unavailable.");
  }
  const facts = data.history.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      !isPositiveInteger(entry.lesson_ordinal) ||
      !isPositiveInteger(entry.timeline_day_number) ||
      !isNonEmptyString(entry.title) ||
      !isPillar(entry.pillar) ||
      (entry.state !== "completed" && entry.state !== "undone") ||
      !isNonEmptyString(entry.occurred_at)
    ) {
      return null;
    }
    return {
      lessonOrdinal: entry.lesson_ordinal,
      timelineDayNumber: entry.timeline_day_number,
      title: entry.title,
      pillar: entry.pillar,
      state: entry.state,
      occurredAt: entry.occurred_at,
    } satisfies ProgramProgressHistoryFact;
  });
  if (facts.some((fact) => fact === null)) {
    throw new Error("Program progress returned an invalid response.");
  }
  return facts as ProgramProgressHistoryFact[];
}

export async function loadProgramCompletedOnceActivity(input: {
  from: string | null;
  to: string | null;
  memberIds: string[];
  programId?: string | null;
}) {
  const memberIds = [...new Set(input.memberIds.filter(isNonEmptyString))];
  const client = createAdminClient() as unknown as ProgramProgressRpcClient;
  const records = new Map<string, ProgramCompletedOnceActivity>();
  for (let start = 0; start < memberIds.length; start += BATCH_SIZE) {
    const rows = await offsetPages({
      client,
      name: "list_program_completed_once_activity",
      baseArgs: {
        target_from: input.from,
        target_to: input.to,
        target_member_ids: memberIds.slice(start, start + BATCH_SIZE),
        target_program_id: input.programId ?? null,
      },
      parseRow: parseActivity,
    });
    for (const row of rows) {
      const key = `${row.member_id}:${row.program_id}:${row.lesson_identity_id}`;
      const previous = records.get(key);
      if (
        previous &&
        (previous.first_completed_at !== row.first_completed_at ||
          previous.pillar !== row.pillar)
      ) {
        throw new Error("Program progress returned conflicting history.");
      }
      records.set(key, row);
    }
  }
  return [...records.values()].sort(
    (a, b) =>
      a.first_completed_at.localeCompare(b.first_completed_at) ||
      a.member_id.localeCompare(b.member_id) ||
      a.program_id.localeCompare(b.program_id) ||
      a.lesson_identity_id.localeCompare(b.lesson_identity_id),
  );
}

export async function loadProgramReminderCandidates(input: {
  memberIds: string[];
  easternToday: string;
}) {
  const memberIds = [...new Set(input.memberIds.filter(isNonEmptyString))];
  const client = createAdminClient() as unknown as ProgramProgressRpcClient;
  const candidates = new Map<string, ProgramReminderCandidate>();
  for (let start = 0; start < memberIds.length; start += BATCH_SIZE) {
    const rows = await offsetPages({
      client,
      name: "get_program_reminder_candidates",
      baseArgs: {
        target_member_ids: memberIds.slice(start, start + BATCH_SIZE),
        target_eastern_today: input.easternToday,
      },
      parseRow: parseReminder,
    });
    for (const row of rows) {
      const key = `${row.member_id}:${row.reminder_key}`;
      if (candidates.has(key)) {
        throw new Error("Program reminder candidates were duplicated.");
      }
      candidates.set(key, row);
    }
  }
  return [...candidates.values()];
}

export type ProgramCatalogCountInput = { id: string; dayCount: number };
export type ProgramCatalogVersion = {
  program_id: string;
  current_content_version_id: string | null;
  revision_kind: "current" | "free_snapshot" | "paid" | null;
  lesson_count: number | null;
};

export function resolveProgramCatalogLessonCounts(
  programs: readonly ProgramCatalogCountInput[],
  versions: readonly ProgramCatalogVersion[],
) {
  const versionsByProgram = new Map(versions.map((row) => [row.program_id, row]));
  const counts = new Map<string, number>();
  for (const program of programs) {
    const version = versionsByProgram.get(program.id);
    if (version?.current_content_version_id && !version.revision_kind) {
      throw new Error("Program catalog version metadata is unavailable.");
    }
    if (version?.revision_kind && version.revision_kind !== "current") {
      if (
        version.lesson_count === null ||
        !isNonNegativeInteger(version.lesson_count)
      ) {
        throw new Error("Program catalog version metadata is unavailable.");
      }
      counts.set(program.id, version.lesson_count);
      continue;
    }
    counts.set(program.id, program.dayCount);
  }
  return counts;
}

// Caller supplies only live program IDs already returned by its authorized catalog query. A
// current mutable revision reads only current day counts by those IDs; immutable free/paid
// versions use their snapshot counts.
export async function loadProgramCatalogLessonCounts(
  programs: readonly ProgramCatalogCountInput[],
) {
  const unique = [...new Map(programs.map((program) => [program.id, program])).values()];
  if (unique.length === 0) return new Map<string, number>();
  const db = createAdminClient();
  const states: { program_id: string; current_content_version_id: string | null }[] = [];
  for (let start = 0; start < unique.length; start += BATCH_SIZE) {
    const ids = unique.slice(start, start + BATCH_SIZE).map((program) => program.id);
    const { data, error } = await db
      .from("program_commerce_state")
      .select("program_id, current_content_version_id")
      .in("program_id", ids);
    if (error) throw new Error("Program catalog metadata is unavailable.");
    states.push(...((data ?? []) as typeof states));
  }
  const versionIds = [
    ...new Set(
      states
        .map((row) => row.current_content_version_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const versions: {
    id: string;
    program_id: string;
    revision_kind: string;
    lesson_count: number | null;
  }[] = [];
  for (let start = 0; start < versionIds.length; start += BATCH_SIZE) {
    const ids = versionIds.slice(start, start + BATCH_SIZE);
    const { data, error } = await db
      .from("program_content_versions")
      .select("id, program_id, revision_kind, lesson_count")
      .in("id", ids);
    if (error) throw new Error("Program catalog metadata is unavailable.");
    versions.push(...((data ?? []) as typeof versions));
  }
  const versionById = new Map(
    versions.map((row) => [row.id, row]),
  );
  const countInputs: ProgramCatalogVersion[] = states.map((state) => {
    const version = state.current_content_version_id
      ? versionById.get(state.current_content_version_id)
      : undefined;
    return {
      program_id: state.program_id,
      current_content_version_id: state.current_content_version_id,
      revision_kind:
        version?.revision_kind === "current" ||
        version?.revision_kind === "free_snapshot" ||
        version?.revision_kind === "paid"
          ? version.revision_kind
          : null,
      lesson_count:
        isNonNegativeInteger(version?.lesson_count)
          ? version.lesson_count
          : null,
    };
  });
  const currentProgramIds = countInputs
    .filter((row) => row.revision_kind === "current")
    .map((row) => row.program_id);
  const currentDayCounts = new Map<string, number>();
  for (let start = 0; start < currentProgramIds.length; start += BATCH_SIZE) {
    const ids = currentProgramIds.slice(start, start + BATCH_SIZE);
    const { data, error } = await db
      .from("programs")
      .select("id, program_days(count)")
      .in("id", ids);
    if (error) throw new Error("Program catalog metadata is unavailable.");
    for (const row of data ?? []) {
      const programDays = row.program_days;
      const dayCount = Array.isArray(programDays)
        ? programDays[0]?.count
        : null;
      if (typeof row.id === "string" && isNonNegativeInteger(dayCount)) {
        currentDayCounts.set(row.id, dayCount);
      }
    }
  }
  if (currentProgramIds.some((id) => !currentDayCounts.has(id))) {
    throw new Error("Program catalog metadata is unavailable.");
  }
  const resolvedInputs = unique.map((program) => ({
    ...program,
    dayCount: currentDayCounts.get(program.id) ?? program.dayCount,
  }));
  return resolveProgramCatalogLessonCounts(resolvedInputs, countInputs);
}
