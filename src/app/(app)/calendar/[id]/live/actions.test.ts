import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCoach: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  after: vi.fn(),
  notifyLiveNow: vi.fn(),
  createLiveInput: vi.fn(),
  deleteLiveInput: vi.fn(),
  getLiveIngestUrl: vi.fn(),
  isLiveStreamConfigured: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/achievements-data", () => ({ syncProgressQuietly: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAccount: vi.fn(),
  requireCoach: mocks.requireCoach,
}));
vi.mock("@/lib/notify", () => ({ notifyLiveNow: mocks.notifyLiveNow }));
vi.mock("@/lib/stream", () => ({
  createLiveInput: mocks.createLiveInput,
  deleteLiveInput: mocks.deleteLiveInput,
  getLiveIngestUrl: mocks.getLiveIngestUrl,
  isLiveStreamConfigured: mocks.isLiveStreamConfigured,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { endLive, markLive, prepareBroadcast } from "./actions";

const coachId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const openSession = {
  id: sessionId,
  coach_id: coachId,
  title: "Strength session",
  starts_at: "2026-11-15T00:00:00.000Z",
  ends_at: "2026-11-16T23:59:00.000Z",
  live_mode: "broadcast",
};

function sessionClient(session: typeof openSession | null = openSession) {
  return {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: session, error: null }),
      };
      return query;
    },
  };
}

