import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDetail: vi.fn() }));

vi.mock("@/lib/form-coach/workflow-server", () => ({
  getFormCoachWorkflowDetail: mocks.getDetail,
}));

import CoachAssessmentDetailPage from "./page";
import MemberFormCheckDetailPage from "../../../form-checks/[assessmentId]/page";

const assessmentId = "f1000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDetail.mockResolvedValue({ kind: "not_authorized" });
});

describe("Form Coach detail route role expectations", () => {
  it("passes the promised coach assessment ID and requires a coach detail read", async () => {
    const page = await CoachAssessmentDetailPage({
      params: Promise.resolve({ assessmentId }),
    });

    expect(mocks.getDetail).toHaveBeenCalledWith(assessmentId, "coach");
    expect(renderToStaticMarkup(page)).toContain("Assessment not available");
  });

  it("passes the promised member assessment ID and requires a member detail read", async () => {
    const page = await MemberFormCheckDetailPage({
      params: Promise.resolve({ assessmentId }),
    });

    expect(mocks.getDetail).toHaveBeenCalledWith(assessmentId, "member");
    expect(renderToStaticMarkup(page)).toContain("Assessment not available");
  });
});
