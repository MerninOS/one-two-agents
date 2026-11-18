import "server-only";
// Finishing a sign-in (docs/tenancy.md, slice 8.1), shared by the emailed link and Sign in with
// Google. Deliberately not a "use server" file: these take a verified address and must never be
// callable from the browser. Only code that has verified the address itself calls them.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { membershipsOf, type Membership } from "@/core/db";
import { memberById, memberToSignIn, recordSignIn } from "@/core/members";
import { loadBusiness } from "@/core/business";
import { HOME_ORG_ID, withOrg } from "@/core/tenancy";
import { PICK_COOKIE, SESSION_COOKIE, newPickToken, newSessionToken, pickChoices, pickCookieOptions, sessionCookieOptions, type Session } from "@/core/session";

/**
 * The memberships a verified address opens, each tied to its auth user. A membership already tied
 * to another auth user is left out. While no org has the address as a member, the home org's first
 * owner (OPERATOR_OWNER_EMAIL) is made here, as before.
 */
export async function openableMemberships(email: string): Promise<Membership[]> {
  const found = await membershipsOf(email);
  if (found.length) return found;
  const first = await withOrg(HOME_ORG_ID, () => memberToSignIn(email));
  return first ? membershipsOf(email) : [];
}

/**
 * After an address is verified: ties each of its memberships to the auth user, then signs in to the
 * one business, or sends a person in several to pick one. Shared by the email link and Google.
 */
export async function finishSignIn(email: string, userId: string, next: string): Promise<never> {
  const back: (problem: string) => never = (problem) => redirect(`/login?problem=${encodeURIComponent(problem)}`);
  const tied: Session[] = [];
  for (const m of await openableMemberships(email)) {
    const row = await withOrg(m.orgId, () => memberById(m.memberId));
    if (row && (await withOrg(m.orgId, () => recordSignIn(row, userId)))) tied.push({ memberId: m.memberId, orgId: m.orgId });
  }
  if (!tied.length) back("That address isn’t a member of any business here. Ask an owner to add you on Settings > People.");
  const jar = await cookies();
  if (tied.length === 1) {
    jar.set(SESSION_COOKIE, newSessionToken(tied[0].memberId, tied[0].orgId), sessionCookieOptions());
    redirect(next);
  }
  jar.set(PICK_COOKIE, newPickToken(tied), pickCookieOptions());
  redirect(`/auth/pick?next=${encodeURIComponent(next)}`);
}

/** The businesses a pending pick lists, with their names, for /auth/pick. */
export async function pickList(): Promise<{ memberId: string; orgName: string; role: string }[]> {
  const choices = pickChoices((await cookies()).get(PICK_COOKIE)?.value);
  if (!choices.length) return [];
  const out: { memberId: string; orgName: string; role: string }[] = [];
  for (const c of choices) {
    const b = await withOrg(c.orgId, async () => ({ biz: await loadBusiness(), m: await memberById(c.memberId) }));
    if (b.m) out.push({ memberId: c.memberId, orgName: b.biz.name || "Your business", role: b.m.role });
  }
  return out;
}

