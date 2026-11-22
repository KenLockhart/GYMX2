import type { NextConfig } from "next";
import { FORM_COACH_WORKER_CSP } from "./src/lib/form-coach/runtime-security";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/form-coach-worker/:hash/:path*",
        headers: [{ key: "Content-Security-Policy", value: FORM_COACH_WORKER_CSP }],
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/form-coach-worker/:hash/:path*",
          destination: "/form-coach-assets/form-coach-worker/:hash/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
