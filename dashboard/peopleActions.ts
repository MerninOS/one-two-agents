"use server";
// Settings > People (docs/tenancy.md, slice 2): owners add people by email, change their role and
// remove them. At least one owner always remains. Each action checks the role again.
import { audit } from "@/core/audit";
import { revalidatePath } from "next/cache";
import { addMember, removeMember, setMemberRole } from "@/core/members";
import { isRole } from "@/core/roles";
import type { ActionResult } from "./actions";
import { asRole } from "./data";

const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/settings"); return { ok: true, text }; };

export async function peopleAdd(email: string, role: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isRole(role)) return { ok: false, text: "Pick a role." };
  try {
    const m = await addMember(String(email ?? ""), role, me.email);
    await audit(me, "add_person", m.email, { role });
    return done(`Added ${m.email}. They sign in with their email on the sign-in page; nothing is sent until they do.`);
  } catch (e) { return fail(e); }
}

export async function peopleSetRole(id: string, role: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isRole(role)) return { ok: false, text: "Pick a role." };
  try { await setMemberRole(String(id), role); await audit(me, "set_role", id, { role }); return done("Role changed. It applies on their next click."); } catch (e) { return fail(e); }
}

export async function peopleRemove(id: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try { await removeMember(String(id)); await audit(me, "remove_person", id); return done("Removed. They’re signed out on their next click."); } catch (e) { return fail(e); }
}
