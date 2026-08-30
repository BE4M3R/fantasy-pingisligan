import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.46", "10.255.255.254"],
  devIndicators: false,
};

export default nextConfig;
