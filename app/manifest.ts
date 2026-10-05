import type { MetadataRoute } from "next";

// Installable app: opened from the home screen it runs full screen,
// without browser bars
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PicMe",
    short_name: "PicMe",
    description: "Show a photo. Everyone guesses whose it is.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fff5f8",
    theme_color: "#fff5f8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Same art: the heart sits well inside the safe zone for round masks
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
