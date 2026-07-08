import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (.next/standalone).
  output: 'standalone',
  // For Capacitor builds, comment out 'standalone' above, uncomment the line
  // below, and use `npm run build:mobile`
  // output: 'export',
};

export default nextConfig;
