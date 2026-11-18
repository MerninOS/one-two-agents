// Connect an MCP server (docs/company-mode.md, slice 6): registers the Control Room with the
// server, keeps the sign-in's state in a short-lived sealed cookie, and sends the owner to the server's
// own sign-in page. The login is checked here too, not only by the proxy.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, controlsOn } from "@/dashboard/session";
import { memberFromCookie } from "@/dashboard/data";
import { atLeast, refusal } from "@/core/roles";
import { isMcpId } from "@/core/mcp-rules";
import { isCustomId } from "@/core/custom-mcp-rules";
import { PENDING_COOKIE, PENDING_MINUTES, startConnect } from "@/integrations/mcp";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = new URL(`/connections?${isCustomId(id) ? "s" : "c"}=${encodeURIComponent(id)}`, req.url);
  const me = await memberFromCookie(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.redirect(new URL("/login", req.url));
  if (!isMcpId(id) && !isCustomId(id)) return NextResponse.redirect(new URL("/connections", req.url));
  // Connections are the owner's (docs/tenancy.md, slice 2)
  if (!atLeast(me.role, "owner")) { back.searchParams.set("problem", refusal(me.role, "owner")); return NextResponse.redirect(back); }
  // a custom server is connected only with Controls on, like adding one
  if (isCustomId(id) && !controlsOn()) { back.searchParams.set("problem", "Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to connect a custom server."); return NextResponse.redirect(back); }
  try {
    const { url, pending } = await startConnect(id, new URL(`/connections/${id}/callback`, req.url).toString());
    const res = NextResponse.redirect(url);
    res.cookies.set(PENDING_COOKIE, pending, { httpOnly: true, secure: true, sameSite: "lax", path: `/connections/${id}`, maxAge: PENDING_MINUTES * 60 });
    return res;
  } catch (e) {
    back.searchParams.set("problem", `Couldn’t start the sign-in: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    return NextResponse.redirect(back);
  }
}
