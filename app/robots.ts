import { competitionsEnabled } from "@/lib/competition-publication";
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const enabled = await competitionsEnabled();
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
        ...(!enabled ? ["/competitions"] : []),
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
