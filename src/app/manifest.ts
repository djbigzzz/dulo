import type { MetadataRoute } from "next";
import { POSITIONING } from "@/lib/config";

/** Served at /manifest.webmanifest. Referenced from src/app/layout.tsx metadata.manifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dulo",
    short_name: "Dulo",
    description: POSITIONING,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0908",
    theme_color: "#0a0908",
    lang: "en",
    categories: ["finance", "games"],
    icons: [
      // PNGs first: iOS and older Android launchers do not rasterise SVG icons.
      // The 512 is listed twice ("any" + "maskable") because Next types `purpose` as a
      // single value; the mark sits inside the 80% maskable safe zone, so one file serves both.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
