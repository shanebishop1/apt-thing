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

// `APT_WRANGLER_CONFIG` lets the end-to-end suite point the dev bridge at
// `e2e/wrangler.e2e.jsonc` (which binds a local D1) and at its own persistence directory, so
// an e2e run never reads or writes a developer's `.wrangler/state`.
const e2eWranglerConfig = process.env.APT_WRANGLER_CONFIG;

import("@opennextjs/cloudflare").then((m) =>
  m.initOpenNextCloudflareForDev(
    e2eWranglerConfig
      ? // `wrangler d1 migrations apply --persist-to .wrangler/e2e-state` writes under a `v3`
        // subdirectory, while `getPlatformProxy` treats `persist.path` as the directory that
        // directly holds the `d1` store, so this path carries the `v3` segment explicitly.
        { configPath: e2eWranglerConfig, persist: { path: ".wrangler/e2e-state/v3" } }
      : undefined,
  ),
);
