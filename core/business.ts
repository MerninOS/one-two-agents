import "server-only";
// The business's own words (core/business-rules.ts), read from its row in orgs and written only
// by an owner on Settings, through the service-role helper in core/db.ts.
import { db, updateOrgRow } from "@/core/db";
import { orgId } from "@/core/tenancy";
import { UNKNOWN_BUSINESS, readBusiness, type Business } from "@/core/business-rules";

const cache = new Map<string, { b: Business; at: number }>();
const TTL_MS = 60_000;

/** The current org's name, about line and owner's name. Falls back to the name alone before the migration. */
export async function loadBusiness(): Promise<Business> {
  const org = await orgId();
  const hit = cache.get(org);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.b;
  let res = await db().from("orgs").select("name, about, owner_name").maybeSingle();
  if (res.error) res = await db().from("orgs").select("name").maybeSingle();
  if (res.error) { console.error("[business]", res.error.message); return UNKNOWN_BUSINESS; }
  const b = readBusiness(res.data as Record<string, unknown> | null);
  cache.set(org, { b, at: Date.now() });
  return b;
}

/** Saves the current org's words. The caller has checked the member is an owner. */
export async function saveBusiness(b: { name: string; about: string; ownerName: string }): Promise<void> {
  const org = await orgId();
  await updateOrgRow(org, { name: b.name.trim(), about: b.about.trim() || null, owner_name: b.ownerName.trim() || null });
  cache.delete(org);
}
