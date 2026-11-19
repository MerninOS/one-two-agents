"use server";
// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Sign-up (no member yet, like signing in, so no role to check: the sign-up code is the check) and
// the admin business's sign-up codes (ee/admin.ts).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminOrgId } from "./admin";
import { audit } from "@/core/audit";
import { asRole } from "@/dashboard/data";
import { signIn } from "@/dashboard/authActions";
import { checkSignup } from "./signup-rules";
import { makeCode, revokeCode, signUpBusiness } from "./signup";

const again = (problem: string): never => redirect(`/signup?problem=${encodeURIComponent(problem.slice(0, 200))}`);

/** /signup: uses the code, makes the business, then emails the owner the usual sign-in link. */
export async function signUp(form: FormData): Promise<void> {
  const f = checkSignup(Object.fromEntries(form));
  if ("problem" in f) again(f.problem);
  const ok = (f as { ok: Parameters<typeof signUpBusiness>[0] }).ok;
  try { await signUpBusiness(ok); } catch (e) { again(e instanceof Error ? e.message : String(e)); }
  const link = new FormData(); link.set("email", ok.email); link.set("next", "/");
  const sent = await signIn(undefined, link);
  redirect(sent.error ? `/login?problem=${encodeURIComponent(`Your business is made. ${sent.error}`)}` : `/signup?sent=${encodeURIComponent(ok.email)}`);
}

const adminOnly = { ok: false as const, text: "Sign-up codes are made by the admin business." };

export async function createSignupCode(form: FormData): Promise<void> {
  const { me, no } = await asRole("owner"); if (no) redirect(`/settings?billing_problem=${encodeURIComponent(no.text)}`);
  if (me.orgId !== adminOrgId()) redirect(`/settings?billing_problem=${encodeURIComponent(adminOnly.text)}`);
  const code = await makeCode(String(form.get("note") ?? ""), me.email);
  await audit(me, "signup_code_add", null, { note: String(form.get("note") ?? "").slice(0, 60) });
  redirect(`/settings?new_code=${encodeURIComponent(code)}#billing`);
}

export async function revokeSignupCode(form: FormData): Promise<void> {
  const { me, no } = await asRole("owner"); if (no) redirect(`/settings?billing_problem=${encodeURIComponent(no.text)}`);
  if (me.orgId !== adminOrgId()) redirect(`/settings?billing_problem=${encodeURIComponent(adminOnly.text)}`);
  const id = String(form.get("id") ?? "");
  if (/^[0-9a-f-]{36}$/.test(id)) { await revokeCode(id); await audit(me, "signup_code_revoke", id); }
  revalidatePath("/settings");
}
