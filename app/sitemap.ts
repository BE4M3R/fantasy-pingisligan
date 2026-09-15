import type { MetadataRoute } from "next";
import { HOME_LANGUAGE_ALTERNATES, SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: "2026-09-15",
      alternates: { languages: HOME_LANGUAGE_ALTERNATES },
    },
    {
      url: `${SITE_URL}/en`,
      lastModified: "2026-09-15",
      alternates: { languages: HOME_LANGUAGE_ALTERNATES },
    },
    {
      url: `${SITE_URL}/about`,
      lastModified: "2026-09-01",
    },
    {
      url: `${SITE_URL}/rules`,
      lastModified: "2026-09-12",
    },
  ];
}
