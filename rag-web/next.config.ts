import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (server.js + minimal node_modules) so the
  // Docker runtime image stays small. See the multi-stage Dockerfile.
  output: "standalone",
  // Pin the file-tracing root to this app so a stray lockfile elsewhere on the
  // machine doesn't get inferred as the workspace root.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
