import type { MetadataRoute } from "next";
import { HOME_DESCRIPTION, PWA_NAME } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: PWA_NAME,
    short_name: PWA_NAME,
    description: HOME_DESCRIPTION,
    lang: "sv",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Match --pf-navy and --pf-page-blue in app/globals.css.
    theme_color: "#01213c",
    background_color: "#0a4d86",
    icons: [
      { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/branding/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
