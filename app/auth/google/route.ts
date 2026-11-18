// Sign in with Google (docs/tenancy.md, slice 8.1): Supabase Auth sends the person to Google and
// back to /auth/google/callback. Google only proves the address; who may sign in is still the
// members list, exactly as with the emailed link.
import { NextResponse, type NextRequest } from "next/server";
import { authFlow, googleSignInOn } from "@/core/db";
import { safeNext } from "@/core/roles";
import { loginConfigured } from "@/core/session";

const GOOGLE_FLOW_COOKIE = "op_google";

export async function GET(req: NextRequest) {
  const problem = (p: string) => NextResponse.redirect(new URL(`/login?problem=${encodeURIComponent(p)}`, req.url));
  if (!loginConfigured()) return problem("SESSION_SECRET isn’t set, so nobody can sign in yet.");
  if (!(await googleSignInOn())) return problem("Sign in with Google isn’t turned on here. Use the emailed link.");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const store: Record<string, string> = {};
  const { data, error } = await authFlow(store).signInWithOAuth({
    provider: "google",
    options: { redirectTo: new URL(`/auth/google/callback?next=${encodeURIComponent(next)}`, req.url).toString(), skipBrowserRedirect: true, scopes: "email" },
  });
  if (error || !data?.url) return problem("Google sign-in couldn’t start. Try again, or use the emailed link.");
  const res = NextResponse.redirect(data.url);
  res.cookies.set(GOOGLE_FLOW_COOKIE, Buffer.from(JSON.stringify(store)).toString("base64url"), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/auth/google", maxAge: 600 });
  return res;
}
