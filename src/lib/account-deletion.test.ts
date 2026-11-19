import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  cancelAllMemberships: vi.fn(),
  cancelAllPlatformMemberships: vi.fn(),
  sendEmail: vi.fn(),
  accountDeletedEmail: vi.fn(() => ({ subject: "Deleted" })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/membership-server", () => ({
  cancelAllMemberships: mocks.cancelAllMemberships,
}));
vi.mock("@/lib/platform-membership-server", () => ({
  cancelAllPlatformMemberships: mocks.cancelAllPlatformMemberships,
  isStripeConfigured: () => false,
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(),
  isStripeConfigured: () => false,
}));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/email-templates", () => ({
  accountDeletedEmail: mocks.accountDeletedEmail,
}));
vi.mock("@/lib/supabase/env", () => ({
  getSiteUrl: () => "http://localhost",
  getSupabaseEnv: () => ({
    url: "http://127.0.0.1:59999",
    publishableKey: "synthetic-key",
  }),
}));
vi.mock("@/lib/stream", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stream")>(
    "@/lib/stream",
  );
  return { ...actual, isStreamConfigured: () => true };
});

import { deleteAccount } from "./account-deletion";

const userId = "11111111-1111-4111-8111-111111111111";
const fetchMock = vi.fn<typeof fetch>();
let videoRows: { cloudflare_uid: string }[] = [];
let postVideoRows: { video_uid: string }[] = [];

function adminClient() {
  return {
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
    from(table: string) {
      return {
        select(selection: string) {
          const query = {
            eq() {
              return query;
            },
            not() {
              return query;
            },
            in() {
              return query;
            },
            then(
              resolve: (value: { data: unknown[]; error: null }) => unknown,
              reject: (reason: unknown) => unknown,
            ) {
              let data: unknown[] = [];
              if (table === "videos") data = videoRows;
              if (table === "post_media" && selection.startsWith("video_uid"))
                data = postVideoRows;
              return Promise.resolve({ data, error: null }).then(resolve, reject);
            },
          };
          return query;
        },
      };
    },
    auth: { admin: { deleteUser: vi.fn(async () => ({ error: null })) } },
  };
}

describe("account cleanup VOD ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", "test-token");
    vi.stubEnv("CLOUDFLARE_STREAM_CUSTOMER_CODE", "test-customer");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    videoRows = [];
    postVideoRows = [];
    mocks.createAdminClient.mockImplementation(adminClient);
    mocks.cancelAllMemberships.mockResolvedValue(undefined);
    mocks.cancelAllPlatformMemberships.mockResolvedValue(undefined);
    mocks.sendEmail.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not delete a foreign UID found in the account's video rows", async () => {
    videoRows = [{ cloudflare_uid: "synthetic-video-uid" }];
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ result: { creator: "22222222-2222-4222-8222-222222222222" } }),
      ),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      deleteAccount({ id: userId, email: "test@example.test", name: "Test" }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).not.toBe("DELETE");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not delete a foreign UID forged into the account's post media", async () => {
    postVideoRows = [{ video_uid: "synthetic-forged-post-video-uid" }];
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ result: { creator: "22222222-2222-4222-8222-222222222222" } }),
      ),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      deleteAccount({ id: userId, email: "test@example.test", name: "Test" }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/stream/synthetic-forged-post-video-uid",
    );
    expect(fetchMock.mock.calls[0][1]?.method).not.toBe("DELETE");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("checks the account being deleted as the expected creator before provider deletion", async () => {
    videoRows = [{ cloudflare_uid: "synthetic-video-uid" }];
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { creator: userId } })),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await expect(
      deleteAccount({ id: userId, email: "test@example.test", name: "Test" }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.method).not.toBe("DELETE");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
  });
});
