import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, validSessionToken } from "@/dashboard/session";

// Guards the Control Room pages. /api/* keeps its own bearer check and is not touched here.
export function proxy(req: NextRequest) {
  if (validSessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = new URL("/login", req.url);
  if (req.nextUrl.pathname !== "/") url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/|login|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
