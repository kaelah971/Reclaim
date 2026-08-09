import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Disable Turbopack's filesystem (SST) cache for `next dev`. The cache
    // previously corrupted local development (missing .sst files / corrupted
    // cache entries); with this disabled Turbopack runs without persistent
    // dev-cache writes, avoiding the corruption entirely.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
