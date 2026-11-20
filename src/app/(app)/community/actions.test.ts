import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  after: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/auth", () => ({ requireAccount: mocks.requireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { deletePost } from "./actions";

const authorId = "11111111-1111-4111-8111-111111111111";
const postId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const storedUid = "synthetic-video-uid";
const fetchMock = vi.fn<typeof fetch>();

function userClient() {
  return {
    from(table: string) {
      if (table === "post_media") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [{ path: null, video_uid: storedUid }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "posts") {
        return {
          delete: () => ({
            eq: () => ({
              eq: () => ({
                select: async () => ({ data: [{ id: postId }], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe("community post VOD deletion ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", "test-token");
    vi.stubEnv("CLOUDFLARE_STREAM_CUSTOMER_CODE", "test-customer");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    mocks.requireAccount.mockResolvedValue({ profile: { id: authorId } });
    mocks.createClient.mockResolvedValue(userClient());
    mocks.createAdminClient.mockReturnValue({
      storage: { from: () => ({ remove: vi.fn() }) },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not delete a foreign provider UID stored on the author's post", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ result: { creator: "22222222-2222-4222-8222-222222222222" } }),
      ),
    );

    await expect(deletePost(postId)).resolves.toEqual({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).not.toBe("DELETE");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("deletes a post video only when Cloudflare confirms the post author's creator ID", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { creator: authorId } })),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await expect(deletePost(postId)).resolves.toEqual({});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.method).not.toBe("DELETE");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
  });
});
