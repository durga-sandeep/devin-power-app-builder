import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads the session cookie and the DB, so nothing can be prerendered. Cache Components
  // (the create-next-app default) only adds Suspense/`instant` validation noise here, so it's off.
  cacheComponents: false,
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
