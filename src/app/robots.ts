import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/supabase/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/c/", "/terms", "/privacy", "/refunds"],
      disallow: ["/api/", "/r/", "/auth/"],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
