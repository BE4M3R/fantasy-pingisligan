import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.0.46", "10.255.255.254"],
  devIndicators: false,
  distDir: process.env.TEST_APP_DIST_DIR ?? ".next",
  ...(process.env.TEST_APP_TSCONFIG
    ? { typescript: { tsconfigPath: process.env.TEST_APP_TSCONFIG } }
    : {}),
};

export default nextConfig;