function liveRoomAdmin(options: {
  startedAt?: string | null;
  endedAt?: string | null;
  updateError?: { code?: string; message?: string } | null;
} = {}) {
  const state = {
    startedAt: options.startedAt ?? null,
    endedAt: options.endedAt ?? null,
  };

  const client = {
    from: () => {
      let operation: "select" | "update" = "select";
      let values: Record<string, unknown> = {};
      const filters: Record<string, string> = {};
      const query = {
        select: () => query,
        update: (next: Record<string, unknown>) => {
          operation = "update";
          values = next;
          return query;
        },
        eq: (column: string, value: string) => {
          filters[column] = value;
          return query;
        },
        is: (column: string, value: unknown) => {
          filters[`is:${column}`] = String(value);
          return query;
        },
        not: (column: string, operator: string, value: string) => {
          filters[`not:${column}`] = `${operator}:${value}`;
          return query;
        },
        maybeSingle: async () => {
          if (operation !== "update")
            return {
              data: state.startedAt
                ? {
                    live_started_at: state.startedAt,
                    live_ended_at: state.endedAt,
                  }
                : null,
              error: null,
            };
          if (options.updateError)
            return { data: null, error: options.updateError };
          if (filters["is:live_started_at"] === "null") {
            if (state.startedAt) return { data: null, error: null };
            state.startedAt = String(values.live_started_at);
            state.endedAt = null;
            return { data: { session_id: sessionId }, error: null };
          }
          if (filters["not:live_started_at"] === "is:null") {
            if (!state.startedAt) return { data: null, error: null };
            state.endedAt = (values.live_ended_at as string | null) ?? null;
            return { data: { session_id: sessionId }, error: null };
          }
          return { data: null, error: null };
        },
        then: (
          resolve: (result: { data: null; error: unknown }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: null, error: options.updateError ?? null }).then(resolve, reject),
      };
      return query;
    },
  };
  return { client, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T12:00:00.000Z"));
  mocks.requireCoach.mockResolvedValue({ profile: { id: coachId } });
  mocks.createClient.mockResolvedValue(sessionClient());
  mocks.isLiveStreamConfigured.mockReturnValue(true);
  mocks.after.mockImplementation((callback: () => unknown) => callback());
  mocks.notifyLiveNow.mockResolvedValue(undefined);
  mocks.deleteLiveInput.mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

describe("live session server actions", () => {
  it("rejects group broadcast actions for a private one-on-one session", async () => {
    mocks.createClient.mockResolvedValue(
      sessionClient({ ...openSession, live_mode: "one_on_one" }),
    );

    await expect(prepareBroadcast(sessionId)).resolves.toEqual({
      error: "Use the private one-on-one live controls for this session.",
    });
    await expect(markLive(sessionId)).resolves.toEqual({
      error: "Use the private one-on-one live controls for this session.",
    });
    await expect(endLive(sessionId)).resolves.toEqual({
      error: "Use the private one-on-one live controls for this session.",
    });
    expect(mocks.createLiveInput).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not return a group ingest address if the session becomes private while Cloudflare responds", async () => {
    mocks.createClient
      .mockResolvedValueOnce(sessionClient())
      .mockResolvedValueOnce(
        sessionClient({ ...openSession, live_mode: "one_on_one" }),
      );
    mocks.getLiveIngestUrl.mockResolvedValue("https://stream.test/secret-ingest");
    mocks.createAdminClient.mockReturnValue({
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: { input_uid: "existing-group-input" },
            error: null,
          }),
        };
        return query;
      },
    });

    await expect(prepareBroadcast(sessionId)).resolves.toEqual({
      error: "We couldn't open the live room. Please try again.",
    });
    expect(mocks.getLiveIngestUrl).toHaveBeenCalledOnce();
  });

  it("rechecks the broadcast window when the connection finishes negotiating", async () => {
    const outsideWindow = {
      ...openSession,
      starts_at: "2030-01-01T12:00:00Z",
      ends_at: "2030-01-01T13:00:00Z",
    };
    mocks.createClient.mockResolvedValue(sessionClient(outsideWindow));

    await expect(markLive(sessionId)).resolves.toEqual({
      error:
        "You can go live from 30 minutes before the start until an hour after the end.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("reports a room write failure instead of telling the coach the room is live", async () => {
    const admin = liveRoomAdmin({ updateError: { code: "XX001", message: "write failed" } });
    mocks.createAdminClient.mockReturnValue(admin.client);

    await expect(markLive(sessionId)).resolves.toEqual({
      error: "We couldn't mark the session as live. Please try again.",
    });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("sends the start notification only to the atomic first-start winner", async () => {
    const admin = liveRoomAdmin();
    mocks.createAdminClient.mockReturnValue(admin.client);

    const results = await Promise.all([markLive(sessionId), markLive(sessionId)]);

    expect(results).toEqual([{}, {}]);
    expect(admin.state.startedAt).toBeTruthy();
    expect(admin.state.endedAt).toBeNull();
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.notifyLiveNow).toHaveBeenCalledOnce();
  });

  it("reports an end write failure so the room does not appear locally ended", async () => {
    const admin = liveRoomAdmin({
      startedAt: "2026-11-15T12:00:00.000Z",
      updateError: { code: "XX001", message: "write failed" },
    });
    mocks.createAdminClient.mockReturnValue(admin.client);

    await expect(endLive(sessionId)).resolves.toEqual({
      error: "We couldn't end the live session. Please try again.",
    });
  });

  it("ends an unstarted room idempotently when there is nothing to update", async () => {
    const admin = liveRoomAdmin();
    mocks.createAdminClient.mockReturnValue(admin.client);

    await expect(endLive(sessionId)).resolves.toEqual({});
    expect(admin.state.endedAt).toBeNull();
  });

  it("does not report success if a live row remains active after a zero-row update", async () => {
    mocks.createAdminClient.mockReturnValue({
      from: () => {
        let operation: "select" | "update" = "select";
        const query = {
          select: () => query,
          update: () => {
            operation = "update";
            return query;
          },
          eq: () => query,
          not: () => query,
          maybeSingle: async () => {
            if (operation === "select")
              return {
                data: {
                  live_started_at: "2026-11-15T11:00:00.000Z",
                  live_ended_at: null,
                },
                error: null,
              };
            return { data: null, error: null };
          },
        };
        return query;
      },
    });

    await expect(endLive(sessionId)).resolves.toEqual({
      error: "We couldn't end the live session. Please try again.",
    });
  });

  it("cleans a duplicate provider input and reuses the winning room row", async () => {
    let stored: { session_id: string; input_uid: string; playback_url: string } | null = null;
    let next = 0;
    mocks.createLiveInput.mockImplementation(async () => {
      next += 1;
      return { uid: `input-${next}`, playbackUrl: `https://stream.test/play-${next}` };
    });
    mocks.getLiveIngestUrl.mockImplementation(async (uid: string) => `https://stream.test/ingest/${uid}`);
    mocks.createAdminClient.mockReturnValue({
      from: () => {
        let insert: typeof stored = null;
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: stored, error: null }),
          insert: (row: typeof stored) => {
            insert = row;
            return Promise.resolve().then(() => {
              if (stored)
                return {
                  error: {
                    code: "23505",
                    constraint: "session_live_pkey",
                    message: "duplicate session",
                  },
                };
              stored = insert;
              return { error: null };
            });
          },
        };
        return query;
      },
    });

    const results = await Promise.all([
      prepareBroadcast(sessionId),
      prepareBroadcast(sessionId),
    ]);

    expect(results.every((result) => Boolean(result.ingestUrl))).toBe(true);
    expect(mocks.deleteLiveInput).toHaveBeenCalledOnce();
    const deletedUid = mocks.deleteLiveInput.mock.calls[0]?.[0];
    expect(["input-1", "input-2"]).toContain(deletedUid);
    expect(mocks.getLiveIngestUrl).toHaveBeenCalledTimes(2);
    const reusedUids = mocks.getLiveIngestUrl.mock.calls.map(([uid]) => uid);
    expect(reusedUids).toHaveLength(2);
    expect(reusedUids[1]).toBe(reusedUids[0]);
    expect(reusedUids[0]).not.toBe(deletedUid);
  });

  it("cleans a just-created input when a private-mode race rejects the room insert", async () => {
    mocks.createLiveInput.mockResolvedValue({
      uid: "unused-after-mode-change",
      playbackUrl: "https://stream.test/playback",
    });
    mocks.createAdminClient.mockReturnValue({
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
          insert: async () => ({
            error: { code: "23514", message: "room blocked by private mode" },
          }),
        };
        return query;
      },
    });

    await expect(prepareBroadcast(sessionId)).resolves.toEqual({
      error: "We couldn't open the live room. Please try again.",
    });
    expect(mocks.deleteLiveInput).toHaveBeenCalledWith(
      "unused-after-mode-change",
    );
    expect(mocks.getLiveIngestUrl).not.toHaveBeenCalled();
  });
});
