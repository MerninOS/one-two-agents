import type { NextConfig } from "next";

// Agent jobs behind /api/agents/[agent] (Vercel Schedules or by hand), and the Control Room dashboard.
// The Docker image (Dockerfile, docs/self-host.md) builds with NEXT_OUTPUT=standalone; Vercel builds as usual.
const nextConfig: NextConfig = process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {};

export default nextConfig;
