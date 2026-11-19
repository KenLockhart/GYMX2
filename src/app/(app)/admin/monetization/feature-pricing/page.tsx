import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { AdminFeaturePricing } from "@/components/admin-feature-pricing";
import { requireAdmin } from "@/lib/auth";
import { loadPricingAdminDashboard } from "@/lib/form-coach/pricing-admin-server";

export const metadata: Metadata = { title: "Form Coach pricing" };

export default async function FeaturePricingAdminPage() {
  const { profile } = await requireAdmin();
  const dashboard = await loadPricingAdminDashboard();

  return (
    <AdminFeaturePricing
      key={`${profile.id}:${dashboard.current?.revision ?? "none"}`}
      dashboard={dashboard}
      adminId={profile.id}
      initialRequestId={randomUUID()}
      initialCompRequestId={randomUUID()}
    />
  );
}
