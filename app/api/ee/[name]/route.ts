import { extensions } from "@/core/extensions";

// The paid layer's routes (the api slot, docs/extensions.md), such as /api/ee/stripe. Each checks its
// own caller. The open edition has none, so every name is not found.
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const route = Object.hasOwn(extensions.api, name) ? extensions.api[name] : undefined;
  if (!route) return new Response("Not found", { status: 404 });
  return route(req);
}
