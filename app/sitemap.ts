import type { MetadataRoute } from "next";

const SITE_URL = "https://pingisliganfantasy.se";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: "2026-09-12",
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
