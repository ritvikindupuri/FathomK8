import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server binds 0.0.0.0, so Next only allowlists that hostname.
  // Browsers open 127.0.0.1 and otherwise get a raw "Unauthorized" on the
  // HMR socket, which keeps the client from hydrating.
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
