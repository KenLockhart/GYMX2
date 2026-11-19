import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminFeaturePricingPage from "./page";
import { requireAdmin } from "@/lib/auth";
import { loadPricingAdminDashboard } from "@/lib/form-coach/pricing-admin-server";
import { AdminFeaturePricing } from "@/components/admin-feature-pricing";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/form-coach/pricing-admin-server", () => ({ loadPricingAdminDashboard: vi.fn() }));
vi.mock("@/components/admin-feature-pricing", () => ({ AdminFeaturePricing: vi.fn(() => null) }));

const dashboard = {
  current: null,
  revisions: [],
  changes: [],
  syncRequests: [],
  comps: [],
  legacyContractCount: 0,
  moveStateCounts: {},
  readErrors: [],
};

function hasFunction(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (Array.isArray(value)) return value.some(hasFunction);
  return value !== null && typeof value === "object"
    && Object.values(value as Record<string, unknown>).some(hasFunction);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ profile: { id: "admin-id", role: "admin" } } as never);
  vi.mocked(loadPricingAdminDashboard).mockResolvedValue(dashboard);
});

describe("admin Form Coach pricing page", () => {
  it("authorizes before reading the admin dashboard and passes safe page props", async () => {
    const element = await AdminFeaturePricingPage();
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(loadPricingAdminDashboard).toHaveBeenCalledOnce();
    expect(element.type).toBe(AdminFeaturePricing);
    expect(element.props.dashboard).toBe(dashboard);
    expect(element.props.adminId).toBe("admin-id");
    expect(element.props.initialRequestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(element.props.initialCompRequestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(element.props).not.toHaveProperty("copy");
    expect(hasFunction(element.props)).toBe(false);
  });

  it("stops before loading pricing data if page authorization fails", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("redirect"));
    await expect(AdminFeaturePricingPage()).rejects.toThrow("redirect");
    expect(loadPricingAdminDashboard).not.toHaveBeenCalled();
  });
});
