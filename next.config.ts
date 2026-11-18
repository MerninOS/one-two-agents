import type { NextConfig } from "next";
import { existsSync } from "node:fs";

// Agent jobs behind /api/agents/[agent] (Vercel Schedules or by hand), and the Control Room dashboard.
// The Docker image (Dockerfile, docs/self-host.md) builds with NEXT_OUTPUT=standalone; Vercel builds as usual.
// OPERATOR_EDITION=cloud builds the paid layer in: "operator-extensions" becomes ee/index.ts instead of
// core/extensions/none.ts (tsconfig.json), the only switch between editions (docs/extensions.md).
const cloud = process.env.OPERATOR_EDITION === "cloud";
if (cloud && !existsSync("ee/index.ts")) throw new Error("OPERATOR_EDITION=cloud needs ee/index.ts, which the open-source repo leaves out. Unset it to build the open edition.");
const nextConfig: NextConfig = {
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  ...(cloud ? { turbopack: { resolveAlias: { "operator-extensions": "./ee/index.ts" } } } : {}),
};

export default nextConfig;
