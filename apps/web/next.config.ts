import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = { output: "standalone" };

initOpenNextCloudflareForDev();
export default nextConfig;
