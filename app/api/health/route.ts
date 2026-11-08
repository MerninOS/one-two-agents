import { NextResponse } from "next/server";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { cronAuthorized } from "@/core/runs";

// Which settings are present and whether Supabase answers. Never returns a secret's value.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const set = {
    supabase: !!(env.supabaseUrl && env.supabaseServiceKey),
    shopify: !!(env.shopifyDomain && (env.shopifyAdminToken || (env.shopifyClientId && env.shopifyClientSecret))),
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    mercury: !!(env.mercuryToken && env.mercuryAccountIds.length),
    notion: !!(env.notionToken && env.notionBriefParent),
    gmail: !!(env.gmailClientId && env.gmailClientSecret && env.gmailRefreshToken),
  };
  let agents: { id: string; enabled: boolean }[] | string = "not checked";
  if (set.supabase) {
    const { data, error } = await db().from("agents").select("id, enabled").order("id");
    agents = error ? `error: ${error.message}` : data ?? [];
  }
  return NextResponse.json({ set, agents });
}
