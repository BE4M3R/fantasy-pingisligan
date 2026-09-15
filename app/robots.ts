import type { MetadataRoute } from "next";

const SITE_URL = "https://pingisliganfantasy.se";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api",
        "/auth",
        "/dashboard",
        "/forgot-password",
        "/login",
        "/reset-password",
        "/signup",
        "/test-supabase",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
