import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GYMX2",
    short_name: "GYMX2",
    description: "Train with the coaches and creators you want to follow.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0d0f0c",
    theme_color: "#0d0f0c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
