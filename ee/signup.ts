// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Invite-only sign-up (card 128 slice 3c). The admin business (ee/admin.ts) makes codes; a code makes one business
// through core/install's newOrg, the same path as npm run org:new: its owner, every agent off duty,
// every action type at Draft, and a 14-day trial. The owner then signs in with the usual emailed link.
import "server-only";
import { db, updateOrgRow } from "@/core/db";
import { withOrg } from "@/core/tenancy";
import { SIGNUP_CLOSED, adminOrgId } from "./admin";
import { newOrg } from "@/core/install";
import { saveSettings } from "@/core/settings";
import { NO_SETTINGS } from "@/core/settings-rules";
import { CODE_DAYS, codeHash, newCode, slugFor, type SignupForm } from "./signup-rules";
import { PLAN } from "./plan-rules";

/** Runs `fn` as the admin business; refused when sign-up is closed. */
function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  const admin = adminOrgId();
  if (!admin) return Promise.reject(new Error(SIGNUP_CLOSED));
  return withOrg(admin, fn);
}

export interface CodeRow { id: string; note: string; created_by: string; created_at: string; expires_at: string; used_at: string | null; open: boolean }

/** The admin business's codes, newest first. */
export const listCodes = () => asAdmin(async () => {
  const { data, error } = await db().from("ee_signup_codes").select("id, note, created_by, created_at, expires_at, used_at").order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(/ee_signup_codes|relation|schema cache/.test(error.message) ? "The billing migration (20261212090000_ee_subscriptions.sql) isn’t applied yet." : error.message);
  const now = Date.now();
  return ((data ?? []) as Omit<CodeRow, "open">[]).map((c) => ({ ...c, open: !c.used_at && Date.parse(c.expires_at) > now }));
});

/** A new code from the admin business; returned once, kept only as a hash. */
export const makeCode = (note: string, by: string) => asAdmin(async () => {
  const code = newCode();
  const { error } = await db().from("ee_signup_codes").insert({
    code_hash: codeHash(code.replace(/-/g, "")), note: note.trim().slice(0, 120), created_by: by,
    expires_at: new Date(Date.now() + CODE_DAYS * 86_400_000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
});

/** Ends an unused code now. The row stays as a record. */
export const revokeCode = (id: string) => asAdmin(async () => {
  const { error } = await db().from("ee_signup_codes").update({ expires_at: new Date().toISOString() }).eq("id", id).is("used_at", null);
  if (error) throw new Error(error.message);
});

/**
 * Uses the code (once, while it hasn't expired), then makes the business. A code that can't be used
 * says only that, whether it never existed, expired or was used.
 */
export async function signUpBusiness(f: SignupForm): Promise<{ orgId: string }> {
  const now = new Date().toISOString();
  const claimed = await asAdmin(async () => {
    const { data, error } = await db().from("ee_signup_codes").update({ used_at: now }).eq("code_hash", codeHash(f.code)).is("used_at", null).gt("expires_at", now).select("id");
    if (error) throw new Error(error.message);
    return (data ?? [])[0] as { id: string } | undefined;
  });
  if (!claimed) throw new Error("That sign-up code doesn’t work: it may have been used or expired. Ask for a new one.");
  const { orgId } = await newOrg({ slug: slugFor(f.business), name: f.business, ownerEmail: f.email });
  await updateOrgRow(orgId, { name: f.business, about: null, owner_name: f.ownerName });
  await withOrg(orgId, async () => {
    await saveSettings({ ...NO_SETTINGS, ownerEmail: f.email });
    const { error } = await db().from("ee_subscriptions").insert({ status: "trialing", trial_ends_at: new Date(Date.now() + PLAN.trialDays * 86_400_000).toISOString(), seats: 1 });
    if (error) throw new Error(`The business was made, but its trial wasn’t started: ${error.message}`);
  });
  await asAdmin(async () => db().from("ee_signup_codes").update({ used_org_id: orgId }).eq("id", claimed.id));
  return { orgId };
}
