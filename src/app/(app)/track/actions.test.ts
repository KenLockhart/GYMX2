import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MEMBER_ID = "e0000000-0000-4000-8000-000000000001";
const HABIT_ID = "e0000000-0000-4000-8000-000000000002";
const PHOTO_ID = "e0000000-0000-4000-8000-000000000003";

const mocks = vi.hoisted(() => ({
  role: "member",
  from: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  removeStorage: vi.fn(),
  revalidatePath: vi.fn(),
  after: vi.fn(),
  syncProgressQuietly: vi.fn(),
  query: null as null | {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireAccount: async () => ({
    profile: { id: "e0000000-0000-4000-8000-000000000001", role: mocks.role },
  }),
}));
vi.mock("@/lib/achievements-data", () => ({
  syncProgressQuietly: mocks.syncProgressQuietly,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mocks.from }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: mocks.createSignedUploadUrl,
        remove: mocks.removeStorage,
      }),
    },
  }),
}));

import {
  deleteProgressPhoto,
  prepareProgressPhoto,
  saveBodyLog,
  saveNutritionLog,
  saveProgressPhoto,
  setHabitDone,
} from "./actions";

const today = "2026-11-11";
const yesterday = "2026-11-10";
const tomorrow = "2026-11-12";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T20:00:00.000Z"));
  mocks.role = "member";

  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.delete.mockReturnValue(query);
  mocks.query = query;
  mocks.from.mockReturnValue(query);
  mocks.createSignedUploadUrl.mockResolvedValue({
    data: { path: `${MEMBER_ID}/00000000-0000-4000-8000-000000000004.jpg`, token: "signed" },
    error: null,
  });
  mocks.removeStorage.mockResolvedValue({ error: null });
});

afterEach(() => vi.useRealTimers());

describe("member tracking write actions", () => {
  it.each([yesterday, tomorrow])(
    "rejects habit updates for %s before touching storage",
    async (day) => {
      await expect(setHabitDone(HABIT_ID, day, true)).resolves.toEqual({
        error: "Only today's tracking can be changed.",
      });
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it.each([yesterday, tomorrow])(
    "rejects body log saves for %s before touching storage",
    async (day) => {
      await expect(
        saveBodyLog({}, form({ day, weight_lb: "180", body_fat_pct: "", waist_in: "" })),
      ).resolves.toEqual({ error: "Only today's tracking can be changed." });
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it.each([yesterday, tomorrow])(
    "rejects nutrition saves for %s before touching storage",
    async (day) => {
      await expect(
        saveNutritionLog({}, form({ day, protein_g: "150", calories: "", water_glasses: "" })),
      ).resolves.toEqual({ error: "Only today's tracking can be changed." });
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it.each([yesterday, tomorrow])(
    "rejects progress photo upload preparation for %s before signing a URL",
    async (day) => {
      await expect(
        prepareProgressPhoto({ fileName: "progress.jpg", size: 1000, day }),
      ).resolves.toEqual({ error: "Only today's tracking can be changed." });
      expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
    },
  );

  it.each([yesterday, tomorrow])(
    "rejects progress photo saves for %s before inserting a row",
    async (day) => {
      await expect(
        saveProgressPhoto({
          path: `${MEMBER_ID}/00000000-0000-4000-8000-000000000004.jpg`,
          pose: "front",
          day,
        }),
      ).resolves.toEqual({ error: "Only today's tracking can be changed." });
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it("blocks deleting a historical photo before deleting its row or object", async () => {
    mocks.query!.maybeSingle.mockResolvedValueOnce({ data: { day: yesterday } });

    await expect(
      deleteProgressPhoto({}, form({ photo_id: PHOTO_ID })),
    ).resolves.toEqual({ error: "Only today's tracking can be changed." });
    expect(mocks.query!.delete).not.toHaveBeenCalled();
    expect(mocks.removeStorage).not.toHaveBeenCalled();
  });

  it("allows member writes dated today", async () => {
    await expect(setHabitDone(HABIT_ID, today, true)).resolves.toEqual({});
    await expect(
      saveBodyLog({}, form({ day: today, weight_lb: "180", body_fat_pct: "", waist_in: "" })),
    ).resolves.toEqual({ message: "Saved." });
    await expect(
      saveNutritionLog({}, form({ day: today, protein_g: "150", calories: "", water_glasses: "" })),
    ).resolves.toEqual({ message: "Saved." });
    expect(mocks.query!.insert).toHaveBeenCalledWith({
      habit_id: HABIT_ID,
      user_id: MEMBER_ID,
      day: today,
    });
    expect(mocks.query!.upsert).toHaveBeenCalledTimes(2);
  });

  it("can prepare and save a member photo dated today", async () => {
    await expect(
      prepareProgressPhoto({ fileName: "progress.jpg", size: 1000, day: today }),
    ).resolves.toEqual({
      path: `${MEMBER_ID}/00000000-0000-4000-8000-000000000004.jpg`,
      token: "signed",
    });
    await expect(
      saveProgressPhoto({
        path: `${MEMBER_ID}/00000000-0000-4000-8000-000000000004.jpg`,
        pose: "front",
        day: today,
      }),
    ).resolves.toEqual({});
    expect(mocks.query!.insert).toHaveBeenCalledWith({
      user_id: MEMBER_ID,
      path: `${MEMBER_ID}/00000000-0000-4000-8000-000000000004.jpg`,
      pose: "front",
      day: today,
    });
  });

  it("can delete a member photo dated today", async () => {
    mocks.query!.maybeSingle
      .mockResolvedValueOnce({ data: { day: today } })
      .mockResolvedValueOnce({ data: { path: `${MEMBER_ID}/today.jpg` } });

    await expect(
      deleteProgressPhoto({}, form({ photo_id: PHOTO_ID })),
    ).resolves.toEqual({ message: "Deleted." });
    expect(mocks.removeStorage).toHaveBeenCalledWith([`${MEMBER_ID}/today.jpg`]);
  });

  it("preserves the coach seven-day action window", async () => {
    mocks.role = "coach";
    await expect(setHabitDone(HABIT_ID, yesterday, true)).resolves.toEqual({});
    expect(mocks.query!.insert).toHaveBeenCalledWith({
      habit_id: HABIT_ID,
      user_id: MEMBER_ID,
      day: yesterday,
    });
  });
});
