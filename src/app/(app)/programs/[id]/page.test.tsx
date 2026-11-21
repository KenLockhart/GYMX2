import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getT: vi.fn(),
  getLocale: vi.fn(),
  notFound: vi.fn(),
  paidAuthoringEnabled: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAccount: mocks.requireAccount }));
vi.mock("@/lib/program-authoring-server", () => ({
  isProgramPaidAuthoringEnabled: mocks.paidAuthoringEnabled,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/stream", () => ({
  getPlayerUrl: vi.fn(),
  isStreamConfigured: vi.fn(() => false),
}));
vi.mock("@/lib/program-progress-data", () => ({
  loadProgramProgressSummariesForProgram: vi.fn(async () => []),
}));
vi.mock("@/lib/achievements-data", () => ({
  syncProgressQuietly: vi.fn(),
}));
vi.mock("@/i18n/server", () => ({
  getT: mocks.getT,
  getLocale: mocks.getLocale,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/form-parts", () => ({
  ActionForm: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  Field: () => null,
  FormStatus: () => null,
  SubmitButton: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
vi.mock("@/components/game-parts", () => ({
  PillarTag: ({ pillar }: { pillar: string }) => <span>{pillar}</span>,
}));

import ProgramPage from "./page";

const PROGRAM_ID = "10000000-0000-4000-8000-000000000001";
const MEMBER_ID = "20000000-0000-4000-8000-000000000002";
const OWNER_ID = "70000000-0000-4000-8000-000000000007";
const OPEN_LESSON_ID = "30000000-0000-4000-8000-000000000003";
const LOCKED_LESSON_ID = "40000000-0000-4000-8000-000000000004";

function lesson(id: string, ordinal: number, title: string) {
  return {
    id,
    source_day_id: null,
    lesson_ordinal: ordinal,
    timeline_day_number: ordinal,
    title,
    pillar: "body",
  };
}

function progress(mode: "paid_order" | "legacy_free" = "paid_order") {
  return {
    program_id: PROGRAM_ID,
    member_id: MEMBER_ID,
    program_title: "Foundations",
    program_uses_versions: true,
    mode,
    access_authorized: true,
    enrollment_id: "50000000-0000-4000-8000-000000000005",
    content_version_id: "60000000-0000-4000-8000-000000000006",
    started_on: null,
    access_started_on: "2026-11-18",
    eastern_today: "2026-11-19",
    timeline_ceiling: 2,
    paid_ceiling: 1,
    lesson_ceiling: 1,
    cleared_installments: 1,
    installment_count: 3,
    fully_funded: false,
    required_count: 2,
    current_completed_count: 0,
    lifetime_completed_count: 0,
    required_lessons: [
      lesson(OPEN_LESSON_ID, 1, "Open lesson"),
      {
        ...lesson(LOCKED_LESSON_ID, 2, "Locked lesson title"),
        instructions: "LOCKED LESSON PRIVATE INSTRUCTIONS",
      },
    ],
    accessible_lessons: [
      {
        ...lesson(OPEN_LESSON_ID, 1, "Open lesson"),
        instructions: "Visible lesson instructions",
      },
    ],
    accessible_lesson_ids: [OPEN_LESSON_ID],
    current_completed_lesson_ids: [],
    completed_once: [],
    history: [],
  };
}

let rawProgress: unknown;
let queries: string[];
let adminQueries: string[];
let adminDays: unknown[];
let programVisible: boolean;

function makeClient() {
  return {
    rpc: vi.fn(async () => ({ data: rawProgress, error: null })),
    from(table: string) {
      queries.push(table);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        order: vi.fn(() => query),
        in: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data:
            table === "programs" && programVisible
              ? {
                  id: PROGRAM_ID,
                  coach_id: "70000000-0000-4000-8000-000000000007",
                  title: "Foundations",
                  description: "Program overview",
                  published: true,
                  platform_owned: false,
                  intro_video_id: null,
                  coach: { display_name: "Coach" },
                }
              : null,
          error: null,
        })),
      };
      return query;
    },
  };
}

async function renderPage() {
  const element = await ProgramPage({ params: Promise.resolve({ id: PROGRAM_ID }) });
  return renderToStaticMarkup(element);
}

