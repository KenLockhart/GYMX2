import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCoachOrAdmin: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireCoachOrAdmin: mocks.requireCoachOrAdmin,
  requireAccount: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/achievements", () => ({ isPillar: vi.fn(() => true) }));
vi.mock("@/lib/achievements-data", () => ({ syncProgressQuietly: vi.fn() }));

import { createProgram, saveProgramDay } from "./actions";

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
    const inserted = vi.fn(async () => ({ error: null }));
    const tables: string[] = [];
    mocks.from.mockImplementation((table: string) => {
      tables.push(table);
      if (table === "programs") {
        return selection({ coach_id: CREATOR_ID, platform_owned: false });
      }
      if (table === "videos") return selection(video);
      return { insert: inserted };
    });
    return { inserted, tables };
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

  it("saves a ready video owned by the program creator", async () => {
    const { inserted } = configureSave({
      id: VIDEO_ID,
      coach_id: CREATOR_ID,
      status: "ready",
    });

    const result = await saveProgramDay({}, dayForm(VIDEO_ID));

    expect(result).toEqual({ message: "Saved." });
    expect(inserted).toHaveBeenCalledWith({
      day_number: 1,
      title: "Day one",
      instructions: "Move well.",
      pillar: "body",
      video_id: VIDEO_ID,
      program_id: PROGRAM_ID,
    });
  });
});
