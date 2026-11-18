"use server";
// Sign-in (docs/tenancy.md, slice 2): each person signs in as themselves with a one-time link
// emailed by Supabase Auth. Only members get a link, and the page never says who is one. A person
// who is a member of several businesses picks one after the link (slice 8.1).
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authApi } from "@/core/db";
import { env } from "@/core/env";
import { normalEmail, safeNext } from "@/core/roles";
import { PICK_COOKIE, SESSION_COOKIE, loginConfigured, newSessionToken, pickChoices, sessionCookieOptions } from "@/core/session";
import { finishSignIn, openableMemberships } from "./signin";

export interface SignInState { sent?: string; error?: string }

/** This deployment's own address, for the link in the email. Supabase only sends links to its Redirect URLs. */
async function selfOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : env.dashboardUrl ?? "";
}

/** Emails a sign-in link when the address is a member of any business. Says "check your email" either way. */
export async function signIn(_: SignInState | undefined, form: FormData): Promise<SignInState> {
  const email = normalEmail(form.get("email"));
  if (!email) return { error: "Enter your email address." };
  if (!loginConfigured()) return { error: "SESSION_SECRET isn’t set (at least 32 characters), so nobody can sign in yet." };
  const next = safeNext(form.get("next"));
  try {
    const ms = await openableMemberships(email);
    if (ms.length) {
      const auth = authApi();
      // an invited member's auth user is made on their first sign-in, never for an unknown address
      if (ms.every((m) => !m.userId)) {
        const made = await auth.admin.createUser({ email, email_confirm: true });
        if (made.error && !/already|exists|registered/i.test(made.error.message)) throw new Error(made.error.message);
      }
      const { error } = await auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${await selfOrigin()}/auth/confirm?next=${encodeURIComponent(next)}` } });
      if (error) console.error("[sign-in] link not sent:", error.message);
    }
  } catch (e) {
    console.error("[sign-in]", e instanceof Error ? e.message : e);
    return { error: "Sign-in isn’t working right now. Try again in a minute." };
  }
  return { sent: email };
}

/**
 * The button on /auth/confirm: checks the one-time code with Supabase, then finishes the sign-in.
 * A button rather than the link itself, so a mail scanner that opens links can't use up the code.
 */
export async function confirmSignIn(form: FormData): Promise<void> {
  const tokenHash = String(form.get("token_hash") ?? "");
  const next = safeNext(form.get("next"));
  const back: (problem: string) => never = (problem) => redirect(`/login?problem=${encodeURIComponent(problem)}`);
  if (!loginConfigured()) back("SESSION_SECRET isn’t set, so nobody can sign in yet.");
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(tokenHash)) back("That sign-in link isn’t complete. Ask for a new one.");
  const auth = authApi();
  const { data, error } = await auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  const user = data?.user;
  if (error || !user?.email) back("That link has expired or was already used. Ask for a new one.");
  // we keep our own cookie; Supabase's session for this sign-in isn't needed
  if (data.session?.access_token) await auth.admin.signOut(data.session.access_token).catch(() => undefined);
  await finishSignIn(normalEmail(user.email) ?? user.email, user.id, next);
}

/** /auth/pick: a person in several businesses opens one. Only a business their sign-in listed. */
export async function pickBusiness(form: FormData): Promise<void> {
  const jar = await cookies();
  const choices = pickChoices(jar.get(PICK_COOKIE)?.value);
  const memberId = String(form.get("member") ?? "");
  const choice = choices.find((c) => c.memberId === memberId);
  if (!choice) redirect(`/login?problem=${encodeURIComponent("That sign-in has expired. Ask for a new link.")}`);
  jar.delete({ name: PICK_COOKIE, path: "/auth" });
  jar.set(SESSION_COOKIE, newSessionToken(choice.memberId, choice.orgId), sessionCookieOptions());
  redirect(safeNext(form.get("next")));
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
