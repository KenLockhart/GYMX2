import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCoachOrAdmin: vi.fn(),
  requireAccount: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  redirect: vi.fn(),
  rpc: vi.fn(),
  after: vi.fn(),
  revalidatePath: vi.fn(),
  syncProgressQuietly: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireCoachOrAdmin: mocks.requireCoachOrAdmin,
  requireAccount: mocks.requireAccount,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/achievements", () => ({ isPillar: vi.fn(() => true) }));
vi.mock("@/lib/achievements-data", () => ({ syncProgressQuietly: mocks.syncProgressQuietly }));

import { createProgram, saveProgramDay, setProgramDayDone } from "./actions";

const PROGRAM_ID = "10000000-0000-4000-8000-000000000001";
const VIDEO_ID = "30000000-0000-4000-8000-000000000003";
const CREATOR_ID = "40000000-0000-4000-8000-000000000004";
const OTHER_ID = "60000000-0000-4000-8000-000000000006";

function selection(data: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  return query;
}

function dayForm(videoId: string) {
  const data = new FormData();
  data.set("program_id", PROGRAM_ID);
  data.set("day_id", "");
  data.set("day_number", "1");
  data.set("title", "Day one");
  data.set("pillar", "body");
  data.set("instructions", "Move well.");
  data.set("video_id", videoId);
  return data;
}

function form() {
  const data = new FormData();
  data.set("title", "Intro-backed program");
  data.set("description", "Description");
  data.set("intro_video_id", "");
  return data;
}

function progressForm(done: boolean, operationId = "50000000-0000-4000-8000-000000000005") {
  const data = new FormData();
  data.set("program_id", PROGRAM_ID);
  data.set("day_id", "20000000-0000-4000-8000-000000000002");
  data.set("operation_id", operationId);
  data.set("done", String(done));
  return data;
}

function configureProgressRpc(result: { data: unknown; error: unknown }) {
  mocks.rpc.mockResolvedValue(result);
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.requireAccount.mockResolvedValue({
    profile: { id: CREATOR_ID, role: "member" },
  });
}

describe("createProgram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.single.mockResolvedValue({ data: { id: "program-id" }, error: null });
    mocks.select.mockReturnValue({ single: mocks.single });
    mocks.insert.mockReturnValue({ select: mocks.select });
    mocks.from.mockReturnValue({ insert: mocks.insert });
    mocks.createClient.mockResolvedValue({ from: mocks.from });
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`REDIRECT:${destination}`);
    });
  });

  it("creates an admin program as platform-owned", async () => {
    mocks.requireCoachOrAdmin.mockResolvedValue({
      profile: { id: "admin-id", role: "admin" },
    });

    await expect(createProgram({}, form())).rejects.toThrow(
      "REDIRECT:/programs/program-id",
    );
    expect(mocks.insert).toHaveBeenCalledWith({
      coach_id: "admin-id",
      title: "Intro-backed program",
      description: "Description",
      platform_owned: true,
      intro_video_id: null,
    });
  });

  it("keeps coach programs coach-owned", async () => {
    mocks.requireCoachOrAdmin.mockResolvedValue({
      profile: { id: "coach-id", role: "coach" },
    });

    await expect(createProgram({}, form())).rejects.toThrow(
      "REDIRECT:/programs/program-id",
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        coach_id: "coach-id",
        platform_owned: false,
      }),
    );
  });
});

describe("saveProgramDay video attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCoachOrAdmin.mockResolvedValue({
      profile: { id: CREATOR_ID, role: "coach" },
    });
  });

  function configureSave(video: { id: string; coach_id: string; status: string }) {
    const tables: string[] = [];
    mocks.from.mockImplementation((table: string) => {
      tables.push(table);
      if (table === "programs") {
        return selection({ coach_id: CREATOR_ID, platform_owned: false });
      }
      if (table === "videos") return selection(video);
      return { insert: vi.fn() };
    });
    mocks.rpc.mockResolvedValue({ data: "saved-day-id", error: null });
    mocks.createClient.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
    return { tables };
  }

  it("rejects a day video that belongs to another creator", async () => {
    const { tables } = configureSave({
      id: VIDEO_ID,
      coach_id: OTHER_ID,
      status: "ready",
    });

    const result = await saveProgramDay({}, dayForm(VIDEO_ID));

    expect(result.error).toBe("Choose one of your ready videos.");
    expect(tables).toEqual(["programs", "videos"]);
  });

  it("rejects a day video that is still processing", async () => {
    const { tables } = configureSave({
      id: VIDEO_ID,
      coach_id: CREATOR_ID,
      status: "processing",
    });

    const result = await saveProgramDay({}, dayForm(VIDEO_ID));

    expect(result.error).toBe("Choose one of your ready videos.");
    expect(tables).toEqual(["programs", "videos"]);
  });

  it("saves a ready video owned by the program creator through the lock-aware RPC", async () => {
    const { tables } = configureSave({
      id: VIDEO_ID,
      coach_id: CREATOR_ID,
      status: "ready",
    });

    const result = await saveProgramDay({}, dayForm(VIDEO_ID));

    expect(result).toEqual({ message: "Saved." });
    expect(tables).toEqual(["programs", "videos"]);
    expect(mocks.rpc).toHaveBeenCalledWith("save_owned_program_day", {
      target_program_id: PROGRAM_ID,
      target_day_id: null,
      target_day_number: 1,
      target_title: "Day one",
      target_instructions: "Move well.",
      target_pillar: "body",
      target_video_id: VIDEO_ID,
    });
  });
});

describe("setProgramDayDone idempotent progress result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces every RPC error, including an unexpected unique violation", async () => {
    configureProgressRpc({
      data: null,
      error: { code: "23505" },
    });

    const result = await setProgramDayDone({}, progressForm(true));

    expect(result.error).toBe("We couldn't save that. Please try again.");
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not award or resync an exact replay after a later undo", async () => {
    configureProgressRpc({
      data: { accepted: true, replayed: true, current_completed: false },
      error: null,
    });

    const result = await setProgramDayDone({}, progressForm(true));

    expect(result).toEqual({ message: "Saved." });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("set_my_program_lesson_state", {
      target_program_id: PROGRAM_ID,
      target_lesson_id: "20000000-0000-4000-8000-000000000002",
      target_done: true,
      target_operation_id: "50000000-0000-4000-8000-000000000005",
    });
  });

  it("uses neutral feedback when a new operation restores a completion", async () => {
    configureProgressRpc({
      data: { accepted: true, replayed: false, current_completed: true },
      error: null,
    });

    const result = await setProgramDayDone({}, progressForm(true, "70000000-0000-4000-8000-000000000007"));

    expect(result).toEqual({ message: "Saved." });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/programs/${PROGRAM_ID}`);
  });
});
