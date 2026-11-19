import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { sendEmail } from "@/lib/email";

describe("Resend email idempotency option", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "synthetic-resend-key");
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the optional idempotency key as Resend's documented header", async () => {
    const sent = await sendEmail(
      "member@example.test",
      { subject: "Reminder", html: "<p>Reminder</p>", text: "Reminder" },
      { idempotencyKey: "intake-reminder:24h:session:member" },
    );

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "intake-reminder:24h:session:member",
        }),
      }),
    );
  });

  it("preserves existing callers without an idempotency key", async () => {
    await sendEmail("member@example.test", {
      subject: "Notice",
      html: "<p>Notice</p>",
      text: "Notice",
    });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "Idempotency-Key",
    );
  });

  it("does not send an invalid header value", async () => {
    const sent = await sendEmail(
      "member@example.test",
      { subject: "Reminder", html: "", text: "" },
      { idempotencyKey: "bad\r\nheader" },
    );

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
