import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDetail: vi.fn(),
  getReviewDetail: vi.fn(),
  isSummaryProviderConfigured: vi.fn(),
}));

vi.mock("@/lib/form-coach/workflow-server", () => ({
  getFormCoachWorkflowDetail: mocks.getDetail,
}));
vi.mock("@/lib/form-coach/review-server", () => ({
  getCoachFormCoachReviewDetail: mocks.getReviewDetail,
}));
vi.mock("@/lib/form-coach/summary-provider", () => ({
  createFormCoachSummaryProvider: () => ({
    isConfigured: mocks.isSummaryProviderConfigured,
  }),
}));
vi.mock("@/components/form-coach/assessment-detail", () => ({
  AssessmentDetail: (props: {
    role: "coach" | "member";
    summaryProviderConfigured?: boolean;
  }) => `${props.role}:${String(props.summaryProviderConfigured)}`,
}));
vi.mock("./actions", () => ({ recordFormCoachReviewAction: vi.fn() }));

import CoachAssessmentDetailPage from "./page";
import MemberFormCheckDetailPage from "../../../form-checks/[assessmentId]/page";

const assessmentId = "f1000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDetail.mockResolvedValue({ kind: "not_authorized" });
  mocks.getReviewDetail.mockResolvedValue({ kind: "not_authorized" });
  mocks.isSummaryProviderConfigured.mockReturnValue(false);
});

describe("Form Coach detail route role expectations", () => {
  it("passes the promised coach assessment ID and requires a coach detail read", async () => {
    const page = await CoachAssessmentDetailPage({
      params: Promise.resolve({ assessmentId }),
    });

    expect(mocks.getReviewDetail).toHaveBeenCalledWith(assessmentId);
    expect(renderToStaticMarkup(page)).toContain("Assessment not available");
  });

  it("passes the promised member assessment ID and requires a member detail read", async () => {
    const page = await MemberFormCheckDetailPage({
      params: Promise.resolve({ assessmentId }),
    });

    expect(mocks.getDetail).toHaveBeenCalledWith(assessmentId, "member");
    expect(renderToStaticMarkup(page)).toContain("Assessment not available");
  });

  it("passes the current provider configuration to the member detail view", async () => {
    mocks.getDetail.mockResolvedValue({ kind: "ready", value: {} });
    mocks.isSummaryProviderConfigured.mockReturnValue(false);

    const page = await MemberFormCheckDetailPage({
      params: Promise.resolve({ assessmentId }),
    });

    expect(renderToStaticMarkup(page)).toContain("member:false");
    expect(mocks.isSummaryProviderConfigured).toHaveBeenCalledTimes(1);
  });

  it("passes the current provider configuration to the coach detail view", async () => {
    mocks.getReviewDetail.mockResolvedValue({ kind: "ready", value: {} });
    mocks.isSummaryProviderConfigured.mockReturnValue(true);

    const page = await CoachAssessmentDetailPage({
      params: Promise.resolve({ assessmentId }),
    });

    expect(renderToStaticMarkup(page)).toContain("coach:true");
    expect(mocks.isSummaryProviderConfigured).toHaveBeenCalledTimes(1);
  });
});
