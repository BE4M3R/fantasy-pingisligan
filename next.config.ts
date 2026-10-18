import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  distDir: process.env.TEST_APP_DIST_DIR ?? ".next",
  ...(process.env.TEST_APP_TSCONFIG
    ? { typescript: { tsconfigPath: process.env.TEST_APP_TSCONFIG } }
    : {}),
};

export default nextConfig;
