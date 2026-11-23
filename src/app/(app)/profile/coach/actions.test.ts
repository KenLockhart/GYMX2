import { beforeEach, describe, expect, it, vi } from "vitest";

const COACH_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_PATH = `${COACH_ID}/22222222-2222-4222-8222-222222222222.jpg`;

const mocks = vi.hoisted(() => ({
  requireCoach: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  from: vi.fn(),
  list: vi.fn(),
  createSignedUrl: vi.fn(),
  revalidatePath: vi.fn(),
  update: vi.fn(),
  writeEq: vi.fn(),
  writeSelect: vi.fn(),
  writeMaybeSingle: vi.fn(),
  insert: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireCoach: mocks.requireCoach }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { setCoachPhoto, unpublishMyProfile } from "./actions";

function makeDraftQuery(existing: boolean) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    update: mocks.update,
    insert: mocks.insert,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({
    data: existing ? { coach_id: COACH_ID } : null,
    error: null,
  });
  return query;
}

function expectPhotoRevalidations() {
  expect(mocks.revalidatePath.mock.calls).toEqual([
    ["/profile/coach"],
    ["/admin/coach-profiles"],
    [`/admin/coach-profiles/${COACH_ID}`],
  ]);
}

describe("coach photo and publication actions", () => {
  let query: ReturnType<typeof makeDraftQuery>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCoach.mockResolvedValue({ profile: { id: COACH_ID } });
    query = makeDraftQuery(true);
    mocks.from.mockReturnValue(query);
    mocks.createClient.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
    mocks.list.mockResolvedValue({
      data: [{ name: PHOTO_PATH.slice(COACH_ID.length + 1) }],
      error: null,
    });
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://photos.invalid/signed" },
      error: null,
    });
    mocks.update.mockReturnValue({ eq: mocks.writeEq });
    mocks.writeEq.mockReturnValue({ select: mocks.writeSelect });
    mocks.insert.mockReturnValue({ select: mocks.writeSelect });
    mocks.writeSelect.mockReturnValue({ maybeSingle: mocks.writeMaybeSingle });
    mocks.writeMaybeSingle.mockResolvedValue({
      data: { coach_id: COACH_ID, photo_path: PHOTO_PATH },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          list: mocks.list,
          createSignedUrl: mocks.createSignedUrl,
        })),
      },
    });
  });

  it("saves only the coach's private draft photo, then refreshes editor and review views", async () => {
    await expect(setCoachPhoto(PHOTO_PATH)).resolves.toEqual({
      url: "https://photos.invalid/signed",
    });

    expect(mocks.requireCoach).toHaveBeenCalledOnce();
    expect(mocks.list).toHaveBeenCalledWith(COACH_ID, {
      search: PHOTO_PATH.slice(COACH_ID.length + 1),
    });
    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(mocks.from.mock.calls).toEqual([
      ["coach_profile_drafts"],
      ["coach_profile_drafts"],
    ]);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      photo_path: PHOTO_PATH,
    });
    expect(mocks.writeEq).toHaveBeenCalledExactlyOnceWith("coach_id", COACH_ID);
    expect(mocks.writeSelect).toHaveBeenCalledExactlyOnceWith(
      "coach_id, photo_path",
    );
    expect(mocks.writeMaybeSingle).toHaveBeenCalledOnce();
    expectPhotoRevalidations();
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/coaches");
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(PHOTO_PATH, 60 * 60);
  });

  it("inserts a first draft photo and verifies the returned owner and path", async () => {
    query = makeDraftQuery(false);
    mocks.from.mockReturnValue(query);

    await expect(setCoachPhoto(PHOTO_PATH)).resolves.toEqual({
      url: "https://photos.invalid/signed",
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith({
      coach_id: COACH_ID,
      data: {},
      photo_path: PHOTO_PATH,
    });
    expect(mocks.writeSelect).toHaveBeenCalledExactlyOnceWith(
      "coach_id, photo_path",
    );
    expectPhotoRevalidations();
  });

  it("removes a draft photo and refreshes editor and review views after the verified write", async () => {
    mocks.writeMaybeSingle.mockResolvedValueOnce({
      data: { coach_id: COACH_ID, photo_path: null },
      error: null,
    });

    await expect(setCoachPhoto(null)).resolves.toEqual({ url: null });

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ photo_path: null });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expectPhotoRevalidations();
  });

  it.each([
    ["different coach", { coach_id: "22222222-2222-4222-8222-222222222222", photo_path: PHOTO_PATH }],
    ["different photo", { coach_id: COACH_ID, photo_path: `${COACH_ID}/33333333-3333-4333-8333-333333333333.png` }],
  ])("rejects a persisted row with a %s and does not invalidate", async (_case, saved) => {
    mocks.writeMaybeSingle.mockResolvedValueOnce({ data: saved, error: null });

    await expect(setCoachPhoto(PHOTO_PATH)).resolves.toEqual({
      error: "We couldn't save the photo.",
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("keeps the committed save revalidated when signed URL creation fails", async () => {
    mocks.createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: "signing failed" },
    });

    await expect(setCoachPhoto(PHOTO_PATH)).resolves.toEqual({ url: null });

    expectPhotoRevalidations();
    expect(mocks.createSignedUrl).toHaveBeenCalledOnce();
  });

  it("does not invalidate any view when the draft photo write fails", async () => {
    mocks.writeMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "write failed" },
    });

    await expect(setCoachPhoto(PHOTO_PATH)).resolves.toEqual({
      error: "We couldn't save the photo.",
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("does not report success or invalidate when the write affects no owned row", async () => {
    mocks.writeMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(setCoachPhoto(PHOTO_PATH)).resolves.toEqual({
      error: "We couldn't save the photo.",
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects a photo outside the coach's upload path before writing or invalidating", async () => {
    await expect(setCoachPhoto("another-coach/photo.jpg")).resolves.toEqual({
      error: "That photo upload didn't work.",
    });

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refreshes discovery and the public detail only after a successful self-unpublish", async () => {
    await expect(unpublishMyProfile()).resolves.toEqual({});

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("unpublish_coach_profile", {
      target_coach_id: COACH_ID,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/profile/coach"],
      ["/coaches"],
      [`/coaches/${COACH_ID}`],
    ]);
  });

  it("does not invalidate views when self-unpublish fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "rpc failed" } });

    await expect(unpublishMyProfile()).resolves.toEqual({
      error: "We couldn't take your profile down.",
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
