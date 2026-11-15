// Back from an MCP server's sign-in page (docs/company-mode.md, slice 6): checks the state against
// the sealed cookie, trades the code for a token, keeps it encrypted, and returns to Connections.
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, validSessionToken } from "@/dashboard/session";
import { isMcpId } from "@/core/mcp-rules";
import { PENDING_COOKIE, finishConnect } from "@/integrations/mcp";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validSessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.redirect(new URL("/login", req.url));
  if (!isMcpId(id)) return NextResponse.redirect(new URL("/connections", req.url));
  const back = new URL(`/connections?c=${encodeURIComponent(id)}`, req.url);
  const q = req.nextUrl.searchParams;
  try {
    await finishConnect(id, req.cookies.get(PENDING_COOKIE)?.value, { code: q.get("code"), state: q.get("state"), error: q.get("error") });
    back.searchParams.set("connected", "1");
    revalidatePath("/", "layout");
  } catch (e) {
    back.searchParams.set("problem", `Not connected: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
  const res = NextResponse.redirect(back);
  res.cookies.set(PENDING_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: `/connections/${id}`, maxAge: 0 });
  return res;
}
