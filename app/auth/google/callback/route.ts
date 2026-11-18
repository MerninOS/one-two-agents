// Back from Google (docs/tenancy.md, slice 8.1): trades the code for the verified address, then
// finishes the sign-in like the emailed link does. We keep our own session cookie; Supabase's
// session for this sign-in is signed out at once.
import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authApi, authFlow } from "@/core/db";
import { normalEmail, safeNext } from "@/core/roles";
import { finishSignIn } from "@/dashboard/signin";

const FLOW_COOKIE = "op_google";

export async function GET(req: NextRequest) {
  const back: (p: string) => never = (p) => redirect(`/login?problem=${encodeURIComponent(p)}`);
  const code = req.nextUrl.searchParams.get("code") ?? "";
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const jar = await cookies();
  const raw = jar.get(FLOW_COOKIE)?.value;
  jar.delete({ name: FLOW_COOKIE, path: "/auth/google" });
  if (!raw || !/^[A-Za-z0-9_-]{8,500}$/.test(code)) back("That Google sign-in didn’t finish. Try again.");
  let store: Record<string, string>;
  try { store = JSON.parse(Buffer.from(raw, "base64url").toString()) as Record<string, string>; } catch { back("That Google sign-in didn’t finish. Try again."); }
  const { data, error } = await authFlow(store).exchangeCodeForSession(code);
  const user = data?.user;
  if (data?.session?.access_token) await authApi().admin.signOut(data.session.access_token).catch(() => undefined);
  const email = normalEmail(user?.email);
  if (error || !user || !email) back("Google didn’t confirm an email address. Try again, or use the emailed link.");
  await finishSignIn(email, user.id, next);
}
