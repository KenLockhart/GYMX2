import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  createClient: vi.fn(),
  getMemberCoachIntakeClearance: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("@/lib/auth", () => ({ requireAccount: mocks.requireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/member-intake-server", () => ({
  getMemberCoachIntakeClearance: mocks.getMemberCoachIntakeClearance,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import SessionJoinPage from "./page";

const sessionId = "33333333-3333-4333-8333-333333333333";
const coachId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
});

function installSession(
  meetingUrl: string | null = "https://meet.example/session",
  inviteMemberIds: string[] = [memberId],
) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: {
        id: sessionId,
        coach_id: coachId,
        meeting_url: meetingUrl,
        session_invites: inviteMemberIds.map((id) => ({ member_id: id })),
      },
      error: null,
    }),
  };
  mocks.createClient.mockResolvedValue({ from: () => query });
}

describe("session join gate", () => {
  it("redirects an authorized member only to the stored HTTPS meeting URL", async () => {
    installSession();
    mocks.requireAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    mocks.getMemberCoachIntakeClearance.mockResolvedValue("cleared");

    await expect(SessionJoinPage({ params: Promise.resolve({ id: sessionId }) }))
      .rejects.toThrow("NEXT_REDIRECT:https://meet.example/session");
  });

  it("routes a cleared member with no external URL to session detail", async () => {
    installSession(null);
    mocks.requireAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    mocks.getMemberCoachIntakeClearance.mockResolvedValue("cleared");

    await expect(SessionJoinPage({ params: Promise.resolve({ id: sessionId }) }))
      .rejects.toThrow(`NEXT_REDIRECT:/calendar/${sessionId}`);
  });

  it("keeps the intake redirect ahead of the missing-URL fallback", async () => {
    installSession(null);
    mocks.requireAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    mocks.getMemberCoachIntakeClearance.mockResolvedValue("needs_intake");

    await expect(SessionJoinPage({ params: Promise.resolve({ id: sessionId }) }))
      .rejects.toThrow(`NEXT_REDIRECT:/intake?coach=${coachId}&returnTo=${encodeURIComponent(`/calendar/${sessionId}/join`)}`);
  });

  it("denies an uninvited member even when no external URL is configured", async () => {
    installSession(null, []);
    mocks.requireAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });

    await expect(SessionJoinPage({ params: Promise.resolve({ id: sessionId }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getMemberCoachIntakeClearance).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalledWith(`/calendar/${sessionId}`);
  });

  it.each(["http://meet.example/session", "javascript:alert(1)", "https://user:pass@meet.example/session"])(
    "rejects unsafe stored meeting destinations (%s)",
    async (meetingUrl) => {
      installSession(meetingUrl);
      mocks.requireAccount.mockResolvedValue({ profile: { id: coachId, role: "coach" } });

      await expect(SessionJoinPage({ params: Promise.resolve({ id: sessionId }) }))
        .rejects.toThrow("NEXT_NOT_FOUND");
      expect(mocks.redirect).not.toHaveBeenCalledWith(meetingUrl);
    },
  );
});
