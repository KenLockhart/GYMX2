import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAccount,
  mockGetT,
  mockGetLocale,
  mockCreateClient,
  mockSendMessage,
  mockRedirect,
} = vi.hoisted(() => ({
  mockRequireAccount: vi.fn(),
  mockGetT: vi.fn(),
  mockGetLocale: vi.fn(),
  mockCreateClient: vi.fn(),
  mockSendMessage: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));
vi.mock("@/i18n/server", () => ({
  getT: mockGetT,
  getLocale: mockGetLocale,
}));
vi.mock("@/lib/auth", () => ({ requireAccount: mockRequireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/app/(app)/messages/actions", () => ({ sendMessage: mockSendMessage }));

import { en } from "@/i18n/en";
import { sendSessionRequest } from "./actions";

const memberId = "11111111-1111-4111-8111-111111111111";
const coachId = "22222222-2222-4222-8222-222222222222";
const messageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function formData(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    coach_id: coachId,
    day: "2099-11-20",
    time: "18:30",
    time_zone: "America/New_York",
    note: "Work on squat form.",
    ...overrides,
  }))
    form.set(key, value);
  return form;
}

function databaseConnection(result: { data: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  return {
    from: vi.fn(() => builder),
    builder,
  };
}

describe("sendSessionRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    mockGetT.mockResolvedValue(en);
    mockGetLocale.mockResolvedValue("en");
    mockRedirect.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });
  });

  it("rejects non-members before looking up a coach or sending a message", async () => {
    mockRequireAccount.mockResolvedValue({ profile: { id: coachId, role: "coach" } });

    const result = await sendSessionRequest({}, formData());

    expect(result).toEqual({ error: en.calendar.request.memberOnly });
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("rejects a past or invalid local time before checking connections", async () => {
    const result = await sendSessionRequest(
      {},
      formData({ day: "2020-01-01", time: "08:00" }),
    );

    expect(result).toEqual({ error: en.calendar.request.invalidTime });
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("does not send for an unlinked coach or a failed connection lookup", async () => {
    const unlinkedDb = databaseConnection({ data: null });
    mockCreateClient.mockResolvedValue(unlinkedDb);

    const unlinked = await sendSessionRequest({}, formData());
    expect(unlinked).toEqual({ error: en.calendar.request.coachUnavailable });
    expect(mockSendMessage).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockRequireAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    mockGetT.mockResolvedValue(en);
    mockGetLocale.mockResolvedValue("en");
    const failedDb = databaseConnection({ data: null, error: new Error("db unavailable") });
    mockCreateClient.mockResolvedValue(failedDb);

    const failed = await sendSessionRequest({}, formData());
    expect(failed).toEqual({ error: en.calendar.request.lookupError });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("returns the existing message guard error if the connection disappears before send", async () => {
    mockCreateClient.mockResolvedValue(databaseConnection({ data: { coach_id: coachId } }));
    mockSendMessage.mockResolvedValue({ error: "You can only message your coaches and your members." });

    const result = await sendSessionRequest({}, formData());

    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(result).toEqual({ error: "You can only message your coaches and your members." });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("sends the preferred time through the existing message action and redirects with confirmation context", async () => {
    mockCreateClient.mockResolvedValue(databaseConnection({ data: { coach_id: coachId } }));
    mockSendMessage.mockResolvedValue({ message: { id: messageId } });

    await expect(sendSessionRequest({}, formData())).rejects.toThrow(
      `redirect:/messages/${coachId}?session_request=sent&request_id=${messageId}`,
    );

    expect(mockSendMessage).toHaveBeenCalledWith(
      coachId,
      "I'd like to request a session. My preferred time is Nov 20, 2099, 6:30 PM (America/New_York).\n\nWhat I'd like to work on: Work on squat form.",
    );
    expect(mockRedirect).toHaveBeenCalledOnce();
  });
});
