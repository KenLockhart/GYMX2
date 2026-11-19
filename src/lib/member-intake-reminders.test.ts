import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  loadRecipient: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/email", () => ({
  loadRecipient: mocks.loadRecipient,
  sendEmail: mocks.sendEmail,
}));

import { runMemberIntakeReminders } from "@/lib/member-intake-reminders";

const candidate = {
  member_id: "11111111-1111-4111-8111-111111111111",
  coach_id: "22222222-2222-4222-8222-222222222222",
  coach_name: "Coach",
  booking_id: "33333333-3333-4333-8333-333333333333",
  session_id: "44444444-4444-4444-8444-444444444444",
  starts_at: "2026-11-20T12:00:00.000Z",
  reminder_phase: "24h" as const,
};

describe("member intake reminder recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00.000Z"));
    let leaseExpiresAt = 0;
    let completionCalls = 0;
    const rpc = vi.fn((name: string) => {
      if (name === "list_member_intake_reminder_candidates")
        return { limit: async () => ({ data: [candidate], error: null }) };
      if (name === "claim_member_intake_reminder") {
        if (Date.now() < leaseExpiresAt) return Promise.resolve({ data: false, error: null });
        leaseExpiresAt = Date.now() + 60_000;
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "complete_member_intake_reminder") {
        completionCalls += 1;
        return Promise.resolve(completionCalls === 1
          ? { data: null, error: { code: "XX000" } }
          : { data: true, error: null });
      }
      return Promise.reject(new Error(`Unexpected RPC ${name}`));
    });
    mocks.createAdminClient.mockReturnValue({ rpc });
    mocks.loadRecipient.mockResolvedValue({
      email: "member@example.test",
      name: "Member",
      locale: "en",
      wantsUpdates: true,
    });
    mocks.sendEmail.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses one stable Resend key after accepted delivery and lease recovery", async () => {
    const first = await runMemberIntakeReminders();
    expect(first.failed).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);

    await runMemberIntakeReminders();
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-19T12:01:01.000Z"));
    const recovered = await runMemberIntakeReminders();
    expect(recovered.sent).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);

    const firstKey = mocks.sendEmail.mock.calls[0]?.[2]?.idempotencyKey;
    const retryKey = mocks.sendEmail.mock.calls[1]?.[2]?.idempotencyKey;
    expect(firstKey).toBe("member-intake-reminder:24h:44444444-4444-4444-8444-444444444444:11111111-1111-4111-8111-111111111111");
    expect(retryKey).toBe(firstKey);
  });

  it("does not call the provider for an ambiguous attempt older than the 23-hour retry cutoff", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "list_member_intake_reminder_candidates")
        // The SQL candidate query excludes a stale sending row before the worker
        // can claim it. Its first attempt is older than Resend's 24-hour window.
        return { limit: async () => ({ data: [], error: null }) };
      if (name === "claim_member_intake_reminder")
        return Promise.reject(new Error("A stale ambiguous attempt must never be claimed"));
      return Promise.reject(new Error(`Unexpected RPC ${name}`));
    });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const result = await runMemberIntakeReminders();

    expect(result.candidates).toBe(0);
    expect(rpc).not.toHaveBeenCalledWith("claim_member_intake_reminder", expect.anything());
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
