import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  isStreamConfigured: vi.fn(),
  getPlayerUrl: vi.fn(),
  getT: vi.fn(),
  todayKey: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAccount: mocks.requireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/stream", () => ({
  isStreamConfigured: mocks.isStreamConfigured,
  getPlayerUrl: mocks.getPlayerUrl,
}));
vi.mock("@/i18n/server", () => ({ getT: mocks.getT }));
vi.mock("@/lib/reminders", () => ({ todayKey: mocks.todayKey }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import ProgramDayVideoPage from "./page";

const PROGRAM_ID = "10000000-0000-4000-8000-000000000001";
const DAY_ID = "20000000-0000-4000-8000-000000000002";
const VIDEO_ID = "30000000-0000-4000-8000-000000000003";
const CREATOR_ID = "40000000-0000-4000-8000-000000000004";
const MEMBER_ID = "50000000-0000-4000-8000-000000000005";
const OTHER_ID = "60000000-0000-4000-8000-000000000006";
const PROGRAM = {
  id: PROGRAM_ID,
  coach_id: CREATOR_ID,
  title: "Foundation",
  published: true,
};
const DAY = {
  id: DAY_ID,
  program_id: PROGRAM_ID,
  day_number: 1,
  title: "Day One",
  instructions: "Start slowly.",
  video_id: VIDEO_ID,
};
const ENROLLMENT = {
  id: "70000000-0000-4000-8000-000000000007",
  program_id: PROGRAM_ID,
  member_id: MEMBER_ID,
  started_on: "2026-11-18",
};
const VIDEO = {
  id: VIDEO_ID,
  coach_id: CREATOR_ID,
  title: "Day One Video",
  description: "A private program lesson.",
  cloudflare_uid: "cloudflare-uid",
  status: "ready",
};
const LEGACY_PROGRESS = {
  program_id: PROGRAM_ID,
  member_id: MEMBER_ID,
  program_title: "Foundation",
  program_uses_versions: false,
  mode: "legacy_free",
  access_authorized: true,
  enrollment_id: ENROLLMENT.id,
  content_version_id: null,
  started_on: ENROLLMENT.started_on,
  access_started_on: null,
  eastern_today: "2026-11-18",
  timeline_ceiling: 1,
  paid_ceiling: 1,
  lesson_ceiling: 1,
  cleared_installments: 0,
  installment_count: 0,
  fully_funded: false,
  required_count: 1,
  current_completed_count: 0,
  lifetime_completed_count: 0,
  required_lessons: [
    {
      id: DAY_ID,
      source_day_id: DAY_ID,
      lesson_ordinal: 1,
      timeline_day_number: 1,
      title: "Day One",
      pillar: "body",
    },
  ],
  accessible_lessons: [
    {
      id: DAY_ID,
      source_day_id: DAY_ID,
      lesson_ordinal: 1,
      timeline_day_number: 1,
      title: "Day One",
      pillar: "body",
      instructions: "Start slowly.",
    },
  ],
  accessible_lesson_ids: [DAY_ID],
  current_completed_lesson_ids: [],
  completed_once: [],
  history: [],
};

type QueryRecord = { table: string; filters: [string, unknown][] };

const userRows = new Map<string, unknown>();
const adminRows = new Map<string, unknown>();
let userQueries: QueryRecord[];
let adminQueries: QueryRecord[];
let viewer: { id: string; role: "member" | "coach" | "admin" | "moderator" };

function clientFor(rows: Map<string, unknown>, queries: QueryRecord[]) {
  return {
    rpc: vi.fn(async (name: string) => ({
      data: name === "get_program_versioned_progress" ? rows.get("progress") ?? null : null,
      error: null,
    })),
    from(table: string) {
      const record: QueryRecord = { table, filters: [] };
      queries.push(record);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          record.filters.push([column, value]);
          return query;
        }),
        maybeSingle: vi.fn(async () => ({ data: rows.get(table) ?? null, error: null })),
      };
      return query;
    },
  };
}

function callPage() {
  return ProgramDayVideoPage({
    params: Promise.resolve({ id: PROGRAM_ID, dayId: DAY_ID }),
  });
}

