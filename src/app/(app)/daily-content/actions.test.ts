import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireAccount, mockCreateClient, mockRevalidatePath } = vi.hoisted(() => ({
  mockRequireAccount: vi.fn(),
  mockCreateClient: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/auth", () => ({ requireAccount: mockRequireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/reminders", () => ({ todayKey: () => "2026-11-19" }));

import {
  acknowledgeDailyContentAffirmation,
  archiveDailyContentItem,
  cancelDailyContentSlot,
  publishDailyContentSlot,
  saveDailyContentItem,
} from "./actions";

const coachId = "11111111-1111-4111-8111-111111111111";
const itemId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const revisionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const slotId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const videoId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("Daily Content server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAccount.mockResolvedValue({ profile: { id: coachId, role: "coach" } });
    mockCreateClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: [{ item_id: itemId, revision_id: revisionId }], error: null }),
    });
  });

  it("validates a video item then delegates ownership and readiness to the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ item_id: itemId, revision_id: revisionId }], error: null });
    mockCreateClient.mockResolvedValue({ rpc });
    await expect(saveDailyContentItem({ status: "idle" }, form({
      item_id: "",
      kind: "video",
      title: "  Strength Flow  ",
      video_id: videoId,
      quote_text: "",
      quote_attribution: "",
      affirmation_text: "",
    }))).resolves.toEqual({ status: "saved" });
    expect(rpc).toHaveBeenCalledWith("save_daily_content_item", {
      target_item_id: null,
      target_kind: "video",
      target_title: "Strength Flow",
      target_video_id: videoId,
      target_quote_text: null,
      target_quote_attribution: null,
      target_affirmation_text: null,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects malformed or mixed content before reaching the database", async () => {
    const rpc = vi.fn();
    mockCreateClient.mockResolvedValue({ rpc });
    await expect(saveDailyContentItem({ status: "idle" }, form({
      item_id: "",
      kind: "quote",
      title: "Quote",
      video_id: videoId,
      quote_text: "Some words",
      quote_attribution: "",
      affirmation_text: "",
    }))).resolves.toEqual({ status: "error", reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps coach and admin mutations role-gated", async () => {
    const rpc = vi.fn();
    mockCreateClient.mockResolvedValue({ rpc });
    mockRequireAccount.mockResolvedValue({ profile: { id: coachId, role: "member" } });
    await expect(saveDailyContentItem({ status: "idle" }, form({
      item_id: "",
      kind: "quote",
      title: "Quote",
      video_id: "",
      quote_text: "A useful thought.",
      quote_attribution: "",
      affirmation_text: "",
    }))).resolves.toEqual({ status: "error", reason: "not_allowed" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("publishes only validated today-or-future dates and maps RPC failures", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: slotId, error: null });
    mockCreateClient.mockResolvedValue({ rpc });
    await expect(publishDailyContentSlot({ status: "idle" }, form({
      item_id: itemId,
      revision_id: revisionId,
      day: "2026-11-19",
    }))).resolves.toEqual({ status: "published" });
    expect(rpc).toHaveBeenCalledWith("publish_daily_content_slot", {
      target_item_id: itemId,
      target_revision_id: revisionId,
      target_day: "2026-11-19",
    });

    await expect(publishDailyContentSlot({ status: "idle" }, form({
      item_id: itemId,
      revision_id: revisionId,
      day: "2026-11-18",
    }))).resolves.toEqual({ status: "error", reason: "invalid" });

    mockCreateClient.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "22023" } }) });
    await expect(publishDailyContentSlot({ status: "idle" }, form({
      item_id: itemId,
      revision_id: revisionId,
      day: "2026-11-20",
    }))).resolves.toEqual({ status: "error", reason: "not_ready" });
  });

  it("cancels or archives only UUID-identified owned resources", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mockCreateClient.mockResolvedValue({ rpc });
    await expect(archiveDailyContentItem({ status: "idle" }, form({ item_id: itemId })))
      .resolves.toEqual({ status: "archived" });
    expect(rpc).toHaveBeenCalledWith("archive_daily_content_item", { target_item_id: itemId });
    await expect(cancelDailyContentSlot({ status: "idle" }, form({ slot_id: slotId })))
      .resolves.toEqual({ status: "cancelled" });
    expect(rpc).toHaveBeenCalledWith("cancel_daily_content_slot", { target_slot_id: slotId });
  });

  it("acknowledges only the current member affirmation and current Eastern day", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mockCreateClient.mockResolvedValue({ rpc });
    mockRequireAccount.mockResolvedValue({ profile: { id: coachId, role: "member" } });
    await expect(acknowledgeDailyContentAffirmation("2026-11-19", revisionId, true))
      .resolves.toEqual({ ok: true, acknowledged: true });
    expect(rpc).toHaveBeenCalledWith("set_member_daily_content_acknowledgment", {
      target_expected_day: "2026-11-19",
      target_revision_id: revisionId,
      target_acknowledged: true,
    });
    await expect(acknowledgeDailyContentAffirmation("2026-11-18", revisionId, true))
      .resolves.toEqual({ ok: false, reason: "day_changed" });
    expect(rpc).toHaveBeenCalledOnce();
  });
});
