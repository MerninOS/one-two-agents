// Connect an MCP server (docs/company-mode.md, slice 6): registers the Control Room with the
// server, keeps the sign-in's state in a short-lived sealed cookie, and sends Zak to the server's
// own sign-in page. The login is checked here too, not only by the proxy.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, validSessionToken } from "@/dashboard/session";
import { isMcpId } from "@/core/mcp-rules";
import { PENDING_COOKIE, PENDING_MINUTES, startConnect } from "@/integrations/mcp";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = new URL(`/connections?c=${encodeURIComponent(id)}`, req.url);
  if (!validSessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.redirect(new URL("/login", req.url));
  if (!isMcpId(id)) return NextResponse.redirect(new URL("/connections", req.url));
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
