import "server-only";
// Members (docs/tenancy.md, slice 2): the people of the current org and their roles. Every read
// and write goes through db(), so it is the current org's members only.
import { db } from "@/core/db";
import { env } from "@/core/env";
import { isRole, memberChangeProblem, normalEmail, type Member, type Role } from "@/core/roles";

export interface MemberRow extends Member { user_id: string | null; added_by: string | null; created_at: string; last_sign_in_at: string | null }

const COLS = "id, email, role, user_id, added_by, created_at, last_sign_in_at";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const row = (r: Record<string, unknown> | null): MemberRow | null => (r && isRole(r.role) ? (r as unknown as MemberRow) : null);

export async function memberById(id: string): Promise<MemberRow | null> {
  if (!ID.test(id)) return null;
  const { data, error } = await db().from("members").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return row(data);
}

export async function memberByEmail(email: string): Promise<MemberRow | null> {
  const e = normalEmail(email);
  if (!e) return null;
  const { data, error } = await db().from("members").select(COLS).eq("email", e).maybeSingle();
  if (error) throw new Error(error.message);
  return row(data);
}

export async function listMembers(): Promise<MemberRow[]> {
  const { data, error } = await db().from("members").select(COLS).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map(row).filter((m): m is MemberRow => !!m);
}

/**
 * The member an address signs in as. While the org has no members at all, OPERATOR_OWNER_EMAIL
 * becomes its first owner; anyone else needs an owner to add them first.
 */
export async function memberToSignIn(email: string): Promise<MemberRow | null> {
  const e = normalEmail(email);
  if (!e) return null;
  const found = await memberByEmail(e);
  if (found || !env.ownerEmail || e !== env.ownerEmail) return found;
  const { count, error } = await db().from("members").select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  if (count) return null;
  const ins = await db().from("members").insert({ email: e, role: "owner", added_by: "OPERATOR_OWNER_EMAIL" }).select(COLS).single();
  // two first sign-ins at once: the other one made the row
  if (ins.error) return memberByEmail(e);
  return row(ins.data);
}

/** After the emailed code checks out: ties the member to their auth user (first time) and notes the sign-in. */
export async function recordSignIn(m: MemberRow, userId: string): Promise<boolean> {
  if (m.user_id && m.user_id !== userId) return false;
  const { error } = await db().from("members").update({ user_id: userId, last_sign_in_at: new Date().toISOString() }).eq("id", m.id);
  if (error) throw new Error(error.message);
  return true;
}

export async function addMember(email: string, role: Role, by: string): Promise<MemberRow> {
  const e = normalEmail(email);
  if (!e) throw new Error("That isn’t an email address.");
  if (!isRole(role)) throw new Error("Pick a role.");
  if (await memberByEmail(e)) throw new Error(`${e} is already a member.`);
  const { data, error } = await db().from("members").insert({ email: e, role, added_by: by }).select(COLS).single();
  if (error) throw new Error(error.message);
  return row(data)!;
}

export async function setMemberRole(id: string, role: Role): Promise<void> {
  if (!isRole(role)) throw new Error("Pick a role.");
  const problem = memberChangeProblem(await listMembers(), id, role);
  if (problem) throw new Error(problem);
  const { error } = await db().from("members").update({ role }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeMember(id: string): Promise<void> {
  const problem = memberChangeProblem(await listMembers(), id, "removed");
  if (problem) throw new Error(problem);
  const { error } = await db().from("members").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
