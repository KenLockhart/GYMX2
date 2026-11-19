import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import UploadPage from "./page";
import { requireCoachOrAdmin } from "@/lib/auth";
import { isStreamConfigured } from "@/lib/stream";
import { UploadForm } from "./upload-form";

const mockMessages = vi.hoisted(() => ({
  library: {
    upload: "Upload a video",
    back: "Back to the library",
    uploadsOff: "Uploads are not connected",
    dailyContent: { open: "Daily content" },
    dailyContentUploadPrivacy: "This upload will be private",
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireCoachOrAdmin: vi.fn() }));
vi.mock("@/lib/stream", () => ({ isStreamConfigured: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getT: vi.fn().mockResolvedValue(mockMessages) }));

const mockRequire = vi.mocked(requireCoachOrAdmin);
const mockConfigured = vi.mocked(isStreamConfigured);
type UploadPageChildProps = {
  href?: string;
  returnTo?: string;
  dailyContentUpload?: boolean;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigured.mockReturnValue(true);
});

describe("video upload return route", () => {
  it("accepts the coach Daily Content return path and passes the private-upload mode", async () => {
    mockRequire.mockResolvedValue({ profile: { id: "coach-id", role: "coach" } } as never);
    const page = await UploadPage({
      searchParams: Promise.resolve({ returnTo: "/library/daily-content" }),
    });
    const children = page.props.children as ReactElement<UploadPageChildProps>[];
    const form = children.find((child) => child.type === UploadForm)!;
    expect(children[0].props.href).toBe("/library/daily-content");
    expect(form.props.returnTo).toBe("/library/daily-content");
    expect(form.props.dailyContentUpload).toBe(true);
  });

  it("falls back to the library for an untrusted or role-mismatched route", async () => {
    mockRequire.mockResolvedValue({ profile: { id: "coach-id", role: "coach" } } as never);
    const page = await UploadPage({
      searchParams: Promise.resolve({ returnTo: "https://outside.example/" }),
    });
    const children = page.props.children as ReactElement<UploadPageChildProps>[];
    expect(children[0].props.href).toBe("/library");
    const form = children.find((child) => child.type === UploadForm)!;
    expect(form.props.returnTo).toBe("/library");
    expect(form.props.dailyContentUpload).toBe(false);
  });

  it("accepts only the admin Daily Content destination for an admin upload", async () => {
    mockRequire.mockResolvedValue({ profile: { id: "admin-id", role: "admin" } } as never);
    const page = await UploadPage({
      searchParams: Promise.resolve({ returnTo: "/admin/daily-content" }),
    });
    const children = page.props.children as ReactElement<UploadPageChildProps>[];
    const form = children.find((child) => child.type === UploadForm)!;
    expect(children[0].props.href).toBe("/admin/daily-content");
    expect(form.props.dailyContentUpload).toBe(true);
    expect(form.props.returnTo).toBe("/admin/daily-content");
  });
});
