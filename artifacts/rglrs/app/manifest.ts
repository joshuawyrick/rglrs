import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RGLRS",
    short_name: "RGLRS",
    description: "Private social for the people who matter.",
    id: "/",
    start_url: "/",
    scope: "/",
    orientation: "portrait",
    categories: ["social", "lifestyle"],
    display: "standalone",
    background_color: "#0F1115",
    theme_color: "#0F1115",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" }
    ]
  };
}
