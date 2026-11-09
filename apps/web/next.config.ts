import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const backendUrl =
  process.env.RADAR_API_URL ||
  process.env.NEXT_PUBLIC_RADAR_API_URL ||
  "http://localhost:8787";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl.replace(/\/$/, "")}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${backendUrl.replace(/\/$/, "")}/health`,
      },
    ];
  },
};

initOpenNextCloudflareForDev();
export default nextConfig;
