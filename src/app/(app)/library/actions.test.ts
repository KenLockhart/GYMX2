import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAccount,
  mockCreateClient,
  mockCreateAdminClient,
  mockDeleteStreamVideo,
  mockIsStreamConfigured,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireAccount: vi.fn(),
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockDeleteStreamVideo: vi.fn(),
  mockIsStreamConfigured: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/auth", () => ({ requireAccount: mockRequireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/stream", () => ({
  deleteVideo: mockDeleteStreamVideo,
  isStreamConfigured: mockIsStreamConfigured,
}));

import { deleteVideo } from "./actions";

const coachId = "11111111-1111-4111-8111-111111111111";
const videoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const uid = "provider-video-uid";

function formData(id = videoId) {
  const form = new FormData();
  form.set("video_id", id);
  return form;
}

function userClient(options: {
  reservation?: { data: unknown; error: unknown };
  deletion?: { data: unknown; error: unknown };
  order?: string[];
} = {}) {
  const order = options.order ?? [];
  return {
    rpc: vi.fn(async (name: string) => {
      order.push(`rpc:${name}`);
      return options.reservation ?? { data: true, error: null };
    }),
    from: vi.fn((table: string) => ({
      delete: () => ({
        eq: () => ({
          select: async () => {
            order.push(`db-delete:${table}`);
            return options.deletion ?? { data: [{ id: videoId }], error: null };
          },
        }),
      }),
    })),
  };
}

function adminClient(options: { uid?: string | null; error?: unknown; order?: string[] } = {}) {
  const order = options.order ?? [];
  return {
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            order.push(`admin-read:${table}`);
            return options.error
              ? { data: null, error: options.error }
              : { data: options.uid === null ? null : { cloudflare_uid: options.uid ?? uid }, error: null };
          },
        }),
      }),
    })),
  };
}

describe("Library video deletion reservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAccount.mockResolvedValue({ profile: { id: coachId, role: "coach" } });
    mockIsStreamConfigured.mockReturnValue(true);
    mockDeleteStreamVideo.mockResolvedValue(undefined);
  });

  it("does not mutate database or provider when live stream configuration is missing", async () => {
    mockIsStreamConfigured.mockReturnValue(false);
    await expect(deleteVideo({}, formData())).resolves.toEqual({
      error: "We couldn't delete that video. Please try again.",
    });
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockDeleteStreamVideo).not.toHaveBeenCalled();
  });

  it.each([
    ["Daily Content", "Video is used by Daily Content or is still saved by a member", "daily-content-video-in-use"],
    ["Daily Fuel", "Video is assigned in Daily Fuel", "daily-fuel-video-in-use"],
  ])("maps a %s reservation conflict to its exact typed UI sentinel", async (_kind, message, sentinel) => {
    const user = userClient({ reservation: { data: null, error: { code: "23503", message } } });
    mockCreateClient.mockResolvedValue(user);

    await expect(deleteVideo({}, formData())).resolves.toEqual({ error: sentinel });
    expect(user.rpc).toHaveBeenCalledWith("reserve_daily_content_video_delete", {
      target_video_id: videoId,
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockDeleteStreamVideo).not.toHaveBeenCalled();
  });

  it("reserves before provider deletion and removes the row only after provider success", async () => {
    const order: string[] = [];
    const user = userClient({ order });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(adminClient({ order }));
    mockDeleteStreamVideo.mockImplementation(async () => { order.push("provider-delete"); });

    await expect(deleteVideo({}, formData())).resolves.toEqual({});
    expect(order).toEqual([
      "rpc:reserve_daily_content_video_delete",
      "admin-read:videos",
      "provider-delete",
      "db-delete:videos",
    ]);
    expect(mockDeleteStreamVideo).toHaveBeenCalledWith(uid);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/library/saved");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("keeps the row reserved and avoids row deletion when provider deletion fails", async () => {
    const order: string[] = [];
    const user = userClient({ order });
    mockCreateClient.mockResolvedValue(user);
    mockCreateAdminClient.mockReturnValue(adminClient({ order }));
    mockDeleteStreamVideo.mockRejectedValue(new Error("provider failure"));

    await expect(deleteVideo({}, formData())).resolves.toEqual({
      error: "We couldn't delete that video. Please try again.",
    });
    expect(order).toEqual([
      "rpc:reserve_daily_content_video_delete",
      "admin-read:videos",
    ]);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