describe("Program member detail progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queries = [];
    adminQueries = [];
    adminDays = [];
    programVisible = true;
    rawProgress = progress();
    mocks.requireAccount.mockResolvedValue({
      profile: { id: MEMBER_ID, role: "member" },
    });
    mocks.paidAuthoringEnabled.mockReturnValue(false);
    mocks.createClient.mockResolvedValue(makeClient());
    mocks.createAdminClient.mockReturnValue({
      from(table: string) {
        adminQueries.push(table);
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          order: vi.fn(() => query),
          then: (
            resolve: (value: { data: unknown[]; error: null }) => unknown,
          ) => Promise.resolve(resolve({ data: table === "program_days" ? adminDays : [], error: null })),
        };
        return query;
      },
    });
    mocks.getLocale.mockResolvedValue("en");
    mocks.getT.mockResolvedValue({
      programs: {
        back: "Back",
        days: (label: string) => `Program days · ${label}`,
        byCoach: (coach: string) => `Program · ${coach}`,
        weeks: (count: number) => `${count} lessons`,
        daysDone: (done: number, total: number) => `${done} of ${total} done`,
        upNext: (ordinal: number) => `Up next: lesson ${ordinal}`,
        caughtUp: "Caught up",
        dayTitle: (ordinal: number, title: string) => `Lesson ${ordinal}: ${title}`,
        startToday: "Start today",
        starting: "Starting",
        saving: "Saving",
        undo: "Undo",
        markDone: "Mark done",
        leaving: "Leaving",
        leave: "Leave",
        confirmLeave: (title: string) => `Leave ${title}?`,
        historyProgress: (count: number) => `${count} in saved history`,
        watch: (title: string) => `Watch ${title}`,
        theVideo: "the video",
        unlocks: (date: string) => `Unlocks ${date}`,
        program: "Program",
        programTitle: "Program title",
        description: "Description",
        introVideoOptional: "Intro video",
        noIntroVideo: "No intro video",
        introVideoHint: "Intro video hint",
        published: "Published",
        publishedPlatformHint: "Published platform hint",
        publishedHint: "Published hint",
        saveProgram: "Save Program",
        confirmRemoveDay: (day: number) => `Remove day ${day}?`,
        removing: "Removing",
        remove: "Remove",
        edit: "Edit",
        addDayN: (day: number) => `Add day ${day}`,
        membersOn: "Members",
        nobody: "Nobody",
        aMember: "A member",
        currentProgress: (done: number, total: number) => `${done} of ${total}`,
        confirmDelete: (title: string) => `Delete ${title}?`,
        deleting: "Deleting",
        delete: "Delete",
        day: "Day",
        dayTitlePlaceholder: "Day title",
        pillar: "Pillar",
        choose: "Choose",
        instructions: "Instructions",
        videoOptional: "Video (optional)",
        noVideo: "No video",
        saveDay: "Save day",
        addDay: "Add day",
      },
      options: { pillars: { body: "Body", mind: "Mind", spirit: "Spirit" } },
    });
    mocks.notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  it("shows only unlocked instructions from the canonical paid-stage projection", async () => {
    const html = await renderPage();

    expect(html).toContain("Visible lesson instructions");
    expect(html).toContain("Locked lesson title");
    expect(html).not.toContain("LOCKED LESSON PRIVATE INSTRUCTIONS");
    expect(queries).toEqual(["programs"]);
  });

  it("does not load lessons when the self progress RPC denies the reader", async () => {
    rawProgress = null;

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(queries).toEqual(["programs"]);
  });

  it("renders only saved history when the live Program is no longer visible", async () => {
    programVisible = false;
    rawProgress = {
      ...progress(),
      mode: "history_only",
      access_authorized: false,
      required_lessons: [],
      accessible_lessons: [],
      accessible_lesson_ids: [],
      current_completed_lesson_ids: [],
      completed_once: [
        {
          lesson_identity_id: "80000000-0000-4000-8000-000000000008",
          first_completed_at: "2026-11-10T12:00:00Z",
          title: "Saved immutable lesson",
          pillar: "mind",
        },
      ],
      history: [
        {
          version_id: "60000000-0000-4000-8000-000000000006",
          lesson_id: "90000000-0000-4000-8000-000000000009",
          lesson_identity_id: "80000000-0000-4000-8000-000000000008",
          lesson_ordinal: 1,
          timeline_day_number: 1,
          title: "Saved immutable lesson",
          pillar: "mind",
          state: "completed",
          event_sequence: 1,
          occurred_at: "2026-11-10T12:00:00Z",
        },
      ],
    };

    const html = await renderPage();

    expect(html).toContain("Foundations");
    expect(html).toContain("Saved immutable lesson");
    expect(html).not.toContain("Visible lesson instructions");
    expect(queries).toEqual(["programs"]);
  });

  it("lets a non-owning admin preview current days without author or learner controls", async () => {
    mocks.requireAccount.mockResolvedValue({
      profile: { id: "80000000-0000-4000-8000-000000000008", role: "admin" },
    });
    adminDays = [
      {
        id: "90000000-0000-4000-8000-000000000009",
        program_id: PROGRAM_ID,
        day_number: 1,
        title: "Current lesson",
        instructions: "Preview-only lesson details.",
        pillar: "body",
        video_id: "video-current",
        video: { title: "Current lesson video" },
      },
    ];

    const html = await renderPage();

    expect(html).toContain("Foundations");
    expect(html).toContain("Preview-only lesson details.");
    expect(html).toContain('href="/programs/10000000-0000-4000-8000-000000000001/days/90000000-0000-4000-8000-000000000009"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Start today");
    expect(html).not.toContain("Delete");
    expect(queries).toEqual(["programs"]);
    expect(adminQueries).toEqual(["program_days"]);
  });

  it("does not elevate another coach to the admin preview", async () => {
    mocks.requireAccount.mockResolvedValue({
      profile: { id: "80000000-0000-4000-8000-000000000008", role: "coach" },
    });

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adminQueries).toHaveLength(0);
  });

  it("shows the authoring link only to the exact owner when the feature is enabled", async () => {
    mocks.requireAccount.mockResolvedValue({ profile: { id: OWNER_ID, role: "coach" } });
    mocks.paidAuthoringEnabled.mockReturnValue(true);

    const html = await renderPage();

    expect(html).toContain(`href="/programs/${PROGRAM_ID}/manage"`);
    expect(html).toContain("Paid content and pricing");
  });

  it("keeps the authoring link hidden when the feature is disabled", async () => {
    mocks.requireAccount.mockResolvedValue({ profile: { id: OWNER_ID, role: "coach" } });

    const html = await renderPage();

    expect(html).not.toContain(`/programs/${PROGRAM_ID}/manage`);
    expect(html).not.toContain("Paid content and pricing");
  });
});
