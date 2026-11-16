import { NextResponse } from "next/server";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { cronAuthorized } from "@/core/runs";
import { notionConnected } from "@/integrations/notion";
import { hasMercury } from "@/integrations/mercury";
import { localReady } from "@/integrations/mcp";
import { hasGmail } from "@/integrations/gmail";
import { hasGmailRead } from "@/integrations/gmail-read";

// Which settings are present and whether Supabase answers. Never returns a secret's value.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const set = {
    supabase: !!(env.supabaseUrl && env.supabaseServiceKey),
    shopify: !!env.shopifyDomain && (await localReady("shopify")),
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    mercury: !!env.mercuryAccountIds.length && (await hasMercury()),
    notion: !!env.notionBriefParent && (await notionConnected()),
    email: !!(env.resendKey && env.briefFrom && env.briefTo),
    gmail: await hasGmail(),
    gmail_read: await hasGmailRead(),
  };
  let agents: { id: string; enabled: boolean }[] | string = "not checked";
  if (set.supabase) {
    const { data, error } = await db().from("agents").select("id, enabled").order("id");
    agents = error ? `error: ${error.message}` : data ?? [];
  }
  return NextResponse.json({ set, agents });
}
