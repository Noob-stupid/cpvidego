import type { NextConfig } from "next";

const sitesBuild = process.env.SITES_BUILD === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(sitesBuild
    ? {
        output: "export" as const,
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
