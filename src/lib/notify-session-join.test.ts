import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadRecipient: vi.fn(),
  sendEmail: vi.fn(),
  sendPush: vi.fn(),
  createAdminClient: vi.fn(),
  getSiteUrl: vi.fn(),
  sessionEmail: vi.fn(() => ({ subject: "session", html: "", text: "" })),
  introEmail: vi.fn(() => ({ subject: "intro", html: "", text: "" })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/email", () => ({ loadRecipient: mocks.loadRecipient, sendEmail: mocks.sendEmail }));
vi.mock("@/lib/push", () => ({ sendPush: mocks.sendPush }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/env", () => ({ getSiteUrl: mocks.getSiteUrl }));
vi.mock("@/lib/calendar", () => ({ formatEmailSessionTime: () => "Nov 20" }));
vi.mock("@/i18n/phrases", () => ({ translate: (text: string) => text }));
vi.mock("@/lib/message-flags", () => ({ describeFlags: vi.fn(), detectFlags: vi.fn() }));
vi.mock("@/lib/email-templates", () => ({
  flaggedMessageEmail: vi.fn(),
  introEmail: mocks.introEmail,
  liveNowEmail: vi.fn(() => ({ subject: "live", html: "", text: "" })),
  newMessageEmail: vi.fn(),
  newSaleEmail: vi.fn(),
  orderShippedEmail: vi.fn(),
  sessionEmail: mocks.sessionEmail,
}));

import { notifyIntro, notifySession } from "@/lib/notify";

const sessionId = "44444444-4444-4444-8444-444444444444";
const coachId = "22222222-2222-4222-8222-222222222222";
const memberId = "11111111-1111-4111-8111-111111111111";
const externalMeetingUrl = "https://meet.example/private-session";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSiteUrl.mockReturnValue("https://gymx2.example");
  mocks.loadRecipient.mockResolvedValue({
    email: "person@example.test",
    name: "Person",
    locale: "en",
    wantsUpdates: true,
  });
  mocks.sendEmail.mockResolvedValue(true);
  mocks.createAdminClient.mockReturnValue({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: {
            coach_id: coachId,
            member_id: memberId,
            message: "",
            session_id: sessionId,
            cancelled_by: null,
            slot: {
              starts_at: "2026-11-20T12:00:00.000Z",
              minutes: 30,
              format: "online",
              location: "",
              meeting_url: externalMeetingUrl,
            },
          },
          error: null,
        }),
      };
      return query;
    },
  });
});

describe("session meeting links sent in email", () => {
  it("uses the internal gated join route for calendar-session invitations", async () => {
    await notifySession("invited", {
      id: sessionId,
      coach_id: coachId,
      title: "Training",
      starts_at: "2026-11-20T12:00:00.000Z",
      ends_at: "2026-11-20T13:00:00.000Z",
      location: "",
      meeting_url: externalMeetingUrl,
    }, [memberId]);

    expect(mocks.sessionEmail).toHaveBeenCalledWith(expect.objectContaining({
      meetingUrl: `https://gymx2.example/calendar/${sessionId}/join`,
    }));
    expect(mocks.sessionEmail).not.toHaveBeenCalledWith(expect.objectContaining({
      meetingUrl: externalMeetingUrl,
    }));
  });

  it("uses the internal gated route only for intros tied to a session row", async () => {
    await notifyIntro("55555555-5555-4555-8555-555555555555", "booked");

    expect(mocks.introEmail).toHaveBeenCalledWith(expect.objectContaining({
      meetingUrl: `https://gymx2.example/calendar/${sessionId}/join`,
    }));
    expect(mocks.introEmail).not.toHaveBeenCalledWith(expect.objectContaining({
      meetingUrl: externalMeetingUrl,
    }));
  });
});
