import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This package's root (directory containing this file). When another lockfile
// exists higher in the tree (e.g. ~/package-lock.json), Next may otherwise pick
// the wrong Turbopack root and fail to resolve packages from web/node_modules.
const webRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    // Pin Turbopack to this app when the editor workspace root is the monorepo (Imperium/).
    root: webRoot,
  },
};

export default nextConfig;
