import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("Form Coach Worker routes", () => {
  it("rewrites only the dedicated Worker namespace to the offline public bundle", async () => {
    const rewrites = await nextConfig.rewrites?.();
    expect(rewrites).toEqual({
      beforeFiles: [{
        source: "/form-coach-worker/:hash/:path*",
        destination: "/form-coach-assets/form-coach-worker/:hash/:path*",
      }],
    });
  });

  it("attaches the restrictive response CSP only to the Worker namespace", async () => {
    const headers = await nextConfig.headers?.();
    expect(headers).toHaveLength(1);
    expect(headers?.[0]?.source).toBe("/form-coach-worker/:hash/:path*");
    expect(headers?.[0]?.headers[0]?.value).toContain("default-src 'none'");
  });
});
