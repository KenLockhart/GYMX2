import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  createUpload: vi.fn(),
  deleteVideo: vi.fn(),
  isStreamConfigured: vi.fn(),
  insertVideo: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));

vi.mock("@/lib/stream", () => ({
  createUpload: mocks.createUpload,
  deleteVideo: mocks.deleteVideo,
  isStreamConfigured: mocks.isStreamConfigured,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));

import { POST } from "./route";

function encoded(value: string) {
  return Buffer.from(value).toString("base64");
}

function uploadRequest() {
  return new NextRequest("http://localhost/api/videos/upload", {
    method: "POST",
    headers: {
      "Upload-Length": "1024",
      "Upload-Metadata": [
        `title ${encoded("Intro")}`,
        `description ${encoded("Program introduction")}`,
        `category ${encoded("Technique")}`,
        `visibility ${encoded("private")}`,
      ].join(","),
    },
  });
}

describe("video upload authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStreamConfigured.mockReturnValue(true);
    mocks.createUpload.mockResolvedValue({
      location: "https://upload.example.test/tus/one-time",
      uid: "stream-video-1",
    });
    mocks.insertVideo.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ insert: mocks.insertVideo });
  });

  it("lets an admin upload only under the admin's own profile", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      profile: { id: "admin-id", role: "admin" },
    });

    const response = await POST(uploadRequest());

    expect(response.status).toBe(201);
    expect(mocks.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({ creatorId: "admin-id" }),
    );
    expect(mocks.insertVideo).toHaveBeenCalledWith(
      expect.objectContaining({ coach_id: "admin-id" }),
    );
  });

  it("keeps members from starting a video upload", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      profile: { id: "member-id", role: "member" },
    });

    const response = await POST(uploadRequest());

    expect(response.status).toBe(403);
    expect(mocks.createUpload).not.toHaveBeenCalled();
    expect(mocks.insertVideo).not.toHaveBeenCalled();
  });
});
