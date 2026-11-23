import { beforeEach, describe, expect, it, vi } from "vitest";

const COACH_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { reviewCoachProfile, unpublishCoachProfile } from "./actions";

describe("admin coach profile publication actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("refreshes coach discovery after publishing the reviewed snapshot", async () => {
    await expect(
      reviewCoachProfile({ coachId: COACH_ID, approve: true, note: "" }),
    ).resolves.toEqual({});

    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("review_coach_profile", {
      target_coach_id: COACH_ID,
      approve: true,
      note: "",
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/admin/coach-profiles"],
      ["/coaches"],
      [`/coaches/${COACH_ID}`],
    ]);
  });

  it("does not invalidate public discovery when review requests changes", async () => {
    await expect(
      reviewCoachProfile({
        coachId: COACH_ID,
        approve: false,
        note: "Please update the photo.",
      }),
    ).resolves.toEqual({});

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("review_coach_profile", {
      target_coach_id: COACH_ID,
      approve: false,
      note: "Please update the photo.",
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/admin/coach-profiles"],
      [`/coaches/${COACH_ID}`],
    ]);
  });

  it("does not invalidate any route when the review RPC fails", async () => {
    mocks.rpc.mockResolvedValueOnce({
      error: { code: "P0001", message: "This profile isn't waiting for review" },
    });

    await expect(
      reviewCoachProfile({ coachId: COACH_ID, approve: true, note: "" }),
    ).resolves.toEqual({ error: "This profile isn't waiting for review." });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refreshes discovery and detail after admin unpublish succeeds", async () => {
    await expect(unpublishCoachProfile(COACH_ID)).resolves.toEqual({});

    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "unpublish_coach_profile",
      { target_coach_id: COACH_ID },
    );
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/admin/coach-profiles"],
      ["/coaches"],
      [`/coaches/${COACH_ID}`],
    ]);
  });

  it("does not invalidate routes when admin unpublish fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "rpc failed" } });

    await expect(unpublishCoachProfile(COACH_ID)).resolves.toEqual({
      error: "That didn't work.",
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