describe("program day playback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRows.clear();
    adminRows.clear();
    userQueries = [];
    adminQueries = [];
    viewer = { id: MEMBER_ID, role: "member" };
    userRows.set("programs", PROGRAM);
    userRows.set("program_days", DAY);
    userRows.set("program_enrollments", ENROLLMENT);
    userRows.set("progress", LEGACY_PROGRESS);
    adminRows.set("program_days", DAY);
    adminRows.set("videos", VIDEO);
    mocks.requireAccount.mockImplementation(async () => ({ profile: viewer }));
    mocks.createClient.mockImplementation(async () =>
      clientFor(userRows, userQueries),
    );
    mocks.createAdminClient.mockImplementation(() =>
      clientFor(adminRows, adminQueries),
    );
    mocks.isStreamConfigured.mockReturnValue(true);
    mocks.getPlayerUrl.mockResolvedValue(
      "https://customer.example.test/signed-token/iframe",
    );
    mocks.getT.mockResolvedValue({
      programs: {
        back: "Back to program",
        dayTitle: (number: number, title: string) => `Day ${number}: ${title}`,
      },
      library: { cantPlay: "This video cannot play right now." },
    });
    mocks.todayKey.mockReturnValue("2026-11-18");
    mocks.notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  it("signs only the ready video attached to the exact visible, unlocked member day", async () => {
    await callPage();

    expect(mocks.getPlayerUrl).toHaveBeenCalledOnce();
    expect(mocks.getPlayerUrl).toHaveBeenCalledWith("cloudflare-uid");
    expect(userQueries[0]).toMatchObject({
      table: "programs",
      filters: [["id", PROGRAM_ID]],
    });
    expect(userQueries[1]).toMatchObject({
      table: "program_days",
      filters: [
        ["id", DAY_ID],
        ["program_id", PROGRAM_ID],
      ],
    });
    expect(adminQueries[0]).toMatchObject({
      table: "videos",
      filters: [
        ["id", VIDEO_ID],
        ["coach_id", CREATOR_ID],
        ["status", "ready"],
      ],
    });
  });

  it("does not sign or load a video without a verified progress projection", async () => {
    userRows.set("progress", null);

    await expect(callPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adminQueries).toHaveLength(0);
    expect(mocks.getPlayerUrl).not.toHaveBeenCalled();
  });

  it("rejects a locked day before loading its private video", async () => {
    userRows.set("progress", {
      ...LEGACY_PROGRESS,
      accessible_lesson_ids: [],
      accessible_lessons: [],
    });

    await expect(callPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adminQueries).toHaveLength(0);
    expect(mocks.getPlayerUrl).not.toHaveBeenCalled();
  });

  it.each(["free_snapshot", "paid_order"] as const)(
    "does not expose versioned %s media through the legacy playback route",
    async (mode) => {
      userRows.set("progress", { ...LEGACY_PROGRESS, mode });

      await expect(callPage()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(adminQueries).toHaveLength(0);
      expect(mocks.getPlayerUrl).not.toHaveBeenCalled();
    },
  );

  it("rejects programs hidden from this signed-in viewer", async () => {
    userRows.set("programs", null);

    await expect(callPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(userQueries.map(({ table }) => table)).toEqual(["programs"]);
    expect(adminQueries).toHaveLength(0);
  });

  it("rejects a day returned for another program", async () => {
    userRows.set("program_days", {
      ...DAY,
      program_id: OTHER_ID,
    });

    await expect(callPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adminQueries).toHaveLength(0);
  });

  it("rejects a progress projection for another member", async () => {
    userRows.set("progress", { ...LEGACY_PROGRESS, member_id: OTHER_ID });

    await expect(callPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adminQueries).toHaveLength(0);
    expect(mocks.getPlayerUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["another creator's video", { coach_id: OTHER_ID, status: "ready" }],
    ["a video that is not ready", { coach_id: CREATOR_ID, status: "processing" }],
    ["a different video id", { id: OTHER_ID, coach_id: CREATOR_ID, status: "ready" }],
  ])("rejects %s", async (_name, override) => {
    adminRows.set("videos", {
      ...VIDEO,
      ...override,
    });

    await expect(callPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getPlayerUrl).not.toHaveBeenCalled();
  });

  it("lets the creator preview an unpublished day without member enrollment", async () => {
    viewer = { id: CREATOR_ID, role: "coach" };
    userRows.set("programs", {
      ...PROGRAM,
      published: false,
    });

    await callPage();

    expect(userQueries.some(({ table }) => table === "program_enrollments")).toBe(
      false,
    );
    expect(mocks.getPlayerUrl).toHaveBeenCalledWith("cloudflare-uid");
  });

  it("lets admins preview a program without member enrollment", async () => {
    viewer = { id: OTHER_ID, role: "admin" };
    userRows.delete("program_days");

    await callPage();

    expect(userQueries.some(({ table }) => table === "program_enrollments")).toBe(
      false,
    );
    expect(userQueries.map(({ table }) => table)).toEqual(["programs"]);
    expect(adminQueries.map(({ table }) => table)).toEqual([
      "program_days",
      "videos",
    ]);
    expect(mocks.getPlayerUrl).toHaveBeenCalledWith("cloudflare-uid");
  });

  it("does not elevate another coach to an admin day lookup", async () => {
    viewer = { id: OTHER_ID, role: "coach" };

    await expect(callPage()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(userQueries.map(({ table }) => table)).toEqual([
      "programs",
      "program_days",
    ]);
    expect(adminQueries).toHaveLength(0);
    expect(mocks.getPlayerUrl).not.toHaveBeenCalled();
  });
});
