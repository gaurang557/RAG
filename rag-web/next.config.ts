import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the file-tracing root to this app so a stray lockfile elsewhere on the
  // machine doesn't get inferred as the workspace root.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
