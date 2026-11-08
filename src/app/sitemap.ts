import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";

export const revalidate = 3600;

// Public pages for search engines: the home page, legal pages and coaches' public pages.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = getSiteUrl();
  const { data } = await createAdminClient()
    .from("profiles")
    .select("public_slug, updated_at")
    .eq("role", "coach")
    .eq("public_page", true)
    .not("public_slug", "is", null);
  return [
    { url: site, changeFrequency: "weekly", priority: 1 },
    ...["terms", "privacy", "refunds"].map((path) => ({
      url: `${site}/${path}`,
      changeFrequency: "monthly" as const,
      priority: 0.3,
    })),
    ...(data ?? []).map((row) => ({
      url: `${site}/c/${row.public_slug as string}`,
      lastModified: row.updated_at
        ? new Date(row.updated_at as string)
        : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
