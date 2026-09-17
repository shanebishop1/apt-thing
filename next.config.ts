import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname),
  devIndicators: false,
  poweredByHeader: false,
  // Listing photos are arbitrary third-party URLs, so remote patterns cannot be
  // enumerated, and the Workers deployment does not run the image optimizer.
  images: {
    unoptimized: true,
  },
  typescript: {
    tsconfigPath: "tsconfig.json",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
