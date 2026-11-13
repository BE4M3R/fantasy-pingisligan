import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Derive the public flag at build time; previews also use NODE_ENV=production.
    NEXT_PUBLIC_ANALYTICS_ENABLED: process.env.VERCEL_ENV === "production" ? "true" : "false",
  },
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  distDir: process.env.TEST_APP_DIST_DIR ?? ".next",
  ...(process.env.TEST_APP_TSCONFIG
    ? { typescript: { tsconfigPath: process.env.TEST_APP_TSCONFIG } }
    : {}),
};

export default nextConfig;
